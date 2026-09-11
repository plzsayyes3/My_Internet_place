"""Add offline Japanese translations to the generated article dataset.

The original title/summary are always preserved. Japanese fields are added as
`title_ja` and `summary_ja`. Existing translations from the previous dataset are
reused when the source text is unchanged, so scheduled runs only translate new
or changed content.

No external translation API or API key is used. Argos Translate runs locally in
the GitHub Actions runner.
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "latest.json"
DOCS_DATA_FILE = ROOT / "docs" / "data" / "latest.json"
SOURCES_FILE = ROOT / "config" / "sources.yml"

JP_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
LATIN_RE = re.compile(r"[A-Za-z]")


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_source_languages() -> dict[str, str]:
    if not SOURCES_FILE.exists():
        return {}
    with SOURCES_FILE.open("r", encoding="utf-8") as handle:
        config = yaml.safe_load(handle) or {}
    return {
        str(source.get("id")): str(source.get("language"))
        for source in config.get("sources", [])
        if source.get("id") and source.get("language")
    }


def looks_japanese(text: str) -> bool:
    """Heuristic fallback for feeds without explicit language metadata."""
    if not text:
        return False
    jp = len(JP_RE.findall(text))
    latin = len(LATIN_RE.findall(text))
    if jp == 0:
        return False
    if latin == 0:
        return True
    return jp >= 3 and jp / (jp + latin) >= 0.12


def previous_items(path: Path | None) -> dict[str, dict]:
    if not path or not path.exists():
        return {}
    payload = load_json(path)
    return {
        str(item.get("url")): item
        for item in payload.get("items", [])
        if item.get("url")
    }


def ensure_en_ja_translator():
    import argostranslate.package
    import argostranslate.translate

    installed = argostranslate.package.get_installed_packages()
    if not any(pkg.from_code == "en" and pkg.to_code == "ja" for pkg in installed):
        print("[translate] Installing Argos en→ja model")
        argostranslate.package.update_package_index()
        available = argostranslate.package.get_available_packages()
        model = next(
            (pkg for pkg in available if pkg.from_code == "en" and pkg.to_code == "ja"),
            None,
        )
        if model is None:
            raise RuntimeError("Argos en→ja model is not available")
        argostranslate.package.install_from_path(model.download())

    translator = argostranslate.translate.get_translation_from_codes("en", "ja")
    if translator is None:
        raise RuntimeError("Argos en→ja translator could not be loaded")
    return translator


def translate_dataset(previous_path: Path | None = None) -> dict:
    payload = load_json(DATA_FILE)
    items = payload.get("items", [])
    previous = previous_items(previous_path)
    source_languages = load_source_languages()

    translator = None
    stats = {
        "translated_fields": 0,
        "reused_fields": 0,
        "native_japanese_fields": 0,
        "failed_fields": 0,
    }

    def translate_text(text: str) -> str:
        nonlocal translator
        if translator is None:
            translator = ensure_en_ja_translator()
        return translator.translate(text)

    for item in items:
        url = str(item.get("url") or "")
        old = previous.get(url, {})
        source_language = source_languages.get(str(item.get("source_id") or ""), "")

        for source_key, target_key in (("title", "title_ja"), ("summary", "summary_ja")):
            text = str(item.get(source_key) or "").strip()
            if not text:
                item[target_key] = ""
                continue

            if source_language == "ja" or looks_japanese(text):
                item[target_key] = text
                stats["native_japanese_fields"] += 1
                continue

            if old.get(source_key) == text and old.get(target_key):
                item[target_key] = old[target_key]
                stats["reused_fields"] += 1
                continue

            try:
                translated = str(translate_text(text) or "").strip()
                item[target_key] = translated or text
                stats["translated_fields"] += 1
            except Exception as exc:
                print(f"[translate] WARN {item.get('source_id')} {source_key}: {exc}")
                item[target_key] = text
                stats["failed_fields"] += 1

    payload["translation"] = {
        "engine": "argos-translate",
        "source_language": "en",
        "target_language": "ja",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **stats,
    }
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--previous", type=Path, default=None)
    args = parser.parse_args()

    payload = translate_dataset(args.previous)
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    for path in (DATA_FILE, DOCS_DATA_FILE):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    info = payload.get("translation", {})
    print(
        "Translated dataset: "
        f"new={info.get('translated_fields', 0)} "
        f"reused={info.get('reused_fields', 0)} "
        f"native-ja={info.get('native_japanese_fields', 0)} "
        f"failed={info.get('failed_fields', 0)}"
    )


if __name__ == "__main__":
    main()
