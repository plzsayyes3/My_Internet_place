# My Internet Place — Genre / Recommendation Taxonomy v4

Status: **v4 implementation**  
Updated: 2026-09-12  

> Historical filename retained to avoid breaking existing references. This document now describes v4 and is the source of truth for article genre classification.

## Goal

When My Internet Place is opened, the top-level genre should make it immediately clear what kind of information an article belongs to. Personal interest strength is a separate concern.

The processing order is:

```text
article
  -> normalize title / summary / low-weight metadata
  -> taxonomy topic matching
  -> one primary genre
  -> interest signal matching
  -> interest score / ranking
```

Genre never means "how interested the user is". Signals and weights never become navigation categories by themselves.

## Public/private boundary

`plzsayyes3/gpts/interests/discovery-profile.yml` is the canonical long-term personal interest profile. My Internet Place only carries public-safe abstractions such as topic IDs, general search terms, signals, weights, combinations and downrank conditions. Personal context from gpts must not be copied into this public repository.

## Configuration architecture

- `config/taxonomy.yml` — stable genres, internal topics, keyword rules, relations and classification priority.
- `config/interests.yml` — public-safe topic weights, interest signals, combinations and ranking parameters.
- `config/discovery.yml` — active-search queries linked to taxonomy topics/signals.
- `config/sources.yml` — feed acquisition and fallback topics. Source identity is supplementary classification evidence only.

## Twelve display genres

| ID | UI label |
|---|---|
| `ai` | AI |
| `knowledge` | KNOWLEDGE / NOTES |
| `software` | SOFTWARE |
| `making` | MAKING |
| `small_devices` | SMALL DEVICES |
| `ios_apple` | iOS / APPLE |
| `education` | CHILDCARE / EDUCATION |
| `work` | WORK / TASK |
| `personal_web` | PERSONAL WEB |
| `games` | GAMES / POKEMON |
| `lifestyle` | LIFESTYLE |
| `other` | OTHER |

`Other` is a real fallback shelf but should not be used when a stable topic can reasonably classify the article.

## Topics are internal coordinates

Examples:

- AI: foundation models, AI tools/services, agents, local AI, AI development, AI use cases.
- Knowledge: Obsidian/PKM, personal knowledge, daily notes, handwriting/analog notes, local-first, systems thinking.
- Software: GitHub, web apps, indie/OSS, Obsidian plugin development, small tools, HCI.
- Making: general maker/electronics projects, 3D printing.
- Small Devices: ESP32/embedded, e-paper, wearables, custom input devices.
- iOS / Apple: Apple ecosystem, Shortcuts/iOS automation.
- Education: early childhood, child development, non-cognitive learning.
- Work: task/time management, management/teams, work design.
- Personal Web: personal web/RSS.
- Games: Pokemon.
- Lifestyle: life design.

Each article receives at most three topics and one primary genre.

## Genre priority

Topic score is the first decision rule. If topic scores tie, the more specific genre wins using this stable order:

```text
games
small_devices
ios_apple
ai
knowledge
software
making
education
work
personal_web
lifestyle
other
```

This removes the previous accidental tie-breaking by topic ID string order.

## Classification evidence

Topic matching uses:

1. title — strongest evidence
2. summary / description — normal evidence
3. URL, feed category/tag and source metadata — low-weight supplementary evidence
4. source `default_topics` — fallback only when article-level evidence produces no topic

Source identity must not dominate classification.

Interest-signal vocabulary that is also useful for semantic classification is represented independently in taxonomy keywords where appropriate. Example: `cyberdeck` can help identify a Small Devices article, while the `cyberdeck` interest signal separately controls recommendation strength.

## Genre / topic / signal / score example

```json
{
  "genre": "small_devices",
  "primary_category": "small_devices",
  "topics": [
    {"id": "e_paper", "score": 0.667}
  ],
  "matched_signals": ["epaper_device", "practical_small_computing"],
  "interest_score": 8.4,
  "rank_score": 9.6
}
```

`primary_category` and `score` remain as compatibility aliases while the UI and generated data migrate to `genre` and `interest_score`.

## Generated genre metadata

The generated root JSON includes a `genres` array copied from taxonomy. The Pages UI reads this array rather than maintaining a separate hard-coded navigation taxonomy. A legacy map remains only to render previously generated data safely.

## Pokemon

Pokemon is intentionally represented on all three relevant axes:

```text
genre = games
topic = pokemon
signal = pokemon
```

This prevents Pokemon discovery items from falling into `other` while preserving independent interest weighting.

## Compatibility

Legacy category names from older generated datasets are normalized at collection/UI boundaries. Freshly generated v4 data uses only current genre IDs.

## Out of scope for this change

- adding news sources
- translation changes
- visual redesign
- new recommendation surfaces
- new product features

The focus is classification quality and correct propagation from taxonomy to generated data and genre filters.
