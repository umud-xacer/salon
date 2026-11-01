-- Obuna nazorati.
--   is_active = false yoki subscription_ends_at o'tgan: salon TO'XTATILGAN. Hech qanday huquq yo'q,
--   katalogda ko'rinmaydi, eslatma ketmaydi. MA'LUMOT O'CHIRILMAYDI: obuna uzaytirilsa, shu joyidan davom etadi.
--   status = 'blocked' boshqa narsa: Super Admin qoidabuzarlik uchun bloklaydi, to'lov uni ochmaydi.
ALTER TABLE businesses
    ADD COLUMN is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN subscription_ends_at TIMESTAMPTZ;                -- NULL = muddatsiz

UPDATE businesses b
   SET subscription_ends_at = s.ends_at
  FROM (SELECT business_id, max(ends_at) AS ends_at FROM business_subscriptions GROUP BY business_id) s
 WHERE s.business_id = b.id;

-- Biznesni butunlay o'chirish yo'q: CASCADE butun tarixni olib ketardi
REVOKE DELETE ON businesses FROM app_api;

INSERT INTO modules (code, name) VALUES ('sms', 'SMS xabarnomalar');

-- Kassir va menejer kunlik kassa, xarajatlarni yuritadi (modul yoqilgan bo'lsa)
INSERT INTO role_permissions (role, permission_code) VALUES
    ('manager', 'finance.view'), ('receptionist', 'finance.view');


CREATE FUNCTION app.subscription_ok(p_active BOOLEAN, p_ends_at TIMESTAMPTZ) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT p_active AND (p_ends_at IS NULL OR p_ends_at > now())
$$;

-- Salon ishlay oladimi. Muddat vaqt bo'yicha tekshiriladi: worker kechiksa ham obuna shu daqiqada to'xtaydi.
CREATE FUNCTION app.business_operational(p_business BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM businesses
                    WHERE id = p_business AND status IN ('active', 'pending')
                      AND app.subscription_ok(is_active, subscription_ends_at))
$$;

CREATE OR REPLACE FUNCTION app.business_is_public(p_business BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM businesses
                    WHERE id = p_business AND status = 'active' AND is_listed
                      AND app.subscription_ok(is_active, subscription_ends_at))
$$;

CREATE OR REPLACE FUNCTION app.has_perm(p_business BIGINT, p_perm TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT app.is_superadmin() OR EXISTS (
        SELECT 1
          FROM business_members m
          JOIN businesses b ON b.id = m.business_id AND b.status IN ('active', 'pending')
                           AND app.subscription_ok(b.is_active, b.subscription_ends_at)
          JOIN users u      ON u.id = m.user_id     AND u.status = 'active'
         WHERE m.business_id = p_business
           AND m.user_id = app.uid()
           AND m.is_active
           AND coalesce(
                 (SELECT mp.granted FROM member_permissions mp
                   WHERE mp.member_id = m.id AND mp.permission_code = p_perm),
                 EXISTS (SELECT 1 FROM role_permissions rp
                          WHERE rp.role = m.role AND rp.permission_code = p_perm))
           AND app.module_enabled(p_business, (SELECT module_code FROM permissions WHERE code = p_perm))
    )
$$;

DROP POLICY public_read ON businesses;
CREATE POLICY public_read ON businesses FOR SELECT TO app_api
    USING (status = 'active' AND is_listed AND app.subscription_ok(is_active, subscription_ends_at));

CREATE OR REPLACE VIEW public_staff WITH (security_barrier = true) AS
SELECT m.id          AS member_id,
       m.business_id,
       u.full_name,
       m.title,
       m.bio,
       m.photo_url,
       m.rating_avg,
       m.rating_count
  FROM business_members m
  JOIN users u      ON u.id = m.user_id     AND u.status = 'active'
  JOIN businesses b ON b.id = m.business_id AND b.status = 'active' AND b.is_listed
                   AND app.subscription_ok(b.is_active, b.subscription_ends_at)
 WHERE m.is_active AND m.is_bookable;

-- Obuna maydonlarini faqat Super Admin o'zgartiradi: egasi o'zini o'zi uzaytira olmaydi
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
        OR NEW.subscription_ends_at IS DISTINCT FROM OLD.subscription_ends_at) THEN
        RAISE EXCEPTION 'business_field_forbidden' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;

-- Eslatmalar: to'xtatilgan salon mijozlariga xabar ketmaydi
CREATE OR REPLACE FUNCTION app.next_due_reminder(p_lead_min INTEGER)
RETURNS TABLE (appointment_id BIGINT, phone TEXT, business_name TEXT, slot_time TEXT)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT a.id, c.phone::text, b.name::text, to_char(a.starts_at AT TIME ZONE b.timezone, 'HH24:MI')
      FROM appointments a
      JOIN business_clients c ON c.id = a.client_id
      JOIN businesses b       ON b.id = a.business_id AND b.status = 'active'
                             AND app.subscription_ok(b.is_active, b.subscription_ends_at)
     WHERE a.status IN ('pending', 'confirmed')
       AND a.starts_at > now()
       AND a.starts_at <= now() + make_interval(mins => p_lead_min)
       AND a.created_at < a.starts_at - make_interval(mins => p_lead_min)
       AND NOT EXISTS (SELECT 1 FROM appointment_reminders r WHERE r.appointment_id = a.id)
     ORDER BY a.starts_at
     LIMIT 1
       FOR UPDATE OF a SKIP LOCKED
$$;

CREATE OR REPLACE FUNCTION app.create_due_reminders(p_lead_min INTEGER) RETURNS INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH due AS (
        SELECT a.id, a.business_id, a.starts_at, c.user_id, b.name, b.timezone
          FROM appointments a
          JOIN business_clients c ON c.id = a.client_id
          JOIN businesses b       ON b.id = a.business_id AND b.status = 'active'
                                 AND app.subscription_ok(b.is_active, b.subscription_ends_at)
         WHERE a.status IN ('pending', 'confirmed')
           AND a.starts_at > now()
           AND a.starts_at <= now() + make_interval(mins => p_lead_min)
           AND a.created_at < a.starts_at - make_interval(mins => p_lead_min)
           AND NOT EXISTS (SELECT 1 FROM appointment_reminders r WHERE r.appointment_id = a.id)
           FOR UPDATE OF a SKIP LOCKED
    ), added AS (
        INSERT INTO appointment_reminders (appointment_id, business_id, sent_at, delivered)
        SELECT d.id, d.business_id, now(), d.user_id IS NOT NULL FROM due d
        ON CONFLICT (appointment_id) DO NOTHING
        RETURNING appointment_id
    ), sent AS (
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        SELECT d.user_id, d.business_id, 'appointment_reminder', 'Broningiz yaqinlashmoqda',
               d.name || ', ' || to_char(d.starts_at AT TIME ZONE d.timezone, 'HH24:MI') || '. Borasizmi?',
               jsonb_build_object('appointment_id', d.id, 'action', 'confirm_attendance')
          FROM due d JOIN added x ON x.appointment_id = d.id
         WHERE d.user_id IS NOT NULL
        RETURNING 1
    )
    SELECT count(*)::int FROM added
$$;

-- Worker muddati o'tganlarni is_active = false qiladi. Faqat bayroq o'zgaradi, boshqa hech narsaga tegilmaydi.
CREATE FUNCTION app.expire_subscriptions() RETURNS INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH done AS (
        UPDATE businesses SET is_active = FALSE
         WHERE is_active AND subscription_ends_at IS NOT NULL AND subscription_ends_at <= now()
        RETURNING 1
    )
    SELECT count(*)::int FROM done
$$;

REVOKE ALL ON FUNCTION app.subscription_ok(BOOLEAN, TIMESTAMPTZ), app.business_operational(BIGINT),
                       app.expire_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.subscription_ok(BOOLEAN, TIMESTAMPTZ), app.business_operational(BIGINT) TO app_api;
GRANT EXECUTE ON FUNCTION app.subscription_ok(BOOLEAN, TIMESTAMPTZ) TO app_worker;
GRANT EXECUTE ON FUNCTION app.expire_subscriptions() TO app_worker;
