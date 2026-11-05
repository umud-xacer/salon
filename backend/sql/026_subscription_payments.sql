-- W7 Super Admin: obuna to'lovlari tarixi.
--   Super Admin obunani uzaytirganda qancha pul, qaysi usulda olinganini yozadi. Platforma daromadi statistikasi
--   shu jadvaldan olinadi. Yozuv faqat qo'shiladi (tahrirlash/o'chirish yo'q). Muassasa o'chirilsa, tarix qoladi:
--   business_id NULL bo'ladi, nomi business_name da saqlanadi.
CREATE TABLE subscription_payments (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id    BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
    business_name  VARCHAR(120) NOT NULL,
    days           INTEGER NOT NULL CHECK (days BETWEEN 1 AND 3660),
    amount         BIGINT  NOT NULL DEFAULT 0 CHECK (amount >= 0),
    method         VARCHAR(20) NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'card', 'transfer', 'free')),
    note           TEXT CHECK (length(note) <= 300),
    ends_at        TIMESTAMPTZ NOT NULL,                     -- uzaytirilgandan keyingi muddat
    created_by     BIGINT REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (method <> 'free' OR amount = 0)
);
CREATE INDEX ON subscription_payments (business_id, created_at DESC);
CREATE INDEX ON subscription_payments (created_at);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON subscription_payments TO app_api;
CREATE POLICY superadmin_all ON subscription_payments TO app_api
    USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());
-- Direktor o'z muassasasining to'lov tarixini ko'radi (yozolmaydi)
CREATE POLICY owner_read ON subscription_payments FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'business.manage'));

-- Kim va qachon — bazaning o'zi qo'yadi (so'rovdan kelgan qiymatga ishonilmaydi)
CREATE FUNCTION app.guard_subscription_payments() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.created_by := app.uid();
    NEW.created_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER guard_subscription_payments BEFORE INSERT ON subscription_payments
    FOR EACH ROW EXECUTE FUNCTION app.guard_subscription_payments();
