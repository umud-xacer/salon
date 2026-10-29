-- ════════════════════════════════════════════════════════════════════════════
--  Xizmat ko'rsatish platformasi (salon, klinika, barbershop, spa ...) — MVP sxema
--  PostgreSQL 15+ , PostGIS
--
--  Qoidalar:
--   * Pul — BIGINT (so'm, butun son). FLOAT ishlatilmaydi.
--   * Vaqt — TIMESTAMPTZ. Ish soatlari — TIME.
--   * Har bir "biznes ichidagi" jadvalda business_id bor (multi-tenant).
--   * Biznes ichidagi bog'lanishlar KOMPOZIT kalit (business_id, id) orqali:
--     boshqa salonning ustasi/mijozi/xizmatini bronga ulab bo'lmaydi — baza rad etadi.
--   * Kirish huquqlari (RLS) — 002_security.sql da.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- ─── ENUM turlar ────────────────────────────────────────────────────────────
CREATE TYPE user_status        AS ENUM ('active', 'blocked', 'deleted');
CREATE TYPE business_status    AS ENUM ('pending', 'active', 'blocked');
CREATE TYPE member_role        AS ENUM ('owner', 'manager', 'receptionist', 'staff');
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE booking_source     AS ENUM ('app', 'admin', 'walk_in', 'telegram');
CREATE TYPE payment_method     AS ENUM ('cash', 'card', 'click', 'payme', 'uzum', 'bonus');
CREATE TYPE payment_status     AS ENUM ('pending', 'paid', 'refunded', 'failed');
CREATE TYPE stock_move_type    AS ENUM ('purchase', 'sale', 'usage', 'to_staff', 'adjustment', 'write_off');
CREATE TYPE payroll_status     AS ENUM ('draft', 'approved', 'paid');


-- ════════════════════════════════════════════════════════════════════════════
--  1. FOYDALANUVCHILAR VA KIRISH
--  Bitta users jadvali: mijoz ham, xodim ham, salon egasi ham.
--  Kim qaysi biznesda qanday rolda — business_members da.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE users (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone                  VARCHAR(13) NOT NULL UNIQUE CHECK (phone ~ '^\+998[0-9]{9}$'),
    email                  CITEXT UNIQUE,
    password_hash          TEXT,                              -- argon2id; NULL = faqat SMS orqali kiradi
    full_name              VARCHAR(120) NOT NULL DEFAULT '',
    avatar_url             TEXT,
    language               VARCHAR(5)  NOT NULL DEFAULT 'uz' CHECK (language IN ('uz', 'ru', 'en')),
    is_superadmin          BOOLEAN     NOT NULL DEFAULT FALSE,
    status                 user_status NOT NULL DEFAULT 'active',
    token_version          INTEGER     NOT NULL DEFAULT 0,    -- oshirilsa, barcha access tokenlar bekor
    failed_login_attempts  SMALLINT    NOT NULL DEFAULT 0,
    locked_until           TIMESTAMPTZ,
    last_login_at          TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone       VARCHAR(13) NOT NULL CHECK (phone ~ '^\+998[0-9]{9}$'),
    code_hash   TEXT        NOT NULL,                         -- HMAC-SHA256, kodning o'zi saqlanmaydi
    attempts    SMALLINT    NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    ip          INET,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_codes (phone, created_at DESC);
CREATE INDEX ON otp_codes (ip, created_at DESC);

CREATE TABLE refresh_tokens (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id    UUID   NOT NULL,                             -- bitta kirish sessiyasi zanjiri
    token_hash   TEXT   NOT NULL UNIQUE,                      -- SHA-256, tokenning o'zi saqlanmaydi
    replaced_by  BIGINT REFERENCES refresh_tokens(id),
    user_agent   VARCHAR(200),
    ip           INET,
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON refresh_tokens (user_id);
CREATE INDEX ON refresh_tokens (family_id);

CREATE TABLE device_tokens (                                -- push bildirishnomalar (Expo/FCM)
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT   NOT NULL UNIQUE,
    platform    VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════════════════
--  2. PLATFORMA: kategoriyalar, modullar, tariflar (Super Admin boshqaradi)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE business_categories (
    id         SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug       VARCHAR(40)  NOT NULL UNIQUE,
    name_uz    VARCHAR(80)  NOT NULL,
    name_ru    VARCHAR(80)  NOT NULL,
    icon       VARCHAR(40),
    sort_order SMALLINT     NOT NULL DEFAULT 0
);

CREATE TABLE modules (
    code        VARCHAR(40) PRIMARY KEY,
    name        VARCHAR(80) NOT NULL,
    description TEXT
);

CREATE TABLE plans (
    id             SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           VARCHAR(60) NOT NULL,
    price          BIGINT      NOT NULL CHECK (price >= 0),
    duration_days  INTEGER     NOT NULL CHECK (duration_days > 0),
    max_staff      INTEGER CHECK (max_staff > 0),             -- NULL = cheksiz
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE TABLE plan_modules (
    plan_id      SMALLINT    NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    module_code  VARCHAR(40) NOT NULL REFERENCES modules(code),
    PRIMARY KEY (plan_id, module_code)
);


-- ════════════════════════════════════════════════════════════════════════════
--  3. BIZNES (salon / klinika / filial)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE businesses (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id     BIGINT REFERENCES businesses(id),
    category_id   SMALLINT NOT NULL REFERENCES business_categories(id),
    name          VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
    slug          VARCHAR(140) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    description   TEXT,
    phone         VARCHAR(13) CHECK (phone ~ '^\+998[0-9]{9}$'),
    city          VARCHAR(80),
    address       TEXT,
    location      GEOGRAPHY(POINT, 4326),                    -- Yandex xaritadagi nuqta (lng, lat)
    timezone      VARCHAR(40) NOT NULL DEFAULT 'Asia/Tashkent',
    logo_url      TEXT,
    cover_url     TEXT,
    status        business_status NOT NULL DEFAULT 'pending',
    is_listed     BOOLEAN NOT NULL DEFAULT TRUE,
    rating_avg    NUMERIC(2,1) NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
    rating_count  INTEGER      NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
    created_by    BIGINT REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX businesses_location_gix ON businesses USING GIST (location);
CREATE INDEX ON businesses (category_id, status);

CREATE TABLE business_hours (
    business_id  BIGINT   NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    weekday      SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- 1 = dushanba
    opens_at     TIME     NOT NULL,
    closes_at    TIME     NOT NULL,
    PRIMARY KEY (business_id, weekday),
    CHECK (closes_at > opens_at)
);

CREATE TABLE business_photos (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    url          TEXT   NOT NULL,
    sort_order   SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE business_subscriptions (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT   NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    plan_id      SMALLINT NOT NULL REFERENCES plans(id),
    starts_at    TIMESTAMPTZ NOT NULL,
    ends_at      TIMESTAMPTZ NOT NULL,
    amount_paid  BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX ON business_subscriptions (business_id, ends_at DESC);

-- Super Admin aniq biznesga modulni yoqadi/o'chiradi (tarifdan ustun)
CREATE TABLE business_modules (
    business_id  BIGINT      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    module_code  VARCHAR(40) NOT NULL REFERENCES modules(code),
    enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    expires_at   TIMESTAMPTZ,
    PRIMARY KEY (business_id, module_code)
);


-- ════════════════════════════════════════════════════════════════════════════
--  4. XODIMLAR VA HUQUQLAR
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE permissions (
    code         VARCHAR(60) PRIMARY KEY,
    module_code  VARCHAR(40) REFERENCES modules(code),       -- NULL = har doim mavjud
    description  TEXT
);

CREATE TABLE role_permissions (
    role             member_role NOT NULL,
    permission_code  VARCHAR(60) NOT NULL REFERENCES permissions(code),
    PRIMARY KEY (role, permission_code)
);

CREATE TABLE business_members (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id   BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id       BIGINT NOT NULL REFERENCES users(id),
    role          member_role NOT NULL,
    title         VARCHAR(80),                               -- "Sartarosh", "Stomatolog"
    bio           TEXT,
    photo_url     TEXT,
    is_bookable   BOOLEAN      NOT NULL DEFAULT TRUE,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    rating_avg    NUMERIC(2,1) NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
    rating_count  INTEGER      NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
    hired_at      DATE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (business_id, user_id),
    UNIQUE (business_id, id)
);
CREATE INDEX ON business_members (user_id);
-- Har bir biznesda faqat bitta faol egasi
CREATE UNIQUE INDEX one_owner_per_business ON business_members (business_id) WHERE role = 'owner' AND is_active;

-- Maosh — alohida jadval: xodimning ochiq profilida ko'rinmasligi uchun
CREATE TABLE member_compensation (
    member_id           BIGINT PRIMARY KEY,
    business_id         BIGINT NOT NULL,
    commission_percent  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_percent BETWEEN 0 AND 100),
    base_salary         BIGINT       NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    FOREIGN KEY (business_id, member_id) REFERENCES business_members(business_id, id) ON DELETE CASCADE
);

-- Salon egasi aniq xodimga qo'shimcha huquq beradi (granted=true) yoki olib qo'yadi (false)
CREATE TABLE member_permissions (
    member_id        BIGINT      NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
    permission_code  VARCHAR(60) NOT NULL REFERENCES permissions(code),
    granted          BOOLEAN     NOT NULL,
    PRIMARY KEY (member_id, permission_code)
);

CREATE TABLE staff_schedules (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT   NOT NULL,
    member_id   BIGINT   NOT NULL,
    weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    start_time  TIME     NOT NULL,
    end_time    TIME     NOT NULL,
    CHECK (end_time > start_time),
    FOREIGN KEY (business_id, member_id) REFERENCES business_members(business_id, id) ON DELETE CASCADE
);
CREATE INDEX ON staff_schedules (member_id, weekday);

CREATE TABLE staff_time_off (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL,
    member_id   BIGINT NOT NULL,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    reason      VARCHAR(120),
    CHECK (ends_at > starts_at),
    FOREIGN KEY (business_id, member_id) REFERENCES business_members(business_id, id) ON DELETE CASCADE
);


-- ════════════════════════════════════════════════════════════════════════════
--  5. XIZMATLAR
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE service_categories (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name         VARCHAR(80) NOT NULL,
    sort_order   SMALLINT NOT NULL DEFAULT 0,
    UNIQUE (business_id, id)
);

CREATE TABLE services (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id   BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    category_id   BIGINT,
    name          VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
    description   TEXT,
    duration_min  INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 720),
    price         BIGINT  NOT NULL CHECK (price >= 0),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, id),
    FOREIGN KEY (business_id, category_id) REFERENCES service_categories(business_id, id)
);
CREATE INDEX ON services (business_id, is_active);

CREATE TABLE member_services (
    business_id     BIGINT NOT NULL,
    member_id       BIGINT NOT NULL,
    service_id      BIGINT NOT NULL,
    custom_price    BIGINT  CHECK (custom_price >= 0),
    custom_duration INTEGER CHECK (custom_duration BETWEEN 5 AND 720),
    PRIMARY KEY (member_id, service_id),
    FOREIGN KEY (business_id, member_id)  REFERENCES business_members(business_id, id) ON DELETE CASCADE,
    FOREIGN KEY (business_id, service_id) REFERENCES services(business_id, id) ON DELETE CASCADE
);


-- ════════════════════════════════════════════════════════════════════════════
--  6. MIJOZLAR (biznes ichidagi CRM)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE business_clients (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id    BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id        BIGINT REFERENCES users(id),
    full_name      VARCHAR(120) NOT NULL,
    phone          VARCHAR(13)  NOT NULL CHECK (phone ~ '^\+998[0-9]{9}$'),
    notes          TEXT,
    visits_count   INTEGER NOT NULL DEFAULT 0 CHECK (visits_count >= 0),
    total_spent    BIGINT  NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    bonus_balance  BIGINT  NOT NULL DEFAULT 0 CHECK (bonus_balance >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, phone),
    UNIQUE (business_id, id)
);
CREATE INDEX ON business_clients (user_id);

CREATE TABLE favorites (
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, business_id)
);


-- ════════════════════════════════════════════════════════════════════════════
--  7. BRONLAR
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE appointments (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    client_id       BIGINT NOT NULL,
    member_id       BIGINT NOT NULL,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    status          appointment_status NOT NULL DEFAULT 'pending',
    source          booking_source     NOT NULL DEFAULT 'app',
    total_price     BIGINT NOT NULL DEFAULT 0 CHECK (total_price >= 0),
    discount        BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
    client_note     TEXT,
    cancel_reason   TEXT,
    created_by      BIGINT REFERENCES users(id),
    checked_in_at   TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, id),
    CHECK (ends_at > starts_at),
    CHECK (ends_at - starts_at <= INTERVAL '12 hours'),
    CHECK (discount <= total_price),
    -- Usta va mijoz shu biznesniki bo'lishi shart
    FOREIGN KEY (business_id, member_id) REFERENCES business_members(business_id, id),
    FOREIGN KEY (business_id, client_id) REFERENCES business_clients(business_id, id),
    -- Bitta xodimga bir vaqtda ikkita faol bron yozib bo'lmaydi
    CONSTRAINT no_double_booking EXCLUDE USING GIST (
        member_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
    ) WHERE (status IN ('pending', 'confirmed', 'in_progress'))
);
CREATE INDEX ON appointments (business_id, starts_at);
CREATE INDEX ON appointments (member_id, starts_at);
CREATE INDEX ON appointments (client_id);

CREATE TABLE appointment_services (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT  NOT NULL,
    appointment_id  BIGINT  NOT NULL,
    service_id      BIGINT  NOT NULL,
    service_name    VARCHAR(120) NOT NULL,                   -- o'sha paytdagi nom
    price           BIGINT  NOT NULL CHECK (price >= 0),     -- o'sha paytdagi narx
    duration_min    INTEGER NOT NULL CHECK (duration_min > 0),
    FOREIGN KEY (business_id, appointment_id) REFERENCES appointments(business_id, id) ON DELETE CASCADE,
    FOREIGN KEY (business_id, service_id)     REFERENCES services(business_id, id)
);
CREATE INDEX ON appointment_services (appointment_id);


-- ════════════════════════════════════════════════════════════════════════════
--  8. TO'LOVLAR, XARAJATLAR, OYLIK
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE payments (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id      BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    appointment_id   BIGINT,
    client_id        BIGINT,
    amount           BIGINT NOT NULL CHECK (amount > 0),
    method           payment_method NOT NULL,
    status           payment_status NOT NULL DEFAULT 'paid',
    provider_txn_id  VARCHAR(100),
    received_by      BIGINT,
    paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    note             TEXT,
    FOREIGN KEY (business_id, appointment_id) REFERENCES appointments(business_id, id),
    FOREIGN KEY (business_id, client_id)      REFERENCES business_clients(business_id, id),
    FOREIGN KEY (business_id, received_by)    REFERENCES business_members(business_id, id),
    UNIQUE (method, provider_txn_id)                          -- bitta provayder to'lovi ikki marta yozilmaydi
);
CREATE INDEX ON payments (business_id, paid_at DESC);

CREATE TABLE expense_categories (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name         VARCHAR(80) NOT NULL,
    UNIQUE (business_id, id)
);

CREATE TABLE expenses (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    category_id  BIGINT,
    amount       BIGINT NOT NULL CHECK (amount > 0),
    spent_at     DATE   NOT NULL DEFAULT CURRENT_DATE,
    note         TEXT,
    created_by   BIGINT REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (business_id, category_id) REFERENCES expense_categories(business_id, id)
);
CREATE INDEX ON expenses (business_id, spent_at DESC);

CREATE TABLE payrolls (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id   BIGINT NOT NULL,
    member_id     BIGINT NOT NULL,
    period_start  DATE   NOT NULL,
    period_end    DATE   NOT NULL,
    base_salary   BIGINT NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
    commission    BIGINT NOT NULL DEFAULT 0 CHECK (commission >= 0),
    bonus         BIGINT NOT NULL DEFAULT 0 CHECK (bonus >= 0),
    deductions    BIGINT NOT NULL DEFAULT 0 CHECK (deductions >= 0),
    total         BIGINT GENERATED ALWAYS AS (base_salary + commission + bonus - deductions) STORED,
    status        payroll_status NOT NULL DEFAULT 'draft',
    paid_at       TIMESTAMPTZ,
    CHECK (period_end >= period_start),
    UNIQUE (member_id, period_start, period_end),
    FOREIGN KEY (business_id, member_id) REFERENCES business_members(business_id, id)
);


-- ════════════════════════════════════════════════════════════════════════════
--  9. OMBOR — qoldiq faqat harakatlar orqali o'zgaradi
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE products (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name         VARCHAR(120) NOT NULL,
    sku          VARCHAR(60),
    unit         VARCHAR(20)  NOT NULL DEFAULT 'dona',
    cost_price   BIGINT NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    sale_price   BIGINT NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
    min_qty      NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
    current_qty  NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (current_qty >= 0),   -- manfiy qoldiq bo'lmaydi
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (business_id, sku),
    UNIQUE (business_id, id)
);

CREATE TABLE stock_movements (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL,
    type            stock_move_type NOT NULL,
    qty             NUMERIC(12,3) NOT NULL CHECK (qty <> 0),  -- + kirim, - chiqim
    unit_cost       BIGINT CHECK (unit_cost >= 0),
    member_id       BIGINT,
    appointment_id  BIGINT,
    note            TEXT,
    created_by      BIGINT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (business_id, product_id)     REFERENCES products(business_id, id),
    FOREIGN KEY (business_id, member_id)      REFERENCES business_members(business_id, id),
    FOREIGN KEY (business_id, appointment_id) REFERENCES appointments(business_id, id)
);
CREATE INDEX ON stock_movements (business_id, product_id, created_at DESC);


-- ════════════════════════════════════════════════════════════════════════════
--  10. SHARHLAR, BILDIRISHNOMALAR, AUDIT
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE reviews (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    appointment_id  BIGINT NOT NULL UNIQUE,                  -- bitta tashrif = bitta sharh
    user_id         BIGINT NOT NULL REFERENCES users(id),
    member_id       BIGINT,
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT CHECK (length(comment) <= 2000),
    reply           TEXT CHECK (length(reply) <= 2000),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (business_id, appointment_id) REFERENCES appointments(business_id, id),
    FOREIGN KEY (business_id, member_id)      REFERENCES business_members(business_id, id)
);
CREATE INDEX ON reviews (business_id, created_at DESC);

CREATE TABLE notifications (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id  BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
    type         VARCHAR(40) NOT NULL,
    title        VARCHAR(160) NOT NULL,
    body         TEXT,
    data         JSONB,
    read_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC);

CREATE TABLE audit_logs (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
    user_id      BIGINT REFERENCES users(id),
    action       VARCHAR(40) NOT NULL,
    entity_type  VARCHAR(40) NOT NULL,
    entity_id    BIGINT,
    changes      JSONB,
    ip           INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_logs (business_id, created_at DESC);


-- ════════════════════════════════════════════════════════════════════════════
--  Boshlang'ich ma'lumotlar
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO business_categories (slug, name_uz, name_ru, icon, sort_order) VALUES
    ('beauty_salon', 'Go''zallik saloni', 'Салон красоты', 'sparkles',    1),
    ('barbershop',   'Sartaroshxona',     'Барбершоп',     'scissors',    2),
    ('clinic',       'Klinika',           'Клиника',       'stethoscope', 3),
    ('dental',       'Stomatologiya',     'Стоматология',  'tooth',       4),
    ('spa',          'SPA / Massaj',      'СПА / Массаж',  'leaf',        5);

INSERT INTO modules (code, name) VALUES
    ('booking',        'Onlayn bron'),
    ('inventory',      'Ombor'),
    ('payroll',        'Oylik hisob-kitob'),
    ('finance',        'Daromad va xarajatlar'),
    ('reviews',        'Sharhlar'),
    ('online_payment', 'Onlayn to''lov (Click/Payme)');

INSERT INTO permissions (code, module_code, description) VALUES
    ('business.manage',       NULL,        'Biznes profili, ish soatlari, rasmlar'),
    ('staff.manage',          NULL,        'Xodimlarni qo''shish, huquq berish'),
    ('appointments.view_own', 'booking',   'O''z bronlarini ko''rish'),
    ('appointments.view_all', 'booking',   'Barcha bronlarni ko''rish'),
    ('appointments.manage',   'booking',   'Bron yaratish/o''zgartirish'),
    ('clients.view',          'booking',   'Mijozlar bazasi'),
    ('services.manage',       'booking',   'Xizmat va narxlar'),
    ('inventory.view',        'inventory', 'Omborni ko''rish'),
    ('inventory.manage',      'inventory', 'Kirim/chiqim'),
    ('payments.accept',       'finance',   'To''lov qabul qilish'),
    ('finance.view',          'finance',   'Daromad/xarajat hisobotlari'),
    ('payroll.manage',        'payroll',   'Oylik hisoblash');

INSERT INTO role_permissions (role, permission_code)
SELECT 'owner', code FROM permissions;
INSERT INTO role_permissions (role, permission_code) VALUES
    ('manager', 'appointments.view_all'), ('manager', 'appointments.manage'), ('manager', 'clients.view'),
    ('manager', 'services.manage'),       ('manager', 'inventory.view'),      ('manager', 'inventory.manage'),
    ('manager', 'payments.accept'),
    ('receptionist', 'appointments.view_all'), ('receptionist', 'appointments.manage'),
    ('receptionist', 'clients.view'),          ('receptionist', 'payments.accept'),
    ('staff', 'appointments.view_own');
