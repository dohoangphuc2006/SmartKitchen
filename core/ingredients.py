"""Danh mục nguyên liệu: tên tiếng Việt, nhóm, hạn sử dụng mặc định (ngày, bảo quản trong tủ lạnh)."""

# class_name: (tên Việt, nhóm, số ngày dùng được mặc định, đơn vị)
INGREDIENTS = {
    "apple": ("Táo", "Trái cây", 21, "quả"),
    "banana": ("Chuối", "Trái cây", 5, "quả"),
    "beef": ("Thịt bò", "Thịt", 3, "g"),
    "blueberries": ("Việt quất", "Trái cây", 7, "g"),
    "bread": ("Bánh mì", "Tinh bột", 4, "lát"),
    "butter": ("Bơ", "Sữa & trứng", 30, "g"),
    "carrot": ("Cà rốt", "Rau củ", 14, "củ"),
    "cheese": ("Phô mai", "Sữa & trứng", 21, "g"),
    "chicken": ("Thịt gà", "Thịt", 2, "g"),
    "chicken_breast": ("Ức gà", "Thịt", 2, "g"),
    "chocolate": ("Sô-cô-la", "Khác", 90, "g"),
    "corn": ("Bắp ngô", "Rau củ", 5, "bắp"),
    "eggs": ("Trứng", "Sữa & trứng", 21, "quả"),
    "flour": ("Bột mì", "Tinh bột", 180, "g"),
    "goat_cheese": ("Phô mai dê", "Sữa & trứng", 14, "g"),
    "green_beans": ("Đậu que", "Rau củ", 5, "g"),
    "ground_beef": ("Bò xay", "Thịt", 2, "g"),
    "ham": ("Giăm bông", "Thịt", 7, "g"),
    "heavy_cream": ("Kem tươi", "Sữa & trứng", 10, "ml"),
    "lime": ("Chanh", "Trái cây", 14, "quả"),
    "milk": ("Sữa tươi", "Sữa & trứng", 7, "ml"),
    "mushrooms": ("Nấm", "Rau củ", 5, "g"),
    "onion": ("Hành tây", "Rau củ", 30, "củ"),
    "potato": ("Khoai tây", "Rau củ", 30, "củ"),
    "shrimp": ("Tôm", "Hải sản", 2, "g"),
    "spinach": ("Rau bina", "Rau củ", 4, "g"),
    "strawberries": ("Dâu tây", "Trái cây", 4, "g"),
    "sugar": ("Đường", "Khác", 365, "g"),
    "sweet_potato": ("Khoai lang", "Rau củ", 21, "củ"),
    "tomato": ("Cà chua", "Rau củ", 7, "quả"),
}


def vi_name(key: str) -> str:
    return INGREDIENTS.get(key, (key.replace("_", " "),))[0]


def default_shelf_days(key: str) -> int:
    return INGREDIENTS.get(key, (None, None, 7))[2]
