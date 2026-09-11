const DATA_URL = "./data/latest.json";

const feedEl = document.querySelector("#feed");
const filtersEl = document.querySelector("#filters");
const emptyEl = document.querySelector("#empty");
const generatedEl = document.querySelector("#generated");
const healthEl = document.querySelector("#health");
const template = document.querySelector("#card-template");

let allItems = [];
let activeView = "for-you";

const SOURCE_REPEAT_PENALTY = 0.65;
const CONSECUTIVE_SOURCE_PENALTY = 0.35;

const CATEGORY_ORDER = [
  "ai", "knowledge", "software", "make",
  "work", "education", "life", "web",
];

const CATEGORY_LABELS = {
  ai: "AI",
  knowledge: "KNOWLEDGE",
  software: "SOFTWARE",
  make: "MAKE",
  work: "WORK",
  education: "EDUCATION",
  life: "LIFE",
  web: "WEB",
  other: "OTHER",
};

// Old generated data can still be read while v3 settles.
const LEGACY_CATEGORY_MAP = {
  ai_tools: "ai",
  knowledge_tools: "knowledge",
  software_building: "software",
  personal_devices: "life",
  devices: "make",
  making: "make",
  productivity: "work",
  education_childcare: "education",
  personal_web: "web",
  discovery: "other",
};

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
  return normalizedCategory(item.primary_category || item.source_category);
}

function categoryLabel(category) {
  return CATEGORY_LABELS[normalizedCategory(category)] || String(category || "OTHER").toUpperCase();
}

function sourceKey(item) {
  return item.source_id || item.source || "unknown";
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
      const adjustedScore = Number(item.rank_score || item.score || 0)
        - sourceCount * SOURCE_REPEAT_PENALTY
        - (source === previousSource ? CONSECUTIVE_SOURCE_PENALTY : 0);
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

function renderFilters(items) {
  const available = new Set(items.map(itemCategory));
  for (const category of CATEGORY_ORDER.filter((id) => available.has(id))) {
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
    document.querySelectorAll(".filter").forEach((el) => el.classList.toggle("is-active", el === button));
    renderFeed();
  });
}

function itemsForView() {
  const items = [...allItems];
  if (activeView === "latest") {
    return items.sort((a, b) => numericTime(b.published_at) - numericTime(a.published_at));
  }
  if (activeView === "for-you") return diversifyForYou(items);
  return items
    .filter((item) => itemCategory(item) === activeView)
    .sort((a, b) => numericTime(b.published_at) - numericTime(a.published_at));
}

function renderFeed() {
  feedEl.innerHTML = "";
  const items = itemsForView();
  emptyEl.hidden = items.length > 0;

  for (const item of items) {
    const node = template.content.cloneNode(true);
    node.querySelector(".source").textContent = item.source || "Unknown source";
    node.querySelector(".kind").textContent = (item.content_type || item.item_type || "news").toUpperCase();
    node.querySelector(".score").textContent = scoreLabel(Number(item.score || 0));

    const title = node.querySelector(".title");
    const displayedTitle = item.title_ja || item.title || "";
    title.textContent = displayedTitle;
    title.href = item.url;
    if (item.title_ja && item.title_ja !== item.title) title.title = item.title;

    const summary = node.querySelector(".summary");
    const displayedSummary = item.summary_ja || item.summary || "";
    summary.textContent = displayedSummary;
    summary.hidden = !displayedSummary;

    const labels = item.matched_labels || item.topic_labels || item.matched_interests || [];
    node.querySelector(".reason").textContent = labels.length
      ? `関心: ${labels.join(" · ")}`
      : "発見枠";
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

async function boot() {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    allItems = data.items || [];
    generatedEl.textContent = data.generated_at
      ? `updated ${formatDate(data.generated_at)}`
      : "waiting for first collection";
    renderHealth(data.sources, data.translation);
    renderFilters(allItems);
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
