# Bảng So sánh Kỹ thuật Đã Xác minh (`VERIFIED_COMPARISON_TABLE.md`)

> **Quy tắc tách biệt trạng thái học thuật:**
> - **Mục 1 & 2** trình bày các thông số kỹ thuật, hành vi thực thi và độ trễ **đã xác minh trực tiếp** từ mã nguồn, model artifacts và dữ liệu công thức thực (`13,489` công thức).
> - **Mục 3** lưu giữ kết quả phát lại nhãn thô từ `DEV_REVIEW_A_V2.json` & `DEV_REVIEW_B_V2.json` với nhãn bắt buộc **`DIAGNOSTIC_ONLY — NOT VALIDATED HUMAN RELEVANCE`** — tuyệt đối **không** dùng làm bằng chứng mô hình ML tốt hơn baseline.

---

## 1. So sánh Thực thi Trực tiếp Các Chế độ trong Ứng dụng Smart Kitchen

| Chế độ (`ranking_method`) | Loại mô hình / thuật toán | Trạng thái trên UI | Trạng thái học thuật | Latency đo trên `/api/recommend` (warm) | Cold-load / Boot | Độ dài kết quả & Hành vi (`[2 quả trứng, 3 quả cà chua, hành lá]`) |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **`final` (Stage 5)** | **Rule-based** (trọng số khớp + Jaccard + Cosine + penalty) | **Mặc định Production** | Baseline ổn định kỹ thuật (KHÔNG phải ML) | **`3.65 ms`** (`server 2.23 ms`) | Boot `2.88 s`, RSS `254.7 MB` | Top-1: `Breakfast Stack` (`match_ratio=0.40`, khớp 2/5). |
| **`ml_tfidf`** | **Fitted ML:** TF-IDF Vectorizer (27,431 vocab, L2 norm) | ML thực nghiệm (đã gỡ badge vàng ở V3; xem giới hạn trong “Tìm hiểu thêm”) | Fit thật, tái lập 100%, chưa nghiệm thu người thật | **`21.38 ms`** (`server 3.51 ms`; pure ML `2.49 ms`) | Lazy-load đầu `4.77 s`, RSS `426.2 MB` | Top-1: `Seared Scallions with Poached Eggs` (`ml_tfidf_cosine=0.4589`). |
| **`ml_lsa`** | **Fitted ML:** TF-IDF + Randomized TruncatedSVD (`100D`, var `19.21%`) | ML thực nghiệm (đã gỡ badge vàng ở V3; xem giới hạn trong “Tìm hiểu thêm”) | Fit thật, tái lập 100%, chưa nghiệm thu người thật | **`15.90 ms`** (`server 4.00 ms`; pure ML `2.27 ms`) | Dùng chung artifact `recipe_tfidf_lsa_v1.npz` | Top-1: `Stewed Corn and Tomatoes with Okra` (`ml_lsa_cosine=0.8231`). |

---

## 2. So sánh Cấu trúc Khách quan Trên 16 Query DEV (`ML_FIRST_ABLATION_RESULTS.json`)

> *Lưu ý:* Chỉ số `CORE_V2` là **bộ lọc heuristic nguyên liệu chính** phục vụ kiểm tra kỹ thuật sự thiếu hụt nguyên liệu chủ lực, **KHÔNG phải ground truth người dùng**.

