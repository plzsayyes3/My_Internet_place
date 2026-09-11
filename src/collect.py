#!/usr/bin/env python3
"""Collect RSS/Atom items into data/latest.json and docs/data/latest.json.

Public data only. The collector:
- reads public RSS/Atom feeds from config/sources.yml
- scores items against the generic public profile in config/interests.yml
- removes common tracking parameters and duplicates
- accepts only HTTP(S) article links
- favors recent items and drops stale feed history
- retries short-lived network failures
- records feed health without failing the whole run when one source is down
- writes the same dataset to repository data and the GitHub Pages tree
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser
import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCES_FILE = ROOT / "config" / "sources.yml"
INTERESTS_FILE = ROOT / "config" / "interests.yml"
OUTPUT_FILES = (
    ROOT / "data" / "latest.json",
    ROOT / "docs" / "data" / "latest.json",
)

MAX_ITEMS = 250
MAX_ITEMS_PER_SOURCE = 40
MAX_AGE_DAYS = 120
SUMMARY_LIMIT = 320
FETCH_TIMEOUT_SECONDS = 20
FETCH_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2
TRACKING_KEYS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref_src",
}
USER_AGENT = (
    "MyInternetPlace/0.1 "
    "(public RSS collector; https://github.com/plzsayyes3/My_Internet_place)"
)


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = html.unescape(value)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def canonical_url(url: str) -> str:
    """Remove fragments and common tracking query parameters."""
    try:
        parts = urlsplit(url)
        query = []
        for key, value in parse_qsl(parts.query, keep_blank_values=True):
            key_lower = key.lower()
            if key_lower.startswith("utm_") or key_lower in TRACKING_KEYS:
                continue
            query.append((key, value))
        return urlunsplit(
            (
                parts.scheme.lower(),
                parts.netloc.lower(),
                parts.path,
                urlencode(query, doseq=True),
                "",
            )
        )
    except Exception:
        return url


def is_safe_article_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
        return parts.scheme in {"http", "https"} and bool(parts.netloc)
    except Exception:
        return False


def item_id(url: str, title: str) -> str:
    return hashlib.sha256(f"{url}\n{title}".encode("utf-8")).hexdigest()[:16]


def parsed_datetime(entry) -> datetime | None:
    parsed = getattr(entry, "published_parsed", None) or getattr(
        entry, "updated_parsed", None
    )
    if not parsed:
        return None
    try:
        return datetime(*parsed[:6], tzinfo=timezone.utc)
    except Exception:
        return None


def keyword_matches(keyword: str, haystack: str) -> bool:
    needle = keyword.strip().lower()
    if not needle:
        return False
    # Short keywords such as "AI" should match as words, not inside "said".
    if len(needle) <= 3 and re.fullmatch(r"[a-z0-9+#.-]+", needle):
        return (
            re.search(
                rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", haystack
            )
            is not None
        )
    return needle in haystack


def score_item(
    title: str, summary: str, interests: list[dict]
) -> tuple[float, list[str], list[str]]:
    title_haystack = title.lower()
    summary_haystack = summary.lower()
    score = 0.0
    matched_ids: list[str] = []
    matched_labels: list[str] = []

    for interest in interests:
        weight = float(interest.get("weight", 1.0))
        keywords = [str(k) for k in interest.get("keywords", [])]
        title_matches = [
            k for k in keywords if keyword_matches(k, title_haystack)
        ]
        title_match_set = {k.lower() for k in title_matches}
        summary_matches = [
            k
            for k in keywords
            if k.lower() not in title_match_set
            and keyword_matches(k, summary_haystack)
        ]

        if title_matches or summary_matches:
            # A title match is a much stronger signal that the article is truly
            # about an interest. Summary-only matches still count, but less.
            match_signal = min(
                3.0,
                (1.5 * min(len(title_matches), 2))
                + (0.5 * min(len(summary_matches), 2)),
            )
            score += weight * match_signal
            matched_ids.append(str(interest.get("id", "unknown")))
            matched_labels.append(
                str(interest.get("label") or interest.get("id", "Interest"))
            )

    return round(score, 2), matched_ids, matched_labels


def fetch_feed(url: str):
    last_error: Exception | None = None
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            response = requests.get(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                },
                timeout=FETCH_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            parsed = feedparser.parse(response.content)
            if getattr(parsed, "bozo", False) and not parsed.entries:
                raise RuntimeError(
                    str(getattr(parsed, "bozo_exception", "invalid feed"))
                )
            return parsed
        except (requests.RequestException, RuntimeError) as exc:
            last_error = exc
            if attempt >= FETCH_ATTEMPTS:
                break
            print(f"[RETRY] {url} attempt {attempt}/{FETCH_ATTEMPTS}: {exc}")
            time.sleep(RETRY_DELAY_SECONDS)

    raise RuntimeError(str(last_error or "feed request failed"))


def collect() -> dict:
    source_config = load_yaml(SOURCES_FILE)
    interest_config = load_yaml(INTERESTS_FILE)
    sources = source_config.get("sources", [])
    interests = interest_config.get("interests", [])

    items: list[dict] = []
    source_status: list[dict] = []
    now = datetime.now(timezone.utc)

    enabled_sources = [
        source
        for source in sources
        if source.get("enabled", True)
        and source.get("type", "rss") in {"rss", "atom", "feed"}
        and source.get("url")
    ]

    for source in enabled_sources:
        feed_url = str(source["url"])
        source_id = str(source.get("id") or source.get("name") or feed_url)
        configured_name = str(source.get("name") or "")
        category = str(source.get("category", "other"))
        content_type = str(source.get("content_type", "article"))
        source_priority = float(source.get("priority", 0.5))
        source_max_age = int(source.get("max_age_days", MAX_AGE_DAYS))

        try:
            parsed = fetch_feed(feed_url)
            source_name = configured_name or parsed.feed.get("title") or source_id
            added = 0
            stale = 0

            for entry in parsed.entries[:MAX_ITEMS_PER_SOURCE]:
                title = clean_text(entry.get("title"))
                raw_url = str(entry.get("link", "")).strip()
                url = canonical_url(raw_url)
                if not title or not url or not is_safe_article_url(url):
                    continue

                published_dt = parsed_datetime(entry)
                if published_dt:
                    age_days = max(
                        0.0, (now - published_dt).total_seconds() / 86400
                    )
                    if age_days > source_max_age:
                        stale += 1
                        continue
                    freshness = max(0.0, 1.0 - (age_days / source_max_age))
                    published_at = published_dt.isoformat()
                else:
                    freshness = 0.2
                    published_at = None

                summary = clean_text(
                    entry.get("summary")
                    or entry.get("description")
                    or entry.get("subtitle")
                )
                score, matched_interests, matched_labels = score_item(
                    title, summary, interests
                )

                # Relevance still matters, but freshness prevents old feed history
                # from dominating the "FOR YOU" view.
                rank_score = round(
                    (score * (0.55 + 0.45 * freshness))
                    + (2.0 * freshness)
                    + (source_priority * 0.2),
                    2,
                )

                items.append(
                    {
                        "id": item_id(url, title),
                        "title": title,
                        "url": url,
                        "summary": summary[:SUMMARY_LIMIT],
                        "published_at": published_at,
                        "source": source_name,
                        "source_id": source_id,
                        "source_category": category,
                        "content_type": content_type,
                        "score": score,
                        "rank_score": rank_score,
                        "matched_interests": matched_interests,
                        "matched_labels": matched_labels,
                    }
                )
                added += 1

            source_status.append(
                {
                    "id": source_id,
                    "name": source_name,
                    "ok": True,
                    "items": added,
                    "stale_skipped": stale,
                }
            )
        except Exception as exc:
            source_status.append(
                {
                    "id": source_id,
                    "name": configured_name or source_id,
                    "ok": False,
                    "items": 0,
                    "stale_skipped": 0,
                    "error": clean_text(str(exc))[:180],
                }
            )
            print(f"[WARN] {source_id}: {exc}")

    deduped: dict[str, dict] = {}
    for item in items:
        existing = deduped.get(item["url"])
        if not existing or item["rank_score"] > existing["rank_score"]:
            deduped[item["url"]] = item

    ranked = sorted(
        deduped.values(),
        key=lambda x: (
            x.get("rank_score", 0),
            x.get("published_at") or "",
        ),
        reverse=True,
    )[:MAX_ITEMS]

    healthy = sum(1 for status in source_status if status["ok"])
    if enabled_sources and healthy == 0:
        raise RuntimeError("All configured feeds failed; keeping the previous dataset.")

    return {
        "generated_at": now.isoformat(),
        "count": len(ranked),
        "sources": {
            "configured": len(enabled_sources),
            "healthy": healthy,
            "status": source_status,
        },
        "items": ranked,
    }


def main() -> None:
    result = collect()
    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    for output_file in OUTPUT_FILES:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(payload, encoding="utf-8")
    print(
        f"Collected {result['count']} items "
        f"from {result['sources']['healthy']}/{result['sources']['configured']} feeds"
    )


if __name__ == "__main__":
    main()
