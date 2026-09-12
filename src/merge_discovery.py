"""Merge ChatGPT web-discovery results into the generated article feed.

This step intentionally runs after RSS/Atom collection and before translation.
Search is performed outside GitHub Actions by a scheduled ChatGPT task, which
writes public-safe metadata to data/discovery.json. This module validates that
metadata, applies the same taxonomy/interest scoring used for RSS items, and
merges it into latest.json without disturbing the RSS collector itself.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from collect import (
    ROOT,
    MAX_ITEMS,
    SUMMARY_LIMIT,
    canonical_url,
    classify_item,
    clean_text,
    display_labels,
    is_safe_article_url,
    item_id,
    load_yaml,
    normalize_category,
    score_preferences,
)

DISCOVERY_RESULTS_FILE = ROOT / "data" / "discovery.json"
DISCOVERY_CONFIG_FILE = ROOT / "config" / "discovery.yml"
TAXONOMY_FILE = ROOT / "config" / "taxonomy.yml"
INTERESTS_FILE = ROOT / "config" / "interests.yml"
LATEST_FILE = ROOT / "data" / "latest.json"
OUTPUT_FILES = (LATEST_FILE, ROOT / "docs" / "data" / "latest.json")

SOURCE_PRIORITIES = {
    "official": 0.85,
    "research": 0.78,
    "repository": 0.72,
    "publication": 0.70,
    "blog": 0.62,
    "community": 0.50,
}


def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as f:
            value = json.load(f)
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[discovery] Cannot read {path.name}: {exc}")
        return {}


def _parse_datetime(value: object) -> datetime | None:
    if not value:
        return None
    try:
        text = str(value).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _query_ids(raw: dict, by_query_text: dict[str, str]) -> list[str]:
    values: list[str] = []
    for key in ("discovery_query_ids", "query_ids"):
        candidate = raw.get(key)
        if isinstance(candidate, list):
            values.extend(str(x) for x in candidate if x)
    for key in ("discovery_query_id", "query_id"):
        if raw.get(key):
            values.append(str(raw[key]))
    query_texts: list[str] = []
    if isinstance(raw.get("discovery_queries"), list):
        query_texts.extend(str(x) for x in raw["discovery_queries"] if x)
    for key in ("discovery_query", "query"):
        if raw.get(key):
            query_texts.append(str(raw[key]))
    for text in query_texts:
        query_id = by_query_text.get(text.strip().lower())
        if query_id:
            values.append(query_id)
    return list(dict.fromkeys(values))


def _fallback_category(topic_ids: list[str], topics_by_id: dict[str, dict], valid_categories: set[str]) -> str:
    for topic_id in topic_ids:
        topic = topics_by_id.get(topic_id)
        if topic:
            return normalize_category(str(topic.get("category", "other")), valid_categories)
    return "other"


def _build_discovery_item(
    raw: dict,
    now: datetime,
    query_by_id: dict[str, dict],
    by_query_text: dict[str, str],
    taxonomy: dict,
    interests: dict,
) -> dict | None:
    title = clean_text(str(raw.get("title") or ""))
    url = canonical_url(str(raw.get("url") or "").strip())
    if not title or not url or not is_safe_article_url(url):
        return None

    defaults = load_yaml(DISCOVERY_CONFIG_FILE).get("defaults", {})
    max_age_days = max(1, int(defaults.get("max_age_days", 14)))
    published = _parse_datetime(raw.get("published_at"))
    if published:
        age_days = max(0.0, (now - published).total_seconds() / 86400)
        if age_days > max_age_days:
            return None
        freshness = max(0.0, 1.0 - age_days / max_age_days)
        published_at = published.isoformat()
    else:
        freshness = 0.35
        published_at = None

    query_ids = _query_ids(raw, by_query_text)
    query_configs = [query_by_id[qid] for qid in query_ids if qid in query_by_id]
    fallback_topics: list[str] = []
    query_labels: list[str] = []
    query_texts: list[str] = []
    query_weight = 1.0
    for query in query_configs:
        fallback_topics.extend(str(x) for x in query.get("topics", []) if x)
        label = str(query.get("label") or query.get("query") or query.get("id"))
        if label:
            query_labels.append(label)
        text = str(query.get("query") or "").strip()
        if text:
            query_texts.append(text)
        query_weight = max(query_weight, float(query.get("weight", 1.0)))
    fallback_topics = list(dict.fromkeys(fallback_topics))
    query_labels = list(dict.fromkeys(query_labels))
    query_texts = list(dict.fromkeys(query_texts))

    topics = taxonomy.get("topics", [])
    valid_categories = {str(x["id"]) for x in taxonomy.get("categories", []) if x.get("id")}
    valid_content = {str(x["id"]) for x in taxonomy.get("content_types", []) if x.get("id")}
    valid_sources = {str(x["id"]) for x in taxonomy.get("source_kinds", []) if x.get("id")}
    valid_depths = {str(x["id"]) for x in taxonomy.get("reading_depths", []) if x.get("id")}
    topics_by_id = {str(x["id"]): x for x in topics if x.get("id")}
    fallback_category = _fallback_category(fallback_topics, topics_by_id, valid_categories)

    summary = clean_text(str(raw.get("summary") or raw.get("snippet") or ""))[:SUMMARY_LIMIT]
    source = clean_text(str(raw.get("source") or raw.get("publisher") or "Web discovery"))
    source_kind = str(raw.get("source_kind") or "publication")
    metadata = clean_text(" ".join([url, source, source_kind, *query_texts]))
    category, matched = classify_item(
        title,
        summary,
        topics,
        valid_categories,
        fallback_category,
        fallback_topics,
        taxonomy.get("classification", {}),
        metadata_text=metadata,
    )
    score, matched_signals, matched_combos, components = score_preferences(
        title, summary, matched, interests
    )

    if source_kind not in valid_sources:
        source_kind = "publication"
    content_type = str(raw.get("content_type") or "news")
    if content_type not in valid_content:
        content_type = "news"
    reading_depth = str(raw.get("reading_depth") or "standard")
    if reading_depth not in valid_depths:
        reading_depth = "standard"

    source_priority = SOURCE_PRIORITIES.get(source_kind, 0.65)
    discovery_bonus = min(0.45, 0.18 * query_weight)
    rank_score = round(
        score * (0.55 + 0.45 * freshness)
        + 2.0 * freshness
        + source_priority * 0.2
        + discovery_bonus,
        2,
    )

    topic_ids = [x["id"] for x in matched]
    topic_labels = [x["label"] for x in matched]
    labels = display_labels(matched, matched_signals, matched_combos)
    for label in query_labels:
        if len(labels) >= 6:
            break
        marker = f"検索:{label}"
        if marker not in labels:
            labels.append(marker)

    host = urlsplit(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    source_id = str(raw.get("source_id") or f"search:{host or 'web-discovery'}")
    discovered_at = _parse_datetime(raw.get("discovered_at")) or now
    return {
        "id": item_id(url, title),
        "title": title,
        "url": url,
        "summary": summary,
        "published_at": published_at,
        "source": source,
        "source_id": source_id,
        "source_kind": source_kind,
        "source_category": fallback_category,
        "genre": category,
        "primary_category": category,
        "topics": [{"id": x["id"], "score": x["score"]} for x in matched],
        "topic_ids": topic_ids,
        "topic_labels": topic_labels,
        "topic_scores": {x["id"]: x["score"] for x in matched},
        "matched_signals": [x["id"] for x in matched_signals],
        "positive_signals": [
            x["id"] for x in matched_signals if float(x.get("contribution", 0)) > 0
        ],
        "matched_combinations": [x["id"] for x in matched_combos],
        "content_type": content_type,
        "item_type": content_type,
        "reading_depth": reading_depth,
        "signals": {
            "direct_interest": round(max(0.0, score), 2),
            "related_interest": 0.0,
            "freshness": round(freshness, 3),
            "source_priority": round(source_priority, 3),
            "active_discovery": round(discovery_bonus, 3),
        },
        "recommendation_reason": "direct" if score > 0 else "discovery",
        "interest_score": score,
        "score": score,
        "score_components": components,
        "rank_score": rank_score,
        "matched_interests": topic_ids,
        "matched_labels": labels,
        "source_method": "chatgpt_search",
        "discovered_via": ["chatgpt_search"],
        "discovery_query_ids": query_ids,
        "discovery_queries": query_texts,
        "discovered_at": discovered_at.isoformat(),
    }


def merge() -> dict:
    latest = _load_json(LATEST_FILE)
    if not latest.get("items"):
        raise RuntimeError("RSS dataset missing; refusing to replace it with discovery-only data.")

    config = load_yaml(DISCOVERY_CONFIG_FILE)
    if not config.get("enabled", False):
        print("[discovery] config disabled; RSS dataset unchanged")
        return latest

    raw_results = _load_json(DISCOVERY_RESULTS_FILE)
    taxonomy = load_yaml(TAXONOMY_FILE)
    interests = load_yaml(INTERESTS_FILE)
    queries = [q for q in config.get("queries", []) if q.get("enabled", True)]
    query_by_id = {str(q.get("id")): q for q in queries if q.get("id")}
    by_query_text = {
        str(q.get("query", "")).strip().lower(): str(q.get("id"))
        for q in queries
        if q.get("id") and q.get("query")
    }

    now = datetime.now(timezone.utc)
    accepted: list[dict] = []
    for raw in raw_results.get("items", []):
        if not isinstance(raw, dict):
            continue
        item = _build_discovery_item(raw, now, query_by_id, by_query_text, taxonomy, interests)
        if item:
            accepted.append(item)

    merged: dict[str, dict] = {
        str(item.get("url")): item for item in latest.get("items", []) if item.get("url")
    }
    duplicate_hits = 0
    for item in accepted:
        url = item["url"]
        old = merged.get(url)
        if old:
            duplicate_hits += 1
            old["discovery_query_ids"] = list(dict.fromkeys(
                list(old.get("discovery_query_ids", [])) + item.get("discovery_query_ids", [])
            ))
            old["discovery_queries"] = list(dict.fromkeys(
                list(old.get("discovery_queries", [])) + item.get("discovery_queries", [])
            ))
            old["discovered_via"] = list(dict.fromkeys(
                list(old.get("discovered_via", ["rss"])) + ["chatgpt_search"]
            ))
            old["rank_score"] = max(float(old.get("rank_score", 0)), float(item.get("rank_score", 0)))
            if item.get("discovered_at"):
                old["discovered_at"] = item["discovered_at"]
            continue
        merged[url] = item

    ranked = sorted(
        merged.values(),
        key=lambda x: (float(x.get("rank_score", 0)), x.get("published_at") or ""),
        reverse=True,
    )[:MAX_ITEMS]
    latest["items"] = ranked
    latest["count"] = len(ranked)
    latest["discovery"] = {
        "enabled": True,
        "producer": raw_results.get("producer") or "chatgpt_scheduled_search",
        "generated_at": raw_results.get("generated_at"),
        "configured_queries": len(query_by_id),
        "input_items": len(raw_results.get("items", [])),
        "accepted_items": len(accepted),
        "duplicate_hits": duplicate_hits,
    }
    return latest


def main() -> None:
    result = merge()
    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    for path in OUTPUT_FILES:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload, encoding="utf-8")
    discovery = result.get("discovery", {})
    print(
        "Merged discovery: "
        f"accepted={discovery.get('accepted_items', 0)} "
        f"duplicates={discovery.get('duplicate_hits', 0)} "
        f"total={result.get('count', 0)}"
    )


if __name__ == "__main__":
    main()
