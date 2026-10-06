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
python cv/audit_dataset.py                                         # 1) kiểm định + làm sạch -> reports/, data_checked.yaml
python train.py --model yolov8n.pt --name baseline_v8n --epochs 30 # 2a) baseline nhỏ
python train.py --model yolov8s.pt --name ingredients  --epochs 30 # 2b) mô hình chính
python cv/evaluate.py                                              # 3) so sánh, đánh giá, error analysis -> reports/, models/best.pt
python -m core.detector anh.jpg                                    # 4) thử module nhận diện (in JSON)
```

`audit_dataset.py` kiểm tra: số ảnh/class/object, thống kê class imbalance, ảnh hỏng/0 byte/quá nhỏ, label sai (thiếu, rỗng, class_id ngoài phạm vi, bbox ngoài [0,1], sai số cột), ảnh trùng (MD5), ảnh gần giống (dHash), rò rỉ dữ liệu giữa train/valid/test. Ảnh trùng/leakage trong train được loại qua danh sách `data/splits/train_clean.txt`; dataset gốc **không bị sửa**. Kết quả ghi vào `reports/` và in `READY FOR TRAINING: YES/NO`.

`evaluate.py` đánh giá mọi mô hình trong `runs/`, chọn mô hình có mAP50-95 (valid) cao nhất, xuất Precision/Recall/mAP, confusion matrix, PR/F1 curve, training/validation loss và phân tích lỗi (class nhầm, FP, FN, vật thể nhỏ, bị che, ảnh tối, nền phức tạp).

Output của `detector.py` (chuẩn giao tiếp với Recommendation System):
```json
{"ingredients": [{"name": "tomato", "confidence": 0.95, "count": 2}]}
```

### Kết quả dataset
3.148 ảnh · 39.548 object · 30 class · 0 ảnh lỗi · 0 label lỗi · imbalance max/min = 4.3 (tomato 2027 / chocolate 472). Chi tiết: `reports/summary.md`.

### Kết quả mô hình (YOLOv8s, 640px)
| Tập | Precision | Recall | mAP@0.5 | mAP@0.5:0.95 |
|---|---|---|---|---|
| Valid | 0.959 | 0.967 | 0.966 | 0.640 |
| Test | 0.937 | 0.945 | 0.954 | 0.682 |

So sánh baseline: `reports/model_comparison.csv`. Biểu đồ: `reports/figures/`. Phân tích lỗi: `reports/error_analysis.md`.

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
