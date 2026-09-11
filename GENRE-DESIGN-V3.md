# My Internet Place — Genre / Recommendation Taxonomy v3

Status: **base v3 implementation prepared**  
Updated: 2026-09-11

This document is the source of truth for classification and recommendation taxonomy in `plzsayyes3/My_Internet_place`.

## For other AI / contributors

Before changing taxonomy, scoring, sources, or recommendation behavior:

1. Read this document first.
2. Check the latest `main` HEAD and blob SHA of every file you will edit.
3. Preserve the working RSS/Atom collection and existing `FOR YOU` / `LATEST` behavior.
4. Do not perform unrelated refactors in the same change.
5. Internal category/topic IDs below are stable. UI labels may change.
6. `DISCOVERY` is a recommendation surface, not a genre.
7. `BLOG` is a source kind, not a content type.
8. `LONG READ` is reading depth, not a content type.
9. Active-search phrases belong in `config/discovery.yml`, not in the taxonomy.
10. If another AI is working in parallel, re-read HEAD and target SHAs immediately before writing.

---

## 1. Goal

My Internet Place is not a general-purpose news classifier. It is a personal information radar: classification should model recurring interests well enough to support ranking, feedback learning, source-bias correction, nearby-interest recommendations, and controlled serendipity.

The system separates:

```text
ARTICLE
├─ primary_category   # coarse UI shelf
├─ topics[]           # internal interest coordinates
├─ content_type       # nature of the content
├─ source_kind        # nature of the publisher/source
└─ reading_depth      # reading weight
```

Recommendation reason is separate:

```text
recommendation_reason:
  direct | related | latest | discovery | follow_up
```

---

## 2. Configuration architecture

The conceptual v3 model is split across four files so stable taxonomy and changing interests do not conflict.

### `config/taxonomy.yml`

Stable classification vocabulary:

- 8 display categories
- 25 internal topics
- classification keywords
- topic relations
- content types
- source kinds
- reading depths
- classification rules

### `config/interests.yml`

Public-safe personal preference profile:

- topic weights
- attention signals
- combination bonuses
- ranking parameters
- future feedback/discovery parameters

### `config/discovery.yml`

Active-search vocabulary:

- search queries
- query weights
- related topic IDs

This is intentionally separate from taxonomy keywords. A temporary interest such as `cyberdeck` or `ポケモン` must not force a new permanent topic.

### `config/sources.yml`

Feed acquisition metadata:

- RSS/Atom URL
- `default_topics`
- `source_kind`
- `default_content_type`
- source priority
- freshness limit

`default_topics` are fallback hints only. Article text has priority.

This four-file split replaces the earlier draft idea of putting taxonomy structure, weights, and search terms together in `interests.yml`. The conceptual five-axis model is unchanged.

---

## 3. Display categories

Only these eight categories are permanent main navigation:

| ID | UI label |
|---|---|
| `ai` | AI |
| `knowledge` | KNOWLEDGE |
| `software` | SOFTWARE |
| `make` | MAKE |
| `work` | WORK |
| `education` | EDUCATION |
| `life` | LIFE |
| `web` | WEB |

Rules:

- Keep top-level categories around 7–8.
- Do not add a category just because a product or temporary interest appears.
- `DISCOVERY` belongs beside `FOR YOU` / `LATEST`, never inside this list.

---

## 4. Internal topics

Initial active vocabulary is exactly 25 topics.

### AI

- `llm_ai_tools` — LLM・AIツール
- `ai_agents_automation` — AIエージェント・自動化
- `ai_coding` — AIコーディング

### KNOWLEDGE

- `obsidian_pkm` — Obsidian・PKM
- `personal_knowledge` — 記録・知識管理
- `local_first` — Local-first
- `systems_thinking` — 思考法・システム思考

### SOFTWARE

- `github_devops` — GitHub・Actions
- `web_apps` — Webアプリ
- `indie_open_source` — Indie Software・OSS

### MAKE

- `embedded_devices` — ESP32・小型デバイス
- `e_paper` — 電子ペーパー
- `wearables` — ウェアラブル
- `input_devices` — 入力デバイス・自作キーボード
- `3d_printing` — 3Dプリント・Maker

### WORK

- `task_time_management` — タスク・時間管理
- `management_teams` — マネジメント・チーム
- `work_design` — 働き方・仕事設計

### EDUCATION

- `early_childhood` — 保育・幼児教育
- `child_development` — 子どもの発達
- `noncognitive_learning` — 非認知能力・学び

### LIFE

- `life_design` — 生活設計
- `apple_ecosystem` — Apple Watch・iPhone・iOS

### WEB

- `personal_web_rss` — 個人Web・RSS
- `hci_interfaces` — HCI・インターフェース

Each item receives at most 3 topics.

### Growth rule

Create a new topic only when existing topics cannot distinguish recommendation behavior. Normally:

- ESP32 / M5Stack / Raspberry Pi → `embedded_devices`
- e-paper products → `e_paper`
- keyboards / T9 / HID → `input_devices`
- Cyberdeck → search query / signal connected to existing topics

---

## 5. Keywords vs search queries

Classification keywords answer:

> What is this collected item about?

They live in `taxonomy.yml`.

