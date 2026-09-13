(() => {
  const API_KEY = "mip:reading-state-api";
  const TOKEN_KEY = "mip:reading-state-token";

  function apiUrl() {
    return (localStorage.getItem(API_KEY) || "").replace(/\/$/, "");
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function configured() {
    return Boolean(apiUrl() && token());
  }

  function headers() {
    return {
      "Authorization": `Bearer ${token()}`,
      "Content-Type": "application/json",
    };
  }

  async function request(path, options = {}) {
    if (!configured()) throw new Error("reading-state sync is not configured");
    const response = await fetch(`${apiUrl()}${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`reading-state HTTP ${response.status}`);
    return response.json();
  }

  async function load() {
    if (!configured()) return new Map();
    const payload = await request("/states");
    return new Map((payload.states || []).map((state) => [String(state.article_id), state]));
  }

  async function set(articleId, status) {
    return request(`/states/${encodeURIComponent(articleId)}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  }

  async function clear(articleId) {
    return request(`/states/${encodeURIComponent(articleId)}`, { method: "DELETE" });
  }

  function configureFromPrompt() {
    const currentApi = apiUrl();
    const nextApi = window.prompt("Reading State API URL", currentApi);
    if (nextApi === null) return false;
    if (!nextApi.trim()) {
      localStorage.removeItem(API_KEY);
      localStorage.removeItem(TOKEN_KEY);
      return true;
    }

    const nextToken = window.prompt("Sync key（この端末だけに保存）", token());
    if (nextToken === null) return false;
    if (!nextToken.trim()) {
      localStorage.removeItem(API_KEY);
      localStorage.removeItem(TOKEN_KEY);
      return true;
    }

    localStorage.setItem(API_KEY, nextApi.trim().replace(/\/$/, ""));
    localStorage.setItem(TOKEN_KEY, nextToken.trim());
    return true;
  }

  window.ReadingState = { configured, load, set, clear, configureFromPrompt };
})();
