# Smart Kitchen & Pantry Assistant

Bài tập lớn môn **Học máy và ứng dụng**, Trường Đại học Văn Lang.
Đề tài: **Hệ thống gợi ý món ăn và công thức từ nguyên liệu cung cấp sẵn có**.

Smart Kitchen hỗ trợ nhập nguyên liệu Việt–Anh, nhận diện ảnh/webcam thử nghiệm, gợi ý món và xem công thức song ngữ. Người dùng kiểm tra và xác nhận nguyên liệu trước khi gợi ý.

## Thành viên

| Thành viên | MSSV | Phần phụ trách |
|---|---|---|
| Đỗ Hoàng Phúc | 2474802010313 | Dữ liệu ảnh, kiểm định, huấn luyện, đánh giá YOLO và module nhận diện |
| Huỳnh Hữu Phúc | 2474802010314 | Dữ liệu công thức, chuẩn hóa, hệ gợi ý, API và giao diện tích hợp |

## Chạy ứng dụng trên Windows

Yêu cầu **CPython 3.14 x64** và Internet ở lần cài đầu. Clone nhánh chính:

```powershell
git clone --branch main https://github.com/dohoangphuc2006/SmartKitchen.git smartkitchen_app
cd smartkitchen_app
```

Nếu tải ZIP mã nguồn từ GitHub, giải nén toàn bộ rồi mở thư mục dự án.

1. Chạy `RUN_ME_FIRST.cmd` để kiểm tra gói, tạo `.venv`, cài thư viện và khởi động.
2. Lần sau chạy `Start_Smart_Kitchen.cmd`.
3. Đợi `Application startup complete`, mở <http://127.0.0.1:8000/>.
4. Nhập **trứng, cà chua, hành lá**, chọn **Gợi ý món ăn**, rồi **Xem công thức**.
5. Với **Ảnh** hoặc **Camera**, kiểm tra và xác nhận nguyên liệu trước khi gợi ý.
6. Giữ cửa sổ server mở khi sử dụng; nhấn `Ctrl+C` để dừng.

Nếu cổng 8000 đang bận, chạy `Start_Smart_Kitchen.cmd 8012` rồi mở <http://127.0.0.1:8012/>.

Lệnh tương đương sau khi cài môi trường:

```powershell
.\.venv\Scripts\python.exe -B -s -X utf8 app/run_app.py --profile recipe --with-yolo
```

Xem [hướng dẫn sử dụng](docs/USER_GUIDE.md), [xử lý lỗi](docs/TROUBLESHOOTING.md), [kịch bản demo](START_HERE.md).

## Luồng hoạt động

```text
Nhập nguyên liệu / ảnh / webcam
            ↓
Kiểm tra và xác nhận nguyên liệu
            ↓
Chuẩn hóa tên Việt–Anh
            ↓
Stage 5 (mặc định) / TF-IDF / LSA
            ↓
Có thể nấu ngay / Cần bổ sung
            ↓
Chi tiết công thức Việt–Anh
```

Stage 5 xếp hạng theo luật và trọng số; TF-IDF dùng tương đồng cosine; LSA dùng không gian giảm chiều để thử nghiệm món liên quan. Điều kiện phân hai tầng được kiểm tra riêng với bước xếp hạng. Xem [phương pháp](docs/ML_METHODS.md).

## Cấu trúc bản tích hợp

| Đường dẫn | Nội dung |
|---|---|
| `app/backend/`, `app/frontend/` | API FastAPI và giao diện HTML/CSS/JS |
| `app/core/`, `app/src/` | Detector được tích hợp, chuẩn hóa và hệ gợi ý |
| `app/config/`, `app/mapping/`, `app/processed/` | Cấu hình, ánh xạ và dữ liệu công thức |
| `app/models/` | YOLO, artifact TF-IDF/LSA dùng trong ứng dụng |
| `app/run_app.py`, `app/tests/` | Khởi động ứng dụng chính và kiểm thử |
| `cv/`, `train.py`, `reports/` | Kiểm định, huấn luyện, đánh giá và báo cáo CV của member1 |
| `models/best.pt` | Checkpoint bàn giao của member1 |
| `app.py`, `core/`, `data/` | Prototype Streamlit của member1 |
| `docs/`, `release/` | Tài liệu và gói Windows |

Hai tệp `app/models/best.pt` và `models/best.pt` giống nhau tại thời điểm tích hợp. Huấn luyện CV ở thư mục gốc không tự thay model của ứng dụng trong `app/`.

