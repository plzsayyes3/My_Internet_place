const DATA_URL = "./data/latest.json";

const deckViewEl = document.querySelector("#deck-view");
const deckEl = document.querySelector("#deck");
const deckProgressEl = document.querySelector("#deck-progress");
const feedEl = document.querySelector("#feed");
const emptyEl = document.querySelector("#empty");
const primaryNavEl = document.querySelector("#primary-nav");
const filtersEl = document.querySelector("#filters");
const topicFiltersEl = document.querySelector("#topic-filters");
const generatedEl = document.querySelector("#generated");
const healthEl = document.querySelector("#health");
const syncSettingsEl = document.querySelector("#sync-settings");
const syncStatusEl = document.querySelector("#sync-status");
const deckTemplate = document.querySelector("#deck-template");
const listCardTemplate = document.querySelector("#list-card-template");
const toastEl = document.querySelector("#toast");

let allItems = [];
let readingStates = new Map();
let activeView = "deck";
let activeCategory = null;
let activeTopic = null;
let toastTimer = null;

let categoryOrder = [
  "ai", "knowledge", "software", "making", "small_devices", "ios_apple",
  "education", "work", "personal_web", "games", "lifestyle", "other",
];

let categoryLabels = {
  ai: "AI",
  knowledge: "KNOWLEDGE / NOTES",
  software: "SOFTWARE",
  making: "MAKING",
  small_devices: "SMALL DEVICES",
  ios_apple: "iOS / APPLE",
  education: "CHILDCARE / EDUCATION",
  work: "WORK / TASK",
  personal_web: "PERSONAL WEB",
  games: "GAMES / POKEMON",
  lifestyle: "LIFESTYLE",
  other: "OTHER",
};

const SOURCE_REPEAT_PENALTY = 0.65;
const CONSECUTIVE_SOURCE_PENALTY = 0.35;
const READ_PENALTY = 1000;
const SKIP_PENALTY = 2000;

const LEGACY_CATEGORY_MAP = {
  ai_tools: "ai",
  knowledge_tools: "knowledge",
  software_building: "software",
  personal_devices: "small_devices",
  devices: "small_devices",
  make: "making",
  productivity: "work",
  education_childcare: "education",
  web: "personal_web",
  personal_web: "personal_web",
  life: "lifestyle",
  discovery: "other",
};

