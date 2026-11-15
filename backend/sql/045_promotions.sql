-- 045: Aksiyalar (2026-11-16, mijoz ilovasi "Hot Slots", sovg'a/kupon, tashriflar seriyasi)
--  * promo_rules      — bo'sh soatlarga chegirma: hafta kunlari + vaqt oralig'i + (ixtiyoriy) xizmatlar, % chegirma
--  * promo_codes      — promokodlar: %, limit, bir mijozga bir marta, faqat birinchi tashrif, ilovada ko'rinadigan
--  * loyalty_programs — sodiqlik: har N ta yakunlangan tashrifdan keyingi bron X% arzon
-- Chegirmani faqat baza hisoblaydi (app.best_discount): mijoz so'rovidagi summaga ishonilmaydi.
-- Bir bronga bitta (eng katta) chegirma qo'llanadi, yig'ilmaydi. Kassa allaqachon total_price - discount ni oladi.

ALTER TABLE appointments
    ADD COLUMN discount_source TEXT CHECK (discount_source IN ('hot', 'promo', 'loyalty')),
    ADD COLUMN promo_code_id BIGINT;

CREATE TABLE promo_rules (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 80),
    percent     SMALLINT NOT NULL CHECK (percent BETWEEN 5 AND 70),
    weekdays    SMALLINT[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7
                                           AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]),
    time_from   TIME NOT NULL,
    time_to     TIME NOT NULL,
    service_ids BIGINT[],                                   -- NULL — barcha xizmatlar
    valid_from  DATE NOT NULL DEFAULT current_date,
    valid_to    DATE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (time_to > time_from),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CHECK (service_ids IS NULL OR cardinality(service_ids) BETWEEN 1 AND 100)
);
CREATE INDEX ON promo_rules (business_id) WHERE is_active;

CREATE TABLE promo_codes (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id      BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    code             TEXT NOT NULL CHECK (code ~ '^[A-Z0-9]{3,20}$'),
    title            TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 80),
    percent          SMALLINT NOT NULL CHECK (percent BETWEEN 5 AND 90),
    max_uses         INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    first_visit_only BOOLEAN NOT NULL DEFAULT FALSE,
    is_public        BOOLEAN NOT NULL DEFAULT FALSE,        -- ilovada "Sizga sovg'a" sifatida ko'rinadi
    valid_from       DATE NOT NULL DEFAULT current_date,
    valid_to         DATE,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, code),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

ALTER TABLE appointments
    ADD CONSTRAINT appointments_promo_code_fk FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE SET NULL;
CREATE INDEX ON appointments (promo_code_id) WHERE promo_code_id IS NOT NULL;

CREATE TABLE loyalty_programs (
    business_id     BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    visits_required SMALLINT NOT NULL CHECK (visits_required BETWEEN 2 AND 20),
    reward_percent  SMALLINT NOT NULL CHECK (reward_percent BETWEEN 5 AND 100),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── RLS: aksiyalarni muassasaning 'business.manage' egasi boshqaradi, ko'radi ham shu ───────────────
ALTER TABLE promo_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_programs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON promo_rules, promo_codes, loyalty_programs TO app_api;

CREATE POLICY manage ON promo_rules FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));
CREATE POLICY manage ON promo_codes FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));
CREATE POLICY manage ON loyalty_programs FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));

