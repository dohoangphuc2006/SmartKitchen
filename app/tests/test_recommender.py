"""Kiểm thử baseline trên các biên và dữ liệu thực của project."""

import math
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
from recommender import (  # noqa: E402
    Recommender, ScoringConfig, calculate_cosine, calculate_jaccard,
    calculate_match_ratio, recommend_recipes,
)


class RecommenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Recommender(ROOT)

    def test_binary_metric_formulas(self):
        self.assertEqual(calculate_match_ratio(3, 4), 0.75)
        self.assertEqual(calculate_jaccard(3, 3, 4), 0.75)
        self.assertAlmostEqual(calculate_cosine(3, 3, 4), 3 / math.sqrt(12))
        self.assertEqual(calculate_match_ratio(0, 0), 0)
        self.assertEqual(calculate_jaccard(0, 0, 0), 0)
        self.assertEqual(calculate_cosine(0, 0, 0), 0)

    def test_empty_unknown_and_unmapped_class(self):
        for value in ([], ["unobtainium"], ["beef"]):
            output = self.engine.recommend(value, return_diagnostics=True)
            self.assertEqual(output["recommendations"], [])
            self.assertTrue(output["warnings"])

    def test_alias_yolo_objects_and_duplicates(self):
        a = self.engine.recommend(["eggs", "eggs", "tomato"], return_diagnostics=True)
        b = self.engine.recommend([{"class": "eggs", "confidence": 0.92},
                                   {"name": "tomato", "confidence": 0.95}], return_diagnostics=True)
        self.assertEqual(a["normalized_ingredients"], ["egg", "tomato"])
        self.assertEqual(b["normalized_ingredients"], ["egg", "tomato"])
        self.assertEqual([x["recipe_id"] for x in a["recommendations"]],
                         [x["recipe_id"] for x in b["recommendations"]])
        c = self.engine.recommend(["spring_onion", "tomato"], return_diagnostics=True)
        self.assertEqual(c["normalized_ingredients"], ["green_onion", "tomato"])
        d = self.engine.recommend(["egg", "unobtainium"], return_diagnostics=True)
        self.assertEqual(d["normalized_ingredients"], ["egg"])
        self.assertTrue(any("unobtainium" in warning for warning in d["warnings"]))

    def test_real_top1_and_result_invariants(self):
        scenarios = [(["egg", "tomato", "onion"], "2220"),
                     (["chicken", "carrot", "onion"], "2672"),
                     (["sugar", "butter", "egg", "flour"], "12071")]
        for ingredients, expected_id in scenarios:
            with self.subTest(ingredients=ingredients):
                rows = self.engine.recommend(ingredients)
                self.assertEqual(rows[0]["recipe_id"], expected_id)
                self.assertLessEqual(len(rows), 5)
                for row in rows:
                    self.assertTrue(0 <= row["score"] <= 1)
                    self.assertGreaterEqual(row["match_ratio"], 0.25)
                    self.assertEqual(row["matched_count"], len(row["matched_ingredients"]))
                    self.assertEqual(row["missing_count"], len(row["missing_ingredients"]))
                    self.assertFalse(set(row["matched_ingredients"]) & set(row["missing_ingredients"]))
        self.assertEqual(recommend_recipes(["egg"], top_n=1, root=ROOT)[0]["recipe_id"], "537")

    def test_threshold_and_ready_filter(self):
        self.assertEqual(self.engine.recommend(["bread", "cheese"]), [])
        rows = self.engine.recommend(["egg", "tomato", "onion"],
                                     config=ScoringConfig(ready_only=True))
        self.assertTrue(rows)
        self.assertTrue(all(row["ready_for_mapping"] for row in rows))
        strict = self.engine.recommend(["egg", "tomato", "onion"],
                                       config=ScoringConfig(min_match_ratio=1.0))
        self.assertEqual(strict, [])


if __name__ == "__main__":
    unittest.main()
