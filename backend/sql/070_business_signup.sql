-- Direktor o'zi ro'yxatdan o'tadi (Fresha uslubi), Super Admin tasdiqlaydi, 5 kunlik bepul sinov (2026-11-24).
--
-- Oqim: telefon Telegram bot orqali tasdiqlanadi -> app.self_signup: muassasa 'pending' (ilovada yo'q), direktor
-- a'zo bo'ladi, ariza (business_signups) -> Super Admin app.signup_approve: 'active' + sinov (trial_*),
-- yoki app.signup_reject: ariza jurnalga yoziladi va muassasa o'chiriladi.
-- Sinov davomida worker (app.trial_*) 3-kun SMS, 4-kun Telegram eslatmasi, 6-kun: talablar bajarilgan bo'lsa
-- oylik obunaga o'tkazadi (billing_activate), bo'lmasa o'chiradi. Har qadam trial_events jurnalida (dry-run ham).
-- Odamlarning hisoblari (users) hech qachon o'chirilmaydi — ular mijoz yoki boshqa joyda xodim bo'lishi mumkin.

ALTER TABLE businesses ADD COLUMN signup_source VARCHAR(8) NOT NULL DEFAULT 'admin'
    CHECK (signup_source IN ('admin', 'self'));

CREATE TABLE business_signups (
    business_id      BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    owner_user_id    BIGINT NOT NULL REFERENCES users(id),
    team_size        VARCHAR(6) NOT NULL CHECK (team_size IN ('1', '2-5', '6-10', '11-20', '21+')),
    contact_phone    VARCHAR(16),
    status           VARCHAR(10) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'trial', 'converted')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at      TIMESTAMPTZ,
    reviewed_by      BIGINT REFERENCES users(id),
    trial_started_at TIMESTAMPTZ,
    trial_ends_at    TIMESTAMPTZ,
    sms_day3_at      TIMESTAMPTZ,                         -- 3-kun SMS eslatmasi yuborilgan (yoki dry-run qayd etilgan)
    tg_day4_at       TIMESTAMPTZ,                         -- 4-kun Telegram ogohlantirishi
    end_dry_at       TIMESTAMPTZ,                         -- dry-run: sinov oxiridagi qaror bir marta qayd etildi
    CHECK ((status = 'pending') = (trial_started_at IS NULL))
);
CREATE INDEX ON business_signups (status, created_at DESC);
CREATE INDEX ON business_signups (owner_user_id);

