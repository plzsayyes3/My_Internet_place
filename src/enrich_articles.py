"""Enrich My Internet Place items with personal-research metadata and card images.

Runs after RSS collection + ChatGPT discovery merge and before translation.
- ChatGPT discovery is treated as a second collection route, not a separate feed.
- Metadata from data/discovery.json is preserved on the shared article object.
- Missing card images are resolved from feed/discovery data first, then Open Graph.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests

ROOT = Path(__file__).resolve().parents[1]
LATEST_FILE = ROOT / "data" / "latest.json"
DISCOVERY_FILE = ROOT / "data" / "discovery.json"
OUTPUT_FILES = (LATEST_FILE, ROOT / "docs" / "data" / "latest.json")
USER_AGENT = "MyInternetPlace/0.5 (article metadata enrichment)"
TIMEOUT = 8
MAX_OG_FETCHES = 90
MAX_HTML_BYTES = 700_000


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def clean_url(value: object, base_url: str = "") -> str:
    if not isinstance(value, str):
        return ""
    value = html.unescape(value.strip())
    if base_url:
        value = urljoin(base_url, value)
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return ""
    except ValueError:
        return ""
    return value


def discovery_by_url() -> dict[str, dict]:
    raw = load_json(DISCOVERY_FILE)
    result = {}
    for item in raw.get("items", []):
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if url:
            result[url] = item
    return result


def meta_content(text: str, key: str) -> str:
    patterns = [
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(key)}["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ""


def fetch_card_image(article_url: str) -> str:
    try:
        response = requests.get(
            article_url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
            timeout=TIMEOUT,
            allow_redirects=True,
            stream=True,
        )
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").lower()
        if "html" not in content_type:
            return ""
        chunks = []
        total = 0
        for chunk in response.iter_content(32_768):
            if not chunk:
                continue
            chunks.append(chunk)
            total += len(chunk)
            if total >= MAX_HTML_BYTES:
                break
        encoding = response.encoding or "utf-8"
        text = b"".join(chunks).decode(encoding, errors="replace")
        for key in ("og:image", "twitter:image", "twitter:image:src"):
            image = clean_url(meta_content(text, key), response.url)
            if image:
                return image
    except requests.RequestException as exc:
        print(f"[image] {article_url}: {exc}")
    return ""


def enrich() -> dict:
    latest = load_json(LATEST_FILE)
    items = latest.get("items", [])
    discovery = discovery_by_url()
    fetched = 0
    images_added = 0
    research_items = 0

    for item in items:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "")
        raw = discovery.get(url)
        is_research = item.get("source_method") == "chatgpt_search" or raw is not None

        if is_research:
            research_items += 1
            item["source_type"] = "personal_research"
            item["research_type"] = str((raw or {}).get("research_type") or "zapping")
            pick_reason = str((raw or {}).get("pick_reason") or (raw or {}).get("reason") or "").strip()
            if pick_reason:
                item["pick_reason"] = pick_reason
            interest_tags = (raw or {}).get("interest_tags")
            if isinstance(interest_tags, list):
                item["interest_tags"] = [str(x) for x in interest_tags if x]
            labels = list(item.get("matched_labels") or [])
            if "AI PICK" not in labels:
                labels.append("AI PICK")
            item["matched_labels"] = labels[:7]

        existing = ""
        for key in ("image_url", "thumbnail_url", "og_image", "image", "thumbnail"):
            existing = clean_url(item.get(key), url)
            if existing:
                break
        if not existing and raw:
            for key in ("image_url", "thumbnail_url", "og_image", "image"):
                existing = clean_url(raw.get(key), url)
                if existing:
                    break
        if existing:
            item["image_url"] = existing
            continue

        if fetched >= MAX_OG_FETCHES or not url:
            continue
        fetched += 1
        image = fetch_card_image(url)
        if image:
            item["image_url"] = image
            images_added += 1

    latest["enrichment"] = {
        "personal_research_items": research_items,
        "og_pages_checked": fetched,
        "images_added": images_added,
    }
    return latest


def main() -> None:
    result = enrich()
    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    for path in OUTPUT_FILES:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload, encoding="utf-8")
    info = result.get("enrichment", {})
    print(
        "Enriched articles: "
        f"research={info.get('personal_research_items', 0)} "
        f"og_checked={info.get('og_pages_checked', 0)} "
        f"images={info.get('images_added', 0)}"
    )


if __name__ == "__main__":
    main()
