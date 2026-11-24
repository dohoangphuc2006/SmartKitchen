# Báo cáo Kiểm thử E2E & Môi trường Sạch (`SMART_KITCHEN_FINAL_HANDOFF_20261116_V6`)

- **Cài đặt sạch trên bản sao cô lập:** `setup_env.ps1 -Port 8066` (`rc = 0`), `--profile recipe --check` (`rc = 0`) PASS.
- **Python self-contained trong gói V6 (`.venv` `requirements-recipe.txt`):** `test_recipe_language_switching`, `test_two_tier_recommendations`, `test_main_app_readiness`, và 5 unit test của `test_recommender.RecommenderTests` — **PASS (`rc = 0`)**.
- **Node.js self-contained trong gói V6:** **`13 / 13` PASS** (gồm `test_recipe_language_modal.cjs` và `test_recipe_detail_frontend.cjs`).
- **Recipe Detail Language Probes (`GET /api/recipes/{417, 999, 6236, 103}`):**
  - `#417`, `#999`, `#6236`: đầy đủ Tiếng Việt (tên món, nguyên liệu, từng bước) lẫn nguyên bản Tiếng Anh; `review_status = auto_unreviewed`.
  - `#103` (chưa có batch dịch): tự động dịch dòng nguyên liệu hợp lệ qua `ondemand_dictionary_v1` kèm cache cục bộ và giữ fallback bước nấu Tiếng Anh nguyên vẹn (`untranslated`).
- **Request đầu tiên (`trung_ca_chua_hanh_final`, Run 1):** **`148.29 ms`**.
- **Restart Determinism (`Run 1` port `8066` vs `Run 2` port `8067`):** **`11/11` PASS**.
