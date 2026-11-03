-- Muassasa turlari: Super Admin boshqaradi. Har bir tur o'z tavsiya xizmatlari va standart ish vaqtiga ega.
-- Yozish huquqi faqat Super Admin'da (002_security.sql dagi superadmin_all), o'qish hammaga (read_all).
ALTER TABLE business_categories
    ADD COLUMN is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN opens_at        TIME    NOT NULL DEFAULT '09:00',
    ADD COLUMN closes_at       TIME    NOT NULL DEFAULT '20:00',
    ADD COLUMN service_presets JSONB   NOT NULL DEFAULT '[]'
        CHECK (jsonb_typeof(service_presets) = 'array' AND jsonb_array_length(service_presets) <= 50),
    ADD CONSTRAINT business_categories_hours_check CHECK (closes_at > opens_at),
    ADD CONSTRAINT business_categories_slug_check CHECK (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$');

INSERT INTO business_categories (slug, name_uz, name_ru, icon, sort_order)
VALUES ('pharmacy', 'Dorixona', 'Аптека', 'pill', 3)
ON CONFLICT (slug) DO NOTHING;

-- TZ tartibi: go'zallik, barber, dorixona, klinika, stomatologiya, spa
UPDATE business_categories SET sort_order = x.ord, opens_at = x.o, closes_at = x.c, service_presets = x.p::jsonb
  FROM (VALUES
    ('beauty_salon', 1, TIME '09:00', TIME '20:00', '[
        {"name": "Ayollar soch turmagi", "duration_min": 60, "price": 150000},
        {"name": "Soch bo''yash", "duration_min": 120, "price": 300000},
        {"name": "Manikyur", "duration_min": 60, "price": 100000},
        {"name": "Pedikyur", "duration_min": 60, "price": 120000},
        {"name": "Makiyaj", "duration_min": 60, "price": 200000},
        {"name": "Qosh dizayni", "duration_min": 30, "price": 60000}]'),
    ('barbershop', 2, TIME '09:00', TIME '21:00', '[
        {"name": "Soch olish", "duration_min": 40, "price": 70000},
        {"name": "Soqol olish", "duration_min": 20, "price": 40000},
        {"name": "Soch va soqol", "duration_min": 60, "price": 100000},
        {"name": "Bolalar soch olishi", "duration_min": 30, "price": 50000}]'),
    ('pharmacy', 3, TIME '08:00', TIME '22:00', '[
        {"name": "Farmatsevt maslahati", "duration_min": 15, "price": 0},
        {"name": "Qon bosimini o''lchash", "duration_min": 10, "price": 10000},
        {"name": "Qanddagi glyukozani o''lchash", "duration_min": 10, "price": 15000},
        {"name": "Buyurtma qilingan dorini olib ketish", "duration_min": 15, "price": 0}]'),
    ('clinic', 4, TIME '08:00', TIME '18:00', '[
        {"name": "Terapevt ko''rigi", "duration_min": 30, "price": 150000},
        {"name": "Kardiolog ko''rigi", "duration_min": 30, "price": 200000},
        {"name": "UZI tekshiruvi", "duration_min": 30, "price": 150000},
        {"name": "Umumiy qon tahlili", "duration_min": 15, "price": 80000}]'),
    ('dental', 5, TIME '09:00', TIME '19:00', '[
        {"name": "Stomatolog ko''rigi", "duration_min": 30, "price": 100000},
        {"name": "Tish tozalash", "duration_min": 60, "price": 300000},
        {"name": "Plomba qo''yish", "duration_min": 60, "price": 400000},
        {"name": "Tish oqartirish", "duration_min": 90, "price": 1500000}]'),
    ('spa', 6, TIME '10:00', TIME '22:00', '[
        {"name": "Klassik massaj", "duration_min": 60, "price": 250000},
        {"name": "Butun tana massaji", "duration_min": 90, "price": 350000},
        {"name": "Yuz parvarishi", "duration_min": 60, "price": 200000},
        {"name": "Sauna", "duration_min": 120, "price": 200000}]')
  ) AS x(slug, ord, o, c, p)
 WHERE business_categories.slug = x.slug;
