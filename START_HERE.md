# Trình diễn Smart Kitchen

1. Dùng máy **Windows x64** có **CPython 3.14 x64** và kết nối Internet cho lần cài đầu. Giải nén ZIP vào thư mục có quyền ghi.
2. Chạy **RUN_ME_FIRST.cmd**. Sau khi thấy **Application startup complete**, mở **http://127.0.0.1:8000/**. Lần sau chạy **Start_Smart_Kitchen.cmd**.
3. Nhập **trứng, cà chua, hành lá**, bấm **+ Thêm** rồi **Gợi ý món ăn**. Xem danh sách **Có thể nấu ngay** và **Cần bổ sung**. Gợi ý kiểm tra loại nguyên liệu và vẫn cần người dùng đối chiếu đủ định lượng.
4. Trong **Cách gợi ý món ăn**, lần lượt chọn **Mặc định** (Stage 5), **Theo nguyên liệu tương đồng** (TF-IDF) và **Khám phá món liên quan** (LSA). Bấm **Gợi ý món ăn** sau mỗi lần đổi.
5. Bấm **Xem công thức**, rồi thử **Tiếng Việt → English → Tiếng Việt** trong hộp thoại. Công thức thiếu bản dịch đủ điều kiện giữ nội dung gốc tiếng Anh. Bản dịch tự động có nhãn trạng thái.
6. Thử xóa một nguyên liệu hoặc thay pantry bằng **thịt heo xay** để xem nguyên liệu cần bổ sung. Bấm **Ctrl+C** trong cửa sổ server để dừng.

## Ảnh và webcam thử nghiệm

1. Chạy bộ cài một lần nếu đang nâng cấp từ bản chỉ nhập tay. Khởi động lại bằng **Start_Smart_Kitchen.cmd** rồi tải lại trang.
2. Bấm **Ảnh** bên cạnh ô nhập nguyên liệu, chọn ảnh JPG/PNG/WEBP rồi bấm **Phân tích ảnh**.
3. Kiểm tra các gợi ý nhận diện, sửa/xóa kết quả sai, thêm nguyên liệu bị bỏ sót và xác nhận trước khi gợi ý món.
4. Bấm **Camera**, cho phép trình duyệt truy cập camera. Có thể xem khung nhận diện trực tiếp hoặc bấm **Chụp khung hình** rồi phân tích ảnh chụp. Bấm **Tắt camera** hoặc đóng hộp thoại để dừng.
5. Giới thiệu rõ: **đây là chức năng thử nghiệm đang phát triển, chưa hoàn thiện về độ chính xác**. Không coi việc xuất hiện khung nhận diện là bằng chứng kết quả đúng.

Dùng địa chỉ localhost in trong cửa sổ server. Camera vật lý cần được thử trên máy trình diễn; nếu không có camera hoặc bị từ chối quyền, vẫn có thể dùng ảnh tải lên.

Khi thiếu Python, cài thất bại, cổng bận hoặc trang chưa mở được, xem [Xử lý lỗi](docs/TROUBLESHOOTING.md). Các bước cài riêng có trong [README](README.md).
