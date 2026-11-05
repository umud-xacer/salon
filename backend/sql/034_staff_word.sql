-- Muassasa turi o'z xodimini qanday ataydi (TZ 2026-11-06): Wellness & Spa'da "Usta" emas — "Mutaxassis".
--   NULL — ish tartibidagi standart so'z (salon: Usta, klinika: Shifokor, dorixona: Farmatsevt).
--   Panelda rol ro'yxati, kalendar, "Istalgan ...", bron oynasi shu so'zni oladi. Super Admin turda o'zgartiradi.
ALTER TABLE business_categories
    ADD COLUMN staff_word VARCHAR(40) CHECK (staff_word IS NULL OR length(trim(staff_word)) BETWEEN 2 AND 40);

UPDATE business_categories
   SET staff_word = 'Mutaxassis',
       staff_titles = '["SPA-terapevt", "Massajchi", "Hammomchi / Sauna ustasi", "Kosmetolog-estetist", "Aromaterapevt"]'
 WHERE slug = 'spa';