-- Promokod matni katta harfga keltiriladi (kiritishda "bahor10" ham "BAHOR10" bo'ladi)
CREATE FUNCTION app.normalize_promo_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.code := upper(btrim(NEW.code));
    RETURN NEW;
END $$;
CREATE TRIGGER normalize_code BEFORE INSERT OR UPDATE OF code ON promo_codes
    FOR EACH ROW EXECUTE FUNCTION app.normalize_promo_code();

-- ─── Hisoblash ────────────────────────────────────────────────────────────────────────────────────
-- Bron vaqti (muassasa mahalliy vaqtida) faol bo'sh-soat qoidasiga tushsa — eng katta foiz, aks holda 0
CREATE FUNCTION app.hot_percent(p_business BIGINT, p_service BIGINT, p_starts_at TIMESTAMPTZ) RETURNS SMALLINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(max(r.percent), 0)::SMALLINT
      FROM promo_rules r
      JOIN businesses b ON b.id = r.business_id
     CROSS JOIN LATERAL (SELECT p_starts_at AT TIME ZONE b.timezone AS t) l
     WHERE r.business_id = p_business AND r.is_active
       AND l.t::date BETWEEN r.valid_from AND coalesce(r.valid_to, 'infinity'::date)
       AND extract(isodow FROM l.t)::SMALLINT = ANY (r.weekdays)
       AND l.t::time >= r.time_from AND l.t::time < r.time_to
       AND (r.service_ids IS NULL OR p_service = ANY (r.service_ids))
$$;

-- Sodiqlik: oxirgi mukofotdan keyin nechta yakunlangan tashrif bor
CREATE FUNCTION app.loyalty_status(p_business BIGINT, p_user BIGINT)
RETURNS TABLE (visits INTEGER, required INTEGER, percent INTEGER, ready BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH lp AS (SELECT * FROM loyalty_programs WHERE business_id = p_business AND is_active),
    cl AS (SELECT id FROM business_clients WHERE business_id = p_business AND user_id = p_user),
    last_reward AS (
        SELECT max(a.starts_at) AS at FROM appointments a
         WHERE a.client_id IN (SELECT id FROM cl) AND a.business_id = p_business
           AND a.discount_source = 'loyalty' AND a.status <> 'cancelled'),
    done AS (
        SELECT count(*)::int AS n FROM appointments a, last_reward lr
         WHERE a.client_id IN (SELECT id FROM cl) AND a.business_id = p_business AND a.status = 'completed'
           AND a.starts_at > coalesce(lr.at, '-infinity'::timestamptz)
           AND a.discount_source IS DISTINCT FROM 'loyalty')
    SELECT done.n, lp.visits_required::int, lp.reward_percent::int, done.n >= lp.visits_required
      FROM lp, done
$$;

-- Promokodni tekshirish. Xato bo'lsa — aniq sabab (API foydalanuvchiga tushunarli xabar beradi)
CREATE FUNCTION app.promo_check(p_business BIGINT, p_code TEXT, p_user BIGINT,
                                OUT code_id BIGINT, OUT percent SMALLINT, OUT error TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    c promo_codes%ROWTYPE;
    v_today DATE;
BEGIN
    SELECT (now() AT TIME ZONE timezone)::date INTO v_today FROM businesses WHERE id = p_business;
    SELECT * INTO c FROM promo_codes WHERE business_id = p_business AND code = upper(btrim(p_code));
    IF NOT FOUND OR NOT c.is_active OR v_today < c.valid_from OR v_today > coalesce(c.valid_to, 'infinity'::date) THEN
        error := 'promo_not_found';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM appointments a JOIN business_clients bc ON bc.id = a.client_id
                WHERE a.promo_code_id = c.id AND a.status <> 'cancelled' AND bc.user_id = p_user) THEN
        error := 'promo_used';
        RETURN;
    END IF;
    IF c.max_uses IS NOT NULL AND (SELECT count(*) FROM appointments a
                                    WHERE a.promo_code_id = c.id AND a.status <> 'cancelled') >= c.max_uses THEN
        error := 'promo_limit';
        RETURN;
    END IF;
    IF c.first_visit_only AND EXISTS (
        SELECT 1 FROM appointments a JOIN business_clients bc ON bc.id = a.client_id
         WHERE a.business_id = p_business AND bc.user_id = p_user AND a.status IN ('completed', 'in_progress')) THEN
        error := 'promo_first_visit';
        RETURN;
    END IF;
    code_id := c.id;
    percent := c.percent;
END $$;

-- Bron uchun eng katta chegirma: bo'sh soat, sodiqlik va (berilgan bo'lsa) promokod
CREATE FUNCTION app.best_discount(p_business BIGINT, p_service BIGINT, p_starts_at TIMESTAMPTZ, p_user BIGINT,
                                  p_code TEXT DEFAULT NULL)
RETURNS TABLE (percent SMALLINT, source TEXT, code_id BIGINT, code_error TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_hot  SMALLINT := app.hot_percent(p_business, p_service, p_starts_at);
    v_loy  SMALLINT := 0;
    v_pc   RECORD;
BEGIN
    SELECT CASE WHEN l.ready THEN l.percent ELSE 0 END INTO v_loy FROM app.loyalty_status(p_business, p_user) l;
    v_loy := coalesce(v_loy, 0);
    percent := 0;
    IF nullif(btrim(coalesce(p_code, '')), '') IS NOT NULL THEN
        SELECT * INTO v_pc FROM app.promo_check(p_business, p_code, p_user);
        code_error := v_pc.error;
        IF v_pc.error IS NULL THEN
            percent := v_pc.percent;
            source := 'promo';
            code_id := v_pc.code_id;
        END IF;
    END IF;
    IF v_loy > percent THEN
        percent := v_loy; source := 'loyalty'; code_id := NULL;
    END IF;
    IF v_hot > percent THEN
        percent := v_hot; source := 'hot'; code_id := NULL;
    END IF;
    RETURN NEXT;
END $$;

-- Narx va chegirma (so'mda, pastga yaxlitlanadi). Tasdiqlash ekrani shu bilan oldindan ko'rsatadi.
CREATE FUNCTION app.booking_quote(p_member BIGINT, p_service BIGINT, p_starts_at TIMESTAMPTZ, p_code TEXT DEFAULT NULL)
RETURNS TABLE (price BIGINT, percent SMALLINT, discount BIGINT, source TEXT, code_error TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_business BIGINT;
    v_price    BIGINT;
    d          RECORD;
BEGIN
    SELECT m.business_id, coalesce(ms.custom_price, s.price) INTO v_business, v_price
      FROM business_members m
      JOIN member_services ms ON ms.member_id = m.id AND ms.service_id = p_service
      JOIN services s         ON s.id = ms.service_id
     WHERE m.id = p_member AND app.business_is_public(m.business_id);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO d FROM app.best_discount(v_business, p_service, p_starts_at, app.uid(), p_code);
    price := v_price;
    percent := d.percent;
    discount := (v_price * d.percent) / 100;
    source := d.source;
    code_error := d.code_error;
    RETURN NEXT;
END $$;

-- Mijoz o'zi uchun bron qiladi (005 dagi funksiya + promokod va chegirma)
DROP FUNCTION app.book_appointment(BIGINT, BIGINT, TIMESTAMPTZ, TEXT);
CREATE FUNCTION app.book_appointment(p_member BIGINT, p_service BIGINT, p_starts_at TIMESTAMPTZ, p_note TEXT DEFAULT NULL,
                                     p_promo_code TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid      BIGINT := app.uid();
    v_user     users%ROWTYPE;
    v_business BIGINT;
    v_tz       TEXT;
    v_price    BIGINT;
    v_name     TEXT;
    v_end      TIMESTAMPTZ;
    v_client   BIGINT;
    v_id       BIGINT;
    d          RECORD;
BEGIN
    SELECT * INTO v_user FROM users WHERE id = v_uid AND status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;

    SELECT m.business_id, b.timezone, coalesce(ms.custom_price, s.price), s.name
      INTO v_business, v_tz, v_price, v_name
      FROM business_members m
      JOIN businesses b       ON b.id = m.business_id
      JOIN member_services ms ON ms.member_id = m.id AND ms.service_id = p_service
      JOIN services s         ON s.id = ms.service_id
     WHERE m.id = p_member AND app.business_is_public(m.business_id)
       AND app.module_enabled(m.business_id, 'booking');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT c.slot_end INTO v_end
      FROM app.compute_slots(p_member, p_service, (p_starts_at AT TIME ZONE v_tz)::date, 5, NULL) c
     WHERE c.slot_start = p_starts_at;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'slot_not_available' USING ERRCODE = '23P01';
    END IF;

    -- Promokod noto'g'ri bo'lsa — bron qilinmaydi (mijoz chegirma kutgan narxda yozilib qolmasin)
    SELECT * INTO d FROM app.best_discount(v_business, p_service, p_starts_at, v_uid, p_promo_code);
    IF d.code_error = 'promo_not_found' THEN RAISE EXCEPTION 'promo_not_found' USING ERRCODE = 'P0440'; END IF;
    IF d.code_error = 'promo_used' THEN RAISE EXCEPTION 'promo_used' USING ERRCODE = 'P0441'; END IF;
    IF d.code_error = 'promo_limit' THEN RAISE EXCEPTION 'promo_limit' USING ERRCODE = 'P0442'; END IF;
    IF d.code_error = 'promo_first_visit' THEN RAISE EXCEPTION 'promo_first_visit' USING ERRCODE = 'P0443'; END IF;

    -- Telefon OTP bilan tasdiqlangan, shuning uchun salon qo'lda kiritgan mijoz yozuvi shu foydalanuvchiga bog'lanadi
    INSERT INTO business_clients (business_id, user_id, full_name, phone)
    VALUES (v_business, v_uid, v_user.full_name, v_user.phone)
    ON CONFLICT (business_id, phone) DO UPDATE SET user_id = coalesce(business_clients.user_id, EXCLUDED.user_id)
    RETURNING id INTO v_client;

    -- Bitta mijoz salonning butun jadvalini band qilib qo'ymasin
    IF (SELECT count(*) FROM appointments a
         WHERE a.client_id = v_client AND a.status IN ('pending', 'confirmed') AND a.starts_at > now()) >= 5 THEN
        RAISE EXCEPTION 'too_many_bookings' USING ERRCODE = 'P0429';
    END IF;

    INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, source, total_price, discount,
                              discount_source, promo_code_id, client_note, created_by)
    VALUES (v_business, v_client, p_member, p_starts_at, v_end, 'app', v_price, (v_price * d.percent) / 100,
            CASE WHEN d.percent > 0 THEN d.source END, CASE WHEN d.percent > 0 THEN d.code_id END, p_note, v_uid)
    RETURNING id INTO v_id;

    INSERT INTO appointment_services (business_id, appointment_id, service_id, service_name, price, duration_min)
    VALUES (v_business, v_id, p_service, v_name, v_price, extract(epoch FROM v_end - p_starts_at)::int / 60);

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (v_business, v_uid, 'create', 'appointment', v_id,
            jsonb_build_object('member_id', p_member, 'service_id', p_service, 'starts_at', p_starts_at,
                               'discount_percent', d.percent, 'discount_source', d.source));
    RETURN v_id;
END $$;

-- Ko'chirish: bo'sh-soat chegirmasi yangi vaqtga qarab qayta hisoblanadi (chegirma vaqtidan chiqsa — yo'qoladi,
-- yangi vaqt ham chegirmali bo'lsa — o'sha foiz). Promokod va sodiqlik mukofoti vaqtga bog'liq emas, saqlanadi.
CREATE OR REPLACE FUNCTION app.reschedule_appointment(p_id BIGINT, p_starts_at TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v         appointments%ROWTYPE;
    v_salon   BOOLEAN;
    v_tz      TEXT;
    v_service BIGINT;
    v_end     TIMESTAMPTZ;
    v_hot     SMALLINT;
BEGIN
    SELECT * INTO v FROM appointments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    v_salon := app.has_perm(v.business_id, 'appointments.manage');
    IF NOT (v_salon OR v.client_id = ANY (app.my_client_ids())) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v.status NOT IN ('pending', 'confirmed') OR v.starts_at <= now() THEN
        RAISE EXCEPTION 'not_changeable' USING ERRCODE = 'P0409';
    END IF;

    SELECT timezone INTO v_tz FROM businesses WHERE id = v.business_id;
    SELECT service_id INTO v_service FROM appointment_services WHERE appointment_id = p_id ORDER BY id LIMIT 1;

    SELECT c.slot_end INTO v_end
      FROM app.compute_slots(v.member_id, v_service, (p_starts_at AT TIME ZONE v_tz)::date, 5, p_id) c
     WHERE c.slot_start = p_starts_at;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'slot_not_available' USING ERRCODE = '23P01';
    END IF;

    UPDATE appointments
       SET starts_at = p_starts_at, ends_at = v_end, updated_at = now(),
           status = CASE WHEN v_salon THEN status ELSE 'pending' END
     WHERE id = p_id;

    IF v.discount_source = 'hot' THEN
        v_hot := app.hot_percent(v.business_id, v_service, p_starts_at);
        UPDATE appointments
           SET discount = (total_price * v_hot) / 100,
               discount_source = CASE WHEN v_hot > 0 THEN 'hot' END
         WHERE id = p_id;
    END IF;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (v.business_id, app.uid(), 'reschedule', 'appointment', p_id,
            jsonb_build_object('from', v.starts_at, 'to', p_starts_at));
END $$;

-- ─── Ilova uchun ochiq ma'lumot (faqat SECURITY DEFINER funksiyalar orqali) ───────────────────────
-- Bugungi faol bo'sh-soat qoidalari (muassasa ochiq va ilovada ko'rinadigan bo'lsa)
CREATE FUNCTION app.public_hot_rules(p_businesses BIGINT[])
RETURNS TABLE (rule_id BIGINT, business_id BIGINT, title TEXT, percent SMALLINT, time_from TIME, time_to TIME,
               service_ids BIGINT[], today DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.id, r.business_id, r.title, r.percent, r.time_from, r.time_to, r.service_ids,
           (now() AT TIME ZONE b.timezone)::date
      FROM promo_rules r
      JOIN businesses b ON b.id = r.business_id
     WHERE r.business_id = ANY (p_businesses) AND r.is_active
       AND app.business_is_public(r.business_id) AND app.module_enabled(r.business_id, 'booking')
       AND (now() AT TIME ZONE b.timezone)::date BETWEEN r.valid_from AND coalesce(r.valid_to, 'infinity'::date)
       AND extract(isodow FROM now() AT TIME ZONE b.timezone)::SMALLINT = ANY (r.weekdays)
       AND (now() AT TIME ZONE b.timezone)::time < r.time_to
$$;

-- Ilovada ko'rinadigan promokodlar ("Sizga sovg'a")
CREATE FUNCTION app.public_promo_codes(p_businesses BIGINT[])
RETURNS TABLE (business_id BIGINT, code TEXT, title TEXT, percent SMALLINT, first_visit_only BOOLEAN, valid_to DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT c.business_id, c.code, c.title, c.percent, c.first_visit_only, c.valid_to
      FROM promo_codes c
      JOIN businesses b ON b.id = c.business_id
     WHERE c.business_id = ANY (p_businesses) AND c.is_active AND c.is_public
       AND app.business_is_public(c.business_id)
       AND (now() AT TIME ZONE b.timezone)::date BETWEEN c.valid_from AND coalesce(c.valid_to, 'infinity'::date)
       AND (c.max_uses IS NULL OR (SELECT count(*) FROM appointments a
                                    WHERE a.promo_code_id = c.id AND a.status <> 'cancelled') < c.max_uses)
     ORDER BY c.percent DESC, c.id
$$;

-- Mijozning sodiqlik holati: tashrif qilgan muassasalari bo'yicha
CREATE FUNCTION app.my_loyalty()
RETURNS TABLE (business_id BIGINT, visits INTEGER, required INTEGER, percent INTEGER, ready BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT DISTINCT ON (bc.business_id) bc.business_id, l.visits, l.required, l.percent, l.ready
      FROM business_clients bc
      JOIN loyalty_programs lp ON lp.business_id = bc.business_id AND lp.is_active
     CROSS JOIN LATERAL app.loyalty_status(bc.business_id, app.uid()) l
     WHERE bc.user_id = app.uid() AND app.business_is_public(bc.business_id)
$$;

REVOKE ALL ON FUNCTION app.hot_percent(BIGINT, BIGINT, TIMESTAMPTZ), app.loyalty_status(BIGINT, BIGINT),
                       app.promo_check(BIGINT, TEXT, BIGINT),
                       app.best_discount(BIGINT, BIGINT, TIMESTAMPTZ, BIGINT, TEXT),
                       app.booking_quote(BIGINT, BIGINT, TIMESTAMPTZ, TEXT),
                       app.book_appointment(BIGINT, BIGINT, TIMESTAMPTZ, TEXT, TEXT),
                       app.public_hot_rules(BIGINT[]), app.public_promo_codes(BIGINT[]), app.my_loyalty() FROM PUBLIC;
-- Ichki hisob funksiyalari (foydalanuvchi id parametr bilan) API'ga ochilmaydi — faqat ular orqali
GRANT EXECUTE ON FUNCTION app.booking_quote(BIGINT, BIGINT, TIMESTAMPTZ, TEXT),
                          app.book_appointment(BIGINT, BIGINT, TIMESTAMPTZ, TEXT, TEXT),
                          app.public_hot_rules(BIGINT[]), app.public_promo_codes(BIGINT[]), app.my_loyalty() TO app_api;