-- Jurnal: muassasa o'chsa ham qoladi (FK yo'q — nom va telefon nusxasi saqlanadi)
CREATE TABLE trial_events (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id   BIGINT NOT NULL,
    business_name TEXT NOT NULL,
    owner_phone   VARCHAR(16),
    event         VARCHAR(20) NOT NULL CHECK (event IN ('signup', 'approved', 'rejected', 'sms_day3', 'tg_day4',
                                                        'converted', 'deleted', 'send_failed')),
    dry_run       BOOLEAN NOT NULL DEFAULT FALSE,
    details       JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON trial_events (created_at DESC);
CREATE INDEX ON trial_events (business_id, created_at DESC);

ALTER TABLE business_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON business_signups, trial_events TO app_api;
-- Super Admin hammasini ko'radi; direktor — o'z arizasini (sinov muddati paneldagi ko'rsatkich uchun)
CREATE POLICY superadmin_read ON business_signups FOR SELECT TO app_api USING (app.is_superadmin());
CREATE POLICY member_read ON business_signups FOR SELECT TO app_api USING (business_id = ANY (app.my_business_ids()));
CREATE POLICY superadmin_read ON trial_events FOR SELECT TO app_api USING (app.is_superadmin());
-- O'zgartirish faqat quyidagi funksiyalar orqali (SECURITY DEFINER)

CREATE FUNCTION app.trial_log(p_business BIGINT, p_event TEXT, p_dry BOOLEAN, p_details JSONB) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    INSERT INTO trial_events (business_id, business_name, owner_phone, event, dry_run, details)
    SELECT b.id, b.name,
           (SELECT u.phone FROM business_signups s JOIN users u ON u.id = s.owner_user_id WHERE s.business_id = b.id),
           p_event, p_dry, coalesce(p_details, '{}')
      FROM businesses b WHERE b.id = p_business
$$;

-- Kirish bazasi (app_auth) a'zoliklarni ko'rmaydi: ro'yxatdan o'tishda faqat "a'zomi" degan javob kerak
CREATE FUNCTION app.user_has_business(p_user BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM business_members WHERE user_id = p_user AND is_active)
$$;
REVOKE ALL ON FUNCTION app.user_has_business(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.user_has_business(BIGINT) TO app_auth;

-- ─── 1. Ro'yxatdan o'tish ───────────────────────────────────────────────────
-- Chaqiruvchi (app.uid()) — telefoni tasdiqlangan foydalanuvchi. Hech qaysi muassasada a'zo bo'lmasligi va
-- ko'rib chiqilayotgan arizasi bo'lmasligi kerak (spam va ikki marta yuborishga qarshi).
CREATE FUNCTION app.self_signup(p_name TEXT, p_category BIGINT, p_team_size TEXT, p_region TEXT, p_city TEXT,
                                p_address TEXT, p_contact_phone TEXT, p_lat DOUBLE PRECISION,
                                p_lng DOUBLE PRECISION) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid  BIGINT := app.uid();
    v_name TEXT := btrim(coalesce(p_name, ''));
    v_base TEXT;
    v_slug TEXT;
    v_n    INT := 1;
    v_id   BIGINT;
    v_plan RECORD;
    v_solo BOOLEAN := p_team_size = '1';
BEGIN
    IF v_uid IS NULL OR app.is_superadmin() THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM business_members WHERE user_id = v_uid AND is_active) THEN
        RAISE EXCEPTION 'already_member' USING ERRCODE = 'P0460';
    END IF;
    IF length(v_name) < 2 OR length(v_name) > 120 THEN
        RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'P0461';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM business_categories WHERE id = p_category AND is_active) THEN
        RAISE EXCEPTION 'invalid_category' USING ERRCODE = 'P0462';
    END IF;
    IF p_team_size NOT IN ('1', '2-5', '6-10', '11-20', '21+') THEN
        RAISE EXCEPTION 'invalid_team_size' USING ERRCODE = 'P0463';
    END IF;
    IF (p_lat IS NULL) <> (p_lng IS NULL) OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'invalid_location' USING ERRCODE = 'P0464';
    END IF;

    -- Slug: nomdan (lotin harflar), band bo'lsa -2, -3 ...
    v_base := btrim(regexp_replace(lower(replace(replace(v_name, '''', ''), 'ʻ', '')), '[^a-z0-9]+', '-', 'g'), '-');
    v_base := left(coalesce(nullif(v_base, ''), 'salon'), 120);
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM businesses WHERE slug = v_slug) LOOP
        v_n := v_n + 1;
        v_slug := v_base || '-' || v_n;
    END LOOP;

    SELECT id, monthly_fee INTO v_plan FROM billing_plans WHERE is_active ORDER BY sort_order, id LIMIT 1;
    INSERT INTO businesses (name, slug, category_id, region, city, address, phone, status, is_listed, created_by,
                            plan_id, monthly_fee, is_solo_mode, signup_source, location)
    VALUES (v_name, v_slug, p_category, nullif(btrim(p_region), ''), nullif(btrim(p_city), ''),
            nullif(btrim(p_address), ''), nullif(btrim(p_contact_phone), ''), 'pending', FALSE, v_uid,
            v_plan.id, coalesce(v_plan.monthly_fee, 199000), v_solo, 'self',
            CASE WHEN p_lat IS NOT NULL THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography END)
    RETURNING id INTO v_id;

    -- Turning standart ish vaqti (dushanba-shanba) — direktor keyin o'zgartiradi
    INSERT INTO business_hours (business_id, weekday, opens_at, closes_at)
    SELECT v_id, d, c.opens_at, c.closes_at FROM business_categories c, generate_series(1, 6) d WHERE c.id = p_category;
    INSERT INTO business_members (business_id, user_id, role, is_bookable) VALUES (v_id, v_uid, 'owner', FALSE);
    INSERT INTO business_modules (business_id, module_code, enabled)
    SELECT v_id, code, TRUE FROM modules WHERE code IN ('booking', 'finance', 'inventory', 'payroll', 'reviews');
    IF v_solo THEN
        PERFORM app.solo_apply(v_id);
    END IF;
    INSERT INTO business_signups (business_id, owner_user_id, team_size, contact_phone)
    VALUES (v_id, v_uid, p_team_size, nullif(btrim(p_contact_phone), ''));
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (v_id, v_uid, 'create', 'business', v_id, jsonb_build_object('by', 'self_signup', 'team_size', p_team_size));
    PERFORM app.trial_log(v_id, 'signup', FALSE, jsonb_build_object('team_size', p_team_size, 'category_id', p_category));
    RETURN v_id;
END $$;

-- ─── 2. Tayyorlik (direktor paneli, Super Admin va worker uchun bitta hisob) ─────────────────────
-- logged_in: sinov boshlangandan keyin direktor kirgan yoki muassasada biror amal bajarilgan
-- all_filled: xizmatlar + xizmat bog'langan mutaxassis + ish vaqti + xaritadagi manzil
-- visible: mijoz ilovasida ko'rinadi (catalog._PUBLIC_WHERE bilan bir xil shartlar)
CREATE FUNCTION app.trial_readiness(p_business BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    b   businesses%ROWTYPE;
    s   business_signups%ROWTYPE;
    r   JSONB;
    v_since TIMESTAMPTZ;
BEGIN
    -- SECURITY DEFINER ichida current_user — egasi, shuning uchun ulanish roli (session_user) tekshiriladi
    IF session_user::text IN ('app_api', 'app_auth')
       AND NOT (app.is_superadmin() OR p_business = ANY (app.my_business_ids())) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO b FROM businesses WHERE id = p_business;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO s FROM business_signups WHERE business_id = p_business;
    v_since := coalesce(s.trial_started_at, s.created_at, b.created_at);
    r := jsonb_build_object(
        -- kirgan yoki ochiq sessiyada ishlagan (sessiya yangilanishi — refresh token) yoki biror amal bajarilgan
        'logged_in', EXISTS (SELECT 1 FROM users u WHERE u.id = s.owner_user_id AND u.last_login_at >= v_since)
                  OR EXISTS (SELECT 1 FROM refresh_tokens rt WHERE rt.user_id = s.owner_user_id AND rt.created_at >= v_since)
                  OR EXISTS (SELECT 1 FROM audit_logs a WHERE a.business_id = b.id AND a.created_at >= v_since
                               AND coalesce(a.changes ->> 'by', '') <> 'self_signup'),
        'services', EXISTS (SELECT 1 FROM services x WHERE x.business_id = b.id AND x.is_active),
        'staff', EXISTS (SELECT 1 FROM business_members m JOIN member_services ms ON ms.member_id = m.id
                          JOIN services x ON x.id = ms.service_id AND x.is_active
                         WHERE m.business_id = b.id AND m.is_active AND m.is_bookable),
        'hours', EXISTS (SELECT 1 FROM business_hours h WHERE h.business_id = b.id),
        'location', b.location IS NOT NULL,
        'photos', EXISTS (SELECT 1 FROM business_photos p WHERE p.business_id = b.id),
        'visible', b.status = 'active' AND b.is_listed AND b.location IS NOT NULL AND app.has_public_offer(b.id)
                   AND EXISTS (SELECT 1 FROM business_categories c WHERE c.id = b.category_id AND c.is_active));
    RETURN r || jsonb_build_object('all_filled', (r ->> 'services')::bool AND (r ->> 'staff')::bool
                                                 AND (r ->> 'hours')::bool AND (r ->> 'location')::bool);
END $$;

-- ─── 3. Super Admin: tasdiqlash / rad etish ─────────────────────────────────
CREATE FUNCTION app.signup_approve(p_business BIGINT, p_days INT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT app.is_superadmin() THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF p_days NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION 'invalid_days' USING ERRCODE = 'P0465';
    END IF;
    UPDATE business_signups SET status = 'trial', reviewed_at = now(), reviewed_by = app.uid(),
           trial_started_at = now(), trial_ends_at = now() + make_interval(days => p_days)
     WHERE business_id = p_business AND status = 'pending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'signup_not_pending' USING ERRCODE = 'P0466';
    END IF;
    -- Sinov davomida to'liq ishlaydi; ilovaga chiqishi direktor ma'lumotlarni to'ldirgach (is_listed)
    UPDATE businesses SET status = 'active', is_active = TRUE, is_listed = TRUE,
           subscription_ends_at = now() + make_interval(days => p_days)
     WHERE id = p_business;
    PERFORM app.trial_log(p_business, 'approved', FALSE, jsonb_build_object('days', p_days, 'by', app.uid()));
END $$;

CREATE FUNCTION app.signup_reject(p_business BIGINT, p_reason TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT app.is_superadmin() THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM business_signups WHERE business_id = p_business AND status = 'pending') THEN
        RAISE EXCEPTION 'signup_not_pending' USING ERRCODE = 'P0466';
    END IF;
    PERFORM app.trial_log(p_business, 'rejected', FALSE,
                          jsonb_build_object('reason', left(coalesce(p_reason, ''), 500), 'by', app.uid()));
    PERFORM app.delete_business(p_business);
END $$;

-- ─── 4. Worker ──────────────────────────────────────────────────────────────
-- Sinovdagi arizalar: tayyorlik, direktor telefoni va Telegram chat (eslatmalar uchun)
CREATE FUNCTION app.trial_list()
RETURNS TABLE (business_id BIGINT, name TEXT, slug TEXT, owner_phone TEXT, owner_name TEXT, owner_chat BIGINT,
               trial_started_at TIMESTAMPTZ, trial_ends_at TIMESTAMPTZ, sms_day3_at TIMESTAMPTZ,
               tg_day4_at TIMESTAMPTZ, end_dry_at TIMESTAMPTZ, readiness JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT s.business_id, b.name, b.slug, u.phone, u.full_name,
           (SELECT i.chat_id FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'telegram'
               AND i.chat_id IS NOT NULL ORDER BY i.id LIMIT 1),
           s.trial_started_at, s.trial_ends_at, s.sms_day3_at, s.tg_day4_at, s.end_dry_at,
           app.trial_readiness(s.business_id)
      FROM business_signups s
      JOIN businesses b ON b.id = s.business_id
      JOIN users u ON u.id = s.owner_user_id
     WHERE s.status = 'trial'
     ORDER BY s.trial_started_at
$$;

CREATE FUNCTION app.trial_mark(p_business BIGINT, p_kind TEXT, p_dry BOOLEAN, p_details JSONB) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_kind = 'sms_day3' THEN
        UPDATE business_signups SET sms_day3_at = now() WHERE business_id = p_business AND sms_day3_at IS NULL;
    ELSIF p_kind = 'tg_day4' THEN
        UPDATE business_signups SET tg_day4_at = now() WHERE business_id = p_business AND tg_day4_at IS NULL;
    ELSIF p_kind IN ('converted', 'deleted') AND p_dry THEN
        UPDATE business_signups SET end_dry_at = now() WHERE business_id = p_business AND end_dry_at IS NULL;
    ELSIF p_kind <> 'send_failed' THEN
        RAISE EXCEPTION 'invalid_kind' USING ERRCODE = 'P0467';
    END IF;
    PERFORM app.trial_log(p_business, p_kind, p_dry, p_details);
END $$;

-- Sinov tugadi, talablar bajarilgan: oylik obunaga (faollashtirish: 1-sanagacha kunbay hisob va muhlat)
CREATE FUNCTION app.trial_convert(p_business BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE business_signups SET status = 'converted' WHERE business_id = p_business AND status = 'trial';
    IF NOT FOUND THEN
        RETURN;
    END IF;
    PERFORM app.billing_activate(p_business);
    PERFORM app.trial_log(p_business, 'converted', FALSE, app.trial_readiness(p_business));
END $$;

-- Sinov tugadi, talablar bajarilmagan: muassasa va uning ma'lumotlari o'chadi (odamlarning hisoblari qoladi).
-- Faqat shu ariza orqali o'zi ro'yxatdan o'tgan va hali sinovdagi muassasa — boshqa hech narsaga tegmaydi.
CREATE FUNCTION app.trial_delete(p_business BIGINT, p_details JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM business_signups s JOIN businesses b ON b.id = s.business_id
                    WHERE s.business_id = p_business AND s.status = 'trial' AND b.signup_source = 'self'
                      AND s.trial_ends_at <= now()
                      AND NOT EXISTS (SELECT 1 FROM businesses ch WHERE ch.parent_id = b.id)) THEN
        RETURN FALSE;
    END IF;
    PERFORM app.trial_log(p_business, 'deleted', FALSE, p_details);
    DELETE FROM reviews          WHERE business_id = p_business;
    DELETE FROM payments         WHERE business_id = p_business;
    DELETE FROM stock_movements  WHERE business_id = p_business;
    DELETE FROM payroll_advances WHERE business_id = p_business;
    DELETE FROM payrolls         WHERE business_id = p_business;
    DELETE FROM appointments     WHERE business_id = p_business;
    DELETE FROM businesses WHERE id = p_business;
    RETURN TRUE;
END $$;

REVOKE ALL ON FUNCTION app.trial_log(BIGINT, TEXT, BOOLEAN, JSONB),
    app.self_signup(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION),
    app.trial_readiness(BIGINT), app.signup_approve(BIGINT, INT), app.signup_reject(BIGINT, TEXT),
    app.trial_list(), app.trial_mark(BIGINT, TEXT, BOOLEAN, JSONB), app.trial_convert(BIGINT),
    app.trial_delete(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    app.self_signup(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION),
    app.trial_readiness(BIGINT), app.signup_approve(BIGINT, INT), app.signup_reject(BIGINT, TEXT) TO app_api;
GRANT EXECUTE ON FUNCTION app.trial_list(), app.trial_mark(BIGINT, TEXT, BOOLEAN, JSONB), app.trial_convert(BIGINT),
    app.trial_delete(BIGINT, JSONB), app.trial_readiness(BIGINT) TO app_worker;
