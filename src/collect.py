"""Collect RSS/Atom items for My Internet Place.

Taxonomy = stable classification vocabulary.
Interests = public-safe personal weights/signals.
Sources = feed metadata and fallback topics.
Discovery = separate active-search configuration (not executed here yet).
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
TAXONOMY_FILE = ROOT / "config" / "taxonomy.yml"
INTERESTS_FILE = ROOT / "config" / "interests.yml"
OUTPUT_FILES = (ROOT / "data" / "latest.json", ROOT / "docs" / "data" / "latest.json")
MAX_ITEMS = 250
MAX_ITEMS_PER_SOURCE = 25
MAX_AGE_DAYS = 120
SUMMARY_LIMIT = 320
FETCH_TIMEOUT_SECONDS = 20
FETCH_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2
TRACKING_KEYS = {"fbclid", "gclid", "mc_cid", "mc_eid", "ref_src"}
LEGACY_CATEGORY_MAP = {
    "ai_tools": "ai", "knowledge_tools": "knowledge", "software_building": "software",
    "personal_devices": "life", "devices": "make", "making": "make",
    "productivity": "work", "education_childcare": "education",
    "personal_web": "web", "discovery": "other",
}
USER_AGENT = "MyInternetPlace/0.3 (public RSS collector; https://github.com/plzsayyes3/My_Internet_place)"


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(value))).strip()


def canonical_url(url: str) -> str:
    try:
        p = urlsplit(url)
        q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in TRACKING_KEYS]
        return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path, urlencode(q, doseq=True), ""))
    except Exception:
        return url


def is_safe_article_url(url: str) -> bool:
    try:
        p = urlsplit(url)
        return p.scheme in {"http", "https"} and bool(p.netloc)
    except Exception:
        return False


def item_id(url: str, title: str) -> str:
    return hashlib.sha256(f"{url}\n{title}".encode()).hexdigest()[:16]


def parsed_datetime(entry) -> datetime | None:
    parsed = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
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
    if len(needle) <= 3 and re.fullmatch(r"[a-z0-9+#.-]+", needle):
        return re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", haystack) is not None
    return needle in haystack


def match_terms(terms: list[str], title: str, summary: str) -> tuple[float, list[str]]:
    tm = [t for t in terms if keyword_matches(t, title)]
    seen = {t.lower() for t in tm}
    sm = [t for t in terms if t.lower() not in seen and keyword_matches(t, summary)]
    if not tm and not sm:
        return 0.0, []
    strength = min(3.0, 1.5 * min(len(tm), 2) + 0.5 * min(len(sm), 2))
    return strength, tm + sm


def normalize_category(category: str, valid: set[str]) -> str:
    value = LEGACY_CATEGORY_MAP.get(category, category)
    return value if value in valid else "other"


def _topic_match(topic: dict, title: str, summary: str, config: dict) -> dict | None:
    matching = config.get("topic_matching", {})
    title_mul = float(matching.get("title_multiplier", 2.0))
    summary_mul = float(matching.get("summary_multiplier", 1.0))
    max_hits = max(1, int(matching.get("max_keyword_matches_per_topic", 3)))
    minimum = float(config.get("minimum_topic_score", 0.25))
    terms = [str(x) for x in topic.get("keywords", [])]
    tm = [t for t in terms if keyword_matches(t, title)][:max_hits]
    used = {t.lower() for t in tm}
    sm = [t for t in terms if t.lower() not in used and keyword_matches(t, summary)][:max(0, max_hits-len(tm))]
    if not tm and not sm:
        return None
    raw = title_mul * len(tm) + summary_mul * len(sm)
    score = min(1.0, raw / max(title_mul * max_hits, 1.0))
    if score < minimum:
        return None
    return {"id": str(topic.get("id")), "label": str(topic.get("label") or topic.get("id")),
            "category": str(topic.get("category", "other")), "score": round(score, 3),
            "raw_score": round(raw, 3), "terms": tm + sm, "fallback": False}


def classify_item(title: str, summary: str, topics: list[dict], valid_categories: set[str],
                  fallback_category: str = "other", fallback_topic_ids: list[str] | None = None,
                  classification: dict | None = None) -> tuple[str, list[dict]]:
    """Return one coarse category and at most N scored topics."""
    config = classification or {}
    max_topics = max(1, int(config.get("max_topics_per_item", 3)))
    matched = []
    for topic in topics:
        item = _topic_match(topic, title.lower(), summary.lower(), config)
        if item:
            item["category"] = normalize_category(item["category"], valid_categories)
            matched.append(item)
    matched.sort(key=lambda x: (x["score"], x["raw_score"], x["id"]), reverse=True)
    matched = matched[:max_topics]

    if not matched and config.get("fallback", {}).get("use_source_default_topics", True) and fallback_topic_ids:
        by_id = {str(t.get("id")): t for t in topics if t.get("id")}
        minimum = float(config.get("minimum_topic_score", 0.25))
        for topic_id in fallback_topic_ids[:max_topics]:
            topic = by_id.get(str(topic_id))
            if topic:
                matched.append({"id": str(topic["id"]), "label": str(topic.get("label") or topic["id"]),
                                "category": normalize_category(str(topic.get("category", "other")), valid_categories),
                                "score": round(minimum, 3), "raw_score": 0.0, "terms": [], "fallback": True})

    category = matched[0]["category"] if matched else normalize_category(fallback_category, valid_categories)
    return category, matched


def score_preferences(title: str, summary: str, matched_topics: list[dict], interest_config: dict):
    th, sh, full = title.lower(), summary.lower(), f"{title} {summary}".lower()
    weights = interest_config.get("topic_weights", {})
    topic_score = sum(float(weights.get(t["id"], 0.5)) * float(t.get("score", 0)) * 3 for t in matched_topics)

    signal_score, signals = 0.0, []
    for signal in interest_config.get("interest_signals", []):
        strength, terms = match_terms([str(x) for x in signal.get("terms", [])], th, sh)
        if strength <= 0:
            continue
        weight = float(signal.get("weight", 0))
        contribution = weight * strength
        signal_score += contribution
        signals.append({"id": str(signal.get("id")), "label": str(signal.get("label") or signal.get("id")),
                        "weight": weight, "strength": round(strength, 2),
                        "contribution": round(contribution, 2), "terms": terms})

    combo_score, combos = 0.0, []
    for combo in interest_config.get("combinations", []):
        terms = [str(x) for x in combo.get("terms", [])]
        hits = [t for t in terms if keyword_matches(t, full)]
        if len(hits) < max(1, int(combo.get("min_match", 2))):
            continue
        bonus = float(combo.get("bonus", 0))
        combo_score += bonus
        combos.append({"id": str(combo.get("id")), "label": str(combo.get("label") or combo.get("id")),
                       "bonus": bonus, "terms": hits})

    components = {"topics": round(topic_score, 2), "signals": round(signal_score, 2), "combinations": round(combo_score, 2)}
    return round(topic_score + signal_score + combo_score, 2), signals, combos, components


def display_labels(topics: list[dict], signals: list[dict], combos: list[dict]) -> list[str]:
    labels = [str(x["label"]) for x in topics[:3]]
    labels += [str(x["label"]) for x in signals if float(x.get("contribution", 0)) > 0]
    labels += [str(x["label"]) for x in combos]
    return list(dict.fromkeys(labels))[:6]


def fetch_feed(url: str):
    last_error = None
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT,
                "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"},
                timeout=FETCH_TIMEOUT_SECONDS)
            r.raise_for_status()
            parsed = feedparser.parse(r.content)
            if getattr(parsed, "bozo", False) and not parsed.entries:
                raise RuntimeError(str(getattr(parsed, "bozo_exception", "invalid feed")))
            return parsed
        except (requests.RequestException, RuntimeError) as exc:
            last_error = exc
            if attempt >= FETCH_ATTEMPTS:
                break
            print(f"[RETRY] {url} attempt {attempt}/{FETCH_ATTEMPTS}: {exc}")
            time.sleep(RETRY_DELAY_SECONDS)
    raise RuntimeError(str(last_error or "feed request failed"))


def _validated(value: str, valid: set[str], fallback: str) -> str:
    return value if value in valid else fallback


def _default_category(topic_ids: list[str], topic_by_id: dict[str, dict], valid: set[str]) -> str:
    for topic_id in topic_ids:
        topic = topic_by_id.get(topic_id)
        if topic:
            return normalize_category(str(topic.get("category", "other")), valid)
    return "other"


def collect() -> dict:
    source_config, taxonomy, interests = load_yaml(SOURCES_FILE), load_yaml(TAXONOMY_FILE), load_yaml(INTERESTS_FILE)
    sources, topics = source_config.get("sources", []), taxonomy.get("topics", [])
    classification = taxonomy.get("classification", {})
    valid_categories = {str(x["id"]) for x in taxonomy.get("categories", []) if x.get("id")}
    topic_by_id = {str(x["id"]): x for x in topics if x.get("id")}
    valid_content = {str(x["id"]) for x in taxonomy.get("content_types", []) if x.get("id")}
    valid_source = {str(x["id"]) for x in taxonomy.get("source_kinds", []) if x.get("id")}
    valid_depth = {str(x["id"]) for x in taxonomy.get("reading_depths", []) if x.get("id")}
    now, items, source_status = datetime.now(timezone.utc), [], []
    enabled = [s for s in sources if s.get("enabled", True) and s.get("type", "rss") in {"rss", "atom", "feed"} and s.get("url")]

    for source in enabled:
        url = str(source["url"]); source_id = str(source.get("id") or source.get("name") or url)
        configured_name = str(source.get("name") or "")
        defaults = [str(x) for x in source.get("default_topics", [])]
        fallback_category = str(source.get("default_category") or source.get("category") or _default_category(defaults, topic_by_id, valid_categories))
        source_kind = _validated(str(source.get("source_kind", "publication")), valid_source, "publication")
        content_type = _validated(str(source.get("default_content_type") or source.get("default_item_type") or source.get("content_type") or "news"), valid_content, "news")
        depth = _validated(str(source.get("default_reading_depth", "standard")), valid_depth, "standard")
        priority = float(source.get("priority", 0.5)); max_age = int(source.get("max_age_days", MAX_AGE_DAYS))
        try:
            parsed = fetch_feed(url); source_name = configured_name or parsed.feed.get("title") or source_id
            added = stale = 0
            for entry in parsed.entries[:MAX_ITEMS_PER_SOURCE]:
                title = clean_text(entry.get("title")); article_url = canonical_url(str(entry.get("link", "")).strip())
                if not title or not article_url or not is_safe_article_url(article_url):
                    continue
                published = parsed_datetime(entry)
                if published:
                    age = max(0.0, (now - published).total_seconds() / 86400)
                    if age > max_age:
                        stale += 1; continue
                    freshness = max(0.0, 1.0 - age / max_age); published_at = published.isoformat()
                else:
                    freshness, published_at = 0.2, None
                summary = clean_text(entry.get("summary") or entry.get("description") or entry.get("subtitle"))
                category, matched = classify_item(title, summary, topics, valid_categories, fallback_category, defaults, classification)
                score, matched_signals, matched_combos, components = score_preferences(title, summary, matched, interests)
                rank_score = round(score * (0.55 + 0.45 * freshness) + 2.0 * freshness + priority * 0.2, 2)
                topic_ids = [x["id"] for x in matched]; topic_labels = [x["label"] for x in matched]
                public_topics = [{"id": x["id"], "score": x["score"]} for x in matched]
                labels = display_labels(matched, matched_signals, matched_combos)
                direct = max(0.0, score)
                items.append({
                    "id": item_id(article_url, title), "title": title, "url": article_url,
                    "summary": summary[:SUMMARY_LIMIT], "published_at": published_at,
                    "source": source_name, "source_id": source_id, "source_kind": source_kind,
                    "source_category": normalize_category(fallback_category, valid_categories),
                    "primary_category": category, "topics": public_topics,
                    "topic_ids": topic_ids, "topic_labels": topic_labels,
                    "topic_scores": {x["id"]: x["score"] for x in matched},
                    "matched_signals": [x["id"] for x in matched_signals],
                    "positive_signals": [x["id"] for x in matched_signals if float(x.get("contribution", 0)) > 0],
                    "matched_combinations": [x["id"] for x in matched_combos],
                    "content_type": content_type, "item_type": content_type, "reading_depth": depth,
                    "signals": {"direct_interest": round(direct, 2), "related_interest": 0.0,
                                "freshness": round(freshness, 3), "source_priority": round(priority, 3)},
                    "recommendation_reason": "direct" if direct > 0 else "latest",
                    "score": score, "score_components": components, "rank_score": rank_score,
                    "matched_interests": topic_ids, "matched_labels": labels,
                })
                added += 1
            source_status.append({"id": source_id, "name": source_name, "ok": True, "items": added, "stale_skipped": stale})
        except Exception as exc:
            source_status.append({"id": source_id, "name": configured_name or source_id, "ok": False, "items": 0,
                                  "stale_skipped": 0, "error": clean_text(str(exc))[:180]})
            print(f"[WARN] {source_id}: {exc}")

    deduped = {}
    for item in items:
        old = deduped.get(item["url"])
        if not old or item["rank_score"] > old["rank_score"]:
            deduped[item["url"]] = item
    ranked = sorted(deduped.values(), key=lambda x: (x.get("rank_score", 0), x.get("published_at") or ""), reverse=True)[:MAX_ITEMS]
    healthy = sum(1 for x in source_status if x["ok"])
    if enabled and healthy == 0:
        raise RuntimeError("All configured feeds failed; keeping the previous dataset.")
    return {"generated_at": now.isoformat(), "count": len(ranked), "taxonomy_version": taxonomy.get("version"),
            "interest_profile_version": interests.get("version"),
            "sources": {"configured": len(enabled), "healthy": healthy, "status": source_status}, "items": ranked}


def main() -> None:
    result = collect(); payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    for path in OUTPUT_FILES:
        path.parent.mkdir(parents=True, exist_ok=True); path.write_text(payload, encoding="utf-8")
    print(f"Collected {result['count']} items from {result['sources']['healthy']}/{result['sources']['configured']} feeds")


if __name__ == "__main__":
    main()
