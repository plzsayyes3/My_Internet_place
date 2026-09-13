(() => {
  const OWNER = "plzsayyes3";
  const REPO = "my-storage-note";
  const BRANCH = "main";
  const STATE_PATH = "app-state/my-internet-place/reading-state.json";
  const TOKEN_KEY = "zen-note-github-token";
  const ALLOWED_STATUSES = new Set(["read", "skip", "keep"]);
  const MAX_RETRIES = 3;

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function configured() {
    return Boolean(token());
  }

  function apiUrl() {
    return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${STATE_PATH}`;
  }

  function headers() {
    const value = token();
    const result = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
    if (value) result.Authorization = `Bearer ${value}`;
    return result;
  }

  function decodeBase64Utf8(value) {
    const binary = atob(String(value || "").replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function emptyDocument() {
    return { version: 1, updated_at: null, articles: {} };
  }

  function normalizeDocument(value) {
    const document = value && typeof value === "object" ? value : emptyDocument();
    const articles = document.articles && typeof document.articles === "object"
      ? document.articles
      : {};
    return {
      version: 1,
      updated_at: document.updated_at || null,
      articles,
    };
  }

  async function fetchDocument() {
    if (!configured()) throw new Error("GitHub token is not configured");
    const response = await fetch(`${apiUrl()}?ref=${encodeURIComponent(BRANCH)}&t=${Date.now()}`, {
      headers: headers(),
      cache: "no-store",
    });

    if (response.status === 404) {
      return { document: emptyDocument(), sha: null };
    }
    if (!response.ok) throw new Error(`reading-state GET HTTP ${response.status}`);

    const payload = await response.json();
    const text = decodeBase64Utf8(payload.content || "");
    return {
      document: normalizeDocument(JSON.parse(text || "{}")),
      sha: payload.sha || null,
    };
  }

  async function writeDocument(document, sha, message) {
    const body = {
      message,
      branch: BRANCH,
      content: encodeBase64Utf8(`${JSON.stringify(document, null, 2)}\n`),
    };
    if (sha) body.sha = sha;

    const response = await fetch(apiUrl(), {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (response.status === 409 || response.status === 422) {
      const error = new Error(`reading-state conflict HTTP ${response.status}`);
      error.isConflict = true;
      throw error;
    }
    if (!response.ok) throw new Error(`reading-state PUT HTTP ${response.status}`);
    return response.json();
  }

  async function load() {
    if (!configured()) return new Map();
    const { document } = await fetchDocument();
    return new Map(
      Object.entries(document.articles || {}).map(([articleId, state]) => [
        String(articleId),
        {
          article_id: String(articleId),
          status: state?.status || null,
          updated_at: state?.updated_at || null,
        },
      ])
    );
  }

  async function mutate(articleId, nextStatus) {
    const id = String(articleId);
    if (nextStatus !== null && !ALLOWED_STATUSES.has(nextStatus)) {
      throw new Error(`invalid reading state: ${nextStatus}`);
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const { document, sha } = await fetchDocument();
      const now = new Date().toISOString();

      if (nextStatus === null) {
        delete document.articles[id];
      } else {
        document.articles[id] = { status: nextStatus, updated_at: now };
      }
      document.updated_at = now;

      try {
        await writeDocument(
          document,
          sha,
          nextStatus === null
            ? `Clear reading state: ${id}`
            : `Set reading state: ${id} -> ${nextStatus}`
        );
        return nextStatus === null
          ? null
          : { article_id: id, status: nextStatus, updated_at: now };
      } catch (error) {
        if (!error.isConflict || attempt === MAX_RETRIES - 1) throw error;
      }
    }
    throw new Error("reading-state save failed");
  }

  async function set(articleId, status) {
    return mutate(articleId, status);
  }

  async function clear(articleId) {
    return mutate(articleId, null);
  }

  function configureFromPrompt() {
    const current = token();
    const next = window.prompt(
      "GitHub token（Cockpidと共通 / この端末のlocalStorageにのみ保存）",
      current
    );
    if (next === null) return false;
    if (next.trim()) localStorage.setItem(TOKEN_KEY, next.trim());
    else localStorage.removeItem(TOKEN_KEY);
    return true;
  }

  window.ReadingState = {
    configured,
    load,
    set,
    clear,
    configureFromPrompt,
  };
})();
