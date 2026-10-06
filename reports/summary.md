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
| removed_from_train | 99 |
| train_images_clean | 2895 |
| ready_for_training | True |

## Imbalance
```
Tổng ảnh: 3148 | Tổng object: 39548 | Số class: 30
Object/class: min=472 (chocolate), max=2027 (tomato), median=1378
Imbalance ratio (max/min) = 4.3
Class hiếm (< 25% median): không có
Class không có mặt ở valid/test: goat_cheese, ham
```

## Data leakage

Các cặp ảnh trùng/gần giống giữa các split (xem data_leakage.csv):

- near: `valid/DSC_6094_JPG_jpg.rf.edd7ce425b91625766bd95f058dea58e.jpg` ↔ `test/DSC_6095_JPG_jpg.rf.3343013706e4d0ba8e8dd6e0f542d462.jpg` (hamming=4)

Đã loại 99 ảnh khỏi tập train (trùng lặp/leakage) → `data/splits/train_clean.txt`. Dataset gốc giữ nguyên.

**READY FOR TRAINING: YES**