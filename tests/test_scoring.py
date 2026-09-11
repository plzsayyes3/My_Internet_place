import unittest
from pathlib import Path

from src.collect import classify_item, load_yaml, score_preferences


ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = load_yaml(ROOT / "config" / "taxonomy.yml")
INTERESTS = load_yaml(ROOT / "config" / "interests.yml")
TOPICS = TAXONOMY.get("topics", [])
VALID_CATEGORIES = {
    str(category["id"])
    for category in TAXONOMY.get("categories", [])
    if category.get("id")
}


def classify_and_score(title: str, summary: str, fallback: str = "make"):
    category, matched_topics = classify_item(
        title,
        summary,
        TOPICS,
        VALID_CATEGORIES,
        fallback,
    )
    score, signals, combinations, components = score_preferences(
        title,
        summary,
        matched_topics,
        INTERESTS,
    )
    return category, matched_topics, score, signals, combinations, components


class PersonalScoringTests(unittest.TestCase):
    def test_cyberdeck_epaper_is_strongly_boosted(self):
        category, topics, score, signals, combinations, _ = classify_and_score(
            "Build a pocket ESP32 e-paper cyberdeck",
            "A handheld low-power terminal with a keyboard and e-paper display.",
        )

        self.assertEqual(category, "devices")
        self.assertIn("small_computing", {topic["id"] for topic in topics})
        self.assertIn("epaper_wearables", {topic["id"] for topic in topics})
        self.assertIn("cyberdeck", {signal["id"] for signal in signals})
        self.assertIn("cyberdeck_build", {combo["id"] for combo in combinations})
        self.assertGreater(score, 8.0)

    def test_large_industrial_robotics_is_downranked(self):
        _, _, score, signals, combinations, components = classify_and_score(
            "New industrial robot arm for warehouse automation",
            "A large industrial robotics platform for factories.",
        )

        self.assertIn("large_robotics", {signal["id"] for signal in signals})
        self.assertEqual(combinations, [])
        self.assertLess(components["signals"], 0)
        self.assertLess(score, 0)

    def test_general_small_electronics_still_matches_without_cyberdeck_bonus(self):
        _, topics, score, signals, combinations, _ = classify_and_score(
            "ESP32 electronics project with PCB",
            "A general maker tutorial for a development board.",
        )

        self.assertIn("small_computing", {topic["id"] for topic in topics})
        self.assertIn("diy_electronics", {topic["id"] for topic in topics})
        self.assertIn(
            "practical_small_computing", {signal["id"] for signal in signals}
        )
        self.assertNotIn("cyberdeck_build", {combo["id"] for combo in combinations})
        self.assertGreater(score, 0)

    def test_source_category_is_only_a_fallback(self):
        category, topics, *_ = classify_and_score(
            "A quiet unrelated essay",
            "No configured topic terms appear here.",
            fallback="education",
        )

        self.assertEqual(category, "education")
        self.assertEqual(topics, [])


if __name__ == "__main__":
    unittest.main()
