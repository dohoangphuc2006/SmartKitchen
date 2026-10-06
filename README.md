# 🍳 Smart Kitchen & Pantry Assistant

Chụp ảnh tủ lạnh → **YOLOv8** nhận diện 30 loại nguyên liệu → chỉnh sửa danh sách + hạn dùng → **gợi ý món** (Content-based Filtering, tùy chọn LLM Gemini) → lưu thực đơn yêu thích.

Đồ án môn *Học máy và ứng dụng*.

```
Ảnh → Object Detection (YOLOv8) → Danh sách nguyên liệu → Ingredient Mapping → Recommendation → Top món phù hợp
```

## Cấu trúc

```
smartkitchen_app/
├─ app.py                  # Web app Streamlit
├─ train.py                # Huấn luyện YOLOv8
├─ cv/
│   ├─ audit_dataset.py    # Kiểm định dataset: thống kê, ảnh/label lỗi, duplicate, leakage, EDA
│   └─ evaluate.py         # Đánh giá mô hình + phân tích lỗi
├─ core/
│   ├─ detector.py         # Module nhận diện (detect_ingredients)
│   ├─ recommender.py      # TF-IDF + cosine + ưu tiên hạn dùng
│   ├─ llm.py              # Sinh công thức bằng Gemini (tùy chọn)
│   ├─ ingredients.py      # Tên Việt + hạn dùng mặc định
│   └─ favorites.py        # Lưu yêu thích
├─ data/recipes.json       # 40 công thức
├─ data_checked.yaml       # Cấu hình dataset đã kiểm định (sinh bởi audit_dataset.py)
├─ reports/                # Báo cáo dataset, metrics, biểu đồ, error analysis
└─ models/best.pt          # Trọng số YOLO sau huấn luyện
```

## Cài đặt

```bash
pip install -r requirements.txt
# GPU NVIDIA: pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

### Dataset
Dataset *Fridge detection* (Roboflow, MIT, 3.148 ảnh, 30 class, định dạng YOLOv8):
https://universe.roboflow.com/fridge-ydzni/fridge-detection-es0ja/dataset/1

Giải nén thành thư mục `SmartKitchen/` **nằm cạnh** thư mục `smartkitchen_app/`:
```
BTL/
├─ SmartKitchen/{train,valid,test,data.yaml}
└─ smartkitchen_app/
```
(Dataset không được đưa lên git vì dung lượng lớn.)

## Quy trình Computer Vision (Thành viên 1)

```bash
python cv/audit_dataset.py      # 1) kiểm định dataset -> reports/, data_checked.yaml
python train.py --epochs 30     # 2) huấn luyện YOLOv8s -> runs/ingredients/weights/best.pt
python cv/evaluate.py           # 3) đánh giá valid/test + error analysis -> reports/, models/best.pt
python -m core.detector anh.jpg # 4) thử module nhận diện (in JSON)
```

`audit_dataset.py` kiểm tra: số ảnh/class/object, thống kê class imbalance, ảnh hỏng/0 byte/quá nhỏ, label sai (thiếu, rỗng, class_id ngoài phạm vi, bbox ngoài [0,1], sai số cột), ảnh trùng (MD5), ảnh gần giống (dHash), rò rỉ dữ liệu giữa train/valid/test. Dataset gốc **không bị sửa**; kết quả ghi vào `reports/` và in `READY FOR TRAINING: YES/NO`.

Output của `detector.py` (chuẩn giao tiếp với Recommendation System):
```json
{"ingredients": [{"name": "tomato", "confidence": 0.95, "count": 2}]}
```

### Kết quả mô hình
Xem `reports/metrics.json`, `reports/error_analysis.md` và `reports/figures/` (training curves, confusion matrix, PR/F1 curve).

## Chạy ứng dụng

```bash
streamlit run app.py
```
Tải ảnh → *Nhận diện nguyên liệu* → chỉnh số lượng/hạn dùng → tab *Gợi ý món* → *Lưu vào yêu thích*.
Bật LLM (tùy chọn): đặt biến môi trường `GEMINI_API_KEY` trước khi chạy.

## Thuật toán gợi ý
`score = 0.55·coverage + 0.25·cosine + 0.20·urgency (+ bonus nguyên liệu tùy chọn)`
- **coverage**: tỉ lệ nguyên liệu chính đang có (trọng số IDF).
- **cosine**: tương đồng TF-IDF giữa vector tủ lạnh và vector công thức.
- **urgency**: ưu tiên nguyên liệu còn ≤ 3 ngày để giảm lãng phí thực phẩm.
Định lượng được nhân theo khẩu phần mục tiêu.

## Phân công
- **Thành viên 1**: Dataset ảnh, EDA, kiểm định label/duplicate/leakage, huấn luyện & đánh giá YOLO, `detector.py`.
- **Thành viên 2**: Recipe dataset, chuẩn hóa/mapping nguyên liệu, Recommendation System, `recommender.py`.
