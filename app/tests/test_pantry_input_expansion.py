"""Unit and integration tests for Smart Kitchen Pantry Input Expansion."""

from __future__ import annotations

import unittest
from pathlib import Path
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services.smart_kitchen_service import SmartKitchenService
from src.localization import get_localization
from src.pantry_catalog import get_pantry_catalog

ROOT = Path(__file__).resolve().parents[1]


class TestPantryInputExpansion(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = get_pantry_catalog(str(ROOT))
        cls.localization = get_localization(str(ROOT))
        cls.service = SmartKitchenService(ROOT, recipe_first=True)
        cls.app = create_app(lambda: cls.service)
        cls.client = TestClient(cls.app)

    def test_catalog_counts_and_structure(self) -> None:
        summary = self.catalog.public_summary()
        self.assertEqual(summary["total_items"], 526)
        self.assertEqual(len(summary["categories"]), 12)
        self.assertEqual(set(summary["ambiguous_concepts"].keys()), {"beef", "pork", "chili", "tofu"})
        yolo_count = sum(1 for item in summary["items"] if item.get("yolo30_class"))
        non_yolo_count = sum(1 for item in summary["items"] if not item.get("yolo30_class"))
        self.assertEqual(yolo_count, 28)
        self.assertEqual(non_yolo_count, 498)
        for item in summary["items"]:
            self.assertTrue(item["ingredient_id"].startswith("ing_"))
            self.assertTrue(item["canonical_name"])
            self.assertTrue(item["display_name_vi"])
            self.assertEqual(item["mapping_status"], "RESOLVED")
            self.assertTrue(item["recommendable"])
            self.assertGreaterEqual(int(item["recipe_count"]), 1)

    def test_localization_zero_new_conflicts(self) -> None:
        pub = self.localization.public_dictionary()
        self.assertEqual(pub["ambiguous_inputs"], ["bột mì đa dụng", "đường bột"])
        self.assertIn("pantry_catalog", pub)
        self.assertEqual(pub["pantry_catalog"]["total_items"], 526)
        self.assertGreaterEqual(len(pub["ingredients"]), 550)
        self.assertGreaterEqual(len(pub["manual_aliases"]), 3000)

    def test_catalog_api_endpoint_search_and_filter(self) -> None:
        with TestClient(self.app) as client:
            resp = client.get("/api/ingredients/catalog?limit=20&offset=0")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body["total"], 526)
            self.assertEqual(len(body["items"]), 20)

            # Search accented & unaccented Vietnamese + quantity prefix
            resp_pork = client.get("/api/ingredients/catalog", params={"q": "300g thịt ba chỉ", "limit": 5})
            self.assertEqual(resp_pork.status_code, 200)
            pork_data = resp_pork.json()
            self.assertEqual(pork_data["detected_quantity"], "300g")
            self.assertEqual(pork_data["items"][0]["canonical_name"], "pork belly")

            resp_unacc = client.get("/api/ingredients/catalog", params={"q": "suon heo", "limit": 5})
            self.assertEqual(resp_unacc.status_code, 200)
            self.assertEqual(resp_unacc.json()["items"][0]["canonical_name"], "pork ribs")

            # Category filter
            resp_sea = client.get("/api/ingredients/catalog", params={"category": "seafood", "limit": 100})
            self.assertEqual(resp_sea.status_code, 200)
            sea_data = resp_sea.json()
            self.assertGreaterEqual(sea_data["total"], 25)
            self.assertTrue(all(it["category"] == "seafood" for it in sea_data["items"]))

            # Ambiguous trigger returns ambiguous_match with disambiguation_options
            resp_amb = client.get("/api/ingredients/catalog", params={"q": "thịt bò", "limit": 5})
            self.assertEqual(resp_amb.status_code, 200)
            amb_data = resp_amb.json()
            self.assertIsNotNone(amb_data["ambiguous_match"])
            self.assertEqual(amb_data["ambiguous_match"]["canonical_concept"], "beef")
            self.assertGreaterEqual(len(amb_data["ambiguous_match"]["disambiguation_options"]), 5)

    def test_expanded_ingredients_normalize_and_recommend_across_all_methods(self) -> None:
        cases = [
            (["thịt ba chỉ", "tỏi", "hành lá"], {"pork belly", "garlic", "green_onion"}),
            (["thit ba chi", "2 tep toi", "2 nhanh hanh la"], {"pork belly", "garlic", "green_onion"}),
            (["200g thịt gà", "cà rốt", "hành tây"], {"chicken", "carrot", "onion"}),
            (["cơm nguội", "trứng", "hành lá"], {"cooked rice", "egg", "green_onion"}),
            (["ớt hiểm", "ớt chuông đỏ", "tỏi"], {"thai chile", "red bell_pepper", "garlic"}),
            (["cá hồi", "chanh vàng", "dầu ô liu"], {"salmon", "lemon", "olive oil"}),
            (["sườn heo", "nước mắm", "đường"], {"pork ribs", "fish sauce", "sugar"}),
            (["đậu phụ cứng", "nấm hương", "nước tương", "tỏi"], {"firm tofu", "shiitake mushroom", "soy sauce", "garlic"}),
        ]
        for raw_pantry, expected_stage5_set in cases:
            for method in ("final", "ml_tfidf", "ml_lsa"):
                res = self.service.recommend_ingredients(raw_pantry, 5, method)
                self.assertEqual(len(res["normalized_ingredients"]), len(expected_stage5_set), f"Failed on {raw_pantry} ({method})")
                if method == "final":
                    self.assertEqual(set(res["normalized_ingredients"]), expected_stage5_set)
                self.assertGreater(len(res["recommendations"]), 0, f"Empty recs for {raw_pantry} ({method})")

    def test_ambiguous_concepts_remain_unresolved_and_never_force_mapped(self) -> None:
        for raw in ("thịt bò", "thit bo", "beef", "thịt heo", "thit heo", "pork", "ớt", "ot", "2 quả ớt", "đậu hũ", "dau hu", "tofu"):
            for method in ("final", "ml_tfidf", "ml_lsa"):
                res = self.service.recommend_ingredients([raw], 5, method)
                self.assertEqual(res["normalized_ingredients"], [], f"Expected {raw} to stay unresolved in {method}")

    def test_multi_ingredient_pantry_deduplication_and_scaling(self) -> None:
        large_pantry = [
            "2 quả trứng", "eggs", "trung",
            "300g thịt ba chỉ", "2 tép tỏi", "2 nhánh hành lá",
            "1 củ hành tây", "cà chua", "ca rot",
            "nước mắm", "dầu hào", "tiêu đen",
            "cải thảo", "nấm hương", "cơm nguội",
        ]
        for method in ("final", "ml_tfidf", "ml_lsa"):
            res = self.service.recommend_ingredients(large_pantry, 5, method)
            self.assertEqual(len(res["normalized_ingredients"]), 13)
            self.assertGreater(len(res["recommendations"]), 0)
            for rec in res["recommendations"]:
                self.assertIn("matched_ingredients", rec)
                self.assertIn("missing_ingredients", rec)
                self.assertIn("recipe_id", rec)


if __name__ == "__main__":
    unittest.main()
