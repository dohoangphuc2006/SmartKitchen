"""Regression tests for functional audit fixes: chicken cuts, aliases, readiness, and missing core."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services.smart_kitchen_service import SmartKitchenService


ROOT = Path(__file__).resolve().parents[1]

PROTECTED_SHA256 = {
    "models/recipe_ml/recipe_tfidf_lsa_v1.npz": "3616f73132f4effe2700831d8da5174a39a56fd4ab223737cfc8b49a556d487b",
    "models/recipe_ml/recipe_tfidf_lsa_v1.metadata.json": "1529682237272954d70ff56034177a556d4a612915bc65bc494b0d9e14ca3cb9",
    "processed/recipes_cleaned.csv": "14df8e201d567a14cda3ffcb4d139869f0b8a8ec05742e4c6ef4a5097e3a89d3",
    "processed/ingredient_details.csv": "5dc3fcf44381fa1f790902d6b8068d05751fa78f085d321e4e256ee131e32746",
    "config/app_config.json": "cdd8dd1640beb47c75034cee97035264cf295ab0fccefc7de8182c7f572be253",
    "config/recommendation_config.json": "b143281d16d91505eee66206098c37da1e9efaac1929444514406774e98b99c3",
    "config/pantry_ingredient_catalog.json": "253c23b787159eb1f2e79853c7b2b654b1ccbdc16ab104d6f0522cfeb7b040c2",
}


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@unittest.skipUnless((ROOT / "models/best.pt").is_file(), "YOLO checkpoint is outside the Windows Recipe ZIP")
class OptionalCheckpointTests(unittest.TestCase):
    def test_yolo_checkpoint_bit_identical(self):
        self.assertEqual(_sha256(ROOT / "models/best.pt"),
                         "c67106a099bb625912a461eee00fe1e09bda9ea8a7a0f55da34abaace3f7f8cf")


class RecommendationAuditFixesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = SmartKitchenService(ROOT, recipe_first=True)
        cls.app = create_app(lambda: cls.service)

    def test_protected_assets_bit_identical(self):
        for rel, expected in PROTECTED_SHA256.items():
            with self.subTest(asset=rel):
                self.assertEqual(_sha256(ROOT / rel), expected)

    def test_chicken_three_cuts_monotonic_across_all_methods(self):
        three_cuts = ["ức gà", "đùi gà rút xương bỏ da", "đùi gà nguyên xương có da"]
        single_bone_in = ["đùi gà nguyên xương có da"]
        for method in ("final", "ml_tfidf", "ml_lsa"):
            with self.subTest(method=method):
                r3 = self.service.recommend_ingredients(three_cuts, top_n=5, ranking_method=method)
                r1 = self.service.recommend_ingredients(single_bone_in, top_n=5, ranking_method=method)
                self.assertEqual(len(r3["normalized_ingredients"]), 3)
                self.assertEqual([x["recipe_id"] for x in r3["recommendations"]], ["7085"])
                self.assertEqual([x["recipe_id"] for x in r1["recommendations"]], ["7085"])
                rec = r3["recommendations"][0]
                self.assertEqual(rec["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")
                self.assertEqual(rec["suggestion_status"], "needs_ingredients")
                self.assertEqual(rec["missing_ingredients"], ["ground black pepper", "kosher salt", "vegetable oil"])

    def test_peeled_shrimp_and_override_aliases(self):
        for method in ("final", "ml_tfidf", "ml_lsa"):
            with self.subTest(method=method):
                res = self.service.recommend_ingredients(["tôm bóc vỏ"], top_n=5, ranking_method=method)
                ids = [x["recipe_id"] for x in res["recommendations"]]
                self.assertIn("4063", ids)
                scampi = next(x for x in res["recommendations"] if x["recipe_id"] == "4063")
                self.assertEqual(scampi["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")
                self.assertEqual(scampi["missing_core_ingredients"], [])

        norm = self.service.pipeline.recommender.shared_normalizer
        for raw, expected in (
            ("bột mì đa dụng", "all purpose flour"),
            ("đường bột", "powdered sugar"),
            ("french bread", "baguette"),
        ):
            parsed = norm.normalize_pantry([raw])
            self.assertEqual(parsed["normalized_ingredients"], [expected], (raw, parsed))

    def test_generic_unresolved_and_anti_confusion(self):
        norm = self.service.pipeline.recommender.shared_normalizer
        for raw in ("ớt", "ot", "cá", "hành", "thịt bò", "thịt heo"):
            parsed = norm.normalize_pantry([raw])
            self.assertEqual(parsed["normalized_ingredients"], [], raw)
            self.assertTrue(parsed["unresolved_ingredients"], raw)
        self.assertEqual(norm.normalize_pantry(["cá hồi"])["normalized_ingredients"], ["salmon"])
        self.assertEqual(norm.normalize_pantry(["hành lá"])["normalized_ingredients"], ["green_onion"])
        self.assertEqual(norm.normalize_pantry(["ớt hiểm"])["normalized_ingredients"], ["thai chile"])

    def test_readiness_distinguishes_can_cook_now_vs_needs_ingredients(self):
        for method in ("final", "ml_tfidf", "ml_lsa"):
            with self.subTest(method=method):
                egg_only = self.service.recommend_ingredients(["500g ức gà", "2 quả trứng"], top_n=5, ranking_method=method)
                by_id = {r["recipe_id"]: r for r in egg_only["recommendations"]}
                # 2083, 2091 require no missing ingredients and no special equipment -> CAN_COOK_NOW
                for rid in ("2083", "2091"):
                    if rid in by_id:
                        self.assertEqual(by_id[rid]["readiness_status"], "CAN_COOK_NOW")
                        self.assertEqual(by_id[rid]["suggestion_status"], "pantry_match")
                # 537 (sous vide machine) and 767 (steamer basket) require equipment -> NEEDS_ADDITIONAL_INGREDIENTS
                if "537" in by_id:
                    self.assertEqual(by_id["537"]["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")
                    self.assertIn("sous vide machine", by_id["537"]["required_equipment"])
                if "767" in by_id:
                    self.assertEqual(by_id["767"]["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")
                    self.assertIn("steamer basket", by_id["767"]["required_equipment"])
                # 2088 misses salt & pepper -> NEEDS_ADDITIONAL_INGREDIENTS
                if "2088" in by_id:
                    self.assertEqual(by_id["2088"]["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")

    def test_missing_core_ingredients_populated_for_production_and_ml(self):
        # Breakfast Stack (12940) missing canadian bacon
        s5_p1 = self.service.recommend_ingredients(["trứng", "cà chua", "hành lá"], top_n=5, ranking_method="final")
        r12940 = next(r for r in s5_p1["recommendations"] if r["recipe_id"] == "12940")
        self.assertIn("canadian bacon", r12940["missing_core_ingredients"])
        self.assertEqual(r12940["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")

        # Stir-Fried Egg and Tomato (8849): tomato satisfies 'tomato , each cut into 6 wedges'
        r8849 = next(r for r in s5_p1["recommendations"] if r["recipe_id"] == "8849")
        self.assertEqual(r8849["missing_core_ingredients"], [])

        # Sweet Balsamic Glazed Chicken (3586) missing boneless skinless chicken breast
        ml_p4 = self.service.recommend_ingredients(["tỏi", "muối", "nước tương"], top_n=5, ranking_method="ml_tfidf")
        r3586 = next(r for r in ml_p4["recommendations"] if r["recipe_id"] == "3586")
        self.assertIn("boneless skinless chicken breast", r3586["missing_core_ingredients"])
        self.assertEqual(r3586["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")

    def test_api_empty_detail_and_20_targeted_cases(self):
        with TestClient(self.app) as client:
            # Empty detail when single cut has no eligible recipes
            r_uc = client.post("/api/recommend", json={"ingredients": ["ức gà"], "ranking_method": "ml_tfidf"})
            self.assertEqual(r_uc.status_code, 200)
            body_uc = r_uc.json()
            self.assertEqual(body_uc["recommendations"], [])
            self.assertEqual(body_uc["empty_detail"]["pantry_group_count"], 1)
            self.assertEqual(body_uc["empty_detail"]["candidate_count"], 2)
            self.assertTrue(body_uc["empty_detail"]["explanation_vi"])

            # Three chicken cuts via HTTP API
            r_3 = client.post(
                "/api/recommend",
                json={"ingredients": ["ức gà", "đùi gà rút xương bỏ da", "đùi gà nguyên xương có da"], "ranking_method": "ml_tfidf"},
            )
            self.assertEqual(r_3.status_code, 200)
            b3 = r_3.json()
            self.assertEqual([r["recipe_id"] for r in b3["recommendations"]], [7085])
            self.assertEqual(b3["recommendations"][0]["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")

            # Empty pantry rejected with 422
            self.assertEqual(client.post("/api/recommend", json={"ingredients": []}).status_code, 422)

    def test_negative_regression_anti_confusion_and_no_false_can_cook_now(self):
        # 1. Chicken breast MUST NOT unlock chicken thigh recipe #7085
        for method in ("final", "ml_tfidf", "ml_lsa"):
            with self.subTest(case="breast_not_thigh", method=method):
                r_breast = self.service.recommend_ingredients(["ức gà"], top_n=5, ranking_method=method)
                self.assertEqual(r_breast["recommendations"], [])
                self.assertNotIn("7085", [r["recipe_id"] for r in r_breast["recommendations"]])

        # 2. Beef / ground beef MUST NOT match chicken recipes
        for method in ("final", "ml_tfidf", "ml_lsa"):
            with self.subTest(case="beef_not_chicken", method=method):
                r_beef_unres = self.service.recommend_ingredients(["thịt bò"], top_n=5, ranking_method=method)
                self.assertEqual(r_beef_unres["recommendations"], [])
                self.assertTrue(r_beef_unres["unresolved_ingredients"])
                r_ground_beef = self.service.recommend_ingredients(["thịt bò xay"], top_n=5, ranking_method=method)
                self.assertEqual(r_ground_beef["recommendations"], [])

        # 3. Specific salmon MUST NOT equate to generic fish or cod/tuna/tilapia; generic cá stays unresolved
        for method in ("final", "ml_tfidf", "ml_lsa"):
            with self.subTest(case="salmon_not_generic_fish", method=method):
                r_fish = self.service.recommend_ingredients(["cá"], top_n=5, ranking_method=method)
                self.assertEqual(r_fish["normalized_ingredients"], [])
                self.assertEqual(r_fish["recommendations"], [])
                self.assertTrue(r_fish["unresolved_ingredients"])
                r_salmon = self.service.recommend_ingredients(["cá hồi"], top_n=5, ranking_method=method)
                self.assertEqual(r_salmon["normalized_ingredients"], ["salmon"])
                for rec in r_salmon["recommendations"]:
                    titles_tokens = " ".join(rec.get("matched_ingredients", [])).lower()
                    self.assertNotIn("cod", titles_tokens)
                    self.assertNotIn("tilapia", titles_tokens)

        # 4. Duplicate aliases (egg, eggs, trứng, quả trứng gà) NEVER inflate matched_count or match_ratio
        for method in ("final", "ml_tfidf", "ml_lsa"):
            with self.subTest(case="duplicate_aliases_no_inflation", method=method):
                r_single = self.service.recommend_ingredients(["trứng gà"], top_n=5, ranking_method=method)
                r_dups = self.service.recommend_ingredients(["egg", "eggs", "trứng", "quả trứng gà"], top_n=5, ranking_method=method)
                self.assertEqual(r_dups["normalized_ingredients"], ["egg"])
                self.assertEqual(
                    [(r["recipe_id"], r["matched_count"], r["match_ratio"]) for r in r_dups["recommendations"]],
                    [(r["recipe_id"], r["matched_count"], r["match_ratio"]) for r in r_single["recommendations"]],
                )

        # 5. Never assign CAN_COOK_NOW when missing a defining/core or required staple ingredient
        with TestClient(self.app) as client:
            for pantry, expected_rid in (
                (["trứng", "cà chua", "hành lá"], 12940),
                (["tôm bóc vỏ"], 4063),
                (["ức gà", "đùi gà rút xương bỏ da", "đùi gà nguyên xương có da"], 7085),
            ):
                resp = client.post("/api/recommend", json={"ingredients": pantry, "ranking_method": "final"})
                self.assertEqual(resp.status_code, 200)
                rec = next(r for r in resp.json()["recommendations"] if r["recipe_id"] == expected_rid)
                self.assertEqual(rec["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")
                self.assertNotEqual(rec["readiness_status"], "CAN_COOK_NOW")

    def test_staple_policy_water_salt_pepper_oil_explicit_in_api(self):
        with TestClient(self.app) as client:
            for method in ("final", "ml_tfidf", "ml_lsa"):
                resp = client.post(
                    "/api/recommend",
                    json={"ingredients": ["đùi gà nguyên xương có da"], "ranking_method": method},
                )
                self.assertEqual(resp.status_code, 200)
                body = resp.json()
                policy = body.get("staple_policy") or {}
                self.assertFalse(policy.get("assumed_present_for_can_cook_now"))
                self.assertTrue(policy.get("excluded_from_missing_core_ingredients"))
                self.assertEqual(policy.get("staples_checked"), ["water", "salt", "pepper", "cooking_oil"])
                rec = body["recommendations"][0]
                self.assertEqual(rec["recipe_id"], 7085)
                self.assertEqual(rec["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")
                self.assertIn("kosher salt", rec["missing_ingredients"])
                self.assertIn("ground black pepper", rec["missing_ingredients"])
                self.assertIn("vegetable oil", rec["missing_ingredients"])
                self.assertEqual(rec["missing_core_ingredients"], [])

    def test_ground_pork_recognized_empty_detail_and_pairings(self):
        with TestClient(self.app) as client:
            for raw in ("thịt heo xay", "thit heo xay", "ground pork"):
                for method in ("final", "ml_tfidf", "ml_lsa"):
                    with self.subTest(raw=raw, method=method):
                        resp = client.post("/api/recommend", json={"ingredients": [raw], "ranking_method": method})
                        self.assertEqual(resp.status_code, 200)
                        body = resp.json()
                        self.assertEqual(body["ingredients"], ["ground pork"])
                        self.assertEqual(body["unresolved_ingredients"], [])
                        self.assertEqual(body["recommendations"], [])
                        self.assertEqual(body["empty_reason"], "NO_CANDIDATE_PASSED_ELIGIBILITY")
                        detail = body["empty_detail"]
                        self.assertEqual(detail["candidate_count"], 76)
                        self.assertEqual(detail["qualified_count"], 0)
                        self.assertEqual(detail["pantry_group_count"], 1)
                        self.assertEqual(detail["recognized_ingredients"], ["ground pork"])
                        self.assertTrue(detail["suggested_additions"])
                        self.assertIn("ground pork", detail["explanation_vi"].lower())
                        self.assertIn("76", detail["explanation_vi"])
                        self.assertIn("ground pork", detail["explanation_en"].lower())

            # Generic pork remains unresolved (anti-confusion)
            for raw in ("thịt heo", "pork"):
                resp = client.post("/api/recommend", json={"ingredients": [raw], "ranking_method": "final"})
                self.assertEqual(resp.status_code, 200)
                body = resp.json()
                self.assertEqual(body["ingredients"], [])
                self.assertEqual(body["recommendations"], [])
                self.assertEqual(body["empty_reason"], "NO_RECOGNIZED_INGREDIENTS")
                self.assertEqual(body["unresolved_ingredients"][0]["reason"], "GENERIC_MEAT_CUT_UNSPECIFIED")

            # Adding an accompaniment yields real catalog recipes across all modes
            for method in ("final", "ml_tfidf", "ml_lsa"):
                paired = client.post(
                    "/api/recommend",
                    json={"ingredients": ["thịt heo xay", "hành lá"], "ranking_method": method},
                ).json()
                self.assertEqual(paired["ingredients"], ["green_onion", "ground pork"])
                self.assertIn(4322, [r["recipe_id"] for r in paired["recommendations"]])

    def test_shrimp_comma_and_space_forms_equivalent_across_modes(self):
        with TestClient(self.app) as client:
            for method in ("final", "ml_tfidf", "ml_lsa"):
                with self.subTest(method=method):
                    a = client.post("/api/recommend", json={"ingredients": ["shrimp, peeled, deveined"], "ranking_method": method}).json()
                    b = client.post("/api/recommend", json={"ingredients": ["shrimp peeled deveined"], "ranking_method": method}).json()
                    both = client.post(
                        "/api/recommend",
                        json={"ingredients": ["shrimp, peeled, deveined", "shrimp peeled deveined"], "ranking_method": method},
                    ).json()
                    self.assertEqual(a["ingredients"], b["ingredients"])
                    self.assertEqual(a["ingredients"], both["ingredients"])
                    self.assertEqual(len(both["ingredients"]), 1)
                    self.assertEqual([r["recipe_id"] for r in a["recommendations"]], [4063])
                    self.assertEqual(a["recommendations"], b["recommendations"])
                    self.assertEqual(a["recommendations"], both["recommendations"])


if __name__ == "__main__":
    unittest.main()