function configureGenres(genres) {
  if (!Array.isArray(genres) || !genres.length) return;
  const normalized = genres
    .filter((genre) => genre && genre.id)
    .map((genre) => ({
      id: String(genre.id),
      label: String(genre.label || genre.id),
      order: Number(genre.order ?? 999),
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  if (!normalized.length) return;
  categoryOrder = normalized.map((genre) => genre.id);
  categoryLabels = Object.fromEntries(normalized.map((genre) => [genre.id, genre.label]));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function numericTime(value) {
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? 0 : time;
}

function normalizedCategory(category) {
  return LEGACY_CATEGORY_MAP[category] || category || "other";
}

function itemCategory(item) {
  return normalizedCategory(item.genre || item.primary_category || item.source_category);
}

function categoryLabel(category) {
  return categoryLabels[normalizedCategory(category)] || String(category || "OTHER").toUpperCase();
}

function itemTopics(item) {
  const explicitIds = Array.isArray(item.topic_ids) ? item.topic_ids : [];
  const explicitLabels = Array.isArray(item.topic_labels) ? item.topic_labels : [];

  if (explicitIds.length) {
    return explicitIds.map((id, index) => ({
      id: String(id),
      label: String(explicitLabels[index] || id),
    }));
  }

  if (!Array.isArray(item.topics)) return [];
  return item.topics
    .map((topic) => {
      if (typeof topic === "string") return { id: topic, label: topic };
      if (!topic || !topic.id) return null;
      return { id: String(topic.id), label: String(topic.label || topic.id) };
    })
    .filter(Boolean);
}

function itemHasTopic(item, topicId) {
  return itemTopics(item).some((topic) => topic.id === topicId);
}

function itemThumbnail(item) {
  const candidates = [
    item.thumbnail_url,
    item.image_url,
    item.og_image,
    item.image,
    item.thumbnail,
  ];
  return candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || "";
}

function sourceKey(item) {
  return item.source_id || item.source || "unknown";
}

function emptyState() {
  return {
    read: false,
    kept: false,
    skipped: false,
    note: "",
    updated_at: null,
  };
}

function itemState(item) {
  return readingStates.get(String(item.id)) || emptyState();
}

function isProcessed(item) {
  const state = itemState(item);
  return Boolean(state.read || state.kept || state.skipped);
}

function statePenalty(item) {
  const state = itemState(item);
  if (state.skipped) return SKIP_PENALTY;
  if (state.read && !state.kept) return READ_PENALTY;
  return 0;
}

function stateSortRank(item) {
  const state = itemState(item);
  if (state.skipped) return 2;
  if (state.read && !state.kept) return 1;
  return 0;
}

function compareFreshWithinState(a, b) {
  const stateDiff = stateSortRank(a) - stateSortRank(b);
  if (stateDiff) return stateDiff;
  return numericTime(b.published_at) - numericTime(a.published_at);
}

function diversifyForYou(items) {
  const remaining = [...items];
  const selected = [];
  const sourceCounts = new Map();
  let previousSource = null;

  while (remaining.length) {
    let bestIndex = 0;
    let bestAdjustedScore = -Infinity;
    let bestPublishedAt = 0;

    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      const source = sourceKey(item);
      const sourceCount = sourceCounts.get(source) || 0;
      const adjustedScore = Number(item.rank_score || item.interest_score || item.score || 0)
        - sourceCount * SOURCE_REPEAT_PENALTY
        - (source === previousSource ? CONSECUTIVE_SOURCE_PENALTY : 0)
        - statePenalty(item);
      const publishedAt = numericTime(item.published_at);

      if (adjustedScore > bestAdjustedScore
          || (adjustedScore === bestAdjustedScore && publishedAt > bestPublishedAt)) {
        bestIndex = index;
        bestAdjustedScore = adjustedScore;
        bestPublishedAt = publishedAt;
      }
    }

    const [nextItem] = remaining.splice(bestIndex, 1);
    const nextSource = sourceKey(nextItem);
    selected.push(nextItem);
    sourceCounts.set(nextSource, (sourceCounts.get(nextSource) || 0) + 1);
    previousSource = nextSource;
  }

  return selected;
}

function scoreLabel(item) {
  const score = Number(item.rank_score || item.interest_score || item.score || 0);
  if (score >= 3) return `FOR YOU ${Math.min(99, 70 + Math.round(score * 6))}%`;
  if (score > 0) return "MATCH";
  return "DISCOVER";
}

function itemSignal(item) {
  const sourceType = String(item.source_type || "").toLowerCase();
  const researchType = String(item.research_type || "").toLowerCase();

  if (researchType === "from_note" || item.from_note === true) return "FROM NOTE";
  if (sourceType === "personal_research" || researchType === "zapping") return "WIDEN";
  return "FOLLOWING";
}

function itemReason(item) {
  if (typeof item.pick_reason === "string" && item.pick_reason.trim()) {
    return item.pick_reason.trim();
  }

  const topics = itemTopics(item);
  const topicLabels = new Set(topics.map((topic) => topic.label));
  const matchedLabels = Array.isArray(item.matched_labels) ? item.matched_labels : [];
  const preferenceLabels = matchedLabels.filter((label) => !topicLabels.has(label));
  if (preferenceLabels.length) return `関心: ${preferenceLabels.join(" · ")}`;

  if (Array.isArray(item.discovery_queries) && item.discovery_queries.length) {
    return `探索テーマ: ${item.discovery_queries.slice(0, 2).join(" · ")}`;
  }

  if (itemSignal(item) === "WIDEN") {
    return "いつもの情報源だけに偏らないための探索記事。";
  }

  return `${categoryLabel(itemCategory(item))} の継続ウォッチから。`;
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 1600);
}

function setSyncStatus(text, isError = false) {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = text;
  syncStatusEl.dataset.error = isError ? "true" : "false";
}

function pendingSyncLabel() {
  const pending = window.ReadingState?.pendingCount?.() || 0;
  if (!window.ReadingState?.configured()) {
    return pending ? `reading state: local · ${pending} pending` : "reading state: local only";
  }
  return pending ? `reading state: ${pending} pending` : `reading state: ${readingStates.size} synced`;
}

function updateSyncButton() {
  if (!syncSettingsEl || !window.ReadingState) return;
  syncSettingsEl.textContent = window.ReadingState.configured() ? "SYNC" : "SYNC SETUP";
}

async function refreshReadingStates() {
  try {
    readingStates = await window.ReadingState.load();
    setSyncStatus(pendingSyncLabel());
  } catch (error) {
    readingStates = new Map();
    setSyncStatus("reading state: sync error", true);
    console.error(error);
  }
  updateSyncButton();
}

function saveState(item, patch, options = {}) {
  const id = String(item.id);
  const current = itemState(item);
  const next = {
    ...emptyState(),
    ...current,
    ...patch,
  };

  try {
    const saved = window.ReadingState.setState(id, next);
    if (saved) readingStates.set(id, saved);
    else readingStates.delete(id);
    setSyncStatus(pendingSyncLabel());

    if (options.toast) showToast(options.toast);
    if (options.render !== false) renderCurrentView();
    return saved;
  } catch (error) {
    setSyncStatus("reading state: local save error", true);
    console.error(error);
    return null;
  }
}

function actionPatch(action) {
  if (action === "skip") {
    return { skipped: true, read: false, kept: false };
  }
  if (action === "read") {
    return { skipped: false, read: true, kept: false };
  }
  if (action === "keep") {
    return { skipped: false, read: false, kept: true };
  }
  if (action === "read-now") {
    return { skipped: false, read: true, kept: true };
  }
  return {};
}

function openItem(item) {
  if (!item?.url) return;
  window.open(item.url, "_blank", "noopener,noreferrer");
}

function readNow(item, options = {}) {
  openItem(item);
  saveState(item, actionPatch("read-now"), {
    render: options.render !== false,
    toast: "あとで読むに保存し、既読にしました",
  });
}

function renderTags(container, item) {
  container.innerHTML = "";
  const topics = itemTopics(item);
  for (const topic of topics) {
    const tag = document.createElement("span");
    tag.className = "topic-tag";
    tag.textContent = topic.label;
    container.appendChild(tag);
  }
  container.hidden = topics.length === 0;
}

function deckItems() {
  return diversifyForYou(allItems.filter((item) => !isProcessed(item)));
}

function renderDeck() {
  deckEl.innerHTML = "";
  const items = deckItems();
  deckProgressEl.textContent = items.length ? `${items.length} LEFT` : "0 LEFT";

  if (!items.length) {
    deckEl.classList.add("is-empty");
    const empty = document.createElement("div");
    empty.className = "deck-empty";
    empty.innerHTML = "<h2>ひと通り見ました。</h2><p>KEEPした記事や、残したメモはそのまま残っています。</p>";
    deckEl.appendChild(empty);
    return;
  }

  deckEl.classList.remove("is-empty");
  const item = items[0];
  const state = itemState(item);
  const node = deckTemplate.content.cloneNode(true);
  const card = node.querySelector(".deck-card");

  node.querySelector(".deck-source").textContent = item.source || "Unknown source";
  const signal = node.querySelector(".deck-signal");
  const signalText = itemSignal(item);
  signal.textContent = signalText;
  signal.dataset.signal = signalText;

  const title = node.querySelector(".deck-title");
  title.textContent = item.title_ja || item.title || "";
  title.addEventListener("click", () => readNow(item));

  const summary = node.querySelector(".deck-summary");
  const summaryText = item.summary_ja || item.summary || "";
  summary.textContent = summaryText;
  summary.hidden = !summaryText;

  renderTags(node.querySelector(".deck-tags"), item);

  const reason = node.querySelector(".deck-reason span");
  reason.textContent = itemReason(item);

  const imageWrap = node.querySelector(".deck-image-wrap");
  const image = node.querySelector(".deck-image");
  const imageUrl = itemThumbnail(item);
  if (imageUrl) {
    image.src = imageUrl;
    imageWrap.hidden = false;
    image.addEventListener("error", () => {
      imageWrap.hidden = true;
    }, { once: true });
  }

  const memoInput = node.querySelector(".memo-input");
  const memoStatus = node.querySelector(".memo-status");
  memoInput.value = state.note || "";
  let memoTimer = null;

  memoInput.addEventListener("input", () => {
    memoStatus.textContent = "SAVING…";
    clearTimeout(memoTimer);
    memoTimer = setTimeout(() => {
      saveState(item, { note: memoInput.value }, { render: false });
      memoStatus.textContent = "SAVED";
    }, 450);
  });

  node.querySelector(".read-now").addEventListener("click", () => {
    readNow(item, { render: false });
    animateDecision(card, "read-now", item);
  });

  node.querySelectorAll(".deck-action[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      animateDecision(card, button.dataset.action, item);
    });
  });

  bindSwipe(card, item);
  deckEl.appendChild(node);
}

