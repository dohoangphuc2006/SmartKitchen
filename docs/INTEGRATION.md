# Kiểm tra bản gộp hai thành viên

Ngày kiểm tra: 24/11/2026. Nhánh cục bộ: `codex/integrate-members`.

Bản tích hợp kết hợp ứng dụng FastAPI của member2 với đầy đủ mã kiểm định, huấn luyện, đánh giá, báo cáo và prototype CV của member1. Các kiểm tra dưới đây xác nhận ứng dụng chạy trên máy đang thử nghiệm; chưa phải phép đo độ chính xác nhận diện hay chất lượng gợi ý trên dữ liệu mới.

## Nguồn và giải quyết xung đột

- `main`: `bde93193445ac589df616a39ac7ff1957c2956a3`.
- `member-1-cv`: `91b995eb1feac79b2eee6f1b36bff20e10a7b17b`, đã là tổ tiên của main.
- `member-2-recsys`: `55718094dc23113947105c51d7e7bfc4fb9f24e5`.
- Giữ nguyên mã ứng dụng trong `app/` từ member2.
- Giữ nguyên `cv/`, `train.py`, `reports/`, `core/`, `app.py`, `models/`, `data/`, `requirements.txt` và `data_checked.yaml` từ main.
- Giải quyết xung đột README bằng hướng dẫn tổng hợp; giữ `app.py` và `core/llm.py` theo main.
- Bổ sung quy tắc bỏ qua dữ liệu sinh ra khi chạy CV; mở rộng bộ đóng gói để giữ cả phần công việc của member1.
- Hai checkpoint `models/best.pt` và `app/models/best.pt` có cùng SHA-256: `c67106a099bb625912a461eee00fe1e09bda9ea8a7a0f55da34abaace3f7f8cf`.

## Môi trường và kết quả

Windows x64, CPython **3.14.0**, môi trường `.venv` riêng. Cài theo `app/requirements-vision.txt` và `app/requirements-dev.txt`; `pip check` không phát hiện xung đột phụ thuộc. Chrome headless 158 được dùng cho kiểm thử trình duyệt.

| Kiểm tra | Kết quả |
|---|---|
| Python unittest | 53/53 đạt, không bỏ qua |
| JavaScript | 13/13 tệp kiểm thử đạt |
| Khởi động với `--profile recipe --with-yolo` | `/api/health` xác nhận đã nạp model và hệ gợi ý |
| Gợi ý qua HTTP | 9/9 tổ hợp: 3 pantry × Stage 5, TF-IDF, LSA |
| Chi tiết công thức | HTTP thành công cho công thức lấy từ kết quả gợi ý |
| Ảnh và khung hình camera | API phân tích bằng YOLO thật thành công |
| Trình duyệt chế độ recipe | Thêm/xóa nguyên liệu, ba phương pháp, kết quả hai tầng, công thức VI/EN và fallback đạt |
| Trình duyệt có YOLO | Tải ảnh thật, xác nhận/sửa nguyên liệu, gợi ý và mở công thức đạt |
| Camera giả lập Chrome | Nhận diện trực tiếp, chụp, mở lại, dừng và xử lý lỗi quyền/thiếu thiết bị đạt |

Kịch bản `release/verify_browser.cjs` dành cho chế độ recipe **không bật YOLO**; kịch bản `release/verify_vision.cjs` dành cho chế độ **có YOLO**. Lượt gọi kịch bản recipe trên chế độ có YOLO ban đầu không khớp điều kiện giao diện; lượt chạy đúng chế độ đã đạt. Lượt unittest trong sandbox gặp lỗi thư mục tạm; chạy lại ngoài sandbox đạt cả 53 ca, không sửa mã ứng dụng để bỏ qua lỗi kiểm thử.

Nhật ký cục bộ được giữ trong `.verification/`: `python-tests-elevated.log`, `javascript-results.json`, `server.log`, `verify_recipe_browser/browser.json` và `verify_vision/vision-browser.json`. Thư mục này không được đưa vào Git hoặc ZIP.

## Chạy lại kiểm tra

Cài thêm thư viện kiểm thử, sau đó chạy Python từ thư mục `app` để chọn đúng package `core` của ứng dụng:

```powershell
.\.venv\Scripts\python.exe -X utf8 -m pip install -r app/requirements-dev.txt
Push-Location app
..\.venv\Scripts\python.exe -B -X utf8 -m unittest discover -s tests -p 'test_*.py' -v
Get-ChildItem tests/test_*.cjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw $_.Name } }
Pop-Location
```

## Phạm vi còn lại

Chưa thử webcam vật lý, chưa huấn luyện lại YOLO, chưa chạy lại prototype Streamlit và chưa đánh giá độ chính xác trên bộ ảnh độc lập. Bản tích hợp hiện chỉ được lưu trên nhánh thử nghiệm cục bộ; main và GitHub chưa được cập nhật. Các biên bản cũ trong `release/evidence/` và tài liệu V6 thuộc bản phát hành lịch sử, không phải chứng cứ cho ZIP mới tạo từ nhánh này.
