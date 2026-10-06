# Error analysis (test, conf=0.25, IoU>=0.5)

- GT objects: 610 | Predictions: 628 | True positives: 576
- Precision (cấp object) = 0.917 | Recall = 0.944

## Recall theo kích thước vật thể

| Nhóm | #GT | Recall |
|---|---|---|
| small(<2%) | 566 | 0.942 |
| medium(2-15%) | 44 | 0.977 |
| large(>15%) | 0 | 0.000 |

## Recall theo độ sáng ảnh

| Nhóm | #GT | Recall |
|---|---|---|
| Ảnh tối (mean<90) | 0 | 0.000 |
| Ảnh sáng | 610 | 0.944 |

## Top class bị bỏ sót (False Negative)

- milk: 7
- lime: 7
- apple: 4
- potato: 2
- flour: 2
- chicken_breast: 2
- carrot: 2
- beef: 2

## Top class dự đoán thừa (False Positive)

- chicken_breast: 9
- apple: 6
- beef: 5
- lime: 4
- sweet_potato: 2
- potato: 2
- shrimp: 2
- milk: 2

## Top cặp class bị nhầm (thật -> dự đoán)

- apple -> lime: 3
- beef -> chicken_breast: 2
- potato -> bread: 1
- milk -> chocolate: 1
- flour -> sugar: 1
- potato -> onion: 1
- shrimp -> bread: 1
- cheese -> apple: 1