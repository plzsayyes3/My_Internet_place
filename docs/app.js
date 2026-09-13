const DATA_URL = "./data/latest.json";

const feedEl = document.querySelector("#feed");
const filtersEl = document.querySelector("#filters");
const topicFiltersEl = document.querySelector("#topic-filters");
const emptyEl = document.querySelector("#empty");
const generatedEl = document.querySelector("#generated");
const healthEl = document.querySelector("#health");
const syncSettingsEl = document.querySelector("#sync-settings");
const syncStatusEl = document.querySelector("#sync-status");
const template = document.querySelector("#card-template");

let allItems = [];
let readingStates = new Map();
let activeView = "for-you";
let activeTopic = null;
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

// Old generated data can still be read while v4 settles.
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
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function numericTime(value) {
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? 0 : time;
}

function scoreLabel(score) {
  if (score >= 3) return `FOR YOU ${Math.min(99, 70 + Math.round(score * 6))}%`;
  if (score > 0) return "MATCH";
  return "DISCOVER";
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

function sourceKey(item) {
  return item.source_id || item.source || "unknown";
}

function itemState(item) {
  return readingStates.get(String(item.id))?.status || null;
}

function statePenalty(item) {
  const state = itemState(item);
  if (state === "read") return READ_PENALTY;
  if (state === "skip") return SKIP_PENALTY;
  return 0;
}

function stateSortRank(item) {
  const state = itemState(item);
  if (state === "read") return 1;
  if (state === "skip") return 2;
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

function renderTopicFilters() {
  if (!topicFiltersEl) return;
  topicFiltersEl.innerHTML = "";

  if (!categoryOrder.includes(activeView)) {
    activeTopic = null;
    topicFiltersEl.hidden = true;
    return;
  }

  const topics = new Map();
  for (const item of allItems.filter((candidate) => itemCategory(candidate) === activeView)) {
    for (const topic of itemTopics(item)) {
      if (!topics.has(topic.id)) topics.set(topic.id, topic.label);
    }
  }

  if (!topics.size) {
    activeTopic = null;
    topicFiltersEl.hidden = true;
    return;
  }

  const allButton = document.createElement("button");
  allButton.className = `filter topic-filter${activeTopic ? "" : " is-active"}`;
  allButton.dataset.topic = "";
  allButton.textContent = "すべて";
  topicFiltersEl.appendChild(allButton);

  const sortedTopics = [...topics.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "ja"));

  for (const [id, label] of sortedTopics) {
    const button = document.createElement("button");
    button.className = `filter topic-filter${activeTopic === id ? "" : ""}${activeTopic === id ? " is-active" : ""}`;
    button.dataset.topic = id;
    button.textContent = label;
    topicFiltersEl.appendChild(button);
  }

  topicFiltersEl.hidden = false;
}

function renderFilters(items) {
  const available = new Set(items.map(itemCategory));
  for (const category of categoryOrder.filter((id) => available.has(id))) {
    if (filtersEl.querySelector(`[data-view="${CSS.escape(category)}"]`)) continue;
    const button = document.createElement("button");
    button.className = "filter";
    button.dataset.view = category;
    button.textContent = categoryLabel(category);
    filtersEl.appendChild(button);
  }

  filtersEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    activeView = button.dataset.view;
    activeTopic = null;
    document.querySelectorAll(".filter[data-view]")
      .forEach((el) => el.classList.toggle("is-active", el === button));
    renderTopicFilters();
    renderFeed();
  });

  if (topicFiltersEl) {
    topicFiltersEl.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-topic]");
      if (!button) return;
      activeTopic = button.dataset.topic || null;
      topicFiltersEl.querySelectorAll(".topic-filter")
        .forEach((el) => el.classList.toggle("is-active", el === button));
      renderFeed();
    });
  }
}

function itemsForView() {
  const items = [...allItems];
  if (activeView === "latest") return items.sort(compareFreshWithinState);
  if (activeView === "for-you") return diversifyForYou(items);

  let filtered = items.filter((item) => itemCategory(item) === activeView);
  if (activeTopic) filtered = filtered.filter((item) => itemHasTopic(item, activeTopic));
  return filtered.sort(compareFreshWithinState);
}

function setSyncStatus(text, isError = false) {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = text;
  syncStatusEl.dataset.error = isError ? "true" : "false";
}

function updateSyncButton() {
  if (!syncSettingsEl || !window.ReadingState) return;
  syncSettingsEl.textContent = window.ReadingState.configured() ? "SYNC" : "SYNC SETUP";
}

