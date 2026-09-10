const DATA_URL = "./data/latest.json";

const feedEl = document.querySelector("#feed");
const filtersEl = document.querySelector("#filters");
const emptyEl = document.querySelector("#empty");
const generatedEl = document.querySelector("#generated");
const healthEl = document.querySelector("#health");
const template = document.querySelector("#card-template");

let allItems = [];
let activeView = "for-you";

const CATEGORY_LABELS = {
  ai_tools: "AI",
  knowledge_tools: "KNOWLEDGE",
  software_building: "SOFTWARE",
  making: "MAKE",
  education_childcare: "EDUCATION",
  productivity: "WORKFLOW",
  personal_web: "WEB",
  discovery: "DISCOVERY",
  other: "OTHER",
};

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

function scoreLabel(score) {
  if (score >= 3) return `FOR YOU ${Math.min(99, 70 + Math.round(score * 6))}%`;
  if (score > 0) return "MATCH";
  return "DISCOVER";
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] || String(category || "OTHER").toUpperCase();
}

function renderFilters(items) {
  const categories = [...new Set(items.map((item) => item.source_category).filter(Boolean))];

  for (const category of categories) {
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
    document.querySelectorAll(".filter").forEach((el) => {
      el.classList.toggle("is-active", el === button);
    });
    renderFeed();
  });
}

function itemsForView() {
  const items = [...allItems];

  if (activeView === "latest") {
    return items.sort((a, b) => numericTime(b.published_at) - numericTime(a.published_at));
  }

  if (activeView === "for-you") {
    return items.sort((a, b) => {
      const scoreDiff = Number(b.rank_score || b.score || 0) - Number(a.rank_score || a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return numericTime(b.published_at) - numericTime(a.published_at);
    });
  }

  return items
    .filter((item) => item.source_category === activeView)
    .sort((a, b) => numericTime(b.published_at) - numericTime(a.published_at));
}

function renderFeed() {
  feedEl.innerHTML = "";
  const items = itemsForView();

  emptyEl.hidden = items.length > 0;

  for (const item of items) {
    const node = template.content.cloneNode(true);
    node.querySelector(".source").textContent = item.source || "Unknown source";
    node.querySelector(".kind").textContent = (item.content_type || "article").toUpperCase();
    node.querySelector(".score").textContent = scoreLabel(Number(item.score || 0));

    const title = node.querySelector(".title");
    title.textContent = item.title;
    title.href = item.url;

    const summary = node.querySelector(".summary");
    summary.textContent = item.summary || "";
    summary.hidden = !item.summary;

    const labels = item.matched_labels || item.matched_interests || [];
    node.querySelector(".reason").textContent = labels.length
      ? `関心: ${labels.join(" · ")}`
      : "発見枠";

    node.querySelector(".published").textContent = formatDate(item.published_at);
    feedEl.appendChild(node);
  }
}

function renderHealth(sources) {
  if (!healthEl) return;
  if (!sources || !sources.configured) {
    healthEl.textContent = "";
    return;
  }
  healthEl.textContent = `${sources.healthy}/${sources.configured} feeds`;
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

    renderHealth(data.sources);
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
