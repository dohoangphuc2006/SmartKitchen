# Biên bản nghiệm thu Smart Kitchen Windows

**HANDOFF_BLOCKED** · ZIP Recipe đã được chạy trực tiếp trên Windows từ bản giải nén riêng. Gói đang chờ xác nhận quyền chia sẻ và bước xác minh tải từ GitHub Releases. YOLO nằm ngoài phạm vi ZIP này.

## Gói kiểm định cục bộ

| Hạng mục | Giá trị |
| --- | --- |
| ZIP | [Smart_Kitchen_Final_Windows.zip](Smart_Kitchen_Final_Windows.zip) |
| Tag dự kiến | **2026-11-18-v6-windows** |
| Dung lượng ZIP | 34.188.915 byte |
| Dung lượng sau giải nén | 183.797.688 byte, 118 tệp gồm manifest |
| SHA-256 ZIP | **6592d4b4845bec46694bbe929bab2c8b60bf2fcf2f63ff292c668ef6b8d61728** |
| Kiểm kê | [Cây thư mục](TREE.txt) · [Vai trò, kích thước, SHA-256 và quyền chia sẻ từng tệp](FILE_INVENTORY.json) · [Manifest của ZIP](SHA256_MANIFEST.json) |

Kiểm kê đầu vào ghi nhận 126 tệp, 230.968.620 byte. Đã đối chiếu ZIP với nội dung thực của tệp, gồm kiểm tra từng entry và hash khi giải nén. V6 nguồn khớp 146/146 mục của manifest gốc. Checkpoint cục bộ và artifact sản xuất khớp V6 theo SHA-256. [Kiểm kê ban đầu](INITIAL_INVENTORY.json) · [Đối chiếu V6](V6_PROVENANCE.json)

## Mô hình và tài sản dữ liệu

| Tệp model | Byte | SHA-256 | Phạm vi |
| --- | ---: | --- | --- |
| **app/models/recipe_ml/recipe_tfidf_lsa_v1.npz** | 92.791.550 | 3616f73132f4effe2700831d8da5174a39a56fd4ab223737cfc8b49a556d487b | Có trong ZIP. Vocabulary 27.431, IDF, ma trận TF-IDF và 100 LSA components đã fit trên 13.489 công thức. |
| **app/models/recipe_ml/recipe_tfidf_lsa_v1.metadata.json** | 1.704 | 1529682237272954d70ff56034177a556d4a612915bc65bc494b0d9e14ca3cb9 | Có trong ZIP. Version, checksum NPZ và bốn checksum đầu vào fit. |
| **app/models/best.pt** | 6.276.516 | c67106a099bb625912a461eee00fe1e09bda9ea8a7a0f55da34abaace3f7f8cf | Cục bộ, ngoài ZIP. Chờ quyền chia sẻ và nghiệm thu YOLO Windows CPU. |