Search queries answer:

> What should the system actively look for next?

They live in `discovery.yml`.

These must remain separate. Search interests can change rapidly without changing stable topic IDs.

---

## 6. Content types

Initial stable values:

- `news` — NEWS
- `release` — RELEASE
- `tool` — TOOL
- `paper` — PAPER
- `how_to` — HOW-TO
- `analysis` — ANALYSIS
- `essay` — ESSAY
- `case_study` — CASE STUDY

`blog` is not a content type.

---

## 7. Source kinds

Initial values:

- `official`
- `blog`
- `publication`
- `research`
- `community`
- `repository`

A blog article may still have content type `analysis`, `essay`, `release`, etc.

---

## 8. Reading depth

Initial values:

- `quick`
- `standard`
- `long`

The UI may display `long` as `LONG READ`.

---

## 9. Topic relations

Topics form a small weighted undirected graph rather than a strict tree. Categories are shelves; relations are recommendation distance.

Important examples:

```text
llm_ai_tools ↔ ai_agents_automation
ai_agents_automation ↔ ai_coding
obsidian_pkm ↔ personal_knowledge
obsidian_pkm ↔ local_first
github_devops ↔ web_apps
embedded_devices ↔ e_paper
e_paper ↔ wearables
input_devices ↔ hci_interfaces
task_time_management ↔ work_design
early_childhood ↔ child_development
early_childhood ↔ noncognitive_learning
apple_ecosystem ↔ wearables
```

Exact weights are stored in `taxonomy.yml`.

---

## 10. Current classification behavior

The collector should:

1. Match article title and summary against topic keywords.
2. Weight title matches more strongly than summary matches.
3. Keep at most 3 highest-scoring topics.
4. Derive `primary_category` from the highest topic.
5. Only when article text produces no topic, use source `default_topics` as fallback.
6. Apply personal topic weights, signals, and combination bonuses from `interests.yml`.
7. Preserve compatibility fields until the current Pages UI no longer needs them.

Temporary preference signals already retained include:

- compact / handheld devices
- cyberdecks
- e-paper devices
- practical small computing
- custom input devices
- local-first personal tools
- calm personal technology
- negative weight for large industrial robotics

These are preference signals, not navigation topics.

---

## 11. Source migration

Sources use this shape:

```yaml
- id: hackaday
  name: Hackaday
  type: rss
  url: https://hackaday.com/blog/feed/
  default_topics:
    - embedded_devices
    - 3d_printing
  source_kind: publication
  default_content_type: news
  priority: 0.65
  enabled: true
```

Do not classify every Hackaday item as MAKE merely because of the source. Article text may classify it as `e_paper`, `wearables`, `input_devices`, etc.

---

## 12. Generated item shape

The v3 base dataset should expose the new fields while retaining compatibility aliases:

```json
{
  "source_kind": "publication",
  "primary_category": "make",
  "topics": [
    {"id": "e_paper", "score": 0.83},
    {"id": "embedded_devices", "score": 0.67}
  ],
  "content_type": "news",
  "reading_depth": "standard",
  "signals": {
    "direct_interest": 6.2,
    "related_interest": 0.0,
    "freshness": 0.9,
    "source_priority": 0.65
  },
  "recommendation_reason": "direct"
}
```

Compatibility fields such as `source_category`, `item_type`, `topic_ids`, `topic_labels`, `matched_interests`, and `matched_labels` may remain during migration.

---

## 13. Recommendation connection

Future ranking can combine:

```text
direct interest
+ related-topic interest
+ content-type preference
+ freshness
+ source priority / quality
+ discovery bonus
- source repetition
- topic repetition
```

Feedback should primarily update topic affinity, not whole categories.

A negative reaction to one `e_paper` item must not automatically downrank all of MAKE.

---

## 14. DISCOVERY

`DISCOVERY` should later use the topic graph to find nearby-but-not-identical material, roughly 1–2 hops from strong interests. It should not be random unrelated content.

The active-search file currently remains disabled. Its query vocabulary can evolve independently before the search collector is implemented.

---

## 15. UI rule

Do not expose all 25 topics as permanent navigation.

Main navigation remains compact:

```text
FOR YOU
LATEST
DISCOVERY   # future recommendation surface

AI
KNOWLEDGE
SOFTWARE
MAKE
WORK
EDUCATION
LIFE
WEB
```

Cards may later show compact topic/type/depth badges.

---

## 16. Migration status and next steps

Base v3 implementation scope:

- migrate stable taxonomy to approved 8 categories / 25 topics
- migrate source metadata to `default_topics`, `source_kind`, `default_content_type`
- emit scored `topics` and `primary_category`
- preserve existing scoring signals and compatibility fields
- update minimal category filtering in the current Pages UI
- add regression tests for taxonomy invariants and key personal-interest behavior

After this base is stable:

1. observe actual collected classifications and tune keywords/weights
2. improve content-type and reading-depth inference if needed
3. design `気になる` / `興味なし` storage without exposing private history
4. implement related-topic ranking
5. implement `DISCOVERY`
6. implement active web search from `discovery.yml`

Out of scope for the base migration: broad visual redesign, translation, AI summaries, private history publication, and unrelated feed expansion.
