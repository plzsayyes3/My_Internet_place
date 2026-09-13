const ALLOWED_STATUSES = new Set(["read", "skip", "keep"]);

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = env.ALLOWED_ORIGIN || "https://plzsayyes3.github.io";
  const allow = origin === allowedOrigin ? origin : allowedOrigin;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request, env, value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
    },
  });
}

function authorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return Boolean(env.SYNC_TOKEN) && auth === `Bearer ${env.SYNC_TOKEN}`;
}

function articleIdFromPath(pathname) {
  const match = pathname.match(/^\/states\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (!authorized(request, env)) {
      return json(request, env, { error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/states") {
      const result = await env.DB.prepare(
        "SELECT article_id, status, updated_at FROM article_states ORDER BY updated_at DESC"
      ).all();
      return json(request, env, { states: result.results || [] });
    }

    const articleId = articleIdFromPath(url.pathname);
    if (!articleId) return json(request, env, { error: "not_found" }, 404);

    if (request.method === "PUT") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json(request, env, { error: "invalid_json" }, 400);
      }
      const status = String(body?.status || "");
      if (!ALLOWED_STATUSES.has(status)) {
        return json(request, env, { error: "invalid_status" }, 400);
      }
      const updatedAt = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO article_states (article_id, status, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(article_id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at`
      ).bind(articleId, status, updatedAt).run();
      return json(request, env, { article_id: articleId, status, updated_at: updatedAt });
    }

    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM article_states WHERE article_id = ?")
        .bind(articleId).run();
      return json(request, env, { article_id: articleId, status: null });
    }

    return json(request, env, { error: "method_not_allowed" }, 405);
  },
};
