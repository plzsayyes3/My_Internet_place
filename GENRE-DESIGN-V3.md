# My Internet Place — Genre / Recommendation Taxonomy v3

Status: **approved design, implementation not started**  
Updated: 2026-09-11

This document is the current source of truth for the next classification-system change in `plzsayyes3/My_Internet_place`.

## For other AI / contributors

Before editing implementation files for this work:

1. Read this document first.
2. Check the latest `main` HEAD and the current blob SHA of every file you intend to edit.
3. Do not perform unrelated refactors.
4. Preserve the currently working RSS/Atom collection, `FOR YOU`, and `LATEST` behavior while migrating.
5. Do not invent a competing taxonomy without first updating this design decision.
6. Internal IDs defined here should be treated as stable once implemented. UI labels may change later.
7. `DISCOVERY` is a recommendation surface, not a genre.
8. `BLOG` is a source kind, not a content type.
9. `LONG READ` is reading depth, not a content type.

The intended implementation unit is:

- `config/interests.yml` v3
- `config/sources.yml` migration
- `src/collect.py` compatibility / classification changes

Do not start UI redesign or feedback-learning implementation until the v3 data flow is stable.

---

## 1. Design goal

My Internet Place is not a general-purpose news classifier. Its taxonomy should model the owner's recurring interests closely enough to support:

- `FOR YOU` ranking
- `気になる` / `興味なし` feedback later
- source-bias correction
- recommendations from nearby interests
- controlled serendipity / `DISCOVERY`
- search-term expansion later

The system separates **what an item is about** from **what kind of item it is**, **where it came from**, **how heavy it is to read**, and **why it was recommended**.

---

## 2. Five independent axes

Each article/item should eventually have these independent properties:

```text
ARTICLE
├─ primary_category   # coarse UI shelf
├─ topics[]           # internal interest coordinates
├─ content_type       # nature of the content
├─ source_kind        # nature of the publisher/source
└─ reading_depth      # reading weight
```

Recommendation reason is separate from classification:

```text
recommendation_reason:
  direct | related | latest | discovery | follow_up
```

---

## 3. Display categories

Only these eight coarse categories should be exposed as the main genre navigation.

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
- Do not add a new top-level category merely because a new keyword or product becomes interesting.
- `DISCOVERY` must not become a category. It belongs beside `FOR YOU` / `LATEST` as a recommendation mode.

---

## 4. Internal topics

Use the following 25 topics as the initial active vocabulary.

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

### Topic growth rule

The active topic vocabulary should normally stay at **25 or fewer**.

Create a new topic only when an existing topic cannot distinguish recommendation behavior. Product names and temporary interests should normally become keywords or search terms, not new topics.

Examples:

- ESP32 / M5Stack / Raspberry Pi → `embedded_devices`
- specific keyboard products → `input_devices`
- a temporary interest such as `cyberdeck` → usually a search term under related topics, not a new topic

Each item should have at most **3 topics**.

---

## 5. Keywords and search terms are different

`keywords` and `search_terms` must remain separate.

```yaml
keywords:
  - ESP32
  - M5Stack
  - microcontroller

search_terms:
  - compact ESP32 device
  - pocket cyberdeck
  - tiny e-paper computer
```

Meaning:

- `keywords` = classify / score items already collected
- `search_terms` = later, actively search the web for more material

A changing search interest should not force a taxonomy change.

---

## 6. Content types

Initial values:

| ID | UI label |
|---|---|
| `news` | NEWS |
| `release` | RELEASE |
| `tool` | TOOL |
| `paper` | PAPER |
| `how_to` | HOW-TO |
| `analysis` | ANALYSIS |
| `essay` | ESSAY |
| `case_study` | CASE STUDY |

Do not use `blog` as a content type. A blog post can be a release, how-to, analysis, essay, etc.

---

## 7. Source kinds

Initial values:

- `official`
- `blog`
- `publication`
- `research`
- `community`
- `repository`

`BLOG` belongs here.

---

## 8. Reading depth

Initial values:

- `quick`
- `standard`
- `long`

The UI may display `long` as `LONG READ`.

`LONG READ` must not be encoded as a content type.

---

## 9. Topic relationships

Topics are not a strict tree. The category → topic hierarchy is for coarse organization, while topic-to-topic relations form a small weighted graph for recommendation expansion.

Representative relations:

```yaml
relations:
  - topics: [llm_ai_tools, ai_agents_automation]
    weight: 0.90
  - topics: [ai_agents_automation, ai_coding]
    weight: 0.85
  - topics: [obsidian_pkm, personal_knowledge]
    weight: 0.95
  - topics: [obsidian_pkm, local_first]
    weight: 0.80
  - topics: [github_devops, web_apps]
    weight: 0.85
  - topics: [embedded_devices, e_paper]
    weight: 0.85
  - topics: [e_paper, wearables]
    weight: 0.90
  - topics: [input_devices, hci_interfaces]
    weight: 0.90
  - topics: [task_time_management, work_design]
    weight: 0.90
  - topics: [early_childhood, child_development]
    weight: 0.95
  - topics: [early_childhood, noncognitive_learning]
    weight: 0.90
  - topics: [apple_ecosystem, wearables]
    weight: 0.80
```

