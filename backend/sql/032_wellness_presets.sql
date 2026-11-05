-- "Wellness & Spa" ichki bo'limlari (TZ 2026-11-06): tavsiya xizmatlar bo'limlar bilan.
--   Direktor "Xizmatlar" sahifasida bir bosishda qo'shadi — xizmat o'z bo'limiga tushadi (029 dagi mexanizm),
--   mijoz ilovasida xizmatlar shu bo'limlar bo'yicha guruhlanadi. Narxlar taxminiy, direktor o'zgartiradi.
UPDATE business_categories SET service_presets = '[
    {"name": "Klassik massaj", "duration_min": 60, "price": 250000, "category": "Massaj turlari"},
    {"name": "Relaks massaji", "duration_min": 60, "price": 280000, "category": "Massaj turlari"},
    {"name": "Sport massaji", "duration_min": 60, "price": 300000, "category": "Massaj turlari"},
    {"name": "Bel va bo''yin massaji", "duration_min": 30, "price": 150000, "category": "Massaj turlari"},
    {"name": "Yuz massaji", "duration_min": 30, "price": 150000, "category": "Massaj turlari"},
    {"name": "Fin saunasi", "duration_min": 60, "price": 200000, "category": "Sauna va hammom"},
    {"name": "Turk hammomi (hammam)", "duration_min": 90, "price": 350000, "category": "Sauna va hammom"},
    {"name": "Infraqizil sauna", "duration_min": 45, "price": 180000, "category": "Sauna va hammom"},
    {"name": "Tana skrabi", "duration_min": 45, "price": 200000, "category": "Tana parvarishi va detoks"},
    {"name": "O''rash (obyortivaniye)", "duration_min": 60, "price": 300000, "category": "Tana parvarishi va detoks"},
    {"name": "Aromaterapiya", "duration_min": 60, "price": 250000, "category": "Tana parvarishi va detoks"},
    {"name": "Dam olish paketi: massaj + hammom + skrab", "duration_min": 180, "price": 750000, "category": "Kompleks paketlar"},
    {"name": "Juftliklar uchun paket (2 kishi)", "duration_min": 120, "price": 900000, "category": "Kompleks paketlar"},
    {"name": "Detoks kuni: sauna + o''rash + aromaterapiya", "duration_min": 150, "price": 650000, "category": "Kompleks paketlar"}
]', staff_titles = '["Massajchi", "SPA-terapevt", "Kosmetolog", "Hammom ustasi"]'
 WHERE slug = 'spa';
