# Kết quả kiểm thử kỹ thuật

**Cập nhật phạm vi ngày 23/11/2026:** bản cục bộ đã bổ sung ảnh/webcam thử nghiệm. Bảng bên dưới là kết quả lịch sử của bản Recipe ngày 18/11, không phải kết luận chất lượng nhận diện cho bản mới. Xem [biên bản bật chức năng ảnh/webcam](VISION_EXPERIMENTAL.md).

Kiểm thử ngày 18/11/2026 trên Windows 11 x64 với CPython 3.14.3 và Chrome headless. Gói được giải nén vào thư mục Unicode có khoảng trắng. Windows PowerShell xác minh payload, tạo môi trường ảo, tải 21 thư viện đã ghim từ PyPI và chạy pip check. Biên bản của Owner ghi SHA-256 và liên kết nhật ký của ZIP cuối.

| Kiểm thử | Kết quả quan sát |
| --- | --- |
| Cài sạch và khởi động | **PASS** · Setup tạo .venv mới, kiểm tra SHA-256, cài thành công và khởi động app tại localhost. Khi cổng bận, launcher trả mã 3 và phiên server đang chạy tiếp tục phục vụ. |
| Stage 5, TF-IDF, LSA, Two-Tier | **PASS** · 9/9 tổ hợp pantry × phương pháp qua HTTP. Hai phương pháp ML trả đúng version và SHA-256 artifact. Với pantry trứng/cà chua/hành lá, Tầng A có hai công thức và Tầng B có năm. Với riêng thịt heo xay, Tầng A trống. Stage 5 trả đúng một món khi chỉ một công thức đủ điều kiện trong ca kiểm tra đùi gà. |
| Chi tiết công thức VI/EN | **PASS** · API giữ tên, định lượng và hướng dẫn EN theo catalog. Ba công thức có bản dịch giữ nhãn **auto_unreviewed**. Công thức #103 dùng hướng dẫn EN gốc. Chrome kiểm tra tiêu đề, nguyên liệu, bước nấu và nhãn hộp thoại khi đổi VI → EN → VI. |
| Pantry và trình duyệt | **PASS** · Chrome tải giao diện và thực hiện thêm/xóa, chạy ba phương pháp và xem chi tiết. Đầu vào **phieu12** giữ trạng thái chưa nhận diện, API trả **NO_RECOGNIZED_INGREDIENTS**. |
| Khởi động lại | **PASS** · Sau khi dừng server, khởi động mới trên cổng 8066. ID và thứ tự từng tầng trùng nhau ở 9/9 tổ hợp. Kiểm tra file và kết nối trong tiến trình Python ghi nhận runtime đọc dữ liệu, model và cấu hình từ thư mục giải nén. |
| Hồi quy | **PASS** · 52 bài Python đạt, một bài kiểm checkpoint YOLO được bỏ qua theo phạm vi; 13/13 nhóm JavaScript đạt. Harness frontend tự tạo thư mục và ghi báo cáo 10/10. |
| YOLO | **OUT_OF_SCOPE** đối với ZIP Windows Recipe. Checkpoint còn chờ xác minh quyền chia sẻ. Nghiệm thu nhận diện bằng ảnh trên Windows CPU chưa được thực hiện. |

Catalog đã xử lý có 13.501 dòng công thức và 145.024 dòng chi tiết nguyên liệu. Đầu vào fit của artifact có 13.489 công thức. Danh mục pantry có 526 mục trong 12 nhóm.

Human evaluation ở trạng thái **QUALITY_FLAGGED**. Independent holdout ở mức **0/30**. Lựa chọn mô hình ở trạng thái **MODEL_SELECTION_NOT_ESTABLISHED**. Xem [giới hạn học thuật](ACADEMIC_LIMITATIONS.md), [báo cáo bàn giao V6](E2E_VERIFICATION_REPORT.md) và [bảng đối chiếu kỹ thuật V6](VERIFIED_COMPARISON_TABLE.md) để truy vết kết quả lịch sử.
