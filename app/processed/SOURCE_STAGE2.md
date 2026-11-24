# Nguồn và ghi nhận thay đổi

Các file derived ở thư mục này được tạo từ **Food Ingredients and Recipes Dataset with Images**, do Sakshi Goel và cộng tác viên công bố trên Kaggle, nội dung nguồn Epicurious. Bản tải được phân phối qua Hieu-Pham trên Hugging Face.

- Nguồn: https://www.kaggle.com/datasets/pes12017000148/food-ingredients-and-recipe-dataset-with-images
- Mirror: https://huggingface.co/datasets/Hieu-Pham/kaggle_food_recipes
- Revision: `3bc17b74f8c75ff65e9045074f0f30885bda0c95`
- License nguồn công bố: **CC BY-SA 3.0**, https://creativecommons.org/licenses/by-sa/3.0/
- Các phần nội dung derived từ dataset được cung cấp theo cùng CC BY-SA 3.0; nguồn không xác nhận hay bảo trợ các thay đổi này.

Thay đổi trong Giai đoạn 2: thêm trường derived, tách quantity/unit/description, chuẩn hóa tên bằng quy tắc tường minh, tách một số cụm nhiều nguyên liệu rõ nghĩa, phân loại ghi chú/dụng cụ và thêm cờ cần rà soát. Các cột nguồn vẫn được giữ nguyên. Đây không phải dữ liệu đã kiểm chứng ngữ nghĩa hoàn hảo.

`recipes_cleaning_stage2.csv` là bản sao byte-for-byte để đọc khi xử lý. `recipes_cleaned.csv` giữ raw và derived. `ingredient_details.csv` lưu lineage từng thành phần; `ingredient_vocabulary.csv` có cả các tên còn `review_required=True`. Xem `stage2_manifest.json` để đối chiếu checksum nguồn, mã xử lý, quy tắc và output.