function bindSwipe(card, item) {
  const cues = {
    skip: card.querySelector('[data-cue="skip"]'),
    read: card.querySelector('[data-cue="read"]'),
    keep: card.querySelector('[data-cue="keep"]'),
  };

  const HORIZONTAL_THRESHOLD = 112;
  const UP_THRESHOLD = 96;

  let startX = 0;
  let startY = 0;
  let active = false;
  let pointerId = null;
  let currentAction = null;
  let ready = false;

  function resetCues() {
    Object.values(cues).forEach((cue) => {
      cue.style.opacity = "0";
      cue.classList.remove("is-ready");
    });
  }

  function setCue(action, progress, isReady) {
    resetCues();
    if (!action) return;
    const cue = cues[action];
    cue.style.opacity = String(Math.min(.98, .18 + progress * .82));
    cue.classList.toggle("is-ready", isReady);
  }

  function snapBack() {
    card.classList.remove("is-dragging");
    card.style.transform = "";
    resetCues();
    currentAction = null;
    ready = false;
  }

  card.addEventListener("pointerdown", (event) => {
    if (event.target.closest("textarea, button")) return;

    startX = event.clientX;
    startY = event.clientY;
    active = true;
    pointerId = event.pointerId;
    currentAction = null;
    ready = false;
    card.classList.add("is-dragging");
    card.setPointerCapture?.(event.pointerId);
  });

  card.addEventListener("pointermove", (event) => {
    if (!active || event.pointerId !== pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);

    let action = null;
    let progress = 0;
    let isReady = false;

    if (ax > ay * 1.12 && ax > 12) {
      action = dx < 0 ? "skip" : "keep";
      progress = Math.min(1, ax / HORIZONTAL_THRESHOLD);
      isReady = ax >= HORIZONTAL_THRESHOLD;
      card.style.transform = `translate3d(${dx}px, ${dy * .14}px, 0) rotate(${dx * .025}deg)`;
    } else if (dy < -12 && ay > ax * .82) {
      action = "read";
      progress = Math.min(1, ay / UP_THRESHOLD);
      isReady = ay >= UP_THRESHOLD;
      card.style.transform = `translate3d(${dx * .12}px, ${dy}px, 0) rotate(${dx * .012}deg)`;
    } else {
      card.style.transform = `translate3d(${dx * .18}px, ${Math.min(14, Math.max(-14, dy * .18))}px, 0)`;
    }

    currentAction = action;
    ready = isReady;
    setCue(action, progress, isReady);
  });

  card.addEventListener("pointerup", (event) => {
    if (!active || event.pointerId !== pointerId) return;
    active = false;
    card.releasePointerCapture?.(event.pointerId);

    if (currentAction && ready) {
      card.classList.remove("is-dragging");
      animateDecision(card, currentAction, item);
    } else {
      snapBack();
    }
  });

  card.addEventListener("pointercancel", () => {
    active = false;
    snapBack();
  });
}

