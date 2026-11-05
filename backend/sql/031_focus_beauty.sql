-- Hozirgi bosqich: go'zallik yo'nalishiga e'tibor (TZ 2026-11-06).
--   Dorixona va Klinika turlari VAQTINCHA yashiriladi: mijoz ilovasida, kategoriyalarda va yangi muassasa
--   formasida ko'rinmaydi. Hech narsa o'chirilmaydi — Super Admin "Muassasa turlari" sahifasida
--   "Ilovada ko'rinsin" belgisini yoqsa, qaytadi. Stomatologiya qoladi.
--   "SPA / Massaj" nomi "Wellness & Spa" ga o'zgartirildi.
UPDATE business_categories SET is_active = FALSE WHERE slug IN ('pharmacy', 'clinic');
UPDATE business_categories SET name_uz = 'Wellness & Spa', name_ru = 'Велнес и СПА' WHERE slug = 'spa';
