# 🍳 Smart Kitchen & Pantry Assistant

**Ứng dụng Học máy trong nhận diện thực phẩm và gợi ý công thức nấu ăn**

Bài tập lớn môn *Học máy và ứng dụng* — Đại học Văn Lang.

```
Ảnh nguyên liệu / ảnh tủ lạnh
        ↓
Object Detection (YOLOv8)
        ↓
Danh sách nguyên liệu
        ↓
Ingredient Mapping & Chuẩn hóa
        ↓
Recommendation System (TF-IDF / LSA)
        ↓
Top món ăn phù hợp + Công thức chi tiết
```

---

## Mục tiêu

1. Nhận ảnh chứa thực phẩm/nguyên liệu.
2. Phát hiện các nguyên liệu có trong ảnh bằng mô hình Object Detection (YOLOv8).
3. Chuyển kết quả nhận diện thành danh sách nguyên liệu chuẩn.
4. Dựa vào danh sách nguyên liệu để gợi ý các món ăn phù hợp (Content-based Filtering).
5. Hiển thị mức độ phù hợp, nguyên liệu đã có và nguyên liệu còn thiếu.
6. Tích hợp thành sản phẩm demo hoàn chỉnh.

---

## Phân công nhiệm vụ

| STT | Họ tên | MSSV | Nhiệm vụ |
|:---:|--------|------|-----------|
| 1 | Đỗ Hoàng Phúc | 2474802010313 | – Khảo sát dữ liệu ảnh Fridge Detection và nhãn 30 lớp nguyên liệu.<br>– Phụ trách mô hình YOLOv8n; tích hợp nhận diện ảnh và webcam.<br>– Kiểm thử nhánh nhận diện, phân tích lỗi và giới hạn mô hình.<br>– Viết và thuyết trình phần dữ liệu ảnh, nhận diện; phối hợp kiểm thử hệ thống. |
| 2 | Huỳnh Hữu Phúc | 2474802010314 | – Thu thập, làm sạch dữ liệu công thức; chuẩn hóa nguyên liệu và ánh xạ Việt–Anh.<br>– Xây dựng Stage 5, TF-IDF/LSA và cơ chế gợi ý hai tầng.<br>– Tích hợp API, giao diện và công thức song ngữ; kiểm thử hệ gợi ý, đóng gói ứng dụng.<br>– Viết và thuyết trình phần dữ liệu công thức, hệ gợi ý; tổng hợp báo cáo. |

---

## Cấu trúc dự án

### Nhánh `member-1-cv` — Computer Vision / Object Detection

```
smartkitchen_app/
├─ app.py                  # Web app Streamlit (prototype)
├─ train.py                # Huấn luyện YOLOv8
├─ cv/
│   ├─ audit_dataset.py    # Kiểm định dataset: thống kê, ảnh/label lỗi, duplicate, leakage, EDA
│   └─ evaluate.py         # Đánh giá mô hình + phân tích lỗi
├─ core/
│   ├─ detector.py         # Module nhận diện (detect_ingredients)
│   ├─ recommender.py      # TF-IDF + cosine + ưu tiên hạn dùng
│   ├─ ingredients.py      # Tên Việt + hạn dùng mặc định
│   └─ favorites.py        # Lưu yêu thích
├─ data/recipes.json       # Công thức mẫu
├─ data_checked.yaml       # Cấu hình dataset đã kiểm định (sinh bởi audit_dataset.py)
├─ reports/                # Báo cáo dataset, metrics, biểu đồ, error analysis
└─ models/best.pt          # Trọng số YOLO sau huấn luyện
```

### Nhánh `member-2-recsys` — Recommendation System / Web App

```
app/
├─ backend/                # FastAPI backend
│   ├─ main.py
│   ├─ routes/             # API endpoints (recipes, recommendation)
│   ├─ schemas/            # Response models
│   └─ services/           # Smart Kitchen service logic
├─ frontend/               # Giao diện HTML/CSS/JS
│   ├─ index.html
│   ├─ app.js
│   ├─ style.css
│   └─ ...
├─ src/                    # Recommendation engine
│   ├─ ml_recommender.py   # TF-IDF / LSA recommender
│   ├─ ingredient_mapper.py
│   ├─ pantry_catalog.py
│   └─ ...
├─ config/                 # Cấu hình nguyên liệu, mapping, display
├─ processed/              # Dữ liệu công thức đã làm sạch
├─ models/                 # ML artifacts (TF-IDF/LSA)
├─ scripts/                # Script huấn luyện recommender
└─ run_app.py              # Entry point chạy ứng dụng
```

