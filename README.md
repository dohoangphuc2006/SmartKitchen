# Chạy Smart Kitchen trên Windows

1. Dùng bản cục bộ **release/Smart_Kitchen_Final_Windows.zip** hoặc **nghiemthu.zip** đã cập nhật. Giải nén toàn bộ vào một thư mục có quyền ghi.
2. Cài **CPython 3.14 x64** nếu cần. Môi trường đã kiểm thử là **Windows 11 x64, CPython 3.14.3**. Chọn Windows installer (64-bit). [Tải Python 3.14.3](https://www.python.org/downloads/release/python-3143/)
3. Mở thư mục đã giải nén và chạy **RUN_ME_FIRST.cmd**. Lần cài đầu cần Internet để tải thư viện gợi ý món và YOLO từ PyPI, có thể mất vài phút. Script kiểm tra SHA-256 của gói và tạo môi trường ảo cục bộ. Nếu đã có bản nhập tay cũ, vẫn chạy bước này để bổ sung thư viện nhận diện.
4. Đợi dòng **Application startup complete**, rồi mở **http://127.0.0.1:8000/**. Nhập **trứng, cà chua, hành lá**, bấm **Gợi ý món ăn** và chọn **Xem công thức**.
5. Giữ cửa sổ server mở khi sử dụng. Bấm **Ctrl+C** để dừng. Chạy **Start_Smart_Kitchen.cmd** để mở lại sau khi đã cài.
6. Bên cạnh ô nhập nguyên liệu có nút **Ảnh** và **Camera**. Bấm **Ảnh** để tải ảnh rồi phân tích; bấm **Camera** và cấp quyền để xem nhận diện trực tiếp hoặc chụp khung hình. Kiểm tra, sửa và xác nhận nguyên liệu trước khi gợi ý món.

Nếu muốn cài và chạy riêng từng bước, mở PowerShell tại thư mục giải nén.

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup_env.ps1
.\Start_Smart_Kitchen.cmd
~~~

Bản Windows dùng pantry nhập thủ công, danh mục và chi tiết công thức VI/EN. Hệ thống có Stage 5 mặc định, TF-IDF, LSA và gợi ý hai tầng. Artifact đã fit, dữ liệu và bản dịch nằm trong ZIP. Sau khi cài, việc gợi ý và đọc công thức chạy cục bộ.

**Ảnh / Webcam — Thử nghiệm, đang phát triển:** bản cục bộ ngày 23/11/2026 bật `--profile recipe --with-yolo` và kèm checkpoint hiện có. Hai chức năng đã triển khai bước đầu, chưa hoàn thiện về chất lượng nhận diện; có thể nhận nhầm hoặc bỏ sót. Người dùng phải kiểm tra và xác nhận kết quả. Việc bật lại không đồng nghĩa mô hình đã cải thiện hoặc đạt nghiệm thu độ chính xác. Xem [hướng dẫn và phạm vi kiểm thử ảnh/webcam](docs/VISION_EXPERIMENTAL.md).

- [Kịch bản trình diễn](START_HERE.md)
- [Xử lý lỗi và kiểm tra checksum ZIP](docs/TROUBLESHOOTING.md)
- [Phương pháp ML](docs/ML_METHODS.md) và [giới hạn kiểm thử](docs/EVALUATION_RESULTS.md)
- [Manifest SHA-256 của payload](release/SHA256_MANIFEST.json)

**Trạng thái phát hành:** ZIP kiểm định cục bộ đang chờ xác nhận quyền chia sẻ dữ liệu, model và mã nguồn. Chưa có Release asset đã tải lên và xác minh trên GitHub. Owner xem quy trình và điều kiện chia sẻ trước khi phát hành. [Hướng dẫn phân phối](docs/DISTRIBUTION.md)
