-- Ikki tilli tizim (TZ 2026-11-07): xizmat va bo'limlarning ixtiyoriy ruscha nomi.
--   services.name_ru, service_categories.name_ru — direktor panelda kiritadi (bo'sh bo'lsa, o'zbekcha ko'rinadi).
--   Tavsiya xizmatlarga (service_presets) name_ru va category_ru qo'shiladi: bir bosishda qo'shilganda ruscha nom ham yoziladi.
--   Oldin qo'shilgan tavsiya xizmatlar va bo'limlar (nomi aynan mos) uchun ruscha nom avtomatik to'ldiriladi.
ALTER TABLE services
    ADD COLUMN name_ru VARCHAR(120) CHECK (name_ru IS NULL OR char_length(trim(name_ru)) BETWEEN 2 AND 120);
ALTER TABLE service_categories
    ADD COLUMN name_ru VARCHAR(80) CHECK (name_ru IS NULL OR char_length(trim(name_ru)) BETWEEN 1 AND 80);

CREATE TEMP TABLE preset_ru (uz TEXT PRIMARY KEY, ru TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO preset_ru (uz, ru) VALUES
    -- Go'zallik saloni
    ('Ayollar soch turmagi', 'Женская укладка'), ('Soch bo''yash', 'Окрашивание волос'), ('Manikyur', 'Маникюр'),
    ('Pedikyur', 'Педикюр'), ('Makiyaj', 'Макияж'), ('Qosh dizayni', 'Дизайн бровей'),
    -- Sartaroshxona
    ('Soch olish', 'Стрижка'), ('Soqol olish', 'Бритьё бороды'), ('Soch va soqol', 'Стрижка и борода'),
    ('Bolalar soch olishi', 'Детская стрижка'),
    -- Dorixona
    ('Farmatsevt maslahati', 'Консультация фармацевта'), ('Qon bosimini o''lchash', 'Измерение давления'),
    ('Qanddagi glyukozani o''lchash', 'Измерение глюкозы в крови'), ('Buyurtma qilingan dorini olib ketish', 'Выдача заказанного лекарства'),
    -- Klinika
    ('Terapevt ko''rigi', 'Приём терапевта'), ('Kardiolog ko''rigi', 'Приём кардиолога'), ('UZI tekshiruvi', 'УЗИ'),
    ('Umumiy qon tahlili', 'Общий анализ крови'),
    -- Stomatologiya
    ('Stomatolog ko''rigi', 'Осмотр стоматолога'), ('Plomba qo''yish', 'Установка пломбы'), ('Kanal davolash (pulpit)', 'Лечение каналов (пульпит)'),
    ('Tish rentgeni (pritsel)', 'Рентген зуба (прицельный)'), ('Tish tozalash', 'Чистка зубов'),
    ('Tish toshini olish (ultratovush)', 'Удаление зубного камня (ультразвук)'), ('Tish oqartirish', 'Отбеливание зубов'),
    ('Ftorlash', 'Фторирование'), ('Ortodont maslahati', 'Консультация ортодонта'), ('Breket o''rnatish (bir jag'')', 'Установка брекетов (одна челюсть)'),
    ('Breketni tuzatish (korreksiya)', 'Коррекция брекетов'), ('Elayner (kappa) bilan davolash', 'Лечение элайнерами (капы)'),
    ('Metallokeramik koronka', 'Металлокерамическая коронка'), ('Sirkoniy koronka', 'Циркониевая коронка'), ('Vinir (bitta tish)', 'Винир (один зуб)'),
    ('Olinadigan protez', 'Съёмный протез'), ('Tish sug''urish', 'Удаление зуба'), ('Aql tishini olish', 'Удаление зуба мудрости'),
    ('Implant o''rnatish', 'Установка импланта'), ('Bolalar ko''rigi', 'Детский осмотр'), ('Sut tishini davolash', 'Лечение молочного зуба'),
    ('Fissura germetizatsiyasi', 'Герметизация фиссур'),
    ('Terapevtik davolash', 'Терапевтическое лечение'), ('Gigiyena va tozalash', 'Гигиена и чистка'), ('Ortodontiya (breketlar)', 'Ортодонтия (брекеты)'),
    ('Ortopediya (protezlash)', 'Ортопедия (протезирование)'), ('Jarrohlik va implantatsiya', 'Хирургия и имплантация'),
    ('Bolalar stomatologiyasi', 'Детская стоматология'),
    -- Lor
    ('Birlamchi Lor ko''rigi va maslahati', 'Первичный осмотр и консультация ЛОР'), ('Endoskopik ko''rik (burun va halqum)', 'Эндоскопический осмотр (нос и гортань)'),
    ('Eshitish qobiliyatini tekshirish (audiometriya)', 'Проверка слуха (аудиометрия)'),
    ('Timpanometriya (quloq pardasi holatini tekshirish)', 'Тимпанометрия (проверка барабанной перепонки)'),
    ('Burun bo''shlig''ini dori bilan yuvish ("Kukushka" usuli)', 'Промывание носа лекарством (метод «Кукушка»)'),
    ('Gaymor sinuslarini punksiya qilish / davolash', 'Пункция / лечение гайморовых пазух'),
    ('Vazomotor rinitni / burun shilliq qavatini davolash', 'Лечение вазомоторного ринита / слизистой носа'),
    ('Burundan yot jismni olib tashlash', 'Удаление инородного тела из носа'),
    ('Bodomsimon bezlarni (mindalina) yuvish va dori surish', 'Промывание миндалин и нанесение лекарства'),
    ('Halqum devoriga dori purkash / sepish', 'Орошение задней стенки глотки'),
    ('Tomoqdan / og''iz bo''shlig''idan yot jismni olib tashlash', 'Удаление инородного тела из горла / полости рта'),
    ('Faringit va tonzillitni kompleks davolash', 'Комплексное лечение фарингита и тонзиллита'),
    ('Quloq tiqinini (oltingugurt) tozalash / yuvish', 'Удаление серной пробки / промывание уха'),
    ('O''rta quloq shamollashini davolash (kateterizatsiya)', 'Лечение воспаления среднего уха (катетеризация)'),
    ('Quloqdan yot jismni olib tashlash', 'Удаление инородного тела из уха'),
    ('Otitni (tashqi va o''rta) davolash muolajalari', 'Процедуры при отите (наружном и среднем)'),
    ('Burun qonashini to''xtatish (tamponada)', 'Остановка носового кровотечения (тампонада)'),
    ('Burun to''sig''i qiyshiqligini to''g''rilash: dastlabki muolajalar', 'Искривление носовой перегородки: первичные процедуры'),
    ('Konsultatsiya va diagnostika', 'Консультация и диагностика'), ('Burun va yondosh bo''shliqlar', 'Нос и придаточные пазухи'),
    ('Tomoq va halqum', 'Горло и гортань'), ('Quloq muolajalari', 'Процедуры для уха'), ('Kichik jarrohlik va muolajalar', 'Малая хирургия и процедуры'),
    -- Wellness & Spa
    ('Klassik massaj', 'Классический массаж'), ('Relaks massaji', 'Расслабляющий массаж'), ('Sport massaji', 'Спортивный массаж'),
    ('Bel va bo''yin massaji', 'Массаж спины и шеи'), ('Yuz massaji', 'Массаж лица'), ('Fin saunasi', 'Финская сауна'),
    ('Turk hammomi (hammam)', 'Турецкий хаммам'), ('Infraqizil sauna', 'Инфракрасная сауна'), ('Tana skrabi', 'Скраб для тела'),
    ('O''rash (obyortivaniye)', 'Обёртывание'), ('Aromaterapiya', 'Ароматерапия'),
    ('Dam olish paketi: massaj + hammom + skrab', 'Программа отдыха: массаж + хаммам + скраб'),
    ('Juftliklar uchun paket (2 kishi)', 'Программа для пар (2 человека)'),
    ('Detoks kuni: sauna + o''rash + aromaterapiya', 'День детокса: сауна + обёртывание + ароматерапия'),
    ('Massaj turlari', 'Виды массажа'), ('Sauna va hammom', 'Сауна и хаммам'), ('Tana parvarishi va detoks', 'Уход за телом и детокс'),
    ('Kompleks paketlar', 'Комплексные программы');

-- Tavsiyalarga ruscha nom va bo'lim
UPDATE business_categories c
   SET service_presets = coalesce((
       SELECT jsonb_agg(
                p.v || jsonb_strip_nulls(jsonb_build_object(
                    'name_ru', (SELECT ru FROM preset_ru WHERE uz = p.v->>'name'),
                    'category_ru', (SELECT ru FROM preset_ru WHERE uz = p.v->>'category')))
                ORDER BY p.ord)
         FROM jsonb_array_elements(c.service_presets) WITH ORDINALITY AS p(v, ord)), '[]'::jsonb)
 WHERE jsonb_array_length(c.service_presets) > 0;

-- Oldin qo'shilgan tavsiya xizmatlar va bo'limlar
UPDATE services s SET name_ru = m.ru FROM preset_ru m WHERE s.name = m.uz AND s.name_ru IS NULL;
UPDATE service_categories sc SET name_ru = m.ru FROM preset_ru m WHERE sc.name = m.uz AND sc.name_ru IS NULL;
