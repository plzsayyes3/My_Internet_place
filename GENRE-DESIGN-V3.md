# My Internet Place — Genre / Recommendation Taxonomy v3

Status: **base v3 implemented and validated**  
Updated: 2026-09-11

This document is the source of truth for classification and recommendation taxonomy in `plzsayyes3/My_Internet_place`.

## Current implementation

Base implementation commit: `7736217b9ef9a05fb1b9be0ff309d003a5a0a283`

Validation on GitHub Actions:

- taxonomy regression tests: success
- RSS/Atom collection: success
- generated dataset commit: `99a0011e880f1daf78b94d4a88443de951b3a610`
- 12/12 configured feeds healthy at validation time
- 204 items generated at validation time

## For other AI / contributors

Before changing taxonomy, scoring, sources, or recommendation behavior:

1. Read this document first.
2. Check the latest `main` HEAD and blob SHA of every file you will edit.
3. Preserve the working RSS/Atom collection and `FOR YOU` / `LATEST` behavior.
4. Do not repeat the base v3 migration; it is already implemented.
5. Do not perform unrelated refactors in the same change.
6. Internal category/topic IDs below are stable. UI labels may change.
7. `DISCOVERY` is a recommendation surface, not a genre.
8. `BLOG` is a source kind, not a content type.
9. `LONG READ` is reading depth, not a content type.
10. Active-search phrases belong in `config/discovery.yml`, not in the stable taxonomy.

## Configuration architecture

The v3 model is deliberately split across four files:

- `config/taxonomy.yml` — stable 8 categories, 25 topics, keywords, relations, content types, source kinds, reading depths, classification rules.
- `config/interests.yml` — public-safe topic weights, attention signals, combination bonuses, ranking parameters.
- `config/discovery.yml` — active-search queries and their topic links. Currently disabled as a collector.
- `config/sources.yml` — RSS/Atom sources, `default_topics`, `source_kind`, `default_content_type`, priority.

This split is intentional. Stable classification, personal preference, active search, and feed acquisition must not be collapsed into one file.

## Five independent article axes

```text
ARTICLE
├─ primary_category   # coarse UI shelf
├─ topics[]           # internal interest coordinates
├─ content_type       # nature of content
├─ source_kind        # nature of publisher/source
└─ reading_depth      # reading weight
```

Recommendation reason is separate:

```text
direct | related | latest | discovery | follow_up
```

## Eight display categories

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

Keep top-level navigation at roughly 7–8 categories. `DISCOVERY` never becomes a category.

## 25 internal topics

### AI
- `llm_ai_tools`
- `ai_agents_automation`
- `ai_coding`

### KNOWLEDGE
- `obsidian_pkm`
- `personal_knowledge`
- `local_first`
- `systems_thinking`

### SOFTWARE
- `github_devops`
- `web_apps`
- `indie_open_source`

### MAKE
- `embedded_devices`
- `e_paper`
- `wearables`
- `input_devices`
- `3d_printing`

### WORK
- `task_time_management`
- `management_teams`
- `work_design`

### EDUCATION
- `early_childhood`
- `child_development`
- `noncognitive_learning`

### LIFE
- `life_design`
- `apple_ecosystem`

### WEB
- `personal_web_rss`
- `hci_interfaces`

Each item receives at most 3 topics. Add a new topic only when existing topics cannot distinguish recommendation behavior.

Product names and temporary interests normally become keywords, preference signals, or discovery queries. Examples: ESP32/M5Stack/Raspberry Pi → `embedded_devices`; keyboards/T9/HID → `input_devices`; Cyberdeck → discovery query/signal rather than a permanent topic.

## Content type / source kind / reading depth

Content types:

- `news`
- `release`
- `tool`
- `paper`
- `how_to`
- `analysis`
- `essay`
- `case_study`

Source kinds:

- `official`
- `blog`
- `publication`
- `research`
- `community`
- `repository`

Reading depth:

- `quick`
- `standard`
- `long`

Therefore `BLOG` belongs to `source_kind`, and `LONG READ` is `reading_depth: long`.

## Classification behavior

1. Match article title and summary against topic keywords.
2. Weight title matches more strongly than summary matches.
3. Keep at most 3 highest-scoring topics.
4. Derive `primary_category` from the highest topic.
5. Use source `default_topics` only when article text produces no topic match.
6. Apply topic weights, preference signals, and combination bonuses from `interests.yml`.
7. Keep compatibility fields while the current Pages UI still uses them.

Preference signals currently retained include compact devices, cyberdecks, e-paper devices, practical small computing, custom input devices, local-first personal tools, calm personal technology, and a negative signal for large industrial robotics. These are preference signals, not navigation topics.

## Generated data

The v3 dataset exposes at least:

```json
{
  "source_kind": "publication",
  "primary_category": "make",
  "topics": [{"id": "embedded_devices", "score": 0.667}],
  "content_type": "news",
  "reading_depth": "standard",
  "signals": {
    "direct_interest": 5.6,
    "related_interest": 0.0,
    "freshness": 1.0,
    "source_priority": 0.65
  },
  "recommendation_reason": "direct"
}
```

Compatibility fields such as `source_category`, `item_type`, `topic_ids`, `topic_labels`, `matched_interests`, and `matched_labels` remain for now.

## DISCOVERY and active search

`DISCOVERY` should later recommend nearby-but-not-identical topics using the weighted topic graph, roughly 1–2 hops from strong interests. It should not be random unrelated content.

`config/discovery.yml` holds changing active-search phrases separately. Its search collector is not yet enabled.

## UI rule

Permanent navigation stays compact:

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

Do not expose all 25 topics as permanent top-level navigation.

## Next work

1. Observe real classifications and tune keywords/weights.
2. Improve item-level content-type / reading-depth inference only if needed.
3. Design privacy-safe storage for `気になる` / `興味なし`.
4. Add related-topic recommendation scoring.
5. Implement `DISCOVERY`.
6. Implement active web search from `discovery.yml`.

Out of scope unless separately assigned: broad visual redesign, translation, AI summaries, publication of private history, and unrelated feed expansion.
