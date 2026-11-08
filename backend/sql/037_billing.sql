-- Onlayn obuna to'lovi: Payme va Click (TZ 2026-11-09).
--
--   Direktor panelda paket tanlaydi (1/3/6/12 oy) -> billing_orders da buyurtma ochiladi -> Payme yoki Click
--   sahifasiga o'tadi -> to'lov tizimi serverimizga so'rov yuboradi (webhook) -> buyurtma to'landi,
--   obuna shu zahoti uzayadi, panel ochiladi.
--
-- Xavfsizlik bazada:
--   * Summani bazaning o'zi hisoblaydi (muassasa oylik narxi x oylar x paket chegirmasi). So'rovdagi summaga
--     ishonilmaydi: aks holda kimdir 1 so'mlik buyurtma ochib, 1 so'm to'lab bir yillik obuna olardi.
--   * Buyurtmani faqat muassasa direktori ochadi — obuna tugagan bo'lsa ham (aynan shunda to'lashi kerak).
--     Bloklangan muassasa ('blocked', qoidabuzarlik) to'lov bilan ochilmaydi.
--   * To'lov holatlarini ilova to'g'ridan-to'g'ri o'zgartira olmaydi: faqat quyidagi SECURITY DEFINER
--     funksiyalar orqali (Payme/Click protokoli qadamlari). Imzo/kalit tekshiruvi Python tomonida, undan keyin.
--   * Bitta buyurtma faqat bir marta obunani uzaytiradi (qayta kelgan webhook ikkinchi marta qo'shmaydi).

-- Muassasaning oylik obuna narxi (so'm). Tarifni Super Admin belgilaydi (Start 199 000, Biznes 399 000 ...)
ALTER TABLE businesses ADD COLUMN monthly_fee BIGINT NOT NULL DEFAULT 199000 CHECK (monthly_fee BETWEEN 0 AND 100000000);

-- Paketlar: necha oy va chegirma (%). Super Admin o'zgartiradi
CREATE TABLE billing_packages (
    months        SMALLINT PRIMARY KEY CHECK (months BETWEEN 1 AND 24),
    discount_pct  SMALLINT NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 90),
    is_active     BOOLEAN  NOT NULL DEFAULT TRUE
);
INSERT INTO billing_packages (months, discount_pct) VALUES (1, 0), (3, 0), (6, 0), (12, 0);

CREATE TABLE billing_orders (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    months       SMALLINT NOT NULL REFERENCES billing_packages(months),
    amount       BIGINT NOT NULL CHECK (amount > 0),                 -- so'm
    provider     VARCHAR(10) NOT NULL CHECK (provider IN ('payme', 'click')),
    status       VARCHAR(12) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'cancelled')),
    created_by   BIGINT REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at      TIMESTAMPTZ,
    payment_id   BIGINT REFERENCES subscription_payments(id)
);
CREATE INDEX ON billing_orders (business_id, created_at DESC);

-- Payme / Click tranzaksiyalari. state: 1 yaratilgan, 2 bajarilgan, -1 bajarilmasdan bekor, -2 bajarilgandan keyin bekor.
-- Vaqtlar Payme talabi bo'yicha millisekundda.
CREATE TABLE payment_transactions (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider      VARCHAR(10) NOT NULL CHECK (provider IN ('payme', 'click')),
    ext_id        VARCHAR(64) NOT NULL,                              -- Payme id / Click click_trans_id
    order_id      BIGINT NOT NULL REFERENCES billing_orders(id) ON DELETE CASCADE,
    amount        BIGINT NOT NULL,                                   -- so'm
    state         SMALLINT NOT NULL DEFAULT 1 CHECK (state IN (1, 2, -1, -2)),
    provider_time BIGINT,                                            -- Payme 'time' (ms)
    create_time   BIGINT NOT NULL DEFAULT (extract(epoch FROM clock_timestamp()) * 1000)::bigint,
    perform_time  BIGINT NOT NULL DEFAULT 0,
    cancel_time   BIGINT NOT NULL DEFAULT 0,
    reason        SMALLINT,
    UNIQUE (provider, ext_id)
);
CREATE INDEX ON payment_transactions (order_id);
CREATE INDEX ON payment_transactions (provider, create_time);

ALTER TABLE subscription_payments DROP CONSTRAINT subscription_payments_method_check;
ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_method_check
    CHECK (method IN ('cash', 'card', 'transfer', 'free', 'payme', 'click'));

