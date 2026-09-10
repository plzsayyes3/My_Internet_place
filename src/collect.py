#!/usr/bin/env python3
"""Collect RSS/Atom items into data/latest.json.

This first version deliberately stays simple:
- public RSS/Atom feeds only
- no private data
- keyword-based interest scoring
- no external AI API required
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import feedparser
import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCES_FILE = ROOT / "config" / "sources.yml"
INTERESTS_FILE = ROOT / "config" / "interests.yml"
OUTPUT_FILE = ROOT / "data" / "latest.json"
MAX_ITEMS = 200


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def item_id(url: str, title: str) -> str:
    return hashlib.sha256(f"{url}\n{title}".encode("utf-8")).hexdigest()[:16]


def parsed_date(entry) -> str | None:
    parsed = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if not parsed:
        return None
    try:
        return datetime(*parsed[:6], tzinfo=timezone.utc).isoformat()
    except Exception:
        return None


def score_item(title: str, summary: str, interests: list[dict]) -> tuple[float, list[str]]:
    haystack = f"{title} {summary}".lower()
    score = 0.0
    matches: list[str] = []

    for interest in interests:
        weight = float(interest.get("weight", 1.0))
        keywords = interest.get("keywords", [])
        matched = [k for k in keywords if str(k).lower() in haystack]
        if matched:
            score += weight * min(len(matched), 3)
            matches.append(interest.get("id", "unknown"))

    return round(score, 2), matches


def collect() -> dict:
    source_config = load_yaml(SOURCES_FILE)
    interest_config = load_yaml(INTERESTS_FILE)
    sources = source_config.get("sources", [])
    interests = interest_config.get("interests", [])

    items: list[dict] = []

    for source in sources:
        if not source.get("enabled", True):
            continue
        if source.get("type", "rss") not in {"rss", "atom", "feed"}:
            continue

        feed_url = source.get("url")
        if not feed_url:
            continue

        parsed = feedparser.parse(feed_url)
        source_name = source.get("name") or parsed.feed.get("title") or urlparse(feed_url).netloc
        category = source.get("category", "other")

        for entry in parsed.entries:
            title = clean_text(entry.get("title"))
            url = entry.get("link", "")
            if not title or not url:
                continue

            summary = clean_text(entry.get("summary") or entry.get("description"))
            score, matched_interests = score_item(title, summary, interests)

            items.append(
                {
                    "id": item_id(url, title),
                    "title": title,
                    "url": url,
                    "summary": summary[:500],
                    "published_at": parsed_date(entry),
                    "source": source_name,
                    "source_category": category,
                    "score": score,
                    "matched_interests": matched_interests,
                }
            )

    # Deduplicate by canonical URL, then rank by interest score and recency string.
    deduped: dict[str, dict] = {}
    for item in items:
        existing = deduped.get(item["url"])
        if not existing or item["score"] > existing["score"]:
            deduped[item["url"]] = item

    ranked = sorted(
        deduped.values(),
        key=lambda x: (x.get("score", 0), x.get("published_at") or ""),
        reverse=True,
    )[:MAX_ITEMS]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(ranked),
        "items": ranked,
    }


def main() -> None:
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    result = collect()
    OUTPUT_FILE.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Collected {result['count']} items")


if __name__ == "__main__":
    main()
