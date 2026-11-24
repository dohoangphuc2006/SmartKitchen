"""Tests for NormalizedRecipeIndex (LIMIT-01 provenance), TwoTierRecommender, and /api/recommend two_tier."""
from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
import unittest

from backend.main import create_app
from backend.services.smart_kitchen_service import SmartKitchenService

ROOT = Path(__file__).resolve().parents[1]


class TwoTierRecommendationsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.service = SmartKitchenService(ROOT, recipe_first=True)
        cls.app = create_app(lambda: cls.service)
        cls.app.state.service = cls.service
        cls.two_tier = cls.service._get_two_tier_recommender()

    def test_limit01_index_fixes_notes_prep_and_flags_unreliable_recipes(self) -> None:
        stats = self.two_tier.norm_index.stats
        self.assertGreater(stats["limit01_note_recipes_cleaned"], 0)
        self.assertGreater(stats["limit01_prep_normalized_tokens"], 0)
        self.assertGreater(stats["limit01_unreliable_recipes_flagged"], 0)

        # #988 has 'heatproof 1 qt. jar' container leakage -> MUST be blocked from Tier A
        rec988 = self.two_tier.norm_index.by_row_id["988"]
        self.assertFalse(rec988.reliable_for_can_cook_now)
        res988 = self.service.recommend_ingredients(
            ["garlic", "raw honey"], top_n=5, ranking_method="final", two_tier=True
        )
        tier_a_ids = [r["recipe_id"] for r in res988["tier_a_recommendations"]]
        self.assertNotIn("988", tier_a_ids)

        # #3708 has truncated instruction fragment -> unreliable for Tier A
        rec3708 = self.two_tier.norm_index.by_row_id["3708"]
        self.assertFalse(rec3708.reliable_for_can_cook_now)

    def test_multi_ingredient_pantry_still_surfaces_cookable_egg_recipes_without_assuming_staples(self) -> None:
        for method in ("final", "ml_tfidf", "ml_lsa"):
            with self.subTest(method=method):
                res = self.service.recommend_ingredients(
                    ["500g ức gà", "2 quả trứng"],
                    top_n=5,
                    ranking_method=method,
                    two_tier=True,
                )
                tier_a_ids = {r["recipe_id"] for r in res["tier_a_recommendations"]}
                self.assertIn("2083", tier_a_ids)
                self.assertIn("2091", tier_a_ids)
                # Chicken + salt recipe #2599 must NOT enter Tier A when salt is unconfirmed
                self.assertNotIn("2599", tier_a_ids)
                for r in res["tier_a_recommendations"]:
                    self.assertEqual(r["readiness_status"], "CAN_COOK_NOW")
                    self.assertEqual(r["missing_required_count"], 0)
                    self.assertEqual(r["required_equipment"], [])

    def test_confirmed_staples_opt_in_unlocks_staple_variant_with_provenance(self) -> None:
        res_no_st = self.service.recommend_ingredients(
            ["500g thịt gà", "hành lá"], top_n=5, ranking_method="final", two_tier=True
        )
        self.assertEqual(res_no_st["tier_a_recommendations"], [])
        self.assertEqual(res_no_st["confirmed_staples"], [])

        res_with_st = self.service.recommend_ingredients(
            ["500g thịt gà", "hành lá"],
            top_n=5,
            ranking_method="ml_tfidf",
            two_tier=True,
            confirmed_staples=["water", "salt", "pepper", "vegetable oil"],
        )
        self.assertEqual(res_with_st["main_ingredients"], ["chicken", "green_onion"])
        self.assertEqual(res_with_st["confirmed_staples"], ["pepper", "salt", "vegetable oil", "water"])
        tier_a = {r["recipe_id"]: r for r in res_with_st["tier_a_recommendations"]}
        self.assertIn("2599", tier_a)  # Fully Salted Roast Chicken (needs chicken + kosher salt)
        self.assertEqual(tier_a["2599"]["readiness_status"], "CAN_COOK_NOW")
        compat = tier_a["2599"].get("verified_compatible_ingredients") or []
        self.assertTrue(
            any(c["pantry"] == "salt" and "kosher salt" in c["recipe"] and "confirmed_staple_family:salt" in c["evidence"] for c in compat)
        )

    def test_confirmed_staples_never_fabricate_results_for_unresolved_generic_input(self) -> None:
        for raw in ("thịt bò", "cá", "hành", "rau ngót rừng lạ"):
            res = self.service.recommend_ingredients(
                [raw],
                top_n=5,
                ranking_method="final",
                two_tier=True,
                confirmed_staples=["water", "salt", "pepper", "vegetable oil"],
            )
            self.assertEqual(res["tier_a_recommendations"], [])
            self.assertEqual(res["tier_b_recommendations"], [])
            self.assertEqual(res["empty_reason"], "NO_RECOGNIZED_INGREDIENTS")

    def test_single_ingredient_pantries_surface_safe_tier_b_below_25pct(self) -> None:
        for raw, expect_tier_a in (
            ("thịt heo xay", False),
            ("ức gà", False),
            ("cà chua", False),
            ("tôm bóc vỏ", False),
            ("trứng", True),
        ):
            for method in ("final", "ml_tfidf", "ml_lsa"):
                with self.subTest(raw=raw, method=method):
                    res = self.service.recommend_ingredients(
                        [raw], top_n=5, ranking_method=method, two_tier=True
                    )
                    if expect_tier_a:
                        self.assertTrue(res["tier_a_recommendations"])
                    else:
                        self.assertEqual(res["tier_a_recommendations"], [])
                    self.assertTrue(res["tier_b_recommendations"])
                    for item in res["tier_b_recommendations"]:
                        self.assertEqual(item["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")
                        self.assertEqual(item["suggestion_status"], "needs_ingredients")
                    if raw in ("thịt heo xay", "ức gà", "tôm bóc vỏ"):
                        self.assertTrue(
                            any(not item["passes_baseline_25pct"] for item in res["tier_b_recommendations"])
                        )

    def _asgi_post(self, path: str, payload: dict) -> tuple[int, dict]:
        body_bytes = json.dumps(payload).encode("utf-8")

        async def _call() -> tuple[int, dict]:
            status_code = 500
            chunks: list[bytes] = []
            sent_request = False

            async def receive() -> dict:
                nonlocal sent_request
                if not sent_request:
                    sent_request = True
                    return {"type": "http.request", "body": body_bytes, "more_body": False}
                return {"type": "http.disconnect"}

            async def send(message: dict) -> None:
                nonlocal status_code
                if message["type"] == "http.response.start":
                    status_code = int(message["status"])
                elif message["type"] == "http.response.body":
                    chunks.append(message.get("body", b""))

            scope = {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "http",
                "path": path,
                "raw_path": path.encode("ascii"),
                "query_string": b"",
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body_bytes)).encode("ascii")),
                ],
                "client": ("127.0.0.1", 0),
                "server": ("testserver", 80),
            }
            await self.app(scope, receive, send)
            return status_code, json.loads(b"".join(chunks).decode("utf-8"))

        return asyncio.run(_call())

    def test_api_two_tier_vs_legacy_baseline_coexist(self) -> None:
        status_legacy, legacy_body = self._asgi_post(
            "/api/recommend",
            {"ingredients": ["thịt heo xay"], "ranking_method": "ml_tfidf"},
        )
        self.assertEqual(status_legacy, 200)
        self.assertEqual(legacy_body["recommendations"], [])
        self.assertNotIn("two_tier", legacy_body)

        status_tt, tt_body = self._asgi_post(
            "/api/recommend",
            {
                "ingredients": ["thịt heo xay"],
                "ranking_method": "ml_tfidf",
                "two_tier": True,
                "confirmed_staples": [],
            },
        )
        self.assertEqual(status_tt, 200)
        self.assertIs(tt_body["two_tier"], True)
        self.assertEqual(tt_body["tier_a_recommendations"], [])
        self.assertEqual(len(tt_body["tier_b_recommendations"]), 5)
        self.assertEqual(tt_body["model_version"], "recipe_tfidf_lsa_v1")
        for item in tt_body["tier_b_recommendations"]:
            self.assertEqual(item["quantity_status"], "not_checked")
            self.assertEqual(item["readiness_status"], "NEEDS_ADDITIONAL_INGREDIENTS")

    def test_qa_prevents_pineapple_paletas_brine_and_lsa_anchor_drift(self) -> None:
        # 1. #5472 Fish Brine (only warm water + kosher salt + sugar) must NOT be CAN_COOK_NOW
        rec5472 = self.two_tier.norm_index.by_row_id["5472"]
        self.assertFalse(rec5472.reliable_for_can_cook_now)
        res_p13 = self.service.recommend_ingredients(
            ["400g thịt ba rọi", "15 quả trứng cút", "1 trái dừa tươi", "1 củ tỏi", "2 củ hành tím", "Nước mắm, đường"],
            top_n=5,
            ranking_method="final",
            two_tier=True,
            confirmed_staples=["water", "salt", "pepper", "vegetable oil"],
        )
        self.assertNotIn("5472", {r["recipe_id"] for r in res_p13["tier_a_recommendations"]})

        # 2. Cá lóc + rau ngổ + thơm -> INSUFFICIENT_RECOGNIZED_BASIS across all 3 methods
        for method in ("final", "ml_tfidf", "ml_lsa"):
            res_insufficient = self.service.recommend_ingredients(
                ["cá lóc", "rau ngổ", "thơm"], top_n=5, ranking_method=method, two_tier=True
            )
            self.assertEqual(res_insufficient["tier_a_recommendations"], [])
            self.assertEqual(res_insufficient["tier_b_recommendations"], [])
            self.assertEqual(res_insufficient["empty_reason"], "INSUFFICIENT_RECOGNIZED_BASIS")

        # 3. phieu12 never promotes Pineapple Paletas / Candied Pineapple / Pineapple-Mint Vodka
        phieu12 = ["300g cá lóc cắt khúc", "2 quả cà chua", "1/4 trái thơm", "100g giá đỗ", "5 trái đậu bắp", "1 muỗng me chua", "Rau ngổ, ngò gai"]
        blocked_titles = {"Pineapple Paletas", "Candied Pineapple", "Pineapple-Mint Vodka", "Grilled Pineapple"}
        for method in ("final", "ml_tfidf", "ml_lsa"):
            res12 = self.service.recommend_ingredients(phieu12, top_n=5, ranking_method=method, two_tier=True)
            names = {r["recipe_name"] for r in res12["tier_b_recommendations"]}
            self.assertTrue(names.isdisjoint(blocked_titles), f"{method} returned {names}")
            self.assertEqual(res12["tier_summary"]["basis_status"], "PARTIAL_UNRESOLVED_INPUT")

        # 4. Anchor-protein discipline on LSA (chicken+carrot+onion and shrimp/squid pantries)
        res_s03 = self.service.recommend_ingredients(
            ["thịt gà", "cà rốt", "hành tây"], top_n=5, ranking_method="ml_lsa", two_tier=True
        )
        self.assertTrue(all("chicken" in r["matched_ingredients"] for r in res_s03["tier_b_recommendations"]))

        res_p18 = self.service.recommend_ingredients(
            ["200g tôm tươi", "200g mực", "1 củ cà rốt", "2 nhánh cần tây", "1 củ hành tây", "3 tép tỏi", "Dầu hào"],
            top_n=5,
            ranking_method="ml_lsa",
            two_tier=True,
        )
        self.assertTrue(
            all(({"shrimp", "squid"} & set(r["matched_ingredients"])) for r in res_p18["tier_b_recommendations"])
        )


if __name__ == "__main__":
    unittest.main()