Relations should be treated as undirected unless a future design explicitly requires directionality.

---

## 10. Planned `interests.yml` v3 shape

The intended top-level structure is:

```yaml
version: 3

categories: []
topics: []
relations: []
content_types: []
source_kinds: []
reading_depths: []
classification: {}
ranking: {}
```

Each topic should support at least:

```yaml
- id: e_paper
  label: 電子ペーパー
  category: make
  weight: 1.0
  keywords: []
  search_terms: []
```

Classification defaults:

```yaml
classification:
  max_topics_per_item: 3
  minimum_topic_score: 0.25

  primary_category:
    strategy: highest_scoring_topic

  topic_matching:
    title_multiplier: 2.0
    summary_multiplier: 1.0
    max_keyword_matches_per_topic: 3

  fallback:
    use_source_default_topics: true

  unknown:
    allow_unclassified: true
```

---

## 11. Planned `sources.yml` migration

Current source-level `category` should eventually be replaced by fallback metadata such as:

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

Important:

- `default_topics` are fallback hints, not the final article classification.
- Article text should be allowed to classify an individual Hackaday item as `e_paper`, `wearables`, `input_devices`, etc.
- Migration should preserve current sources and collection behavior.

---

## 12. Planned item JSON

Target shape:

```json
{
  "id": "abc123",
  "title": "Building an E-Ink Wrist Computer with ESP32",
  "url": "https://example.com/article",
  "published_at": "2026-09-11T01:00:00+00:00",

  "source": "Example Blog",
  "source_id": "example_blog",
  "source_kind": "blog",

  "primary_category": "make",

  "topics": [
    {"id": "e_paper", "score": 0.94},
    {"id": "wearables", "score": 0.81},
    {"id": "embedded_devices", "score": 0.73}
  ],

  "content_type": "how_to",
  "reading_depth": "long",

  "signals": {
    "direct_interest": 0.91,
    "related_interest": 0.21,
    "freshness": 0.88,
    "source_priority": 0.65
  },

  "recommendation_reason": "direct",
  "rank_score": 4.82
}
```

Not every field needs to be introduced in the first migration commit. The important first milestone is stable `primary_category` + `topics` while preserving existing ranking/output compatibility.

---

## 13. Recommendation connection

Future ranking should be able to combine:

```text
score =
  direct_interest
+ related_interest
+ content_type_preference
+ freshness
+ source_quality / source_priority
+ discovery_bonus
- source_repetition
- topic_repetition
```

Feedback should update topics primarily, not entire categories.

Example:

```text
Interested in an e-paper article:
  e_paper          +0.15
  wearables        +0.05
  embedded_devices +0.04

Not interested:
  e_paper          -0.20
  closely related topics only slightly negative
```

Do not downrank the whole `MAKE` category because one specific topic received negative feedback.

---

## 14. DISCOVERY behavior

`DISCOVERY` should produce **nearby but not identical** interests rather than random unrelated content.

Conceptually:

```text
high-interest topic
    ↓
related topic graph
    ↓
1–2 hops away
    ↓
high-quality candidate
```

Initial relation window under consideration:

```yaml
discovery:
  relation_min: 0.35
  relation_max: 0.80
```

This should be implemented only after the base v3 classification is stable.

---

## 15. UI rule

Do **not** expose all 25 topics as permanent top-level navigation.

Main navigation remains compact:

```text
FOR YOU
LATEST
DISCOVERY

AI
KNOWLEDGE
SOFTWARE
MAKE
WORK
EDUCATION
LIFE
WEB
```

Individual cards may show small topic/type/depth badges when useful, for example:

```text
MAKE
E-PAPER · WEARABLE · HOW-TO · LONG READ
```

---

## 16. Safe implementation order

Implement in this order:

1. Convert `config/interests.yml` to the v3 schema.
2. Migrate `config/sources.yml` to `default_topics`, `source_kind`, and `default_content_type` while retaining compatibility as needed.
3. Update `src/collect.py` to read the v3 schema.
4. Add `primary_category` and scored `topics` to generated item JSON.
5. Verify existing collection and existing `FOR YOU` / `LATEST` views still work.
6. Add the 8-category UI filtering/navigation.
7. Only after that, implement `DISCOVERY` and feedback learning.

The first implementation should favor backward compatibility over redesign purity.

---

## 17. Scope guard for parallel AI work

Until the v3 base migration is complete:

### In scope

- `config/interests.yml`
- `config/sources.yml`
- `src/collect.py`
- generated JSON compatibility related to taxonomy
- minimal UI compatibility required to avoid breakage

### Out of scope unless separately assigned

- broad visual redesign
- unrelated feed-source expansion
- translation
- AI summarization
- user-history publication/storage changes
- large refactors outside taxonomy/classification

If another AI is working in parallel, re-read the latest HEAD and target file SHA immediately before writing.
