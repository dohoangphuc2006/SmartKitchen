# Biên bản phát hành Smart Kitchen V6

**READY_WITH_LIMITATIONS** · Gói chạy độc lập đã kiểm thử. Quyền chia sẻ đang chờ xác nhận.

## Bản phân phối đã kiểm thử

| Mục | Kết quả |
| --- | --- |
| ZIP | `Smart_Kitchen_V6_Windows.zip` |
| Dung lượng ZIP | 39.869.316 byte |
| SHA-256 ZIP | `2a990efc41ef5f222d5cce84570072ad3c0aa877f454bdb4301364b38792e353` |
| Nội dung khi giải nén | 121 tệp, 190.076.684 byte |
| Phạm vi manifest | 120 tệp, 190.055.781 byte, bao phủ toàn bộ payload trừ chính manifest |
| So với V6 | 100 tệp đối chiếu byte-for-byte. Toàn bộ 146 mục trong manifest V6 được xác minh lại sau khi chuẩn bị bản sao |
| Kiểm tra ZIP | PASS, toàn bộ entry có đúng đường dẫn, SHA-256 và dung lượng tương ứng với bản trong `nghiemthu` |

## Kiểm thử bản ZIP phát hành

- PASS · Giải nén vào đường dẫn Unicode có khoảng trắng. `RUN_ME_FIRST.cmd` tạo `.venv` mới với CPython 3.14.3 x64, cài 21 thư viện đã pin từ PyPI, chạy `pip check` và preflight, sau đó khởi động server.
- PASS · Trang chủ, catalog, Stage 5 mặc định, TF-IDF và LSA trả dữ liệu cục bộ. Pantry thịt heo xay, trứng, và trứng/cà chua/hành lá đạt 9/9 qua ba phương pháp. Hai lần khởi động trên 8000 và 8066 trả đúng cùng ID và thứ tự cho cả hai tầng.
- PASS · Chrome thực mở công thức, chuyển tiêu đề, nguyên liệu, bước nấu và nhãn hộp thoại VI → EN → VI, thêm/xóa nguyên liệu, xem hai tầng và trạng thái không có kết quả.
- PASS · Kiểm tra cổng 8000 bận trả mã 3, server đang giữ cổng vẫn phục vụ. Sau khi thử chi tiết #103, cache dịch phát sinh riêng, toàn bộ hash payload được giữ nguyên.
- PASS · 13/13 nhóm kiểm thử JavaScript trong gói trên Node.js 24.16.0.
- PASS · 52/52 test Python trong bản giải nén sau khi cài requirements-dev.txt, gồm kiểm thử artifact và các đường chạy ứng dụng.
- Quét mẫu khóa/token phổ biến, cấu hình riêng và đường dẫn máy phát triển trong các tệp văn bản của payload không ghi nhận khớp. Checkpoint YOLO được đối chiếu SHA-256, chưa chạy kiểm thử ảnh thực và còn chờ xác nhận quyền phân phối.

Xem [kết quả kỹ thuật](../docs/EVALUATION_RESULTS.md) và [cách phát hành cho Owner](../docs/DISTRIBUTION.md). Human evaluation và independent holdout vẫn chưa đạt nghiệm thu.

## Model artifacts

| Tệp | Byte | SHA-256 |
| --- | ---: | --- |
| `app/models/best.pt` | 6.276.516 | `c67106a099bb625912a461eee00fe1e09bda9ea8a7a0f55da34abaace3f7f8cf` |
| `app/models/recipe_ml/recipe_tfidf_lsa_v1.metadata.json` | 1.704 | `1529682237272954d70ff56034177a556d4a612915bc65bc494b0d9e14ca3cb9` |
| `app/models/recipe_ml/recipe_tfidf_lsa_v1.npz` | 92.791.550 | `3616f73132f4effe2700831d8da5174a39a56fd4ab223737cfc8b49a556d487b` |

TF-IDF và LSA dùng chung NPZ đã fit, metadata version `recipe_tfidf_lsa_v1` và 4 checksum đầu vào fit. `best.pt` là checkpoint YOLO tùy chọn, được giữ trong bản cục bộ với hash V6.

## Dữ liệu runtime