| Mã | Ứng viên trong cohort nghiên cứu | Kiến trúc | Items (`/80`) | Top-5 Fill Rate | Top-1 Missing `CORE_V2` | Top-5 Missing `CORE_V2` | Median Latency | P95 Latency | 5-Run Deterministic |
| :---: | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| **A** | `A_stage5_production` | Rule-based Stage 5 (`final`) | `63` | `0.7875` | `0.4667` (`7/15`) | `0.6508` (`41/63`) | **`3.83 ms`** | `41.57 ms` | YES |
| **B** | `B_tfidf_production` | Production TF-IDF (`ml_tfidf`) | `63` | `0.7875` | `0.4667` (`7/15`) | `0.6190` (`39/63`) | `17.61 ms` | `34.12 ms` | YES |
| **C** | `C_lsa100_production` | Production LSA-100 (`ml_lsa`) | `63` | `0.7875` | `0.7333` (`11/15`) | `0.7302` (`46/63`) | `12.18 ms` | `22.45 ms` | YES |
| **I1** | `I1_clean_norm_tfidf_hard_core_v2` | Clean TF-IDF + Hard `CORE_V2` | `47` | `0.5875` | `0.0667` (`1/15`) | `0.0213` (`1/47`) | `41.20 ms` | `62.10 ms` | YES |
| **J1** | `J1_clean_norm_tfidf_core_relaxed` | Clean TF-IDF + 2-Tier `CORE_V2` | `68` | `0.8500` | **`0.0000`** (`0/15`) | **`0.0000`** (`0/68`) | `265.10 ms` | `470.20 ms` | YES |
| **J2** | `J2_clean_norm_lsa100_core_relaxed` | Clean LSA-100 + 2-Tier `CORE_V2` | `68` | `0.8500` | `0.0000` (`0/15`) | `0.0000` (`0/68`) | `362.80 ms` | `488.40 ms` | YES |
| **J3** | `J3_clean_norm_hybrid_core_relaxed` | Hybrid `0.65 TF-IDF + 0.35 LSA` + 2-Tier `CORE_V2` | `68` | `0.8500` | `0.0000` (`0/15`) | `0.0000` (`0/68`) | `335.90 ms` | `640.10 ms` | YES |
| **J4** | `J4_clean_norm_tfidf_tiered_full5` | Clean TF-IDF + 3-Tier Full-5 | **`75`** | **`0.9375`** | `0.0000` (`0/15`) | `0.0933` (`7/75`) | `312.40 ms` | `645.00 ms` | YES |

---

## 3. `DIAGNOSTIC_ONLY — NOT VALIDATED HUMAN RELEVANCE` (Nhãn Đã Đóng băng `QUALITY_FLAGGED`)

> **Cảnh báo bắt buộc:** Bảng dưới đây được tính từ `167 / 168` cặp đánh giá hợp nhất bằng `min(r_A, r_B)` trên bộ nhãn bị gắn cờ `QUALITY_FLAGGED` (Reviewer A chấm `3` cho `167/167` mục đã chấm và bỏ trống `MLV2-126`; Reviewer B chấm `3` cho `163/168`; $\kappa_{\text{linear}} = 0.0000 < 0.60$). **CẤM sử dụng `nDCG@5` bên dưới để tuyên bố bất kỳ mô hình ML nào vượt baseline Stage 5.**

| Mô hình | Judged Pairs | `nDCG@5` (`DIAGNOSTIC_ONLY`) | `Fixed P@5` (`DIAGNOSTIC_ONLY`) | `Cookability` (`DIAGNOSTIC_ONLY`) | Trạng thái hợp lệ chọn mô hình |
| :--- | :---: | ---: | ---: | ---: | :---: |
| **A (`Stage5 Production`)** | `63 / 63` | `0.8086` | `0.7875` | `1.0000` (bão hòa) | Production hiện hành |
| **B (`Production TF-IDF`)** | `63 / 63` | `0.8147` | `0.7875` | `1.0000` (bão hòa) | **NOT VALIDATED** |
| **C (`Production LSA100`)** | `63 / 63` | `0.8081` | `0.7875` | `1.0000` (bão hòa) | **NOT VALIDATED** |
| **I1 (`Strict Core TF-IDF`)** | `47 / 47` | `0.6649` | `0.5875` | `1.0000` (bão hòa) | **NOT VALIDATED** |
| **J1 (`Relaxed Core TF-IDF`)** | `68 / 67` | `0.8606` | `0.8438` | `1.0000` (bão hòa) | **NOT VALIDATED** |
| **J2 (`Relaxed Core LSA100`)** | `68 / 67` | `0.8597` | `0.8438` | `1.0000` (bão hòa) | **NOT VALIDATED** |
| **J3 (`Relaxed Core Hybrid`)** | `68 / 67` | `0.8606` | `0.8438` | `1.0000` (bão hòa) | **NOT VALIDATED** |
| **J4 (`Tiered Core TF-IDF`)** | `75 / 74` | `0.9276` | `0.9375` | `1.0000` (bão hòa) | **NOT VALIDATED** |
