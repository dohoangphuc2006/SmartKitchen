# Smart Kitchen — Computer Vision và nhận diện nguyên liệu

README riêng của **Đỗ Hoàng Phúc — MSSV 2474802010313**, nhánh `member-1-cv`.
Đây là phần dữ liệu ảnh, kiểm định, huấn luyện, đánh giá YOLO và module nhận diện trong bài tập lớn môn **Học máy và ứng dụng**, Trường Đại học Văn Lang.

Ứng dụng tích hợp của cả nhóm và hướng dẫn chạy FastAPI nằm trên [nhánh main](https://github.com/dohoangphuc2006/SmartKitchen/tree/main). Huỳnh Hữu Phúc phụ trách dữ liệu công thức, chuẩn hóa nguyên liệu, hệ gợi ý, API và giao diện trên [member-2-recsys](https://github.com/dohoangphuc2006/SmartKitchen/tree/member-2-recsys).

## Phạm vi công việc

- Khảo sát bộ ảnh Fridge Detection và 30 lớp nguyên liệu.
- Kiểm định ảnh, nhãn, phân bố lớp, ảnh trùng và nguy cơ rò rỉ dữ liệu giữa các tập.
- Tạo danh sách train đã làm sạch, giữ nguyên dataset gốc.
- Huấn luyện YOLOv8n và YOLOv8s, so sánh theo cùng tiêu chí.
- Xuất metrics, biểu đồ, phân tích lỗi và checkpoint được chọn.
- Bàn giao module nhận diện trả về tên nguyên liệu, độ tin cậy và số đối tượng phát hiện để tích hợp vào hệ gợi ý.

## Cấu trúc phần CV

```text
cv/
  audit_dataset.py         # Kiểm định dữ liệu, EDA và tạo danh sách train sạch
  evaluate.py              # Đánh giá, so sánh model và phân tích lỗi
train.py                   # Huấn luyện YOLO
core/detector.py           # Module nhận diện và giao tiếp với phần gợi ý
models/best.pt             # Checkpoint được chọn để bàn giao
reports/                   # Báo cáo, metrics, cấu hình và biểu đồ đã lưu
reports/figures/            # Biểu đồ dữ liệu, huấn luyện, PR/F1, confusion matrix
reports/model_comparison.csv
reports/metrics.json
data_checked.yaml          # Cấu hình dataset; cần tạo lại bằng audit trên máy mới
app.py                     # Prototype Streamlit phục vụ thử nghiệm
core/, data/recipes.json   # Các thành phần và công thức mẫu của prototype
```

`runs/` chứa kết quả huấn luyện trên máy và không được đưa lên Git. Nhánh này lưu checkpoint bàn giao và các báo cáo để giảng viên đối chiếu.

## Dữ liệu và kiểm định

Nguồn: [Fridge Detection v1 trên Roboflow](https://universe.roboflow.com/fridge-ydzni/fridge-detection-es0ja/dataset/1), định dạng YOLO, 30 lớp nguyên liệu.

Theo [báo cáo kiểm định của nhánh CV](reports/summary.md):

| Nội dung | Kết quả |
|---|---:|
| Tổng số ảnh | 3.148 |
| Tổng số đối tượng được gán nhãn | 39.548 |
| Số lớp | 30 |
| Ảnh lỗi / nhãn lỗi | 0 / 0 |
| Nhóm ảnh trùng chính xác | 99 |
| Cặp ảnh có khả năng gần trùng | 24 |
| Ảnh loại khỏi danh sách train | 99 |
| Ảnh train còn lại sau làm sạch | 2.895 |
| Rò rỉ trùng chính xác giữa các tập | 0 |
| Cặp gần trùng giữa VALID và TEST | 1 |

Đây là kết quả đợt kiểm định được lưu trong nhánh CV. Cặp gần trùng cần được rà soát; không coi số ảnh lỗi bằng 0 là bảo đảm dữ liệu hoàn hảo. Hai lớp `goat_cheese` và `ham` không xuất hiện trong VALID/TEST theo báo cáo hiện có.

Ảnh trùng được loại qua `data/splits/train_clean.txt`; chương trình không xóa ảnh của dataset gốc. Chi tiết: [ảnh trùng](reports/exact_duplicates.csv), [nguy cơ leakage](reports/data_leakage.csv), [phân bố lớp](reports/class_stats.csv), [biểu đồ](reports/figures/).

## Chuẩn bị môi trường

Dùng môi trường riêng cho phần CV. `train.py` hiện đặt `device=0`, nên cần GPU NVIDIA và PyTorch có hỗ trợ CUDA để chạy lệnh huấn luyện bên dưới. Chạy nhận diện bằng checkpoint có sẵn không yêu cầu huấn luyện lại.

Clone nhánh vào thư mục `smartkitchen_app` để khớp ví dụ bố trí dataset:

```powershell
git clone --branch member-1-cv https://github.com/dohoangphuc2006/SmartKitchen.git smartkitchen_app
cd smartkitchen_app
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Bộ thư viện CV trong `requirements.txt` khác bộ thư viện của ứng dụng FastAPI trên main. Kiểm tra CUDA trước khi train:

```powershell
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__); print(torch.cuda.is_available())"
```

Tải dataset, giải nén theo cấu trúc:

```text
thu_muc_lam_viec/
├── SmartKitchen/
│   ├── data.yaml
│   ├── train/images/, train/labels/
│   ├── valid/images/, valid/labels/
│   └── test/images/, test/labels/
└── smartkitchen_app/
    ├── cv/
    └── train.py
```

Tên thư mục dataset phải là `SmartKitchen`, nằm cạnh thư mục chứa mã nguồn theo đường dẫn mà `audit_dataset.py` sử dụng.

## Quy trình thực hiện

Chạy từ thư mục gốc của nhánh CV:

```powershell
# 1. Kiểm định, tạo lại cấu hình và danh sách ảnh theo đường dẫn trên máy hiện tại
.\.venv\Scripts\python.exe cv/audit_dataset.py

# 2. Huấn luyện hai mô hình để so sánh
.\.venv\Scripts\python.exe train.py --model yolov8n.pt --name baseline_v8n --epochs 30
.\.venv\Scripts\python.exe train.py --model yolov8s.pt --name ingredients --epochs 30

# 3. Đánh giá các model trong runs/, chọn theo mAP@0.5:0.95 trên VALID
.\.venv\Scripts\python.exe cv/evaluate.py

# 4. Thử module nhận diện với checkpoint đã chọn
.\.venv\Scripts\python.exe -m core.detector duong_dan_anh.jpg
```

Cấu hình train mặc định: ảnh 640 px, batch 16, tối đa 30 epoch, patience 15, seed 0. `--epochs 30` là giới hạn đặt trước; số epoch thực chạy có thể thấp hơn do dừng sớm. Nếu đã có checkpoint của run tương ứng, script yêu cầu `--force` để huấn luyện lại.

Trên máy mới, luôn chạy audit trước vì `data_checked.yaml` đã lưu chứa đường dẫn của máy phát triển. Khi chạy lại audit/evaluate, các tệp trong `reports/` sẽ được cập nhật; có thể đối chiếu bản đã nộp qua lịch sử Git. Muốn tái lập bước so sánh cần có checkpoint trong `runs/`, bằng cách huấn luyện lại hoặc dùng bản lưu riêng; `models/best.pt` chỉ là checkpoint được chọn.

## Kết quả mô hình đã lưu

Nguồn: [model_comparison.csv](reports/model_comparison.csv) và [metrics.json](reports/metrics.json).

| Mô hình | Tập | Precision | Recall | mAP@0.5 | mAP@0.5:0.95 |
|---|---|---:|---:|---:|---:|
| YOLOv8n (`baseline_v8n`) | VALID | 0.9389 | 0.9435 | 0.9690 | 0.6464 |
| YOLOv8n (`baseline_v8n`) | TEST | 0.8953 | 0.8888 | 0.9394 | 0.6545 |
| YOLOv8s (`ingredients`) | VALID | 0.9567 | 0.9711 | 0.9697 | 0.6425 |
| YOLOv8s (`ingredients`) | TEST | 0.9382 | 0.9482 | 0.9561 | 0.6725 |

**Checkpoint được chọn là YOLOv8n**, vì mAP@0.5:0.95 trên VALID là 0.6464, cao hơn 0.6425 của YOLOv8s. Tiêu chí chọn được áp dụng trên VALID; không dùng TEST để thay đổi lựa chọn. YOLOv8n thực chạy 25 epoch, YOLOv8s chạy 30 epoch theo bảng so sánh đã lưu.

Xem thêm [phân tích lỗi](reports/error_analysis.md), [metrics từng lớp VALID](reports/per_class_metrics_valid.csv), [metrics từng lớp TEST](reports/per_class_metrics_test.csv) và [biểu đồ](reports/figures/).

## Giao tiếp với phần của member2

Hàm `detect_ingredients(image, conf=0.25, iou=0.5)` trong `core/detector.py` nhận đường dẫn ảnh hoặc ảnh PIL và trả về dữ liệu có cấu trúc:

```json
{
  "ingredients": [
    {"name": "tomato", "confidence": 0.95, "count": 2}
  ]
}
```

Đây là ví dụ định dạng đầu ra. `name` là tên lớp tiếng Anh, `confidence` là độ tin cậy lớn nhất trong các đối tượng cùng lớp, `count` là số đối tượng phát hiện của lớp đó; không phải khối lượng hoặc định lượng nấu ăn.

Trong bản tích hợp trên main, detector được đặt tại `app/core/detector.py`, checkpoint tại `app/models/best.pt` và được nối với hệ gợi ý qua adapter của member2. Luồng ảnh/webcam yêu cầu người dùng kiểm tra, chỉnh sửa và xác nhận nguyên liệu trước khi gợi ý.

## Prototype và giới hạn

Có thể mở prototype của nhánh CV bằng:

```powershell
.\.venv\Scripts\python.exe -m streamlit run app.py
```

Prototype dùng công thức mẫu để thử luồng nhận diện; hướng dẫn sản phẩm đầy đủ nằm trong [README tổng trên main](https://github.com/dohoangphuc2006/SmartKitchen/blob/main/README.md).

Mô hình chỉ nhận diện 30 lớp đã huấn luyện; ảnh tối, đối tượng nhỏ hoặc bị che và nền phức tạp có thể gây bỏ sót hoặc nhầm lớp. Số liệu VALID/TEST ở trên thuộc dataset Fridge Detection, chưa phải đánh giá trên bộ ảnh bếp thực tế độc lập. Nhận diện ảnh/webcam của bản tích hợp vẫn là chức năng thử nghiệm cần xác nhận thủ công.