- `app/processed/recipes_cleaned.csv` · 13.501 dòng catalog, chứa văn bản nguồn và trường dẫn xuất. Model dùng 13.489 công thức.
- `app/processed/ingredient_details.csv` · 145.024 dòng lineage và chi tiết nguyên liệu. `stage2_manifest.json` kiểm tra bộ dữ liệu runtime.
- `app/config/pantry_ingredient_catalog.json` · 526 mục trong 12 nhóm. `app/mapping/ingredient_mapping.json`, `ingredient_mapping.csv`, `ingredient_aliases.json` và `app/config/pantry_alias_overrides_v1.json` hỗ trợ đối chiếu đầu vào.
- `app/processed/ingredient_vocabulary.csv` là bảng từ vựng đi kèm dữ liệu đã xử lý. `ingredient_display_vi.csv`, `recipe_titles_vi.csv`, các `recipe_detail_vi_*.json` và cấu hình hiển thị duy trì bản địa hóa. `app/translations/` lưu các bản dịch nguồn dùng để đối chiếu.
- `app/data/recipes_raw/SOURCE.json` và `app/processed/SOURCE_STAGE2.md` ghi rõ nguồn, revision và ghi nhận thay đổi. CSV thô, ảnh công thức và dữ liệu đánh giá nghiên cứu nằm ngoài bản phân phối.

## Các tệp thêm vào và chỉnh sửa

Tệp mới trong payload, bên cạnh manifest mới.

- `.gitattributes`
- `.gitignore`
- `RUN_ME_FIRST.cmd`
- `START_HERE.md`
- `docs/DISTRIBUTION.md`
- `docs/EVALUATION_RESULTS.md`
- `docs/ML_METHODS.md`
- `release/VERSION.txt`

Tệp sửa hoặc viết lại dựa trên nội dung tương ứng V6.

- `README.md`
- `Start_Smart_Kitchen.cmd`
- `app/requirements-dev.txt`
- `app/requirements-recipe.txt`
- `app/run_app.py`
- `app/tests/test_recommendation_audit_fixes.py`
- `app/tests/test_recommender.py`
- `docs/ACADEMIC_LIMITATIONS.md`
- `docs/ARCHITECTURE.md`
- `docs/TROUBLESHOOTING.md`
- `docs/USER_GUIDE.md`
- `setup_env.ps1`

Release còn có ZIP, SHA-256 của ZIP và biên bản này ở thư mục ngoài bản giải nén. Hai tài liệu lịch sử còn lại được chuyển nguyên byte vào `docs/`. Phần lược bỏ gồm log tạm, backup, dữ liệu kiểm định nghiên cứu, runner và các test cần fixture không có trong V6. Hai test được thu gọn để chỉ kiểm tra tài sản được bàn giao.

## Cây thư mục thực tế