---

## Cài đặt & Chạy

### Yêu cầu

- Python 3.10+
- GPU NVIDIA (khuyến nghị) cho huấn luyện YOLO

### Cài đặt thư viện

```bash
pip install -r requirements.txt
# GPU NVIDIA: pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

### Dataset

Dataset *Fridge Detection* (Roboflow, MIT License, 3.148 ảnh, 30 class, định dạng YOLOv8):
https://universe.roboflow.com/fridge-ydzni/fridge-detection-es0ja/dataset/1

Giải nén thành thư mục `SmartKitchen/` **nằm cạnh** thư mục `smartkitchen_app/`:
```
BTL/
├─ SmartKitchen/{train,valid,test,data.yaml}
└─ smartkitchen_app/
```
(Dataset không được đưa lên git vì dung lượng lớn.)

---

## Quy trình Computer Vision (Thành viên 1)

```bash
python cv/audit_dataset.py                                         # 1) Kiểm định + làm sạch → reports/, data_checked.yaml
python train.py --model yolov8n.pt --name baseline_v8n --epochs 30 # 2a) Baseline nhỏ
python train.py --model yolov8s.pt --name ingredients  --epochs 30 # 2b) Mô hình chính
python cv/evaluate.py                                              # 3) So sánh, đánh giá, error analysis → reports/, models/best.pt
python -m core.detector anh.jpg                                    # 4) Thử module nhận diện (in JSON)
```

**`audit_dataset.py`** kiểm tra: số ảnh/class/object, thống kê class imbalance, ảnh hỏng/0 byte/quá nhỏ, label sai (thiếu, rỗng, class_id ngoài phạm vi, bbox ngoài [0,1], sai số cột), ảnh trùng (MD5), ảnh gần giống (dHash), rò rỉ dữ liệu giữa train/valid/test. Ảnh trùng/leakage trong train được loại qua danh sách `data/splits/train_clean.txt`; dataset gốc **không bị sửa**. Kết quả ghi vào `reports/` và in `READY FOR TRAINING: YES/NO`.

**`evaluate.py`** đánh giá mọi mô hình trong `runs/`, chọn mô hình có mAP50-95 (valid) cao nhất, xuất Precision/Recall/mAP, confusion matrix, PR/F1 curve, training/validation loss và phân tích lỗi (class nhầm, FP, FN, vật thể nhỏ, bị che, ảnh tối, nền phức tạp).

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

---

## Thuật toán gợi ý (Thành viên 2)

Hệ thống gợi ý hai tầng:

- **Stage 5 (Mặc định):** Lọc theo nguyên liệu có sẵn, xếp hạng theo tỷ lệ phủ.
- **TF-IDF:** Tương đồng cosine giữa vector tủ lạnh và vector công thức.
- **LSA (Latent Semantic Analysis):** Khám phá món liên quan qua không gian ngữ nghĩa ẩn.

Công thức hỗ trợ song ngữ Việt–Anh. Chi tiết phương pháp: `docs/ML_METHODS.md`.

---

## Chạy ứng dụng

**Phiên bản đầy đủ (FastAPI + HTML frontend):**
```bash
# Windows: Chạy RUN_ME_FIRST.cmd (cài lần đầu), sau đó Start_Smart_Kitchen.cmd
# Hoặc:
python app/run_app.py
```
Mở http://127.0.0.1:8000/ → Nhập nguyên liệu hoặc tải ảnh → Gợi ý món ăn → Xem công thức.

**Phiên bản prototype (Streamlit):**
```bash
streamlit run app.py
```
Tải ảnh → *Nhận diện nguyên liệu* → chỉnh số lượng/hạn dùng → tab *Gợi ý món* → *Lưu vào yêu thích*.

---

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Object Detection | YOLOv8 (Ultralytics) |
| Recommendation | TF-IDF, Cosine Similarity, LSA |
| Backend | FastAPI |
| Frontend | HTML / CSS / JavaScript |
| Prototype UI | Streamlit |
| Ngôn ngữ | Python 3.10+ |

---

## Nhánh Git

| Nhánh | Mục đích |
|---|---|
| `main` | Phiên bản ổn định, tổng hợp |
| `member-1-cv` | Phát triển phần Computer Vision (Thành viên 1) |
| `member-2-recsys` | Phát triển phần Recommendation System & Web App (Thành viên 2) |