function animateDecision(card, action, item) {
  if (!card || card.dataset.committing === "true") return;
  card.dataset.committing = "true";
  card.classList.remove("is-dragging");
  card.style.transform = "";

  if (action === "skip") card.classList.add("fly-left");
  if (action === "keep") card.classList.add("fly-right");
  if (action === "read" || action === "read-now") card.classList.add("fly-up");

  if (action !== "read-now") {
    const labels = {
      skip: "興味なしにしました",
      read: "既読にしました",
      keep: "あとで読むに保存しました",
    };
    saveState(item, actionPatch(action), { render: false, toast: labels[action] });
  }

  setTimeout(() => renderDeck(), 230);
}

function stateLabel(state) {
  if (state.skipped) return "興味なし";
  if (state.kept && state.read) return "保存・既読";
  if (state.kept) return "あとで読む";
  if (state.read) return "既読";
  return "";
}

function renderCategoryFilters() {
  filtersEl.innerHTML = "";

  if (activeView !== "latest") {
    filtersEl.hidden = true;
    topicFiltersEl.hidden = true;
    return;
  }

  const available = new Set(allItems.map(itemCategory));
  const allButton = document.createElement("button");
  allButton.className = `filter${activeCategory ? "" : " is-active"}`;
  allButton.dataset.category = "";
  allButton.textContent = "ALL";
  filtersEl.appendChild(allButton);

  for (const category of categoryOrder.filter((id) => available.has(id))) {
    const button = document.createElement("button");
    button.className = `filter${activeCategory === category ? " is-active" : ""}`;
    button.dataset.category = category;
    button.textContent = categoryLabel(category);
    filtersEl.appendChild(button);
  }

  filtersEl.hidden = false;
  renderTopicFilters();
}