-- ─── Kim to'lay oladi ───────────────────────────────────────────────────────
-- Faol direktor, muassasa bloklanmagan. Obuna holatiga QARAMAYDI (has_perm dan farqi shu).
CREATE FUNCTION app.billing_owner(p_business BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM business_members m
          JOIN businesses b ON b.id = m.business_id AND b.status IN ('active', 'pending')
          JOIN users u      ON u.id = m.user_id AND u.status = 'active'
         WHERE m.business_id = p_business AND m.user_id = app.uid() AND m.role = 'owner' AND m.is_active)
$$;

-- To'lov sahifasi uchun muassasa ma'lumoti. Obunasi tugaganda RLS uni direktorga ko'rsatmaydi (has_perm),
-- shuning uchun shu funksiya orqali — faqat o'sha muassasa direktoriga (yoki Super Admin'ga)
CREATE FUNCTION app.billing_business(p_business BIGINT)
RETURNS TABLE (id BIGINT, name TEXT, slug TEXT, status TEXT, monthly_fee BIGINT, subscription_ends_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT b.id, b.name::text, b.slug::text, b.status::text, b.monthly_fee, b.subscription_ends_at
      FROM businesses b
     WHERE b.id = p_business AND (app.billing_owner(p_business) OR app.is_superadmin())
$$;

-- Paket narxi (so'm). Chegirma pastga yaxlitlanadi, natija kamida 1 so'm.
CREATE FUNCTION app.billing_price(p_business BIGINT, p_months SMALLINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT greatest(1, (b.monthly_fee * p.months * (100 - p.discount_pct)) / 100)
      FROM businesses b, billing_packages p
     WHERE b.id = p_business AND p.months = p_months AND p.is_active AND b.monthly_fee > 0
$$;

ALTER TABLE billing_packages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON billing_packages TO app_api;
GRANT UPDATE (discount_pct, is_active) ON billing_packages TO app_api;
CREATE POLICY read_all ON billing_packages FOR SELECT TO app_api USING (TRUE);
CREATE POLICY superadmin_update ON billing_packages FOR UPDATE TO app_api
    USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());

ALTER TABLE billing_orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON billing_orders TO app_api;
CREATE POLICY owner_read ON billing_orders FOR SELECT TO app_api
    USING (app.is_superadmin() OR app.billing_owner(business_id));
CREATE POLICY owner_insert ON billing_orders FOR INSERT TO app_api
    WITH CHECK (app.billing_owner(business_id));

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON payment_transactions TO app_api;
CREATE POLICY superadmin_read ON payment_transactions FOR SELECT TO app_api USING (app.is_superadmin());

-- Buyurtma ochilganda: summa, holat, kim va qachon — bazaning o'zi qo'yadi
CREATE FUNCTION app.guard_billing_orders() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.amount := app.billing_price(NEW.business_id, NEW.months);
    IF NEW.amount IS NULL THEN
        RAISE EXCEPTION 'billing_package_unavailable' USING ERRCODE = '22023';
    END IF;
    NEW.status := 'created';
    NEW.created_by := app.uid();
    NEW.created_at := now();
    NEW.paid_at := NULL;
    NEW.payment_id := NULL;
    RETURN NEW;
END $$;
CREATE TRIGGER guard_billing_orders BEFORE INSERT ON billing_orders
    FOR EACH ROW EXECUTE FUNCTION app.guard_billing_orders();

-- Muassasa oylik narxini faqat Super Admin o'zgartiradi
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
        OR NEW.monthly_fee          IS DISTINCT FROM OLD.monthly_fee) THEN
        RAISE EXCEPTION 'business_field_forbidden' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;

-- ─── To'lov tasdiqlanganda ──────────────────────────────────────────────────
-- Buyurtmani to'langan qiladi va obunani uzaytiradi. Qolgan kunlar kuymaydi: hisob max(tugash, hozir) dan.
-- Bir buyurtma ikki marta uzaytirmaydi. Bloklangan muassasa uzaymaydi (lekin to'lov qayd etiladi).
CREATE FUNCTION app.billing_apply(p_order BIGINT, p_method TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    o billing_orders%ROWTYPE;
    b businesses%ROWTYPE;
    v_start TIMESTAMPTZ;
    v_ends  TIMESTAMPTZ;
    v_pay   BIGINT;
BEGIN
    SELECT * INTO o FROM billing_orders WHERE id = p_order FOR UPDATE;
    IF NOT FOUND OR o.status = 'paid' THEN RETURN; END IF;
    SELECT * INTO b FROM businesses WHERE id = o.business_id FOR UPDATE;
    v_start := greatest(coalesce(b.subscription_ends_at, now()), now());
    v_ends  := v_start + make_interval(months => o.months);
    UPDATE businesses SET subscription_ends_at = v_ends, is_active = TRUE, updated_at = now() WHERE id = b.id;
    INSERT INTO subscription_payments (business_id, business_name, days, amount, method, note, ends_at)
    VALUES (b.id, b.name, greatest(1, ceil(extract(epoch FROM v_ends - v_start) / 86400))::int, o.amount, p_method,
            o.months || ' oy, buyurtma #' || o.id, v_ends)
    RETURNING id INTO v_pay;
    UPDATE billing_orders SET status = 'paid', paid_at = now(), payment_id = v_pay WHERE id = o.id;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (b.id, NULL, 'renew', 'subscription', b.id,
            jsonb_build_object('order_id', o.id, 'months', o.months, 'amount', o.amount, 'method', p_method,
                               'ends_at', v_ends));
END $$;

-- Buyurtmani to'lash mumkinmi: 'ok' | 'order_not_found' | 'wrong_amount' | 'order_unavailable'
CREATE FUNCTION app.billing_check(p_provider TEXT, p_order BIGINT, p_amount BIGINT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN o.id IS NULL OR o.provider <> p_provider THEN 'order_not_found'
        WHEN o.status <> 'created' OR b.status = 'blocked' THEN 'order_unavailable'
        WHEN o.amount <> p_amount THEN 'wrong_amount'
        ELSE 'ok' END
      FROM (SELECT 1) x
      LEFT JOIN billing_orders o ON o.id = p_order
      LEFT JOIN businesses b ON b.id = o.business_id
$$;

-- ─── Payme (Merchant API, JSON-RPC) ─────────────────────────────────────────
-- Payme summani tiyinda yuboradi; bu yerga so'mga aylantirilgan holda keladi (Python 100 ga bo'ladi).
CREATE FUNCTION app.payme_now() RETURNS BIGINT
LANGUAGE sql VOLATILE AS $$ SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint $$;

-- Natija: code ('ok' | xato kodi), create_time, transaction (bizdagi id), state
CREATE FUNCTION app.payme_create(p_ext TEXT, p_order BIGINT, p_amount BIGINT, p_time BIGINT)
RETURNS TABLE (code TEXT, create_time BIGINT, transaction BIGINT, state SMALLINT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
    t payment_transactions%ROWTYPE;
    v_check TEXT;
BEGIN
    SELECT * INTO t FROM payment_transactions WHERE provider = 'payme' AND ext_id = p_ext FOR UPDATE;
    IF FOUND THEN
        IF t.state <> 1 THEN
            RETURN QUERY SELECT 'cannot_perform', t.create_time, t.id, t.state; RETURN;
        END IF;
        IF app.payme_now() - t.create_time > 43200000 THEN          -- 12 soat o'tdi
            UPDATE payment_transactions SET state = -1, reason = 4, cancel_time = app.payme_now() WHERE id = t.id;
            RETURN QUERY SELECT 'cannot_perform', t.create_time, t.id, (-1)::smallint; RETURN;
        END IF;
        RETURN QUERY SELECT 'ok', t.create_time, t.id, t.state; RETURN;
    END IF;

    PERFORM 1 FROM billing_orders WHERE id = p_order FOR UPDATE;    -- bir buyurtmaga parallel ikki tranzaksiya bo'lmasin
    v_check := app.billing_check('payme', p_order, p_amount);
    IF v_check <> 'ok' THEN
        RETURN QUERY SELECT v_check, NULL::bigint, NULL::bigint, NULL::smallint; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM payment_transactions WHERE order_id = p_order AND state = 1) THEN
        RETURN QUERY SELECT 'order_busy', NULL::bigint, NULL::bigint, NULL::smallint; RETURN;
    END IF;
    INSERT INTO payment_transactions (provider, ext_id, order_id, amount, provider_time)
    VALUES ('payme', p_ext, p_order, p_amount, p_time) RETURNING * INTO t;
    RETURN QUERY SELECT 'ok', t.create_time, t.id, t.state;
END $$;

CREATE FUNCTION app.payme_perform(p_ext TEXT)
RETURNS TABLE (code TEXT, perform_time BIGINT, transaction BIGINT, state SMALLINT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
    t payment_transactions%ROWTYPE;
BEGIN
    SELECT * INTO t FROM payment_transactions WHERE provider = 'payme' AND ext_id = p_ext FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found', NULL::bigint, NULL::bigint, NULL::smallint; RETURN;
    END IF;
    IF t.state = 2 THEN
        RETURN QUERY SELECT 'ok', t.perform_time, t.id, t.state; RETURN;
    END IF;
    IF t.state <> 1 THEN
        RETURN QUERY SELECT 'cannot_perform', t.perform_time, t.id, t.state; RETURN;
    END IF;
    IF app.payme_now() - t.create_time > 43200000 THEN
        UPDATE payment_transactions SET state = -1, reason = 4, cancel_time = app.payme_now() WHERE id = t.id;
        RETURN QUERY SELECT 'cannot_perform', t.perform_time, t.id, (-1)::smallint; RETURN;
    END IF;
    UPDATE payment_transactions SET state = 2, perform_time = app.payme_now() WHERE id = t.id RETURNING * INTO t;
    PERFORM app.billing_apply(t.order_id, 'payme');
    RETURN QUERY SELECT 'ok', t.perform_time, t.id, t.state;
END $$;

-- Bajarilgan to'lovni bekor qilish (qaytarish) qabul qilinmaydi: obuna allaqachon berilgan.
-- Pul qaytarish kerak bo'lsa, Super Admin qo'lda hal qiladi.
CREATE FUNCTION app.payme_cancel(p_ext TEXT, p_reason SMALLINT)
RETURNS TABLE (code TEXT, cancel_time BIGINT, transaction BIGINT, state SMALLINT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
    t payment_transactions%ROWTYPE;
BEGIN
    SELECT * INTO t FROM payment_transactions WHERE provider = 'payme' AND ext_id = p_ext FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found', NULL::bigint, NULL::bigint, NULL::smallint; RETURN;
    END IF;
    IF t.state = 1 THEN
        UPDATE payment_transactions SET state = -1, reason = p_reason, cancel_time = app.payme_now()
         WHERE id = t.id RETURNING * INTO t;
    ELSIF t.state = 2 THEN
        RETURN QUERY SELECT 'cannot_cancel', t.cancel_time, t.id, t.state; RETURN;
    END IF;
    RETURN QUERY SELECT 'ok', t.cancel_time, t.id, t.state;
END $$;

CREATE FUNCTION app.payme_get(p_ext TEXT)
RETURNS TABLE (ext_id TEXT, order_id BIGINT, amount BIGINT, state SMALLINT, provider_time BIGINT,
               create_time BIGINT, perform_time BIGINT, cancel_time BIGINT, reason SMALLINT, transaction BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT t.ext_id::text, t.order_id, t.amount, t.state, t.provider_time, t.create_time, t.perform_time,
           t.cancel_time, t.reason, t.id
      FROM payment_transactions t WHERE t.provider = 'payme' AND t.ext_id = p_ext
$$;

CREATE FUNCTION app.payme_statement(p_from BIGINT, p_to BIGINT)
RETURNS TABLE (ext_id TEXT, order_id BIGINT, amount BIGINT, state SMALLINT, provider_time BIGINT,
               create_time BIGINT, perform_time BIGINT, cancel_time BIGINT, reason SMALLINT, transaction BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT t.ext_id::text, t.order_id, t.amount, t.state, t.provider_time, t.create_time, t.perform_time,
           t.cancel_time, t.reason, t.id
      FROM payment_transactions t
     WHERE t.provider = 'payme' AND t.provider_time BETWEEN p_from AND p_to
     ORDER BY t.provider_time
$$;

-- ─── Click (SHOP API: Prepare / Complete) ───────────────────────────────────
-- Natija: Click xato kodi (0 = muvaffaqiyat) va merchant_prepare_id / merchant_confirm_id
CREATE FUNCTION app.click_prepare(p_ext TEXT, p_order BIGINT, p_amount BIGINT)
RETURNS TABLE (error INTEGER, prepare_id BIGINT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
    t payment_transactions%ROWTYPE;
    v_check TEXT;
    v_status TEXT;
BEGIN
    SELECT * INTO t FROM payment_transactions WHERE provider = 'click' AND ext_id = p_ext;
    IF FOUND THEN                                                   -- takroriy Prepare
        RETURN QUERY SELECT CASE WHEN t.state = 2 THEN -4 WHEN t.state < 0 THEN -9 ELSE 0 END, t.id; RETURN;
    END IF;
    PERFORM 1 FROM billing_orders WHERE id = p_order FOR UPDATE;
    v_check := app.billing_check('click', p_order, p_amount);
    IF v_check = 'order_not_found' THEN RETURN QUERY SELECT -5, NULL::bigint; RETURN; END IF;
    IF v_check = 'order_unavailable' THEN
        SELECT status INTO v_status FROM billing_orders WHERE id = p_order;
        RETURN QUERY SELECT CASE WHEN v_status = 'paid' THEN -4 ELSE -9 END, NULL::bigint; RETURN;
    END IF;
    IF v_check = 'wrong_amount' THEN RETURN QUERY SELECT -2, NULL::bigint; RETURN; END IF;
    INSERT INTO payment_transactions (provider, ext_id, order_id, amount)
    VALUES ('click', p_ext, p_order, p_amount) RETURNING * INTO t;
    RETURN QUERY SELECT 0, t.id;
END $$;

-- p_click_error < 0: Click to'lov o'tmaganini aytmoqda — tranzaksiya bekor qilinadi
CREATE FUNCTION app.click_complete(p_ext TEXT, p_order BIGINT, p_prepare BIGINT, p_amount BIGINT, p_click_error INTEGER)
RETURNS TABLE (error INTEGER, confirm_id BIGINT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
    t payment_transactions%ROWTYPE;
BEGIN
    SELECT * INTO t FROM payment_transactions
     WHERE provider = 'click' AND ext_id = p_ext AND id = p_prepare AND order_id = p_order FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT -6, NULL::bigint; RETURN; END IF;
    IF t.state = 2 THEN RETURN QUERY SELECT -4, t.id; RETURN; END IF;
    IF t.state < 0 THEN RETURN QUERY SELECT -9, t.id; RETURN; END IF;
    IF p_click_error < 0 THEN
        UPDATE payment_transactions SET state = -1, cancel_time = app.payme_now() WHERE id = t.id;
        RETURN QUERY SELECT -9, t.id; RETURN;
    END IF;
    IF t.amount <> p_amount THEN RETURN QUERY SELECT -2, t.id; RETURN; END IF;
    IF (SELECT status FROM billing_orders WHERE id = p_order) <> 'created' THEN
        RETURN QUERY SELECT -4, t.id; RETURN;
    END IF;
    UPDATE payment_transactions SET state = 2, perform_time = app.payme_now() WHERE id = t.id;
    PERFORM app.billing_apply(p_order, 'click');
    RETURN QUERY SELECT 0, t.id;
END $$;

REVOKE ALL ON FUNCTION app.billing_business(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_business(BIGINT) TO app_api;
REVOKE ALL ON FUNCTION app.billing_owner(BIGINT), app.billing_price(BIGINT, SMALLINT), app.billing_apply(BIGINT, TEXT),
    app.billing_check(TEXT, BIGINT, BIGINT), app.payme_now(),
    app.payme_create(TEXT, BIGINT, BIGINT, BIGINT), app.payme_perform(TEXT), app.payme_cancel(TEXT, SMALLINT),
    app.payme_get(TEXT), app.payme_statement(BIGINT, BIGINT),
    app.click_prepare(TEXT, BIGINT, BIGINT), app.click_complete(TEXT, BIGINT, BIGINT, BIGINT, INTEGER) FROM PUBLIC;
-- billing_apply ilovaga berilmaydi: faqat to'lov qadamlari ichidan chaqiriladi
GRANT EXECUTE ON FUNCTION app.billing_owner(BIGINT), app.billing_price(BIGINT, SMALLINT),
    app.billing_check(TEXT, BIGINT, BIGINT), app.payme_now(),
    app.payme_create(TEXT, BIGINT, BIGINT, BIGINT), app.payme_perform(TEXT), app.payme_cancel(TEXT, SMALLINT),
    app.payme_get(TEXT), app.payme_statement(BIGINT, BIGINT),
    app.click_prepare(TEXT, BIGINT, BIGINT), app.click_complete(TEXT, BIGINT, BIGINT, BIGINT, INTEGER) TO app_api;
