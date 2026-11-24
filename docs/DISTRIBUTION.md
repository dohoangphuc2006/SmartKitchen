# Quyền chia sẻ và GitHub Releases

ZIP là bản kiểm định cục bộ. Chưa có xác nhận quyền chia sẻ cần thiết để gửi gói cho giảng viên, tải lên kho riêng tư hoặc công khai trên GitHub.

| Tài sản | Bằng chứng hiện có và điều kiện chia sẻ |
| --- | --- |
| Catalog và văn bản hướng dẫn tiếng Anh | Mirror tự khai báo CC BY-SA 3.0. Catalog có nội dung từ Epicurious. Hồ sơ V6 chưa xác nhận người đăng có quyền cấp phép lại phần văn bản cần chia sẻ. Cần xác minh quyền cho phạm vi nộp bài và cho phạm vi công khai nếu dự kiến công khai. Giữ attribution, revision, ghi nhận thay đổi và các điều khoản áp dụng. Catalog là tài sản bắt buộc. |
| Pantry, ánh xạ, cấu hình và văn bản VI | Gồm dữ liệu dẫn xuất và phần nhóm biên soạn. Cần xác nhận quyền từ người đóng góp và điều khoản áp dụng với dữ liệu dẫn xuất. Các bản dịch tự động giữ trạng thái **auto_unreviewed**. |
| Artifact TF-IDF/LSA và metadata | Có SHA-256, metadata và checksum của đầu vào fit. Chưa có xác nhận điều khoản chia sẻ từ bên có quyền. Cả hai tệp đều cần để chạy TF-IDF và LSA. |
| Mã dự án, giao diện và tài liệu | Hồ sơ V6 chưa kèm giấy phép phát hành mã. Cần xác nhận quyền của các tác giả cho đối tượng dự kiến nhận. |
| Checkpoint YOLO | Hồ sơ V6 chưa xác nhận quyền chia sẻ checkpoint hay dữ liệu liên quan. Bản cục bộ ngày 23/11/2026 đưa checkpoint hiện có vào ZIP để thử nghiệm ảnh/webcam theo yêu cầu chủ dự án. Việc đóng gói cục bộ không phải xác nhận quyền phân phối hoặc kết luận nghiệm thu chất lượng nhận diện. |

Nhãn giấy phép của mirror là thông tin do bên đăng khai báo. Nguồn đối chiếu gồm metadata của snapshot, dataset gốc, mirror và văn bản giấy phép. [Metadata V6](../app/data/recipes_raw/SOURCE.json) · [Kaggle](https://www.kaggle.com/datasets/pes12017000148/food-ingredients-and-recipe-dataset-with-images) · [Mirror Hugging Face](https://huggingface.co/datasets/Hieu-Pham/kaggle_food_recipes) · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

| Phạm vi | Hiện trạng |
| --- | --- |
| Kiểm định nội bộ trong workspace | Đã dùng bản sao V6 theo chỉ thị của Owner. |
| Gửi riêng cho giảng viên | Chờ xác nhận quyền chia sẻ các tài sản trong ZIP. |
| Repository/Release private | Chờ xác nhận quyền tải tài sản lên GitHub và chia sẻ với đúng người nhận. |
| Repository/Release công khai | Chờ quyền phân phối công khai và điều khoản phát hành. |

## Đính kèm gói vào Release sau khi được duyệt

1. Chọn repository phù hợp với phạm vi chia sẻ. Chỉ đưa README và tài sản đã được duyệt vào Git. Với repository private, cấp quyền cho tài khoản giảng viên trước khi gửi link.
2. Tạo Release với tag dự kiến **2026-11-18-v6-windows**. Đính kèm riêng **Smart_Kitchen_Final_Windows.zip** và **Smart_Kitchen_Final_Windows.zip.sha256** từ **release/**. Quy tắc bỏ qua ZIP trong Git áp dụng cho commit. Dùng phần **Assets** của Release để tải tệp nhị phân lên mà không cần đưa ZIP vào Git.
3. Tải lại ZIP từ **Assets** bằng quyền truy cập tương đương tài khoản giảng viên. So SHA-256 với bản đã kiểm định. Gửi link Release thực và tên ZIP. GitHub tạo thêm các archive **Source code** khi tạo tag.

GitHub cho phép mỗi Release asset dưới 2 GiB. ZIP này nằm dưới giới hạn đó. Khi thêm tệp vào repository bằng trình duyệt, giới hạn là 25 MiB. Artifact NPZ 88,49 MiB cũng vượt ngưỡng cảnh báo Git 50 MiB và nằm dưới ngưỡng chặn 100 MiB. **Code → Download ZIP** chưa được kiểm chứng là bản Windows đầy đủ. [Giới hạn GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) · [Giới hạn tệp Git](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
