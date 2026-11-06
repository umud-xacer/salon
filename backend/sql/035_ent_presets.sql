-- "Lor (Otorinolaringologiya)" tibbiy yo'nalishi (TZ 2026-11-07).
--   Alohida muassasa turi, ish tartibi — klinika: xodim "Shifokor", mijoz "Bemor", "Qabulga yozish".
--   staff_word NULL — klinikaning standart so'zi ("Shifokor"); "Usta" hech qayerda chiqmaydi.
--   5 bo'lim, 18 tavsiya xizmat (029 dagi mexanizm: direktor bir bosishda qo'shadi, xizmat o'z bo'limiga tushadi,
--   ilovada bemor shifokor xizmatlarini shu bo'limlar bo'yicha ko'radi). Vaqt va narx taxminiy — direktor
--   yoki shifokor o'zgartiradi. Tartib: stomatologiyadan keyin, Wellness & Spa oldidan.
UPDATE business_categories SET sort_order = sort_order + 1 WHERE sort_order >= 6;

INSERT INTO business_categories (slug, name_uz, name_ru, icon, sort_order, kind, opens_at, closes_at)
VALUES ('ent', 'Lor (Otorinolaringologiya)', 'ЛОР (Оториноларингология)', 'ear', 6, 'clinic', '08:00', '18:00')
ON CONFLICT (slug) DO NOTHING;

UPDATE business_categories SET service_presets = '[
    {"name": "Birlamchi Lor ko''rigi va maslahati", "duration_min": 30, "price": 150000, "category": "Konsultatsiya va diagnostika"},
    {"name": "Endoskopik ko''rik (burun va halqum)", "duration_min": 30, "price": 250000, "category": "Konsultatsiya va diagnostika"},
    {"name": "Eshitish qobiliyatini tekshirish (audiometriya)", "duration_min": 30, "price": 200000, "category": "Konsultatsiya va diagnostika"},
    {"name": "Timpanometriya (quloq pardasi holatini tekshirish)", "duration_min": 20, "price": 150000, "category": "Konsultatsiya va diagnostika"},
    {"name": "Burun bo''shlig''ini dori bilan yuvish (\"Kukushka\" usuli)", "duration_min": 30, "price": 120000, "category": "Burun va yondosh bo''shliqlar"},
    {"name": "Gaymor sinuslarini punksiya qilish / davolash", "duration_min": 60, "price": 400000, "category": "Burun va yondosh bo''shliqlar"},
    {"name": "Vazomotor rinitni / burun shilliq qavatini davolash", "duration_min": 30, "price": 200000, "category": "Burun va yondosh bo''shliqlar"},
    {"name": "Burundan yot jismni olib tashlash", "duration_min": 20, "price": 150000, "category": "Burun va yondosh bo''shliqlar"},
    {"name": "Bodomsimon bezlarni (mindalina) yuvish va dori surish", "duration_min": 30, "price": 120000, "category": "Tomoq va halqum"},
    {"name": "Halqum devoriga dori purkash / sepish", "duration_min": 20, "price": 80000, "category": "Tomoq va halqum"},
    {"name": "Tomoqdan / og''iz bo''shlig''idan yot jismni olib tashlash", "duration_min": 20, "price": 150000, "category": "Tomoq va halqum"},
    {"name": "Faringit va tonzillitni kompleks davolash", "duration_min": 60, "price": 300000, "category": "Tomoq va halqum"},
    {"name": "Quloq tiqinini (oltingugurt) tozalash / yuvish", "duration_min": 20, "price": 100000, "category": "Quloq muolajalari"},
    {"name": "O''rta quloq shamollashini davolash (kateterizatsiya)", "duration_min": 30, "price": 200000, "category": "Quloq muolajalari"},
    {"name": "Quloqdan yot jismni olib tashlash", "duration_min": 20, "price": 150000, "category": "Quloq muolajalari"},
    {"name": "Otitni (tashqi va o''rta) davolash muolajalari", "duration_min": 30, "price": 180000, "category": "Quloq muolajalari"},
    {"name": "Burun qonashini to''xtatish (tamponada)", "duration_min": 30, "price": 150000, "category": "Kichik jarrohlik va muolajalar"},
    {"name": "Burun to''sig''i qiyshiqligini to''g''rilash: dastlabki muolajalar", "duration_min": 60, "price": 500000, "category": "Kichik jarrohlik va muolajalar"}
]', staff_titles = '["Lor-shifokor (otorinolaringolog, kattalar)", "Bolalar Lor-shifokori (pediatrik otorinolaringolog)",
                     "Lor-jarroh (burun, tomoq, quloq)", "Audiolog / Surdolog (eshitish mutaxassisi)"]'
 WHERE slug = 'ent';
