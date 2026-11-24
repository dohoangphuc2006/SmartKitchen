# Kiến trúc Smart Kitchen

```text
Trình duyệt (HTML, CSS, JavaScript)
    Pantry và danh mục → Chọn phương pháp → Hai tầng → Chi tiết VI / EN
                        ⇅ HTTP/JSON trên 127.0.0.1
FastAPI (app/backend)
    /api/config • /api/ingredients/catalog • /api/recommend • /api/recipes/{id}
                        ↓
Chuẩn hóa pantry → Stage 5 / TF-IDF / LSA → Two-Tier Recommendation
                        ↓
Dữ liệu công thức, từ điển và danh mục cục bộ • Artifact recipe_tfidf_lsa_v1
```

- `app/run_app.py` chọn profile `recipe`, kiểm tra cổng và phục vụ trang tĩnh cùng API qua Uvicorn. API cấu hình cung cấp `final` làm mặc định. Ảnh và camera YOLO không được bật ở profile trình diễn.
- `app/src/pantry_catalog.py` và các bảng ánh xạ chuẩn hóa đầu vào Việt / Anh. `app/src/recommender.py` và `recipe_quality.py` chạy baseline. `app/src/two_tier_recommender.py` phân chia và xếp hạng hai nhóm. Kho công thức dùng `row_id` để liên kết kết quả với chi tiết.
- `app/processed/` chứa công thức, lineage nguyên liệu, từ điển hiển thị và các batch bản dịch. `app/models/recipe_ml/` chứa artifact và metadata. Các đường dẫn runtime bắt đầu từ thư mục `app` của chính gói.
- `app/src/recipe_repository.py` trả chi tiết nguồn và bản tiếng Việt theo từng trường. Bộ dịch theo yêu cầu chỉ xử lý các dòng nguyên liệu có quy tắc hỗ trợ. Cache phát sinh tại `app/processed/recipe_detail_vi_ondemand_cache.json`, tách khỏi các batch và model phát hành. Giao diện lưu lịch sử và mục yêu thích trong trình duyệt.
- `/api/health` báo trạng thái khởi động. Trường `model_loaded` của endpoint này dùng cho YOLO. Phản hồi `/api/recommend` ở chế độ ML có `model_version` và `artifact_sha256`.
