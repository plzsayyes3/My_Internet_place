# Public configuration

Do not store personal information here. Everything in this directory is public-safe and intentionally generalized.

- `taxonomy.yml` — stable browsing categories, internal topics, topic relations, item types, and traits.
- `interests.yml` — topic weights, attention signals, combination bonuses, and ranking preferences.
- `sources.yml` — RSS/Atom sources plus fallback category/item type and source priority.
- `discovery.yml` — active-search queries kept separate from RSS/Atom sources and ranking preferences.

## Design rule

`CATEGORY` is for browsing, `TOPIC` is for classification, and `SIGNAL` expresses what tends to attract attention inside a topic.

A source category is only a fallback. The collector classifies each article independently and writes `primary_category`, `topics`, `matched_signals`, and score components into the generated dataset.

RSS/Atom and active search are separate discovery channels. Both should eventually emit the same normalized article shape before classification, scoring, deduplication, freshness checks, and ranking.

`discovery.yml` is configuration only for now. Its top-level `enabled` flag is `false`, so the current collector behavior is unchanged until an active-search collector is implemented deliberately.
