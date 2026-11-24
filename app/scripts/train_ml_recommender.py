"""Huấn luyện và lưu trữ mô hình gợi ý công thức ML (TF-IDF và TF-IDF + TruncatedSVD / LSA).

Chạy script này để fit mô hình trên toàn bộ 13.489 công thức trong data/processed/recipes_cleaned.csv,
sinh artifact nhị phân models/recipe_ml/recipe_tfidf_lsa_v1.npz và metadata JSON.
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np

from src.ml_recommender import (
    ARTIFACT_DIR,
    ARTIFACT_NAME,
    DEFAULT_CONFIG,
    METADATA_NAME,
    MODEL_VERSION,
    MLRecipeRecommender,
    TfidfLsaModel,
    build_documents,
    environment_info,
    fit_inputs_digest,
    sha256_file,
)
from src.recipe_quality import RecipeQualityRecommender
from src.recommender import Recommender

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
LOG = logging.getLogger("train_ml_recommender")


def train(root: Path = ROOT, output_dir: Path | None = None, n_components: int = 100,
          random_state: int = 42, min_df: int = 1) -> dict:
    root = Path(root).resolve()
    target_dir = Path(output_dir).resolve() if output_dir else (root / ARTIFACT_DIR)
    target_dir.mkdir(parents=True, exist_ok=True)

    LOG.info("1. Đang nạp danh mục công thức và từ điển chuẩn hóa từ %s ...", root)
    base_recommender = Recommender(root)
    quality_recommender = RecipeQualityRecommender(base_recommender)

    LOG.info("2. Đang xây dựng tập văn bản nguyên liệu chuẩn hóa (canonical ingredient tokens) ...")
    docs, recipe_row_ids = build_documents(quality_recommender)
    LOG.info("   -> Tổng số công thức: %d", len(recipe_row_ids))

    config = dict(
        DEFAULT_CONFIG,
        n_components=n_components,
        random_state=random_state,
        min_df=min_df,
    )

    LOG.info("3. Bắt đầu fit mô hình TF-IDF + TruncatedSVD (LSA %d components, random_state=%d) ...",
             n_components, random_state)
    t0 = time.perf_counter()
    model = TfidfLsaModel.fit(docs, recipe_row_ids, config=config)
    fit_duration = time.perf_counter() - t0
    LOG.info("   -> Fit hoàn tất trong %.2f giây", fit_duration)
    LOG.info("   -> Từ vựng (Vocabulary): %d tokens", len(model.vocabulary))
    var_sum = float(np.sum(model.explained_variance_ratio))
    LOG.info("   -> Tổng tỉ lệ phương sai giải thích được (explained variance ratio): %.4f (%.2f%%)",
             var_sum, var_sum * 100.0)

    # Lưu artifact .npz
    artifact_path = target_dir / ARTIFACT_NAME
    LOG.info("4. Đang lưu mô hình vào %s ...", artifact_path)
    artifact_sha = model.save(artifact_path)
    artifact_bytes = artifact_path.stat().st_size
    LOG.info("   -> Dung lượng artifact: %d bytes (%.2f MB)", artifact_bytes, artifact_bytes / (1024 * 1024))
    LOG.info("   -> SHA-256 artifact: %s", artifact_sha)

    # Lưu metadata .json
    meta_path = target_dir / METADATA_NAME
    input_digests = fit_inputs_digest(root)
    metadata = {
        "model_version": MODEL_VERSION,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "artifact_file": ARTIFACT_NAME,
        "artifact_sha256": artifact_sha,
        "artifact_bytes": artifact_bytes,
        "fit_inputs_sha256": input_digests,
        "config": model.config,
        "n_recipes": len(recipe_row_ids),
        "n_vocabulary": len(model.vocabulary),
        "n_components": model.config["n_components"],
        "fit_duration_seconds": round(fit_duration, 3),
        "explained_variance_ratio_sum": var_sum,
        "top_singular_values": [round(float(v), 6) for v in model.singular_values[:10]],
        "top_explained_variance_ratio": [round(float(v), 6) for v in model.explained_variance_ratio[:10]],
        "environment": environment_info(),
    }
    meta_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    LOG.info("5. Đã lưu metadata vào %s", meta_path)

    # 6. Kiểm tra tải lại mô hình (round-trip verification)
    LOG.info("6. Đang kiểm tra tái lập (reload & verification) ...")
    loaded = MLRecipeRecommender.load(root, quality_recommender=quality_recommender, artifact_dir=target_dir)

    # Smoke test 1: Tiếng Việt có số lượng
    test_pantry_vi = ["2 quả trứng", "3 quả cà chua", "hành lá"]
    res_tfidf = loaded.recommend(test_pantry_vi, top_n=3, method="ml_tfidf", return_diagnostics=True)
    res_lsa = loaded.recommend(test_pantry_vi, top_n=3, method="ml_lsa", return_diagnostics=True)
    LOG.info("   -> Test Tiếng Việt ('2 quả trứng', '3 quả cà chua', 'hành lá'):")
    LOG.info("      Tokens chuẩn hóa: %s", res_tfidf["normalized_ingredients"])
    LOG.info("      Top-1 TF-IDF: %s (score=%.4f)",
             res_tfidf["recommendations"][0]["recipe_name"] if res_tfidf["recommendations"] else "None",
             res_tfidf["recommendations"][0]["score"] if res_tfidf["recommendations"] else 0.0)
    LOG.info("      Top-1 LSA:    %s (score=%.4f)",
             res_lsa["recommendations"][0]["recipe_name"] if res_lsa["recommendations"] else "None",
             res_lsa["recommendations"][0]["score"] if res_lsa["recommendations"] else 0.0)

    # Smoke test 2: Determinism check (chạy lại phải cho kết quả bit-identical)
    res_lsa_repeat = loaded.recommend(test_pantry_vi, top_n=3, method="ml_lsa", return_diagnostics=True)
    assert [r["recipe_id"] for r in res_lsa["recommendations"]] == [r["recipe_id"] for r in res_lsa_repeat["recommendations"]], "LSA không determinism!"
    assert [r["score"] for r in res_lsa["recommendations"]] == [r["score"] for r in res_lsa_repeat["recommendations"]], "Scores không đồng nhất!"
    LOG.info("   -> Xác minh tính xác định (determinism): ĐẠT (PASS)")

    LOG.info("=== HOÀN THÀNH HUẤN LUYỆN VÀ LƯU MÔ HÌNH THÀNH CÔNG ===")
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=None, help="Thư mục lưu artifact")
    parser.add_argument("--n-components", type=int, default=100, help="Số chiều LSA (TruncatedSVD)")
    parser.add_argument("--random-state", type=int, default=42, help="Seed ngẫu nhiên")
    parser.add_argument("--min-df", type=int, default=1, help="Tần suất tối thiểu của token")
    args = parser.parse_args()
    train(ROOT, output_dir=args.output_dir, n_components=args.n_components,
          random_state=args.random_state, min_df=args.min_df)


if __name__ == "__main__":
    main()
