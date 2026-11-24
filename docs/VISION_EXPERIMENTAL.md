# Ảnh / Webcam — Thử nghiệm, đang phát triển

Cập nhật ngày 23/11/2026 cho bản nghiệm thu cục bộ.

## Trạng thái chức năng

Hệ thống đã triển khai bước đầu nhận diện nguyên liệu từ ảnh tải lên và webcam bằng YOLO. Chức năng chưa hoàn thiện về chất lượng nhận diện, có thể nhận nhầm hoặc bỏ sót; người dùng cần kiểm tra, sửa và xác nhận nguyên liệu trước khi gợi ý món. Đây là chức năng mở rộng đang phát triển, không được ghi là đã đạt nghiệm thu độ chính xác.

Checkpoint hiện có được giữ nguyên, SHA-256:
`c67106a099bb625912a461eee00fe1e09bda9ea8a7a0f55da34abaace3f7f8cf`.
Không huấn luyện lại hoặc thay mô hình trong lần cập nhật này. Chế độ `fridge30_precision_guard` chỉ đưa ra ứng viên để người dùng xem xét; không tự thêm dự đoán chưa xác nhận vào pantry.

## Cách chạy

1. Chạy `RUN_ME_FIRST.cmd` để cài thư viện của `app/requirements-vision.txt`. Lần cài đầu cần Internet và có thể mất vài phút.
2. Lần sau chạy `Start_Smart_Kitchen.cmd`. Lệnh mặc định là `--profile recipe --with-yolo`.
3. Mở địa chỉ localhost in trong cửa sổ server. Nếu cổng 8000 đang có bản cũ, dừng cửa sổ server cũ bằng Ctrl+C rồi mở lại, hoặc chạy `Start_Smart_Kitchen.cmd 8012`.
4. Nút **Ảnh**: chọn ảnh, phân tích, kiểm tra các ứng viên, chọn **Tôi có…** hoặc nhập/sửa nguyên liệu bằng tay, rồi xác nhận và gợi ý món.
5. Nút **Camera**: cấp quyền, xem khung hình trực tiếp, chụp khung hình để phân tích. Camera dừng sau khi chụp; nút **Tắt camera** và thao tác đóng hộp thoại cũng giải phóng camera.

`/api/health` phải trả `model_loaded: true`; `/api/config` phải có `image_detection_available: true`. Nếu không, xem lỗi nạp model và chạy lại bộ cài. Không chỉ gỡ thuộc tính ẩn của nút để giả lập tính khả dụng.

## Kiểm thử kỹ thuật ngày 23/11/2026

| Hạng mục | Kết quả và phạm vi |
| --- | --- |
| Môi trường | Cài bổ sung thư viện vào `.venv` của bản nghiệm thu; `pip check` đạt. |
| Khởi động | Nạp checkpoint thật; health xác nhận model và bộ gợi ý đã nạp. |
| Bản ZIP giải nén | Kiểm tra manifest/SHA-256; nạp model từ thư mục giải nén và phân tích ảnh thật bằng môi trường đã cài: đạt. |
| Ảnh trên Chrome | Tải một ảnh có sẵn từ Fridge VALID qua giao diện; API YOLO thật trả HTTP 200 và 15 ứng viên để xem xét. Đây là kiểm thử tích hợp, không phải bộ đo độ chính xác độc lập. |
| Xác nhận nguyên liệu | Ảnh không tự thêm nguyên liệu vào pantry. Thử chọn ứng viên, xóa/sửa, nhập thêm trứng/cà chua/hành lá, gợi ý món và mở chi tiết: đạt. |
| Webcam trên Chrome | Dùng thiết bị camera giả lập của Chrome; gửi frame qua YOLO thật, chụp và phân tích ảnh, mở lại và tắt camera: đạt. |
| Lỗi camera | Giả lập từ chối quyền và không có thiết bị: hiện thông báo, vẫn cho dùng ảnh tải lên. |
| Nhãn thử nghiệm | Hiển thị ở trang chính và hộp thoại camera; đổi VI/EN đạt. |
| Kiểm thử hiện có | 15 ca điều khiển camera, 7 ca xử lý yêu cầu bất đồng bộ, 4 nhóm hồi quy giao diện và 9 ca Python kiểm bộ chạy: đạt. |

Khi mở lại camera quá nhanh, API frame có thể trả HTTP 429 để giới hạn tần suất; đây là hành vi được xử lý bằng chờ/thử lại. Lượt kiểm thử không ghi nhận lỗi JavaScript chưa xử lý.

Script kiểm thử mới: `release/verify_vision.cjs`. Bằng chứng trong workspace: `reports/nghiemthu_vision_20261123/vision-browser.json`, ảnh chụp giao diện và nhật ký server. Báo cáo cũ ngày 18/11 thuộc bản Recipe chỉ nhập tay.

## Giới hạn còn lại

- Chưa kiểm tra webcam vật lý trong lượt này. Cần thử trên máy sẽ trình diễn và cấp quyền camera.
- Chưa đánh giá độ chính xác trên bộ ảnh độc lập mới; không suy ra accuracy từ kết quả kiểm thử chức năng.
- Chưa thực hiện cài sạch trên một máy Windows khác. Bộ cài trong gói đã được cập nhật để tải đủ thư viện.
- Việc đóng gói cục bộ không tự xác nhận quyền phân phối các tài sản; hồ sơ quyền hiện có được giữ tại `DISTRIBUTION.md`.
