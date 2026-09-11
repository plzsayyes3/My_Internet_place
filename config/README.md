# Public configuration

Everything in this directory is public-safe and intentionally generalized. Do not store private notes, personal identifiers, browsing history, API keys, or secrets here.

## Files

- `taxonomy.yml` — stable 8 display categories, 25 internal topics, topic relations, content types, source kinds, reading depths, and classification rules.
- `interests.yml` — public-safe personal topic weights, attention signals, combination bonuses, and ranking preferences.
- `sources.yml` — RSS/Atom sources, fallback `default_topics`, `source_kind`, `default_content_type`, and source priority.
- `discovery.yml` — active-search queries. Kept separate from classification keywords and RSS/Atom sources.

## Axes

The classification model deliberately separates these concepts:

- `CATEGORY` — coarse UI shelf: AI / KNOWLEDGE / SOFTWARE / MAKE / WORK / EDUCATION / LIFE / WEB.
- `TOPIC` — what an item is about; recommendation learning should mainly happen here.
- `CONTENT TYPE` — what kind of content it is: NEWS / RELEASE / TOOL / PAPER / HOW-TO / ANALYSIS / ESSAY / CASE STUDY.
- `SOURCE KIND` — what kind of publisher produced it. `BLOG` belongs here.
- `READING DEPTH` — QUICK / STANDARD / LONG. `LONG READ` is not a content type.
- `SIGNAL` — an additional preference signal inside topics, such as compact devices or cyberdecks.
- `DISCOVERY QUERY` — a phrase to actively search later; it is not a topic and does not create navigation by itself.

`DISCOVERY` itself is a recommendation surface beside `FOR YOU` / `LATEST`, not a category.

## Classification rules

- Keep the stable topic vocabulary at 25 or fewer unless a new topic is genuinely needed to distinguish recommendation behavior.
- Each collected item receives at most 3 topics.
- Article text is classified first. `sources.yml` `default_topics` are used only as fallback hints when article text produces no topic match.
- Product names and short-lived interests should usually become keywords, signals, or discovery queries rather than new categories/topics.
- `discovery.yml` remains disabled until an active-search collector is deliberately implemented.

The design source of truth is `../GENRE-DESIGN-V3.md`.