## Dữ liệu và kết quả

- Ảnh: [Fridge Detection v1](https://universe.roboflow.com/fridge-ydzni/fridge-detection-es0ja/dataset/1), 3.148 ảnh, 30 lớp. Dataset ảnh tải riêng.
- Catalog: 13.501 công thức; artifact TF-IDF/LSA fit từ 13.489 công thức. Xem [nguồn dữ liệu](app/processed/SOURCE_STAGE2.md).
- Model chọn theo mAP@0.5:0.95 trên VALID: **YOLOv8n (`baseline_v8n`)**.

| Tập | Precision | Recall | mAP@0.5 | mAP@0.5:0.95 |
|---|---:|---:|---:|---:|
| VALID | 0.9389 | 0.9435 | 0.9690 | 0.6464 |
| TEST | 0.8953 | 0.8888 | 0.9394 | 0.6545 |

Nguồn: [metrics](reports/metrics.json), [so sánh mô hình](reports/model_comparison.csv), [phân tích lỗi](reports/error_analysis.md). Kết quả trên dataset chưa chứng minh chất lượng nhận diện ảnh bếp thực tế độc lập.

## Tái lập phần Computer Vision

Hướng dẫn chuyên môn đầy đủ nằm trong [README riêng của member1](https://github.com/dohoangphuc2006/SmartKitchen/blob/member-1-cv/README.md), gồm kiểm định dữ liệu, cấu hình huấn luyện, so sánh hai model và định dạng đầu ra detector.

Đặt dataset `SmartKitchen/` cạnh thư mục dự án, gồm `train/`, `valid/`, `test/`, `data.yaml`. Dùng môi trường CV riêng với `requirements.txt`; script huấn luyện hiện dùng GPU NVIDIA (`device=0`).

```powershell
python -m pip install -r requirements.txt
python cv/audit_dataset.py
python train.py --model yolov8n.pt --name baseline_v8n --epochs 30
python train.py --model yolov8s.pt --name ingredients --epochs 30
python cv/evaluate.py
python -m core.detector duong_dan_anh.jpg
```

Luôn chạy audit trước để tạo lại đường dẫn trong `data_checked.yaml` và danh sách ảnh cho máy hiện tại. Audit/evaluate cập nhật `reports/`; kết quả đã nộp được lưu trong Git. Dataset và `runs/` không được đưa lên Git.

Prototype cũ chạy bằng `streamlit run app.py` trong môi trường CV. FastAPI là ứng dụng chính của nhóm.

## Giới hạn và kiểm thử

- Nhận diện ảnh/webcam còn thử nghiệm, cần người dùng xác nhận.
- “Có thể nấu ngay” chưa xác nhận đầy đủ lượng nguyên liệu thực tế.
- Chưa đủ cơ sở kết luận Stage 5, TF-IDF hay LSA tốt nhất với người dùng.
- [Kết quả kiểm thử lịch sử](docs/EVALUATION_RESULTS.md), [ảnh/webcam](docs/VISION_EXPERIMENTAL.md), [kiểm tra bản gộp](docs/INTEGRATION.md).

Bản tích hợp đã được kiểm tra trên Windows với Python 3.14.0: **53/53 ca Python, 13/13 nhóm JavaScript**, 9 tổ hợp truy vấn gợi ý qua HTTP và hai kịch bản Chrome đều đạt. Kịch bản ảnh/webcam dùng YOLO thật và camera giả lập; chưa thử webcam vật lý hoặc đo độ chính xác trên bộ ảnh độc lập mới.

## Nhánh phát triển và đóng gói

- [main](https://github.com/dohoangphuc2006/SmartKitchen/tree/main): mã nguồn tích hợp của cả nhóm, hướng dẫn chạy và kết quả chính.
- [member-1-cv](https://github.com/dohoangphuc2006/SmartKitchen/tree/member-1-cv): phần Computer Vision và README chuyên môn của Đỗ Hoàng Phúc.
- [member-2-recsys](https://github.com/dohoangphuc2006/SmartKitchen/tree/member-2-recsys): phần hệ gợi ý và ứng dụng của Huỳnh Hữu Phúc.

Sau khi thay đổi tệp thuộc gói Windows, chạy `python release/build_windows_release.py` để tạo lại manifest và ZIP trước khi dùng bộ cài kiểm tra checksum. Các biên bản lịch sử không tự áp dụng cho ZIP mới. Xem [thông tin phân phối](docs/DISTRIBUTION.md).
