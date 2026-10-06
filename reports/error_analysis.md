# Error analysis (test, conf=0.25, IoU>=0.5)

- Ground-truth objects: 610 | Predictions: 646
- TP: 544 | Sai class: 31 | Bỏ sót (FN): 35 | Dự đoán thừa (FP): 71
- Precision (cấp object) = 0.842 | Recall = 0.892

## 1. Vật thể nhỏ (chia 3 nhóm theo diện tích box/ảnh)

| Nhóm | #GT | Recall |
|---|---|---|
| nhỏ (<0.85%) | 206 | 0.917 |
| vừa (0.85%-1.30%) | 201 | 0.831 |
| lớn (>1.30%) | 203 | 0.926 |

## 2. Vật thể bị che (tỉ lệ diện tích bị box khác phủ)

| Nhóm | #GT | Recall |
|---|---|---|
| không bị che (<5%) | 459 | 0.924 |
| che một phần (5-30%) | 105 | 0.800 |
| che nhiều (>30%) | 46 | 0.783 |

## 3. Ảnh tối (25% ảnh tối nhất, độ sáng TB < 114/255)

| Nhóm | #GT | Recall |
|---|---|---|
| tối | 157 | 0.885 |
| bình thường | 453 | 0.894 |

## 4. Nền phức tạp (mật độ cạnh > trung vị 12.9)

| Nhóm | #GT | Recall |
|---|---|---|
| nền đơn giản | 300 | 0.890 |
| nền phức tạp | 310 | 0.894 |

## 5. Ảnh đông vật thể (số object/ảnh)

| Nhóm | #GT | Recall |
|---|---|---|
| ≤10 | 129 | 0.938 |
| 11-20 | 481 | 0.879 |
| >20 | 0 | nan |

## 6. Class bị bỏ sót nhiều nhất (FN + sai class)

- beef: 14/31 (45%)
- ground_beef: 11/24 (46%)
- sweet_potato: 8/12 (67%)
- lime: 7/20 (35%)
- milk: 6/44 (14%)
- apple: 5/26 (19%)
- carrot: 4/16 (25%)
- potato: 3/23 (13%)

## 7. Class dự đoán thừa nhiều nhất (False Positive)

- potato: 13
- sweet_potato: 11
- milk: 10
- chicken_breast: 8
- beef: 6
- flour: 4
- green_beans: 3
- lime: 3

## 8. Cặp class bị nhầm nhiều nhất (thật → dự đoán)

- beef → chicken_breast: 8
- sweet_potato → carrot: 6
- ground_beef → beef: 4
- carrot → shrimp: 3
- potato → bread: 1
- milk → chocolate: 1
- flour → sugar: 1
- ground_beef → sweet_potato: 1

Ảnh minh họa lỗi: `figures/error_examples.png` (xanh lá = GT đúng, xanh dương = bỏ sót/sai class, đỏ = dự đoán thừa).