```text
nghiemthu/
├── app/
│   ├── backend/
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   ├── recipes.py
│   │   │   └── recommendation.py
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   └── response_models.py
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   └── smart_kitchen_service.py
│   │   ├── __init__.py
│   │   ├── errors.py
│   │   └── main.py
│   ├── config/
│   │   ├── app_config.json
│   │   ├── fridge11_scope.json
│   │   ├── fridge30_experimental.json
│   │   ├── fridge30_precision_guard.json
│   │   ├── ingredient_display_vi.json
│   │   ├── integration_config.json
│   │   ├── pantry_alias_overrides_v1.json
│   │   ├── pantry_ingredient_catalog.json
│   │   ├── recipe_quality_ingredients.json
│   │   ├── recipe_title_overrides_vi.json
│   │   ├── recommendation_config.json
│   │   ├── runtime_model.json
│   │   └── yolo_classes.yaml
│   ├── core/
│   │   ├── __init__.py
│   │   ├── detection_scope.py
│   │   ├── detector.py
│   │   ├── image_input.py
│   │   └── model_selection.py
│   ├── data/
│   │   └── recipes_raw/
│   │       └── SOURCE.json
│   ├── frontend/
│   │   ├── app.js
│   │   ├── camera.js
│   │   ├── detection.js
│   │   ├── diagnostic_export.js
│   │   ├── i18n.js
│   │   ├── index.html
│   │   └── style.css
│   ├── mapping/
│   │   ├── fridge30_ingredient_mapping.json
│   │   ├── ingredient_aliases.json
│   │   ├── ingredient_mapping.csv
│   │   ├── ingredient_mapping.json
│   │   └── yolo_classes.csv
│   ├── models/
│   │   ├── recipe_ml/
│   │   │   ├── recipe_tfidf_lsa_v1.metadata.json
│   │   │   └── recipe_tfidf_lsa_v1.npz
│   │   └── best.pt
│   ├── processed/
│   │   ├── SOURCE_STAGE2.md
│   │   ├── ingredient_details.csv
│   │   ├── ingredient_display_vi.csv
│   │   ├── ingredient_vocabulary.csv
│   │   ├── recipe_detail_vi_candidates.json
│   │   ├── recipe_detail_vi_live_batch.json
│   │   ├── recipe_detail_vi_phase5_batch.json
│   │   ├── recipe_detail_vi_v6_batch.json
│   │   ├── recipe_titles_vi.csv
│   │   ├── recipes_cleaned.csv
│   │   └── stage2_manifest.json
│   ├── scripts/
│   │   └── train_ml_recommender.py
│   ├── src/
│   │   ├── detection_to_ingredient.py
│   │   ├── detector_adapter.py
│   │   ├── ingredient_mapper.py
│   │   ├── instruction_translation_validation.py
│   │   ├── localization.py
│   │   ├── ml_recommender.py
│   │   ├── object_detection.py
│   │   ├── pantry_catalog.py
│   │   ├── recipe_detail_translation.py
│   │   ├── recipe_fallback.py
│   │   ├── recipe_food_availability.py
│   │   ├── recipe_normalized_index.py
│   │   ├── recipe_on_demand_translator.py
│   │   ├── recipe_quality.py
│   │   ├── recipe_repository.py
│   │   ├── recipe_requirements.py
│   │   ├── recommender.py
│   │   ├── smart_kitchen_pipeline.py
│   │   └── two_tier_recommender.py
│   ├── tests/
│   │   ├── test_camera_controller.cjs
│   │   ├── test_diagnostic_export.cjs
│   │   ├── test_feature_frontend.cjs
│   │   ├── test_final_delivery_recovery.cjs
│   │   ├── test_main_app_readiness.py
│   │   ├── test_major01_requests.cjs
│   │   ├── test_ml_recommender.py
│   │   ├── test_pantry_expansion_frontend.cjs
│   │   ├── test_pantry_input_expansion.py
│   │   ├── test_production_recovery.cjs
│   │   ├── test_production_runtime_races.cjs
│   │   ├── test_recipe_detail_frontend.cjs
│   │   ├── test_recipe_language_modal.cjs
│   │   ├── test_recipe_language_switching.py
│   │   ├── test_recommendation_audit_fixes.py
│   │   ├── test_recommendation_audit_frontend.cjs
│   │   ├── test_recommender.py
│   │   ├── test_two_tier_frontend.cjs
│   │   ├── test_two_tier_recommendations.py
│   │   └── test_ui_polish_regression.cjs
│   ├── translations/
│   │   ├── recipe_detail_vi_authored_extra_v1.json
│   │   ├── recipe_detail_vi_authored_v1.json
│   │   ├── recipe_detail_vi_live_authored_v1.json
│   │   └── recipe_detail_vi_phase5_authored_v1.json
│   ├── requirements-dev.txt
│   ├── requirements-recipe.txt
│   ├── requirements.txt
│   └── run_app.py
├── docs/
│   ├── ACADEMIC_LIMITATIONS.md
│   ├── ARCHITECTURE.md
│   ├── DISTRIBUTION.md
│   ├── E2E_VERIFICATION_REPORT.md
│   ├── EVALUATION_RESULTS.md
│   ├── ML_METHODS.md
│   ├── TROUBLESHOOTING.md
│   ├── USER_GUIDE.md
│   └── VERIFIED_COMPARISON_TABLE.md
├── release/
│   ├── SHA256_MANIFEST.json
│   ├── SUBMISSION_AUDIT.md
│   ├── Smart_Kitchen_V6_Windows.zip
│   ├── Smart_Kitchen_V6_Windows.zip.sha256
│   └── VERSION.txt
├── .gitattributes
├── .gitignore
├── README.md
├── RUN_ME_FIRST.cmd
├── START_HERE.md
├── Start_Smart_Kitchen.cmd
└── setup_env.ps1
```

Thư mục bàn giao gồm 124 tệp, 229.957.668 byte, bao gồm ZIP, checksum ZIP và biên bản.