function renderTopicFilters() {
  topicFiltersEl.innerHTML = "";

  if (activeView !== "latest" || !activeCategory) {
    topicFiltersEl.hidden = true;
    activeTopic = null;
    return;
  }

  const topics = new Map();
  for (const item of allItems.filter((candidate) => itemCategory(candidate) === activeCategory)) {
    for (const topic of itemTopics(item)) {
      if (!topics.has(topic.id)) topics.set(topic.id, topic.label);
    }
  }

  if (!topics.size) {
    topicFiltersEl.hidden = true;
    return;
  }

  const allButton = document.createElement("button");
  allButton.className = `filter${activeTopic ? "" : " is-active"}`;
  allButton.dataset.topic = "";
  allButton.textContent = "すべて";
  topicFiltersEl.appendChild(allButton);

  for (const [id, label] of [...topics.entries()].sort((a, b) => a[1].localeCompare(b[1], "ja"))) {
    const button = document.createElement("button");
    button.className = `filter${activeTopic === id ? " is-active" : ""}`;
    button.dataset.topic = id;
    button.textContent = label;
    topicFiltersEl.appendChild(button);
  }

  topicFiltersEl.hidden = false;
}

function listItems() {
  if (activeView === "keep") {
    return allItems
      .filter((item) => itemState(item).kept)
      .sort((a, b) => numericTime(b.published_at) - numericTime(a.published_at));
  }

  let items = [...allItems];
  if (activeCategory) {
    items = items.filter((item) => itemCategory(item) === activeCategory);
  }
  if (activeTopic) {
    items = items.filter((item) => itemHasTopic(item, activeTopic));
  }
  return items.sort(compareFreshWithinState);
}

function renderList() {
  feedEl.innerHTML = "";
  const items = listItems();
  emptyEl.hidden = items.length > 0;
  emptyEl.textContent = activeView === "keep"
    ? "あとで読む記事はまだありません。"
    : "記事がありません。";

  for (const item of items) {
    const state = itemState(item);
    const node = listCardTemplate.content.cloneNode(true);
    const card = node.querySelector(".list-card");

    if (state.read) card.classList.add("is-read");
    if (state.kept) card.classList.add("is-kept");
    if (state.skipped) card.classList.add("is-skipped");

    node.querySelector(".source").textContent = item.source || "Unknown source";
    node.querySelector(".kind").textContent = (item.content_type || item.item_type || "news").toUpperCase();
    node.querySelector(".category").textContent = categoryLabel(itemCategory(item));
    node.querySelector(".score").textContent = scoreLabel(item);

    const stateEl = node.querySelector(".reading-state-label");
    const label = stateLabel(state);
    stateEl.textContent = label;
    stateEl.hidden = !label;

    const title = node.querySelector(".title-button");
    title.textContent = item.title_ja || item.title || "";
    title.addEventListener("click", () => readNow(item));

    const summary = node.querySelector(".summary");
    const summaryText = item.summary_ja || item.summary || "";
    summary.textContent = summaryText;
    summary.hidden = !summaryText;

    renderTags(node.querySelector(".topic-tags"), item);

    const thumbnail = node.querySelector(".thumbnail");
    const thumbnailImage = node.querySelector(".thumbnail-image");
    const thumbnailUrl = itemThumbnail(item);
    if (thumbnailUrl) {
      thumbnail.hidden = false;
      thumbnailImage.src = thumbnailUrl;
      thumbnail.addEventListener("click", () => readNow(item));
      thumbnailImage.addEventListener("error", () => {
        thumbnail.hidden = true;
      }, { once: true });
    }

    const reason = node.querySelector(".reason");
    reason.textContent = itemReason(item);

    const buttons = node.querySelectorAll(".list-actions button[data-action]");
    buttons.forEach((button) => {
      const action = button.dataset.action;
      if (action === "keep") button.classList.toggle("is-active", state.kept);
      if (action === "read") button.classList.toggle("is-active", state.read && !state.kept);
      if (action === "skip") button.classList.toggle("is-active", state.skipped);

      button.addEventListener("click", () => {
        if (action === "read-now") {
          readNow(item);
          return;
        }

        const patch = actionPatch(action);
        const isToggleOff =
          (action === "keep" && state.kept && !state.read)
          || (action === "read" && state.read && !state.kept)
          || (action === "skip" && state.skipped);

        if (isToggleOff) {
          saveState(item, {
            read: false,
            kept: false,
            skipped: false,
          }, { toast: "未設定に戻しました" });
        } else {
          const labels = {
            keep: "あとで読むに保存しました",
            read: "既読にしました",
            skip: "興味なしにしました",
          };
          saveState(item, patch, { toast: labels[action] });
        }
      });
    });

    node.querySelector(".published").textContent = formatDate(item.published_at);
    feedEl.appendChild(node);
  }
}

