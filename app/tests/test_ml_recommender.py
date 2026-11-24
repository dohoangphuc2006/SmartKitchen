"""Unit and integration tests for the ML recipe recommendation model."""
from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

import numpy as np
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services.smart_kitchen_service import SmartKitchenService
from src.ml_recommender import (
    ARTIFACT_DIR,
    ARTIFACT_NAME,
    METADATA_NAME,
    CSRMatrix,
    MLRecipeRecommender,
    TfidfLsaModel,
    randomized_svd,
    sha256_file,
)
from src.recipe_quality import RecipeQualityRecommender
from src.recommender import Recommender

ROOT = Path(__file__).resolve().parents[1]


class MLRecommenderUnitTests(TestCase):
    def test_csr_matrix_dense_equivalence(self):
        # 3 rows, 4 columns
        # Row 0: col 0 (1.0), col 2 (2.0)
        # Row 1: col 1 (3.0), col 3 (4.0)
        # Row 2: col 0 (5.0), col 1 (6.0), col 2 (7.0)
        data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
        indices = [0, 2, 1, 3, 0, 1, 2]
        indptr = [0, 2, 4, 7]
        csr = CSRMatrix(data, indices, indptr, 4)

        dense = np.array([
            [1.0, 0.0, 2.0, 0.0],
            [0.0, 3.0, 0.0, 4.0],
            [5.0, 6.0, 7.0, 0.0],
        ])

        # Test dot with matrix M (4, 2)
        M = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]])
        expected_dot = dense @ M
        np.testing.assert_allclose(csr.dot(M), expected_dot)

        # Test tdot with matrix N (3, 2)
        N = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
        expected_tdot = dense.T @ N
        np.testing.assert_allclose(csr.tdot(N), expected_tdot)

        # Test column_rows
        # col 0 is in row 0 and row 2
        np.testing.assert_array_equal(sorted(csr.column_rows(0)), [0, 2])
        # col 3 is in row 1
        np.testing.assert_array_equal(sorted(csr.column_rows(3)), [1])

    def test_randomized_svd_deterministic(self):
        data = [1.0, 2.0, 3.0, 4.0]
        indices = [0, 1, 0, 2]
        indptr = [0, 2, 4]
        csr = CSRMatrix(data, indices, indptr, 3)

        s1, vt1 = randomized_svd(csr, 2, 2, 5, random_state=42)
        s2, vt2 = randomized_svd(csr, 2, 2, 5, random_state=42)

        np.testing.assert_allclose(s1, s2)
        np.testing.assert_allclose(vt1, vt2)

    def test_model_fit_save_load_roundtrip(self):
        docs = [
            ["egg", "tomato", "onion"],
            ["chicken", "onion", "garlic"],
            ["egg", "cheese", "bread"],
            ["tomato", "garlic", "basil"],
        ]
        recipe_row_ids = ["101", "102", "103", "104"]
        config = dict(
            features="canonical_ingredient_tokens",
            binary_tf=True,
            smooth_idf=True,
            norm="l2",
            min_df=1,
            n_components=2,
            n_oversamples=2,
            n_power_iter=3,
            random_state=42,
        )

        model = TfidfLsaModel.fit(docs, recipe_row_ids, config=config)
        self.assertEqual(len(model.recipe_row_ids), 4)
        self.assertEqual(model.components.shape, (2, len(model.vocabulary)))

        with TemporaryDirectory() as tmpdir:
            save_path = Path(tmpdir) / "test_model.npz"
            sha = model.save(save_path)
            self.assertTrue(save_path.is_file())
            self.assertEqual(sha, sha256_file(save_path))

            loaded = TfidfLsaModel.load(save_path)
            self.assertEqual(loaded.vocabulary, model.vocabulary)
            self.assertEqual(loaded.recipe_row_ids, model.recipe_row_ids)
            np.testing.assert_allclose(loaded.idf, model.idf)
            np.testing.assert_allclose(loaded.components, model.components)
            np.testing.assert_allclose(loaded.recipe_lsa, model.recipe_lsa)


class MLRecommenderProductionTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baseline = Recommender(ROOT)
        cls.quality = RecipeQualityRecommender(cls.baseline)
        cls.ml_recommender = MLRecipeRecommender.load(ROOT, quality_recommender=cls.quality)

    def test_production_artifact_attributes(self):
        model = self.ml_recommender.model
        self.assertEqual(len(model.recipe_row_ids), 13489)
        self.assertEqual(len(model.vocabulary), 27431)
        self.assertEqual(model.components.shape, (100, 27431))
        self.assertGreater(float(np.sum(model.explained_variance_ratio)), 0.15)
        meta_file = ROOT / ARTIFACT_DIR / METADATA_NAME
        self.assertTrue(meta_file.is_file())
        metadata = json.loads(meta_file.read_text(encoding="utf-8"))
        self.assertEqual(self.ml_recommender.artifact_sha256, metadata["artifact_sha256"])

    def test_vietnamese_quantity_query_and_determinism(self):
        pantry = ["2 quả trứng", "3 quả cà chua", "hành lá"]
        for method in ("ml_tfidf", "ml_lsa"):
            with self.subTest(method=method):
                res1 = self.ml_recommender.recommend(pantry, top_n=5, method=method, return_diagnostics=True)
                res2 = self.ml_recommender.recommend(pantry, top_n=5, method=method, return_diagnostics=True)

                self.assertEqual(res1["normalized_ingredients"], ["egg", "green_onion", "tomato"])
                self.assertGreater(len(res1["recommendations"]), 0)

                # Determinism check
                ids1 = [r["recipe_id"] for r in res1["recommendations"]]
                ids2 = [r["recipe_id"] for r in res2["recommendations"]]
                self.assertEqual(ids1, ids2)

                scores1 = [r["score"] for r in res1["recommendations"]]
                scores2 = [r["score"] for r in res2["recommendations"]]
                self.assertEqual(scores1, scores2)

                # Schema fields check
                first = res1["recommendations"][0]
                self.assertIn("recipe_id", first)
                self.assertIn("recipe_name", first)
                self.assertIn("score", first)
                self.assertIn("key_matches", first)
                self.assertIn("match_ratio", first)
                self.assertIn("ml_tfidf_cosine", first)
                self.assertIn("ml_lsa_cosine", first)

    def test_gated_vs_open_mode(self):
        # A sparse pantry with low match ratio
        pantry = ["egg"]
        # In gated mode, default min_matched_ingredients is 2, min_match_ratio is 0.25
        # Since user only has 1 ingredient, gated mode will adapt min_matched to 1,
        # but only recipes where egg makes up >= 25% of ingredients pass.
        gated = self.ml_recommender.recommend(pantry, top_n=5, method="ml_tfidf", mode="gated", return_diagnostics=True)
        open_res = self.ml_recommender.recommend(pantry, top_n=5, method="ml_tfidf", mode="open", return_diagnostics=True)

        self.assertGreaterEqual(open_res["qualified_count"], gated["qualified_count"])
        self.assertGreater(len(open_res["recommendations"]), 0)

    def test_unrecognized_or_empty_input(self):
        # Empty list
        empty_res = self.ml_recommender.recommend([], top_n=5, return_diagnostics=True)
        self.assertEqual(empty_res["recommendations"], [])
        self.assertEqual(empty_res["empty_reason"], "NO_RECOGNIZED_INGREDIENTS")

        # Unknown ingredient
        unknown = ["nguyen_lieu_hoan_toan_khong_co_that_xyz_123"]
        unknown_res = self.ml_recommender.recommend(unknown, top_n=5, return_diagnostics=True)
        self.assertEqual(unknown_res["recommendations"], [])
        unresolved_names = [item["raw_line"] for item in unknown_res["unresolved_ingredients"]]
        self.assertIn("nguyen_lieu_hoan_toan_khong_co_that_xyz_123", unresolved_names)

    def test_tamper_protection_detects_hash_mismatch(self):
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            # Copy artifact and create corrupted metadata
            art_src = ROOT / ARTIFACT_DIR / ARTIFACT_NAME
            art_dst = tmp_path / ARTIFACT_NAME
            art_dst.write_bytes(art_src.read_bytes())

            corrupted_meta = json.loads((ROOT / ARTIFACT_DIR / METADATA_NAME).read_text(encoding="utf-8"))
            corrupted_meta["artifact_sha256"] = "corrupted_sha256_hash_here"
            (tmp_path / METADATA_NAME).write_text(json.dumps(corrupted_meta), encoding="utf-8")

            with self.assertRaises(ValueError) as ctx:
                MLRecipeRecommender.load(ROOT, quality_recommender=self.quality, artifact_dir=tmp_path)
            self.assertIn("SHA-256 differs", str(ctx.exception))


class MLRecommenderServiceIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service_lsa = SmartKitchenService(ROOT, recipe_first=True, ranking_method="ml_lsa")
        cls.service_tfidf = SmartKitchenService(ROOT, recipe_first=True, ranking_method="ml_tfidf")

    def test_smart_kitchen_service_with_ml_rankers(self):
        for service, ranker in ((self.service_tfidf, "ml_tfidf"), (self.service_lsa, "ml_lsa")):
            with self.subTest(ranker=ranker):
                self.assertTrue(service.recommender_loaded)
                res = service.recommend_ingredients(["2 quả trứng", "cà chua", "hành lá"], top_n=5)
                self.assertIn("normalized_ingredients", res)
                self.assertIn("recommendations", res)
                self.assertGreater(len(res["recommendations"]), 0)
                self.assertEqual(res["method"], ranker)

    def test_fastapi_endpoint_recommend(self):
        app = create_app(lambda: self.service_lsa)
        with TestClient(app) as client:
            response = client.post("/api/recommend", json={
                "ingredients": ["2 quả trứng", "3 quả cà chua"],
                "top_n": 3,
            })
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertTrue(data["success"])
            self.assertEqual(data["ranking_method"], "ml_lsa")
            self.assertGreater(len(data["recommendations"]), 0)
            first = data["recommendations"][0]
            self.assertIn("recipe_name", first)
            self.assertIn("score", first)
