(() => {
  const OWNER = "plzsayyes3";
  const REPO = "my-storage-note";
  const BRANCH = "main";
  const STATE_PATH = "app-state/my-internet-place/reading-state.json";
  const TOKEN_KEY = "zen-note-github-token";
  const PENDING_KEY = "my-internet-place-reading-state-pending-v2";
  const LEGACY_PENDING_KEY = "my-internet-place-reading-state-pending-v1";
  const MAX_RETRIES = 3;
  const SYNC_DELAY_MS = 1500;
  const RETRY_DELAY_MS = 15000;

  let syncTimer = null;
  let flushPromise = null;
  const listeners = new Set();

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

  function normalizeArticleState(value) {
    const raw = value && typeof value === "object" ? value : {};
    const legacyStatus = typeof raw.status === "string" ? raw.status : null;
    return {
      read: typeof raw.read === "boolean" ? raw.read : legacyStatus === "read",
      kept: typeof raw.kept === "boolean" ? raw.kept : legacyStatus === "keep",
      skipped: typeof raw.skipped === "boolean" ? raw.skipped : legacyStatus === "skip",
      note: typeof raw.note === "string" ? raw.note : "",
      updated_at: raw.updated_at || null,
    };
  }

  function isEmptyState(state) {
    return !state.read && !state.kept && !state.skipped && !state.note;
  }

  function emptyDocument() {
    return { version: 2, updated_at: null, articles: {} };
  }

  function normalizeDocument(value) {
    const document = value && typeof value === "object" ? value : emptyDocument();
    const sourceArticles = document.articles && typeof document.articles === "object"
      ? document.articles
      : {};
    const articles = {};
    for (const [articleId, rawState] of Object.entries(sourceArticles)) {
      const state = normalizeArticleState(rawState);
      if (!isEmptyState(state)) articles[String(articleId)] = state;
    }
    return {
      version: 2,
      updated_at: document.updated_at || null,
      articles,
    };
  }

  function emptyPendingDocument() {
    return { version: 2, mutations: {} };
  }

  function migrateLegacyPending() {
    try {
      const raw = localStorage.getItem(LEGACY_PENDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const mutations = {};
      for (const [articleId, mutation] of Object.entries(parsed?.mutations || {})) {
        if (mutation?.status === null) {
          mutations[String(articleId)] = {
            state: null,
            updated_at: mutation?.updated_at || new Date().toISOString(),
          };
          continue;
        }
        const state = normalizeArticleState({
          status: mutation?.status,
          updated_at: mutation?.updated_at,
        });
        mutations[String(articleId)] = {
          state,
          updated_at: state.updated_at || new Date().toISOString(),
        };
      }
      localStorage.removeItem(LEGACY_PENDING_KEY);
      return { version: 2, mutations };
    } catch (error) {
      console.warn("legacy reading-state pending buffer could not be migrated", error);
      return null;
    }
  }

  function loadPendingDocument() {
    try {
      let raw = localStorage.getItem(PENDING_KEY);
      if (!raw) {
        const migrated = migrateLegacyPending();
        if (migrated && Object.keys(migrated.mutations).length) {
          localStorage.setItem(PENDING_KEY, JSON.stringify(migrated));
          return migrated;
        }
        return emptyPendingDocument();
      }
      const parsed = JSON.parse(raw);
      const normalized = {};
      for (const [articleId, mutation] of Object.entries(parsed?.mutations || {})) {
        if (mutation?.state === null) {
          normalized[String(articleId)] = {
            state: null,
            updated_at: mutation?.updated_at || new Date().toISOString(),
          };
          continue;
        }
        const state = normalizeArticleState(mutation?.state || mutation);
        const updatedAt = mutation?.updated_at || state.updated_at || new Date().toISOString();
        state.updated_at = updatedAt;
        normalized[String(articleId)] = { state, updated_at: updatedAt };
      }
      return { version: 2, mutations: normalized };
    } catch (error) {
      console.warn("reading-state pending buffer was invalid and has been reset", error);
      return emptyPendingDocument();
    }
  }

  function savePendingDocument(document) {
    const mutations = document?.mutations || {};
    if (!Object.keys(mutations).length) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify({ version: 2, mutations }));
  }

  function pendingCount() {
    return Object.keys(loadPendingDocument().mutations).length;
  }

  function emit(phase, extra = {}) {
    const detail = { phase, pending: pendingCount(), ...extra };
    for (const listener of listeners) {
      try {
        listener(detail);
      } catch (error) {
        console.error(error);
      }
    }
  }

  function onStatus(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
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

  function mapFromDocument(document) {
    return new Map(
      Object.entries(document.articles || {}).map(([articleId, rawState]) => {
        const state = normalizeArticleState(rawState);
        return [String(articleId), { article_id: String(articleId), ...state }];
      })
    );
  }

  function applyPendingToMap(states, pendingDocument = loadPendingDocument()) {
    const merged = new Map(states);
    for (const [articleId, mutation] of Object.entries(pendingDocument.mutations || {})) {
      if (mutation.state === null) {
        merged.delete(String(articleId));
      } else {
        merged.set(String(articleId), {
          article_id: String(articleId),
          ...normalizeArticleState(mutation.state),
          pending: true,
        });
      }
    }
    return merged;
  }

  async function load() {
    if (!configured()) return applyPendingToMap(new Map());
    const { document } = await fetchDocument();
    const merged = applyPendingToMap(mapFromDocument(document));
    if (pendingCount()) scheduleFlush(250);
    return merged;
  }

  function queueMutation(articleId, state) {
    const id = String(articleId);
    const pending = loadPendingDocument();
    const updatedAt = new Date().toISOString();

    if (state === null || isEmptyState(normalizeArticleState(state))) {
      pending.mutations[id] = { state: null, updated_at: updatedAt };
    } else {
      const normalized = normalizeArticleState(state);
      normalized.updated_at = updatedAt;
      pending.mutations[id] = { state: normalized, updated_at: updatedAt };
    }

    savePendingDocument(pending);
    emit("queued", { article_id: id, state });
    scheduleFlush();

    if (state === null) return null;
    return {
      article_id: id,
      ...normalizeArticleState({ ...state, updated_at: updatedAt }),
      pending: true,
    };
  }

  function sameMutation(a, b) {
    return Boolean(a && b)
      && JSON.stringify(a.state ?? null) === JSON.stringify(b.state ?? null)
      && a.updated_at === b.updated_at;
  }

  function applyMutationSnapshot(document, snapshot) {
    const mutationTimes = [];
    for (const [articleId, mutation] of Object.entries(snapshot)) {
      mutationTimes.push(mutation.updated_at);
      if (mutation.state === null) {
        delete document.articles[articleId];
      } else {
        document.articles[articleId] = normalizeArticleState({
          ...mutation.state,
          updated_at: mutation.updated_at,
        });
      }
    }
    document.version = 2;
    document.updated_at = mutationTimes.sort().at(-1) || new Date().toISOString();
    return document;
  }

  function removeSyncedSnapshot(snapshot) {
    const current = loadPendingDocument();
    for (const [articleId, mutation] of Object.entries(snapshot)) {
      if (sameMutation(current.mutations[articleId], mutation)) {
        delete current.mutations[articleId];
      }
    }
    savePendingDocument(current);
    return Object.keys(current.mutations).length;
  }

  async function performFlush() {
    if (!configured()) return { synced: 0, pending: pendingCount() };
    const pending = loadPendingDocument();
    const snapshot = { ...pending.mutations };
    const count = Object.keys(snapshot).length;
    if (!count) return { synced: 0, pending: 0 };

    emit("syncing", { count });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const { document, sha } = await fetchDocument();
      applyMutationSnapshot(document, snapshot);
      try {
        await writeDocument(
          document,
          sha,
          `Sync reading state (${count} change${count === 1 ? "" : "s"})`
        );
        const remaining = removeSyncedSnapshot(snapshot);
        emit("synced", { count, pending: remaining });
        if (remaining) scheduleFlush();
        return { synced: count, pending: remaining };
      } catch (error) {
        if (!error.isConflict || attempt === MAX_RETRIES - 1) throw error;
      }
    }
    throw new Error("reading-state save failed");
  }

  function flush() {
    if (flushPromise) return flushPromise;
    clearTimeout(syncTimer);
    syncTimer = null;
    flushPromise = performFlush()
      .catch((error) => {
        emit("error", { error });
        if (configured() && pendingCount()) scheduleFlush(RETRY_DELAY_MS);
        throw error;
      })
      .finally(() => {
        flushPromise = null;
      });
    return flushPromise;
  }

  function scheduleFlush(delay = SYNC_DELAY_MS) {
    if (!configured() || !pendingCount()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      flush().catch((error) => console.error(error));
    }, delay);
  }

  function setState(articleId, state) {
    return queueMutation(articleId, state);
  }

  function set(articleId, status) {
    const legacy = status === "read"
      ? { read: true, kept: false, skipped: false, note: "" }
      : status === "keep"
        ? { read: false, kept: true, skipped: false, note: "" }
        : status === "skip"
          ? { read: false, kept: false, skipped: true, note: "" }
          : null;
    return queueMutation(articleId, legacy);
  }

  function clear(articleId) {
    return queueMutation(articleId, null);
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
    if (configured() && pendingCount()) scheduleFlush(250);
    return true;
  }

  window.addEventListener("online", () => scheduleFlush(250));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleFlush(250);
  });

  window.ReadingState = {
    configured,
    load,
    setState,
    set,
    clear,
    flush,
    pendingCount,
    onStatus,
    configureFromPrompt,
  };
})();