function renderCurrentView() {
  const isDeck = activeView === "deck";
  deckViewEl.hidden = !isDeck;
  feedEl.hidden = isDeck;
  emptyEl.hidden = true;

  if (isDeck) {
    filtersEl.hidden = true;
    topicFiltersEl.hidden = true;
    renderDeck();
  } else {
    renderCategoryFilters();
    renderList();
  }
}

function setActiveView(view) {
  activeView = view;
  activeCategory = null;
  activeTopic = null;

  primaryNavEl.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });

  renderCurrentView();
}

primaryNavEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  setActiveView(button.dataset.view);
});

filtersEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category || null;
  activeTopic = null;
  renderCategoryFilters();
  renderList();
});

topicFiltersEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topic]");
  if (!button) return;
  activeTopic = button.dataset.topic || null;
  renderTopicFilters();
  renderList();
});

function renderHealth(sources, translation) {
  if (!healthEl) return;
  if (!sources || !sources.configured) {
    healthEl.textContent = "";
    return;
  }
  const translationLabel = translation?.engine ? " · JA" : "";
  healthEl.textContent = `${sources.healthy}/${sources.configured} feeds${translationLabel}`;
  healthEl.title = (sources.status || [])
    .map((source) => `${source.ok ? "✓" : "×"} ${source.name}`)
    .join("\n");
}

if (window.ReadingState?.onStatus) {
  window.ReadingState.onStatus((detail) => {
    if (detail.phase === "syncing") {
      setSyncStatus(`reading state: syncing ${detail.pending}…`);
    } else if (detail.phase === "synced") {
      setSyncStatus(detail.pending ? `reading state: ${detail.pending} pending` : `reading state: ${readingStates.size} synced`);
    } else if (detail.phase === "error") {
      setSyncStatus(`reading state: ${detail.pending} pending · sync error`, true);
    } else if (detail.phase === "queued") {
      setSyncStatus(pendingSyncLabel());
    }
  });
}

if (syncSettingsEl && window.ReadingState) {
  syncSettingsEl.addEventListener("click", async () => {
    const changed = window.ReadingState.configureFromPrompt();
    if (!changed) return;
    await refreshReadingStates();
    renderCurrentView();
  });
}

async function boot() {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    configureGenres(data.genres);
    allItems = data.items || [];

    generatedEl.textContent = data.generated_at
      ? `updated ${formatDate(data.generated_at)}`
      : "waiting for first collection";

    renderHealth(data.sources, data.translation);
    await refreshReadingStates();
    renderCurrentView();
  } catch (error) {
    generatedEl.textContent = "feed unavailable";
    if (healthEl) healthEl.textContent = "";
    deckViewEl.hidden = true;
    feedEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.textContent = "記事データを読み込めませんでした。";
    console.error(error);
  }
}

boot();
