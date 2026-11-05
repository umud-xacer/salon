-- Stomatologiya va klinikalar uchun moslash (TZ 2026-11-05).
--   1) Tavsiya xizmatlarda bo'lim (category): direktor bir bosishda qo'shganda xizmat shu bo'limga tushadi
--      (bo'lim bo'lmasa, yaratiladi). Mijoz ilovada xizmatlarni bo'limlar bo'yicha ko'radi.
--   2) staff_titles — turga mos lavozim / mutaxassislik tavsiyalari (Stomatolog-terapevt, Ortodont...).
--      Klinikada ilova shifokorlarni aynan shu mutaxassislik bo'yicha guruhlaydi.
ALTER TABLE business_categories
    ADD COLUMN staff_titles JSONB NOT NULL DEFAULT '[]'
        CHECK (jsonb_typeof(staff_titles) = 'array' AND jsonb_array_length(staff_titles) <= 30);

UPDATE business_categories SET service_presets = '[
    {"name": "Stomatolog ko''rigi", "duration_min": 30, "price": 100000, "category": "Terapevtik davolash"},
    {"name": "Plomba qo''yish", "duration_min": 60, "price": 400000, "category": "Terapevtik davolash"},
    {"name": "Kanal davolash (pulpit)", "duration_min": 90, "price": 800000, "category": "Terapevtik davolash"},
    {"name": "Tish rentgeni (pritsel)", "duration_min": 15, "price": 50000, "category": "Terapevtik davolash"},
    {"name": "Tish tozalash", "duration_min": 60, "price": 300000, "category": "Gigiyena va tozalash"},
    {"name": "Tish toshini olish (ultratovush)", "duration_min": 45, "price": 250000, "category": "Gigiyena va tozalash"},
    {"name": "Tish oqartirish", "duration_min": 90, "price": 1500000, "category": "Gigiyena va tozalash"},
    {"name": "Ftorlash", "duration_min": 30, "price": 150000, "category": "Gigiyena va tozalash"},
    {"name": "Ortodont maslahati", "duration_min": 30, "price": 100000, "category": "Ortodontiya (breketlar)"},
    {"name": "Breket o''rnatish (bir jag'')", "duration_min": 120, "price": 5000000, "category": "Ortodontiya (breketlar)"},
    {"name": "Breketni tuzatish (korreksiya)", "duration_min": 30, "price": 300000, "category": "Ortodontiya (breketlar)"},
    {"name": "Elayner (kappa) bilan davolash", "duration_min": 45, "price": 200000, "category": "Ortodontiya (breketlar)"},
    {"name": "Metallokeramik koronka", "duration_min": 60, "price": 1200000, "category": "Ortopediya (protezlash)"},
    {"name": "Sirkoniy koronka", "duration_min": 60, "price": 2500000, "category": "Ortopediya (protezlash)"},
    {"name": "Vinir (bitta tish)", "duration_min": 90, "price": 2500000, "category": "Ortopediya (protezlash)"},
    {"name": "Olinadigan protez", "duration_min": 60, "price": 3000000, "category": "Ortopediya (protezlash)"},
    {"name": "Tish sug''urish", "duration_min": 45, "price": 300000, "category": "Jarrohlik va implantatsiya"},
    {"name": "Aql tishini olish", "duration_min": 60, "price": 700000, "category": "Jarrohlik va implantatsiya"},
    {"name": "Implant o''rnatish", "duration_min": 90, "price": 6000000, "category": "Jarrohlik va implantatsiya"},
    {"name": "Bolalar ko''rigi", "duration_min": 30, "price": 80000, "category": "Bolalar stomatologiyasi"},
    {"name": "Sut tishini davolash", "duration_min": 45, "price": 250000, "category": "Bolalar stomatologiyasi"},
    {"name": "Fissura germetizatsiyasi", "duration_min": 30, "price": 150000, "category": "Bolalar stomatologiyasi"}
]', staff_titles = '["Stomatolog-terapevt", "Gigiyenist", "Ortodont", "Ortoped-stomatolog",
                     "Jarroh-stomatolog (implantolog)", "Bolalar stomatologi"]'
 WHERE slug = 'dental';

UPDATE business_categories SET staff_titles = x.t::jsonb
  FROM (VALUES
    ('clinic', '["Terapevt", "Pediatr", "Kardiolog", "Nevrolog", "Ginekolog", "LOR", "Okulist", "Dermatolog", "Urolog", "Endokrinolog"]'),
    ('beauty_salon', '["Stilist", "Sartarosh", "Manikyur ustasi", "Vizajist", "Kosmetolog", "Qosh ustasi"]'),
    ('barbershop', '["Barber", "Sartarosh"]'),
    ('spa', '["Massajchi", "Kosmetolog", "SPA mutaxassisi"]'),
    ('pharmacy', '["Farmatsevt", "Provizor"]')
  ) AS x(slug, t)
 WHERE business_categories.slug = x.slug;
