# Xử lý lỗi trên Windows

| Hiện tượng | Cách xử lý |
| --- | --- |
| Thiếu Python hoặc sai phiên bản | Cài CPython 3.14 x64 theo README và mở lại PowerShell. Nếu môi trường ảo đã được tạo bằng phiên bản khác, đổi tên thư mục **.venv** cũ rồi chạy setup. |
| Lỗi pip hoặc máy chưa có mạng | Cần kết nối tới **pypi.org** và **files.pythonhosted.org** trong lần cài đầu. Bật kết nối hoặc dùng mạng cho phép PyPI rồi chạy lại setup. Xem lỗi pip trong cửa sổ cài nếu lỗi lặp lại. |
| Thiếu model, dataset hoặc tệp sai SHA-256 | Kiểm tra SHA-256 ZIP, tải lại tệp đính kèm trong **Assets** nếu cần và giải nén toàn bộ vào thư mục mới. |
| Lỗi đường dẫn hoặc quyền ghi | Giải nén bằng **Extract All** vào thư mục cục bộ có quyền ghi. Đường dẫn Unicode có khoảng trắng đã được thử trên Windows. Nếu chương trình giải nén báo đường dẫn quá dài, thử thư mục ngắn hơn. |
| Cổng 8000 bận | Dùng lệnh đổi cổng bên dưới hoặc bấm Ctrl+C trong cửa sổ Smart Kitchen do bạn mở. |
| CMD hỏi Terminate batch job khi dừng | Gõ Y rồi Enter. Sau đó có thể chạy Start_Smart_Kitchen.cmd để mở lại. |
| Trình duyệt không kết nối | Giữ cửa sổ server mở. Đợi **Application startup complete** rồi mở đúng URL in trong cửa sổ server. |
| Gợi ý trống | Kiểm tra cách viết tên nguyên liệu và chọn mục cụ thể trong danh mục. Có thể thử thêm nguyên liệu khác. |
| Không thấy nút Ảnh / Camera | Chạy lại RUN_ME_FIRST.cmd để cài thư viện, dừng server cũ và mở Start_Smart_Kitchen.cmd của bản mới. Tải lại trang. Kiểm tra `/api/health`: `model_loaded` phải là `true`. Nếu vẫn `false`, xem lỗi nạp YOLO trong cửa sổ server. |
| Camera bị từ chối hoặc không có thiết bị | Cho phép quyền camera trên localhost, đóng ứng dụng đang chiếm camera; nếu máy không có camera, dùng nút Ảnh. |
| Nhận diện sai hoặc không có kết quả | Chức năng còn thử nghiệm. Đổi ảnh rõ hơn, kiểm tra và sửa nguyên liệu bằng tay trước khi xác nhận. |
| Bước nấu vẫn là tiếng Anh | Một số công thức chưa có bản dịch đủ điều kiện. Hộp thoại cho biết nguồn và trạng thái của nội dung đang hiển thị. |

Đổi cổng khi đã cài xong.

~~~powershell
.\Start_Smart_Kitchen.cmd 8066
~~~

Nếu cài mới và dùng cổng 8066, chạy lệnh dưới đây rồi mở **http://127.0.0.1:8066/**.

~~~powershell
.\RUN_ME_FIRST.cmd 8066
~~~

Để kiểm tra ZIP trước khi giải nén, chạy lệnh dưới đây và đối chiếu kết quả với **Smart_Kitchen_Final_Windows.zip.sha256**.

~~~powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\Smart_Kitchen_Final_Windows.zip
~~~
