"""Collect RSS/Atom items into data/latest.json and docs/data/latest.json.

Public data only. The collector:
- reads public RSS/Atom feeds from config/sources.yml
- classifies each item with config/taxonomy.yml
- scores topics, attention signals, and combinations from config/interests.yml
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
SOURCES_FILE = ROOT / 'config' / 'sources.yml'
TAXONOMY_FILE = ROOT / 'config' / 'taxonomy.yml'
INTERESTS_FILE = ROOT / 'config' / 'interests.yml'
OUTPUT_FILES = (ROOT / 'data' / 'latest.json', ROOT / 'docs' / 'data' / 'latest.json')
MAX_ITEMS = 250
MAX_ITEMS_PER_SOURCE = 25
MAX_AGE_DAYS = 120
SUMMARY_LIMIT = 320
FETCH_TIMEOUT_SECONDS = 20
FETCH_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2
TRACKING_KEYS = {'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref_src'}
LEGACY_CATEGORY_MAP = {'ai_tools': 'ai', 'knowledge_tools': 'knowledge', 'software_building': 'software', 'personal_devices': 'devices', 'making': 'make', 'productivity': 'work', 'education_childcare': 'education', 'personal_web': 'software', 'discovery': 'other'}
USER_AGENT = 'MyInternetPlace/0.2 (public RSS collector; https://github.com/plzsayyes3/My_Internet_place)'

def load_yaml(path: Path) -> dict:
    with path.open('r', encoding='utf-8') as f:
        return yaml.safe_load(f) or {}

def clean_text(value: str | None) -> str:
    if not value:
        return ''
    value = html.unescape(value)
    value = re.sub('<[^>]+>', ' ', value)
    return re.sub('\\s+', ' ', value).strip()

def canonical_url(url: str) -> str:
    """Remove fragments and common tracking query parameters."""
    try:
        parts = urlsplit(url)
        query = []
        for key, value in parse_qsl(parts.query, keep_blank_values=True):
            key_lower = key.lower()
            if key_lower.startswith('utm_') or key_lower in TRACKING_KEYS:
                continue
            query.append((key, value))
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, urlencode(query, doseq=True), ''))
    except Exception:
        return url

def is_safe_article_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
        return parts.scheme in {'http', 'https'} and bool(parts.netloc)
    except Exception:
        return False

def item_id(url: str, title: str) -> str:
    return hashlib.sha256(f'{url}\n{title}'.encode('utf-8')).hexdigest()[:16]

def parsed_datetime(entry) -> datetime | None:
    parsed = getattr(entry, 'published_parsed', None) or getattr(entry, 'updated_parsed', None)
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
    if len(needle) <= 3 and re.fullmatch('[a-z0-9+#.-]+', needle):
        return re.search(f'(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])', haystack) is not None
    return needle in haystack

def match_terms(terms: list[str], title_haystack: str, summary_haystack: str) -> tuple[float, list[str]]:
    title_matches = [term for term in terms if keyword_matches(term, title_haystack)]
    title_match_set = {term.lower() for term in title_matches}
    summary_matches = [term for term in terms if term.lower() not in title_match_set and keyword_matches(term, summary_haystack)]
    if not title_matches and not summary_matches:
        return (0.0, [])
    strength = min(3.0, 1.5 * min(len(title_matches), 2) + 0.5 * min(len(summary_matches), 2))
    return (strength, title_matches + summary_matches)

def normalize_category(category: str, valid_categories: set[str]) -> str:
    normalized = LEGACY_CATEGORY_MAP.get(category, category)
    return normalized if normalized in valid_categories else 'other'

def classify_item(title: str, summary: str, topics: list[dict], valid_categories: set[str], fallback_category: str) -> tuple[str, list[dict]]:
    title_haystack = title.lower()
    summary_haystack = summary.lower()
    matched_topics: list[dict] = []
    category_scores: dict[str, float] = {}
    for topic in topics:
        terms = [str(term) for term in topic.get('keywords', [])]
        strength, matched_terms = match_terms(terms, title_haystack, summary_haystack)
        if strength <= 0:
            continue
        topic_id = str(topic.get('id', 'unknown'))
        category = normalize_category(str(topic.get('category', 'other')), valid_categories)
        matched_topics.append({'id': topic_id, 'label': str(topic.get('label') or topic_id), 'category': category, 'strength': round(strength, 2), 'terms': matched_terms})
        category_scores[category] = category_scores.get(category, 0.0) + strength
    fallback_category = normalize_category(fallback_category, valid_categories)
    if fallback_category != 'other':
        category_scores[fallback_category] = category_scores.get(fallback_category, 0.0) + 0.25
    if category_scores:
        primary_category = max(category_scores.items(), key=lambda pair: pair[1])[0]
    else:
        primary_category = fallback_category
    matched_topics.sort(key=lambda topic: (topic['strength'], topic['id']), reverse=True)
    return (primary_category, matched_topics)

def score_preferences(title: str, summary: str, matched_topics: list[dict], interest_config: dict) -> tuple[float, list[dict], list[dict], dict[str, float]]:
    title_haystack = title.lower()
    summary_haystack = summary.lower()
    full_haystack = f'{title} {summary}'.lower()
    topic_weights = interest_config.get('topic_weights', {})
    topic_score = 0.0
    for topic in matched_topics:
        weight = float(topic_weights.get(topic['id'], 0.5))
        topic_score += weight * min(float(topic['strength']), 2.0)
    signal_score = 0.0
    matched_signals: list[dict] = []
    for signal in interest_config.get('interest_signals', []):
        terms = [str(term) for term in signal.get('terms', [])]
        strength, matched_terms = match_terms(terms, title_haystack, summary_haystack)
        if strength <= 0:
            continue
        weight = float(signal.get('weight', 0.0))
        contribution = weight * strength
        signal_score += contribution
        matched_signals.append({'id': str(signal.get('id', 'unknown')), 'label': str(signal.get('label') or signal.get('id', 'Signal')), 'weight': weight, 'strength': round(strength, 2), 'contribution': round(contribution, 2), 'terms': matched_terms})
    combination_score = 0.0
    matched_combinations: list[dict] = []
    for combination in interest_config.get('combinations', []):
        terms = [str(term) for term in combination.get('terms', [])]
        matched_terms = [term for term in terms if keyword_matches(term, full_haystack)]
        min_match = max(1, int(combination.get('min_match', 2)))
        if len(matched_terms) < min_match:
            continue
        bonus = float(combination.get('bonus', 0.0))
        combination_score += bonus
        matched_combinations.append({'id': str(combination.get('id', 'unknown')), 'label': str(combination.get('label') or combination.get('id', 'Combination')), 'bonus': bonus, 'terms': matched_terms})
    total = topic_score + signal_score + combination_score
    components = {'topics': round(topic_score, 2), 'signals': round(signal_score, 2), 'combinations': round(combination_score, 2)}
    return (round(total, 2), matched_signals, matched_combinations, components)

def display_labels(matched_topics: list[dict], matched_signals: list[dict], matched_combinations: list[dict]) -> list[str]:
    labels: list[str] = []
    for topic in matched_topics[:3]:
        labels.append(str(topic['label']))
    for signal in matched_signals:
        if float(signal.get('contribution', 0)) > 0:
            labels.append(str(signal['label']))
    for combination in matched_combinations:
        labels.append(str(combination['label']))
    return list(dict.fromkeys(labels))[:6]

def fetch_feed(url: str):
    last_error: Exception | None = None
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            response = requests.get(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'}, timeout=FETCH_TIMEOUT_SECONDS)
            response.raise_for_status()
            parsed = feedparser.parse(response.content)
            if getattr(parsed, 'bozo', False) and not parsed.entries:
                raise RuntimeError(str(getattr(parsed, 'bozo_exception', 'invalid feed')))
            return parsed
        except (requests.RequestException, RuntimeError) as exc:
            last_error = exc
            if attempt >= FETCH_ATTEMPTS:
                break
            print(f'[RETRY] {url} attempt {attempt}/{FETCH_ATTEMPTS}: {exc}')
            time.sleep(RETRY_DELAY_SECONDS)
    raise RuntimeError(str(last_error or 'feed request failed'))

def collect() -> dict:
    source_config = load_yaml(SOURCES_FILE)
    taxonomy = load_yaml(TAXONOMY_FILE)
    interest_config = load_yaml(INTERESTS_FILE)
    sources = source_config.get('sources', [])
    topics = taxonomy.get('topics', [])
    categories = taxonomy.get('categories', [])
    valid_categories = {str(category.get('id')) for category in categories if category.get('id')}
    items: list[dict] = []
    source_status: list[dict] = []
    now = datetime.now(timezone.utc)
    enabled_sources = [source for source in sources if source.get('enabled', True) and source.get('type', 'rss') in {'rss', 'atom', 'feed'} and source.get('url')]
    for source in enabled_sources:
        feed_url = str(source['url'])
        source_id = str(source.get('id') or source.get('name') or feed_url)
        configured_name = str(source.get('name') or '')
        fallback_category = str(source.get('default_category') or source.get('category') or 'other')
        item_type = str(source.get('default_item_type') or source.get('content_type') or 'article')
        default_traits = [str(trait) for trait in source.get('default_traits', [])]
        source_priority = float(source.get('priority', 0.5))
        source_max_age = int(source.get('max_age_days', MAX_AGE_DAYS))
        try:
            parsed = fetch_feed(feed_url)
            source_name = configured_name or parsed.feed.get('title') or source_id
            added = 0
            stale = 0
            for entry in parsed.entries[:MAX_ITEMS_PER_SOURCE]:
                title = clean_text(entry.get('title'))
                raw_url = str(entry.get('link', '')).strip()
                url = canonical_url(raw_url)
                if not title or not url or not is_safe_article_url(url):
                    continue
                published_dt = parsed_datetime(entry)
                if published_dt:
                    age_days = max(0.0, (now - published_dt).total_seconds() / 86400)
                    if age_days > source_max_age:
                        stale += 1
                        continue
                    freshness = max(0.0, 1.0 - age_days / source_max_age)
                    published_at = published_dt.isoformat()
                else:
                    freshness = 0.2
                    published_at = None
                summary = clean_text(entry.get('summary') or entry.get('description') or entry.get('subtitle'))
                primary_category, matched_topics = classify_item(title, summary, topics, valid_categories, fallback_category)
                score, matched_signals, matched_combinations, score_components = score_preferences(title, summary, matched_topics, interest_config)
                labels = display_labels(matched_topics, matched_signals, matched_combinations)
                rank_score = round(score * (0.55 + 0.45 * freshness) + 2.0 * freshness + source_priority * 0.2, 2)
                topic_ids = [topic['id'] for topic in matched_topics]
                topic_labels = [topic['label'] for topic in matched_topics]
                positive_signal_ids = [signal['id'] for signal in matched_signals if float(signal.get('contribution', 0)) > 0]
                items.append({'id': item_id(url, title), 'title': title, 'url': url, 'summary': summary[:SUMMARY_LIMIT], 'published_at': published_at, 'source': source_name, 'source_id': source_id, 'source_category': normalize_category(fallback_category, valid_categories), 'primary_category': primary_category, 'topics': topic_ids, 'topic_labels': topic_labels, 'topic_scores': {topic['id']: topic['strength'] for topic in matched_topics}, 'matched_signals': [signal['id'] for signal in matched_signals], 'positive_signals': positive_signal_ids, 'matched_combinations': [combination['id'] for combination in matched_combinations], 'item_type': item_type, 'content_type': item_type, 'traits': default_traits, 'score': score, 'score_components': score_components, 'rank_score': rank_score, 'matched_interests': topic_ids, 'matched_labels': labels})
                added += 1
            source_status.append({'id': source_id, 'name': source_name, 'ok': True, 'items': added, 'stale_skipped': stale})
        except Exception as exc:
            source_status.append({'id': source_id, 'name': configured_name or source_id, 'ok': False, 'items': 0, 'stale_skipped': 0, 'error': clean_text(str(exc))[:180]})
            print(f'[WARN] {source_id}: {exc}')
    deduped: dict[str, dict] = {}
    for item in items:
        existing = deduped.get(item['url'])
        if not existing or item['rank_score'] > existing['rank_score']:
            deduped[item['url']] = item
    ranked = sorted(deduped.values(), key=lambda x: (x.get('rank_score', 0), x.get('published_at') or ''), reverse=True)[:MAX_ITEMS]
    healthy = sum(1 for status in source_status if status['ok'])
    if enabled_sources and healthy == 0:
        raise RuntimeError('All configured feeds failed; keeping the previous dataset.')
    return {'generated_at': now.isoformat(), 'count': len(ranked), 'taxonomy_version': taxonomy.get('version'), 'interest_profile_version': interest_config.get('version'), 'sources': {'configured': len(enabled_sources), 'healthy': healthy, 'status': source_status}, 'items': ranked}

def main() -> None:
    result = collect()
    payload = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    for output_file in OUTPUT_FILES:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(payload, encoding='utf-8')
    print(f"Collected {result['count']} items from {result['sources']['healthy']}/{result['sources']['configured']} feeds")
if __name__ == '__main__':
    main()
