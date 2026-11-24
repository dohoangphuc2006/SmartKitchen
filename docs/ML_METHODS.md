# Dữ liệu và phương pháp gợi ý

## Dữ liệu và tiền xử lý

Nguồn là snapshot được ghim của **Food Ingredients and Recipes Dataset with Images**, do Sakshi Goel và cộng tác viên đăng trên Kaggle, có nội dung nguồn Epicurious và bản sao Hieu-Pham trên Hugging Face. Gói dùng dữ liệu văn bản đã xử lý cục bộ. Tiền xử lý tách định lượng/đơn vị/mô tả, chuẩn hóa tên, tách một số cụm gồm nhiều nguyên liệu, phân loại ghi chú/dụng cụ và gắn cờ các mục cần rà soát. Các trường nguồn được giữ để hiển thị chi tiết và truy vết. Xem [ghi nhận dữ liệu](../app/processed/SOURCE_STAGE2.md) và [metadata nguồn](../app/data/recipes_raw/SOURCE.json).

Danh mục pantry dùng tên chuẩn cùng bí danh tiếng Việt và tiếng Anh. Nguyên liệu chỉ được xem là có sẵn khi luồng pantry xác nhận. Năm gia vị nền được người dùng chọn riêng.

## Mặc định Stage 5

`final` dùng luật xếp hạng có trọng số cho tỷ lệ khớp công thức, Jaccard, cosine nhị phân, tỷ lệ nguyên liệu pantry được dùng và hình phạt thiếu nguyên liệu. Trọng số lần lượt là 0,35 / 0,20 / 0,20 / 0,25, với hình phạt 0,15 × tỷ lệ thiếu. Cấu hình baseline dùng ngưỡng khớp 25%. Luồng hai tầng áp dụng thêm điều kiện đủ nguyên liệu, độ tin cậy chuẩn hóa và độ liên quan.

## TF-IDF và LSA

- `ml_tfidf` dùng token nguyên liệu chuẩn, TF nhị phân, IDF có smoothing và chuẩn hóa L2. Cosine similarity là tích vô hướng của hai vector đã chuẩn hóa, dùng để so mức tương đồng pantry với công thức.
- `ml_lsa` chiếu vector TF-IDF qua Randomized Truncated SVD thành 100 chiều rồi tính cosine trong không gian giảm chiều. LSA có thể gợi ý quan hệ đồng xuất hiện giữa nguyên liệu. Metadata ghi 13.489 công thức fit, 27.431 token và tỷ lệ phương sai giải thích khoảng 19,21%.
- Cả hai chế độ dùng chung `recipe_tfidf_lsa_v1.npz`. Lần gọi ML đầu kiểm tra hash artifact và 4 đầu vào fit so với metadata. Suy luận sử dụng NumPy và artifact cục bộ. Scripts huấn luyện chỉ phục vụ đối chiếu học thuật.

## Hai tầng gợi ý

- **Có thể nấu ngay** (`CAN_COOK_NOW`) yêu cầu đủ nguyên liệu bắt buộc theo inventory và các điều kiện về dụng cụ, độ tin cậy của dữ liệu và khớp tên. Nhãn áp dụng theo dữ liệu đã chuẩn hóa.
- **Cần bổ sung** (`NEEDS_ADDITIONAL_INGREDIENTS`) hiển thị công thức có liên quan, kèm nguyên liệu có và còn thiếu. Một số món hợp lệ của tầng này có thể dưới ngưỡng 25% của baseline nếu vượt qua bộ lọc liên quan.
- Việc xếp hạng theo phương pháp được chọn không thay đổi các điều kiện để gắn nhãn sẵn sàng. Số lượng nguyên liệu và khả năng nấu thực tế vẫn cần người dùng đối chiếu.