- **Catalog** gồm **app/processed/recipes_cleaned.csv** với 13.501 công thức và **app/processed/ingredient_details.csv** với 145.024 dòng lineage. **app/processed/ingredient_vocabulary.csv** có 27.929 mục từ vựng cho Stage 3. **SOURCE.json**, **SOURCE_STAGE2.md** và **stage2_manifest.json** ghi snapshot, nguồn và checksum.
- **Pantry và xếp hạng** dùng **pantry_ingredient_catalog.json** với 526 mục/12 nhóm, **pantry_alias_overrides_v1.json**, **ingredient_aliases.json**, hai tệp **ingredient_mapping** CSV/JSON, **yolo_classes.csv**, **recipe_quality_ingredients.json** và **recommendation_config.json**. Recipe pipeline đọc contract lớp và mapping khi khởi tạo.
- **VI/EN** dùng hai CSV **ingredient_display_vi.csv**, **recipe_titles_vi.csv**, cấu hình tiêu đề/hiển thị, các batch **recipe_detail_vi_candidates.json**, **recipe_detail_vi_live_batch.json**, **recipe_detail_vi_phase5_batch.json**, **recipe_detail_vi_v6_batch.json** và hồ sơ biên soạn trong **app/translations/**.

Artifact và dữ liệu Stage 2 gốc trong ZIP dùng nguyên byte. Đợt đóng gói giữ Stage 5 và cơ chế fit của V6. Tệp **recipe_instructions_vi.csv** là cache CSV tùy chọn, vắng cả trong V6. Runtime dùng các JSON batch, dữ liệu nguồn tiếng Anh và cache cục bộ theo yêu cầu. [Phương pháp và provenance](../docs/ML_METHODS.md)

## Cài đặt và sử dụng

Sau khi gói được phép chia sẻ, giải nén toàn bộ vào thư mục cục bộ có quyền ghi. Dùng **Windows x64**, **CPython 3.14 x64** và Internet lần đầu. Chạy **RUN_ME_FIRST.cmd** rồi mở **http://127.0.0.1:8000/** sau khi thấy **Application startup complete**. Sau khi đã cài, dùng **Start_Smart_Kitchen.cmd**. Môi trường kiểm thử là Windows 11 build 26200, CPython 3.14.3 x64, Chrome 157 headless và Node.js 24.16.0 cho harness. [README](../README.md) · [Kịch bản trình diễn](../START_HERE.md) · [Xử lý lỗi](../docs/TROUBLESHOOTING.md)

- **Runtime trực tiếp** gồm fastapi 0.143.0, starlette 1.7.0, pydantic 2.14.1, uvicorn 0.54.0, python-multipart 0.0.32, pillow 12.3.0, pandas 3.0.6, numpy 2.5.4, PyYAML 6.0.3.
- **Runtime bắc cầu** gồm annotated-doc 0.0.6, annotated-types 0.8.0, anyio 4.16.0, click 8.5.1, h11 0.16.0, idna 3.20, opentelemetry-api 1.45.2, pydantic-core 2.50.1, python-dateutil 4.0.0, typing-extensions 4.16.0, typing-inspection 0.4.5, tzdata 2026.6. [Danh sách đã ghim](../app/requirements-recipe.txt)
- **Hồi quy Python** cài thêm httpx 0.28.1, httpx2 2.13.1, httpcore 1.0.9, httpcore2 2.13.1, certifi 2026.10.23, truststore 0.10.5. Harness JavaScript dùng Node.js cục bộ. [Danh sách kiểm thử](../app/requirements-dev.txt)

## Kiểm thử trên chính ZIP cuối

Thay đổi trong lần bàn giao gồm phát hiện phiên bản Windows/Python khi cài, bổ sung kiểm tra tệp runtime vào launcher, giữ cửa sổ khi có lỗi, tự tạo thư mục báo cáo JS và hiển thị riêng ca Tầng B cần dụng cụ. Giao diện chỉ mở nút Ảnh/Camera khi API báo detector khả dụng.

| Hạng mục | Kết quả |
| --- | --- |
| **WINDOWS_CLEAN_INSTALL_PASS** | **PASS** · Giải nén vào thư mục mới có dấu và khoảng trắng. Setup chạy dưới tài khoản thường, tạo .venv mới, tải 21 dependency từ PyPI với cache pip tắt, kiểm SHA-256 và chạy pip check. Exit 0 sau 109,85 giây. [Cài sạch](evidence/6592d4b4845b-20261118-122413/setup.log) · [Thời gian và exit code](evidence/6592d4b4845b-20261118-122413/setup.json) |
| Khởi động, cổng bận và khởi động lại | **PASS** · RUN_ME_FIRST khởi động cổng 8000. Server mới khởi động cổng 8066 bằng Start_Smart_Kitchen. Cổng bận trả mã 3, phiên đang chạy tiếp tục trả HTTP 200. [Lần 1](evidence/6592d4b4845b-20261118-122413/server-run1.json) · [Lần 2](evidence/6592d4b4845b-20261118-122413/server-run2.json) · [Cổng bận](evidence/6592d4b4845b-20261118-122413/busy-port.log) |
| Thiếu tệp và sai checksum | **PASS** · Launcher thoát mã 2 khi thiếu model hoặc catalog. Preflight thoát mã 1 khi metadata sai SHA-256/dung lượng. [Model](evidence/6592d4b4845b-20261118-122413/missing-model.log) · [Dataset](evidence/6592d4b4845b-20261118-122413/missing-dataset.log) · [Metadata](evidence/6592d4b4845b-20261118-122413/tampered-metadata.log) |
| Stage 5, TF-IDF, LSA | **PASS** · Mỗi phương pháp thành công trên ba pantry kiểm thử. Hai chế độ ML trả đúng version và SHA-256 của artifact. Stage 5 trả một món ở ca chỉ một ứng viên đạt. [HTTP lần 1](evidence/6592d4b4845b-20261118-122413/http-run1.json) |
| Two-Tier và restart determinism | **PASS** · 9/9 tổ hợp giữ nguyên ID và thứ tự cả hai tầng sau khi dừng hẳn server. Tầng A đủ loại nguyên liệu trong các ca kiểm tra. Tầng B liệt kê nguyên liệu thiếu hoặc lý do cần kiểm tra. [HTTP lần 2](evidence/6592d4b4845b-20261118-122413/http-run2.json) |
| Trang chủ, pantry và giao diện | **PASS** · HTTP 200 cho trang chủ, health, catalog và 6 tài nguyên tĩnh. Chrome thật thêm/xóa nguyên liệu, giữ định lượng, chạy cả ba phương pháp và xử lý **phieu12**. Ghi nhận 0 lỗi JavaScript, 0 tài nguyên lỗi và 0 request ra ngoài origin từ trang. [Log Chrome](evidence/6592d4b4845b-20261118-122413/browser.json) · [Ảnh kết quả](evidence/6592d4b4845b-20261118-122413/browser-results.png) |
| Recipe detail và VI/EN | **PASS** · HTTP giữ tên, định lượng và hướng dẫn gốc. Chrome đổi tiêu đề, nguyên liệu, bước nấu và nhãn VI → EN → VI trên #2083. Công thức #89 hiển thị fallback EN với nhãn VI. Công thức #103 giữ nguyên bước EN khi bản dịch thiếu. [VI](evidence/6592d4b4845b-20261118-122413/browser-recipe-vi.png) · [EN](evidence/6592d4b4845b-20261118-122413/browser-recipe-en.png) · [Fallback](evidence/6592d4b4845b-20261118-122413/browser-recipe-fallback.png) |
| Cô lập runtime | **PASS** · .venv mới, cấm user site-packages, runtime probe kiểm truy cập file ở cấp Python và kết nối loopback khi chạy server lần 2. Log ghi nhận model, catalog, mapping, cấu hình và bản dịch từ gói giải nén. [Log truy cập](evidence/6592d4b4845b-20261118-122413/runtime-files.log) |
| Hồi quy Python và JavaScript | **PASS** · 52 bài Python đạt, một bài kiểm checkpoint được bỏ qua vì YOLO nằm ngoài phạm vi. 13/13 nhóm JS đạt, gồm harness báo cáo frontend 10/10 khi thư mục báo cáo còn trống. [Python](evidence/6592d4b4845b-20261118-122413/python-regression.log) · [Báo cáo JS](evidence/6592d4b4845b-20261118-122413/feature_frontend_unit.json) |
| Toàn vẹn ZIP và payload sau kiểm thử | **PASS** · SHA-256 ZIP khớp. Toàn bộ 118 entry giải nén và các tệp có trong manifest giữ đúng dung lượng và hash sau khi chạy các ca kiểm thử. [Tổng hợp máy kiểm thử](evidence/6592d4b4845b-20261118-122413/SUMMARY.json) |
| YOLO | **OUT_OF_SCOPE** · Checkpoint còn chờ quyền chia sẻ. Bản Recipe ẩn điều khiển ảnh/camera. Chưa nghiệm thu nạp checkpoint, ảnh thật hay CPU trong gói Windows. |

Hai phiên server đã dừng. Mẫu cache on-demand được tạo trong bản giải nén riêng. Tệp cấu hình, model và catalog tham chiếu theo thư mục ứng dụng giải nén. Python hệ thống cung cấp interpreter và thư viện chuẩn. Chrome và Node.js phục vụ kiểm thử.

Owner có thể kiểm lại ZIP bằng **release/build_windows_release.py --verify**. Dùng **release/verify_windows.py** với CPython 3.14 x64, Node.js và Chrome để chạy lại ca cài sạch, HTTP, browser, kiểm truy cập runtime và hồi quy. Script tự tạo thư mục giải nén trong **.verification/** và ghi kết quả ngoài payload trong **release/evidence/**.

## Phát hành

Kho GitHub phù hợp cần có quyền chia sẻ catalog, phần dịch/dẫn xuất, artifact và mã dự án. Mirror công bố CC BY-SA 3.0. Hồ sơ hiện có chưa xác minh phạm vi quyền chia sẻ văn bản Epicurious hoặc quyền của người đóng góp cho gói. Bản ZIP nằm dưới giới hạn 2 GiB một Release asset. GitHub Releases chấp nhận ZIP đính kèm độc lập với quy tắc bỏ qua ZIP trong Git. Sau khi quyền được xác nhận, Owner đính kèm ZIP và checksum vào Release, rồi tải lại bằng quyền giảng viên để đối chiếu hash. Hiện gói chỉ có cục bộ. [Điều kiện chia sẻ và các bước phát hành](../docs/DISTRIBUTION.md)

Quét tệp văn bản của ZIP theo mẫu secret, đường dẫn máy phát triển và con trỏ Git LFS ghi nhận 0 khớp. Các mẫu địa chỉ email trong dataset xuất phát từ cùng mục liên hệ bán hàng của nhà cung cấp. Ghi chú nguồn cũng có số liên hệ nhà cung cấp. Báo cáo, cache, môi trường ảo, nhật ký và checkpoint YOLO nằm ngoài ZIP. [Kết quả quét](PAYLOAD_SCAN.json)

**Kết luận kỹ thuật:** Có đủ bằng chứng rằng profile Recipe chạy được từ đúng ZIP trên Windows 11 x64 với CPython 3.14.3 theo README. Các tệp thiết yếu cho Recipe có trong ZIP. Trạng thái bàn giao vẫn là **HANDOFF_BLOCKED** cho đến khi quyền chia sẻ được xác nhận và Release đã được tải lại, đối chiếu checksum bằng quyền của người nhận.
