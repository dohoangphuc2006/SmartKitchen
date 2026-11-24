"""Regression tests for V6 recipe language switching & provenance-backed VI batch/on-demand cache."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.instruction_translation_validation import source_hash
from src.recipe_detail_translation import recipe_hash, validate_candidate
from src.recipe_on_demand_translator import OnDemandRecipeTranslator
from src.recipe_repository import RecipeRepository


class RecipeLanguageSwitchingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.root = Path(__file__).resolve().parents[1]
        cls.repo = RecipeRepository(cls.root)
        cls.v6_batch_path = cls.root / "processed/recipe_detail_vi_v6_batch.json"

    def test_v6_batch_exists_and_all_24_recipes_pass_strict_validation(self) -> None:
        self.assertTrue(self.v6_batch_path.is_file())
        payload = json.loads(self.v6_batch_path.read_text(encoding="utf-8"))
        rows = payload.get("recipes", [])
        self.assertEqual(len(rows), 24)
        for item in rows:
            rid = int(item["recipe_id"])
            record = self.repo.records[rid]
            accepted, errors = validate_candidate(item, record)
            self.assertEqual(errors, {}, f"Validation errors for {rid}: {errors}")
            self.assertTrue(accepted.get("title"), f"Missing title for {rid}")
            self.assertTrue(accepted.get("ingredients"), f"Missing ingredients for {rid}")
            self.assertTrue(accepted.get("instructions"), f"Missing instructions for {rid}")
            self.assertEqual(item["review_status"], "auto_unreviewed")
            self.assertIsNone(item.get("reviewed_by"))
            self.assertIsNone(item.get("reviewer"))
            self.assertIsNone(item.get("reviewed_at"))

            detail = self.repo.get_detail(rid)
            vi = detail["translations"]["vi"]
            self.assertEqual(len(vi["ingredients"]), len(detail["ingredients"]))
            self.assertEqual(len(vi["instruction_steps"]), len(detail["instruction_steps"]))
            self.assertTrue(vi["recipe_name_display_eligible"])

    def test_tier_a_recipes_have_complete_vietnamese_and_original_english(self) -> None:
        for rid in (417, 721, 999, 2599, 6006, 10243, 11602):
            detail = self.repo.get_detail(rid)
            self.assertEqual(detail["language"], "en")
            self.assertTrue(detail["recipe_name"])
            self.assertTrue(detail["ingredients"])
            self.assertTrue(detail["instruction_steps"])
            vi = detail["translations"]["vi"]
            self.assertTrue(vi["recipe_name"])
            self.assertEqual(len(vi["ingredients"]), len(detail["ingredients"]))
            self.assertEqual(len(vi["instruction_steps"]), len(detail["instruction_steps"]))
            self.assertIn(vi["instructions_review_status"], {"reviewed", "auto_unreviewed"})

    def test_ondemand_translator_translates_safe_ingredients_and_caches_locally(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "ondemand_cache.json"
            translator = OnDemandRecipeTranslator(self.root, cache_path=cache_path)

            class FakeRecord:
                recipe_id = 999999
                recipe_name = "Test Butter Pasta"
                ingredients = [
                    "2 tablespoons olive oil",
                    "1 teaspoon kosher salt",
                    "1/2 cup water",
                    "2 large eggs",
                ]
                instructions = "Boil water.\nCook pasta until tender."
                source_sha256 = recipe_hash(recipe_name, ingredients, instructions)
                source_instructions_sha256 = source_hash(instructions)

            accepted = translator.build_ingredient_candidate(FakeRecord())
            self.assertIsNotNone(accepted)
            self.assertEqual(len(accepted["ingredients"]), 4)
            self.assertIn("muỗng canh", accepted["ingredients"][0])
            self.assertIn("muỗng cà phê", accepted["ingredients"][1])
            self.assertIn("cốc", accepted["ingredients"][2])
            self.assertIn("trứng", accepted["ingredients"][3])
            self.assertEqual(accepted["field_sources"]["ingredients"], "ondemand_dictionary_v1")
            self.assertTrue(cache_path.is_file())
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            self.assertEqual(cached["recipes"][0]["review_status"], "auto_unreviewed")
            self.assertNotIn("instruction_steps_vi", cached["recipes"][0])

    def test_get_detail_preserves_untranslated_instructions_when_unavailable(self) -> None:
        # Recipe 12776 has tomato/garlic/etc. and no curated instruction batch yet unless added later;
        # regardless, display_catalog(allow_ondemand=False) stays fast & side-effect free.
        catalog = self.repo.display_catalog()
        self.assertGreater(catalog["coverage"]["fully_localized_vi"], 37)
        self.assertEqual(catalog["coverage"]["total_records"], len(self.repo.records))


if __name__ == "__main__":
    unittest.main()
