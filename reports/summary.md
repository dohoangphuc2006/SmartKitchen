# Dataset audit summary

| Mục | Giá trị |
|---|---|
| images | 3148 |
| objects | 39548 |
| classes | 30 |
| broken_images | 0 |
| label_errors | 0 |
| exact_duplicate_groups | 99 |
| near_duplicate_pairs | 24 |
| leakage_exact | 0 |
| leakage_near | 1 |
| ready_for_training | True |

## Imbalance
```
Tổng ảnh: 3148 | Tổng object: 39548 | Số class: 30
Object/class: min=472 (chocolate), max=2027 (tomato), median=1378
Imbalance ratio (max/min) = 4.3
Class hiếm (< 25% median): không có
Class không có mặt ở valid/test: goat_cheese, ham
```