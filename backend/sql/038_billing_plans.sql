-- Tariflar: Super Admin narxlarni bir joydan boshqaradi (TZ 2026-11-09).
--   billing_plans — nomlangan tariflar (Start, Biznes ...) va ularning oylik narxi.
--   businesses.plan_id — muassasa qaysi tarifda. NULL = maxsus (kelishilgan) narx.
--   To'lov uchun narx doim businesses.monthly_fee dan olinadi (037). Tarif narxi o'zgarsa, Super Admin
--   xohlasa shu tarifdagi muassasalarga ham qo'llaydi — avvalgi kelishuvlar o'zidan-o'zi buzilmaydi.
CREATE TABLE billing_plans (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         VARCHAR(60) NOT NULL,
    name_ru      VARCHAR(60),
    monthly_fee  BIGINT NOT NULL CHECK (monthly_fee BETWEEN 0 AND 100000000),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order   SMALLINT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_plans_name_key ON billing_plans (lower(name));

INSERT INTO billing_plans (name, name_ru, monthly_fee, sort_order) VALUES
    ('Start', 'Старт', 199000, 1),
    ('Biznes', 'Бизнес', 399000, 2);

ALTER TABLE businesses ADD COLUMN plan_id BIGINT REFERENCES billing_plans(id) ON DELETE SET NULL;
UPDATE businesses SET plan_id = (SELECT id FROM billing_plans WHERE name = 'Start') WHERE monthly_fee = 199000;

ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON billing_plans TO app_api;
CREATE POLICY superadmin_all ON billing_plans TO app_api
    USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());

-- Tarifni ham faqat Super Admin o'zgartiradi
CREATE OR REPLACE FUNCTION app.guard_businesses() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF app.is_app_role() AND NOT app.is_superadmin() AND (
           NEW.status               IS DISTINCT FROM OLD.status
        OR NEW.created_by           IS DISTINCT FROM OLD.created_by
        OR NEW.parent_id            IS DISTINCT FROM OLD.parent_id
        OR NEW.rating_avg           IS DISTINCT FROM OLD.rating_avg
        OR NEW.rating_count         IS DISTINCT FROM OLD.rating_count
        OR NEW.is_active            IS DISTINCT FROM OLD.is_active
        OR NEW.subscription_ends_at IS DISTINCT FROM OLD.subscription_ends_at
        OR NEW.monthly_fee          IS DISTINCT FROM OLD.monthly_fee
        OR NEW.plan_id              IS DISTINCT FROM OLD.plan_id) THEN
        RAISE EXCEPTION 'business_field_forbidden' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