async function refreshReadingStates() {
  if (!window.ReadingState?.configured()) {
    readingStates = new Map();
    setSyncStatus("reading state: off");
    updateSyncButton();
    return;
  }

  setSyncStatus("reading state: syncing…");
  try {
    readingStates = await window.ReadingState.load();
    setSyncStatus(`reading state: ${readingStates.size} synced`);
  } catch (error) {
    readingStates = new Map();
    setSyncStatus("reading state: sync error", true);
    console.error(error);
  }
  updateSyncButton();
}

async function changeItemState(item, nextState) {
  if (!window.ReadingState?.configured()) return;
  const id = String(item.id);
  const current = itemState(item);
  try {
    if (current === nextState) {
      await window.ReadingState.clear(id);
      readingStates.delete(id);
    } else {
      const saved = await window.ReadingState.set(id, nextState);
      readingStates.set(id, saved);
    }
    setSyncStatus(`reading state: ${readingStates.size} synced`);
    renderFeed();
  } catch (error) {
    setSyncStatus("reading state: save error", true);
    console.error(error);
  }
}

function renderFeed() {
  feedEl.innerHTML = "";
  const items = itemsForView();
  emptyEl.hidden = items.length > 0;
  const syncConfigured = Boolean(window.ReadingState?.configured());

  for (const item of items) {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".card");
    const state = itemState(item);
    if (state) card.classList.add(`is-${state === "skip" ? "skipped" : state}`);

    node.querySelector(".source").textContent = item.source || "Unknown source";
    node.querySelector(".kind").textContent = (item.content_type || item.item_type || "news").toUpperCase();
    node.querySelector(".category").textContent = categoryLabel(itemCategory(item));
    node.querySelector(".score").textContent = scoreLabel(Number(item.interest_score ?? item.score ?? 0));

    const stateLabel = node.querySelector(".reading-state-label");
    stateLabel.textContent = state ? state.toUpperCase() : "";
    stateLabel.hidden = !state;

    const title = node.querySelector(".title");
    const displayedTitle = item.title_ja || item.title || "";
    title.textContent = displayedTitle;
    title.href = item.url;
    if (item.title_ja && item.title_ja !== item.title) title.title = item.title;

    const summary = node.querySelector(".summary");
    const displayedSummary = item.summary_ja || item.summary || "";
    summary.textContent = displayedSummary;
    summary.hidden = !displayedSummary;

    const topics = itemTopics(item);
    const topicLabels = topics.map((topic) => topic.label);
    const topicTags = node.querySelector(".topic-tags");
    topicTags.innerHTML = "";
    for (const topic of topics) {
      const tag = document.createElement("span");
      tag.className = "topic-tag";
      tag.textContent = topic.label;
      topicTags.appendChild(tag);
    }
    topicTags.hidden = topics.length === 0;

    const matchedLabels = Array.isArray(item.matched_labels) ? item.matched_labels : [];
    const preferenceLabels = matchedLabels.filter((label) => !topicLabels.includes(label));
    const reason = node.querySelector(".reason");
    reason.textContent = preferenceLabels.length
      ? `関心: ${preferenceLabels.join(" · ")}`
      : "";
    reason.hidden = preferenceLabels.length === 0;

    const actionButtons = node.querySelectorAll(".state-actions button[data-state]");
    actionButtons.forEach((button) => {
      const targetState = button.dataset.state;
      button.disabled = !syncConfigured;
      button.classList.toggle("is-active", state === targetState);
      button.title = syncConfigured
        ? (state === targetState ? "もう一度押すと未設定に戻します" : `${targetState.toUpperCase()} にする`)
        : "SYNC SETUPから同期を設定してください";
      button.addEventListener("click", () => changeItemState(item, targetState));
    });

    node.querySelector(".published").textContent = formatDate(item.published_at);
    feedEl.appendChild(node);
  }
}

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

if (syncSettingsEl && window.ReadingState) {
  syncSettingsEl.addEventListener("click", async () => {
    const changed = window.ReadingState.configureFromPrompt();
    if (!changed) return;
    await refreshReadingStates();
    renderFeed();
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
    renderFilters(allItems);
    renderTopicFilters();
    renderFeed();
  } catch (error) {
    generatedEl.textContent = "feed unavailable";
    if (healthEl) healthEl.textContent = "";
    emptyEl.hidden = false;
    emptyEl.textContent = "記事データを読み込めませんでした。";
    console.error(error);
  }
}

boot();
