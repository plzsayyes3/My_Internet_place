import unittest
from pathlib import Path

from src.collect import classify_item, load_yaml, score_preferences

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = load_yaml(ROOT / "config" / "taxonomy.yml")
INTERESTS = load_yaml(ROOT / "config" / "interests.yml")
DISCOVERY = load_yaml(ROOT / "config" / "discovery.yml")
TOPICS = TAXONOMY.get("topics", [])
VALID_CATEGORIES = {str(x["id"]) for x in TAXONOMY.get("categories", []) if x.get("id")}
CLASSIFICATION = TAXONOMY.get("classification", {})


def classify_and_score(
    title: str,
    summary: str,
    fallback: str = "making",
    default_topics=None,
    metadata: str = "",
):
    category, topics = classify_item(
        title,
        summary,
        TOPICS,
        VALID_CATEGORIES,
        fallback,
        fallback_topic_ids=default_topics or [],
        classification=CLASSIFICATION,
        metadata_text=metadata,
    )
    score, signals, combinations, components = score_preferences(title, summary, topics, INTERESTS)
    return category, topics, score, signals, combinations, components


class TaxonomyV4Tests(unittest.TestCase):
    def test_display_genres_are_the_approved_twelve(self):
        self.assertEqual(
            [x["id"] for x in TAXONOMY["categories"]],
            [
                "ai",
                "knowledge",
                "software",
                "making",
                "small_devices",
                "ios_apple",
                "education",
                "work",
                "personal_web",
                "games",
                "lifestyle",
                "other",
            ],
        )

    def test_topic_vocabulary_stays_internal_and_bounded(self):
        self.assertLessEqual(len(TOPICS), 40)
        self.assertLessEqual(int(CLASSIFICATION["max_topics_per_item"]), 3)

    def test_blog_and_long_read_are_separate_axes(self):
        content_types = {x["id"] for x in TAXONOMY["content_types"]}
        source_kinds = {x["id"] for x in TAXONOMY["source_kinds"]}
        depths = {x["id"] for x in TAXONOMY["reading_depths"]}
        self.assertNotIn("blog", content_types)
        self.assertIn("blog", source_kinds)
        self.assertNotIn("long_read", content_types)
        self.assertIn("long", depths)

    def test_cyberdeck_epaper_is_small_devices_and_strongly_boosted(self):
        category, topics, score, signals, combinations, _ = classify_and_score(
            "Build a pocket ESP32 e-paper cyberdeck",
            "A handheld low-power terminal with a keyboard and e-paper display.",
        )
        ids = {x["id"] for x in topics}
        self.assertEqual(category, "small_devices")
        self.assertIn("embedded_devices", ids)
        self.assertIn("e_paper", ids)
        self.assertLessEqual(len(topics), 3)
        self.assertIn("cyberdeck", {x["id"] for x in signals})
        self.assertIn("cyberdeck_build", {x["id"] for x in combinations})
        self.assertGreater(score, 8.0)

    def test_pokemon_is_genre_topic_and_signal(self):
        category, topics, score, signals, _, _ = classify_and_score(
            "Latest News | Pokemon.com",
            "Pokémon GO and Pokémon Card Game updates.",
            fallback="other",
        )
        self.assertEqual(category, "games")
        self.assertIn("pokemon", {x["id"] for x in topics})
        self.assertIn("pokemon", {x["id"] for x in signals})
        self.assertGreater(score, 0)

    def test_specific_genre_priority_breaks_equal_topic_scores(self):
        category, topics, *_ = classify_and_score(
            "ESP32 GitHub",
            "A project.",
            fallback="other",
        )
        ids = {x["id"] for x in topics}
        self.assertIn("embedded_devices", ids)
        self.assertIn("github_devops", ids)
        self.assertEqual(category, "small_devices")

    def test_metadata_is_supplemental_but_can_support_three_consistent_terms(self):
        category, topics, *_ = classify_and_score(
            "A new portable project",
            "Hardware notes.",
            fallback="other",
            metadata="https://example.com/esp32/m5stack/arduino",
        )
        self.assertEqual(category, "small_devices")
        self.assertIn("embedded_devices", {x["id"] for x in topics})

    def test_large_industrial_robotics_is_downranked(self):
        _, _, score, signals, combinations, components = classify_and_score(
            "New industrial robot arm for warehouse automation",
            "A large industrial robotics platform for factories.",
        )
        self.assertIn("large_robotics", {x["id"] for x in signals})
        self.assertEqual(combinations, [])
        self.assertLess(components["signals"], 0)
        self.assertLess(score, 0)

    def test_source_default_topics_are_fallback_only(self):
        category, topics, *_ = classify_and_score(
            "A quiet unrelated essay",
            "No configured topic terms appear here.",
            fallback="other",
            default_topics=["early_childhood"],
        )
        self.assertEqual(category, "education")
        self.assertEqual([x["id"] for x in topics], ["early_childhood"])
        self.assertTrue(topics[0]["fallback"])

    def test_article_text_overrides_source_default_topic(self):
        category, topics, *_ = classify_and_score(
            "Obsidian local-first notes",
            "A local-first PKM workflow.",
            fallback="education",
            default_topics=["early_childhood"],
        )
        self.assertEqual(category, "knowledge")
        self.assertIn("obsidian_pkm", {x["id"] for x in topics})
        self.assertNotIn("early_childhood", {x["id"] for x in topics})

    def test_discovery_queries_reference_valid_topics(self):
        valid = {x["id"] for x in TOPICS}
        referenced = {topic for query in DISCOVERY.get("queries", []) for topic in query.get("topics", [])}
        self.assertTrue(referenced.issubset(valid), referenced - valid)

    def test_discovery_queries_reference_valid_interest_signals(self):
        valid = {x["id"] for x in INTERESTS.get("interest_signals", [])}
        referenced = {signal for query in DISCOVERY.get("queries", []) for signal in query.get("signals", [])}
        self.assertTrue(referenced.issubset(valid), referenced - valid)

    def test_pokemon_discovery_has_topic_and_signal(self):
        signals = {x["id"]: x for x in INTERESTS.get("interest_signals", [])}
        self.assertIn("pokemon", signals)
        self.assertAlmostEqual(float(signals["pokemon"]["weight"]), 1.3)

        pokemon_queries = [
            x for x in DISCOVERY.get("queries", [])
            if "pokemon" in x.get("signals", [])
        ]
        self.assertEqual({x["query"] for x in pokemon_queries}, {"ポケモン", "Pokémon", "Pokemon news"})
        self.assertTrue(all("pokemon" in x.get("topics", []) for x in pokemon_queries))
        self.assertTrue(all(x.get("enabled", False) for x in pokemon_queries))
        self.assertTrue(DISCOVERY.get("enabled", False))


if __name__ == "__main__":
    unittest.main()
