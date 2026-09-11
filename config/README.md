# Public configuration

Do not store personal information here. Everything in this directory is public-safe and intentionally generalized.

- `taxonomy.yml` — stable browsing categories, internal topics, topic relations, item types, and traits.
- `interests.yml` — topic weights, attention signals, combination bonuses, downrank signals, and future discovery queries.
- `sources.yml` — RSS/Atom sources plus fallback category/item type and source priority.

## Design rule

`CATEGORY` is for browsing, `TOPIC` is for classification, and `SIGNAL` expresses what tends to attract attention inside a topic.

A source category is only a fallback. The collector classifies each article independently and writes `primary_category`, `topics`, `matched_signals`, and score components into the generated dataset.

`discovery_queries` are stored for future active search beyond RSS/Atom; the current collector does not execute them yet.
