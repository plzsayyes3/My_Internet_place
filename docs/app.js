const DATA_URL = "../data/latest.json";

const feedEl = document.querySelector("#feed");
const filtersEl = document.querySelector("#filters");
const emptyEl = document.querySelector("#empty");
const generatedEl = document.querySelector("#generated");
const template = document.querySelector("#card-template");

let allItems = [];
let activeFilter = "all";

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

function scoreLabel(score) {
  if (score >= 3) return `FOR YOU ${Math.min(99, 70 + Math.round(score * 6))}%`;
  if (score > 0) return "MATCH";
  return "NEW";
}

function renderFilters(items) {
  const categories = [...new Set(items.map((item) => item.source_category).filter(Boolean))];
  for (const category of categories) {
    const button = document.createElement("button");
    button.className = "filter";
    button.dataset.filter = category;
    button.textContent = category.toUpperCase();
    filtersEl.appendChild(button);
  }

  filtersEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach((el) => el.classList.toggle("is-active", el === button));
    renderFeed();
  });
}

function renderFeed() {
  feedEl.innerHTML = "";
  const items = activeFilter === "all"
    ? allItems
    : allItems.filter((item) => item.source_category === activeFilter);

  emptyEl.hidden = items.length > 0;

  for (const item of items) {
    const node = template.content.cloneNode(true);
    node.querySelector(".source").textContent = item.source || "Unknown source";
    node.querySelector(".score").textContent = scoreLabel(Number(item.score || 0));

    const title = node.querySelector(".title");
    title.textContent = item.title;
    title.href = item.url;

    const summary = node.querySelector(".summary");
    summary.textContent = item.summary || "";
    summary.hidden = !item.summary;

    const matches = item.matched_interests || [];
    node.querySelector(".reason").textContent = matches.length
      ? `関心: ${matches.join(" · ")}`
      : "新着記事";

    node.querySelector(".published").textContent = formatDate(item.published_at);
    feedEl.appendChild(node);
  }
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
    renderFilters(allItems);
    renderFeed();
  } catch (error) {
    generatedEl.textContent = "feed unavailable";
    emptyEl.hidden = false;
    emptyEl.textContent = "記事データを読み込めませんでした。";
    console.error(error);
  }
}

boot();
