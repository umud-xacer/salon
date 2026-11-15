-- Tarmoq obunasi (TZ 2026-11-15 + foydalanuvchi qarorlari):
--   * Tarmoq (asosiy + filiallar) BITTA umumiy summa to'laydi: asosiy 100%, har filial tarif narxidan
--     branch_discount_pct (standart 30%) chegirma bilan.
--   * Qo'shimcha pullik modul tarmoqqa bir marta to'lanadi va hamma filialda ishlaydi. Super Admin bepul yoqqan
--     modul — "sovg'a" (source = 'gift'), pulga kirmaydi.
--   * Muddatlar har oyning 1-sanasiga to'g'rilanadi (Asia/Tashkent). Oy o'rtasida qo'shilgan kompaniya, filial
--     yoki modul uchun keyingi 1-sanagacha (tarmoqda — tarmoq muddatigacha) KUNBAY summa hisoblanadi.
--   * Faollashtirish: Super Admin kompaniya/filial qo'shgan kuni kunbay summa "qarz" bo'lib yoziladi, muhlat
--     activation_grace_days (standart 1 kun). To'lanmasa panel yopiladi (mavjud to'lov sahifasi), to'lagach
--     o'sha joyidan davom etadi.
-- Summani har doim baza hisoblaydi (so'rovdagi summaga ishonilmaydi) — 037 dagi qoida saqlanadi.

-- ════════════════════════════════════════════════════════════════════════════
--  1. SOZLAMALAR VA NARXLAR
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE billing_settings (
    id                     SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    activation_grace_days  SMALLINT NOT NULL DEFAULT 1 CHECK (activation_grace_days BETWEEN 0 AND 30)
);
INSERT INTO billing_settings DEFAULT VALUES;

ALTER TABLE billing_plans ADD COLUMN branch_discount_pct SMALLINT NOT NULL DEFAULT 30
    CHECK (branch_discount_pct BETWEEN 0 AND 90);

-- Qo'shimcha modul narxi (so'm/oy, tarmoqqa bir marta). 0 = bepul / tarifga kiradi. booking — asosiy, sotilmaydi
CREATE TABLE module_prices (
    module_code  VARCHAR(40) PRIMARY KEY REFERENCES modules(code) ON DELETE CASCADE,
    monthly_fee  BIGINT  NOT NULL DEFAULT 0 CHECK (monthly_fee BETWEEN 0 AND 100000000),
    is_addon     BOOLEAN NOT NULL DEFAULT TRUE          -- direktor Obuna sahifasida o'zi yoqa oladimi
);
INSERT INTO module_prices (module_code) SELECT code FROM modules WHERE code <> 'booking';

-- Modul manbai: gift — Super Admin yoqib bergan (bepul), paid — direktor sotib olgan (oylik summaga kiradi)
ALTER TABLE business_modules ADD COLUMN source VARCHAR(8) NOT NULL DEFAULT 'gift' CHECK (source IN ('gift', 'paid'));

-- To'lanmagan hisoblar: yangi kompaniya/filialni faollashtirish yoki keyinroq qo'shilgan filial
CREATE TABLE billing_charges (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    head_id      BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    kind         VARCHAR(12) NOT NULL CHECK (kind IN ('activation', 'branch')),
    amount       BIGINT NOT NULL CHECK (amount >= 0),
    period_from  TIMESTAMPTZ NOT NULL,
    period_to    TIMESTAMPTZ NOT NULL,
    status       VARCHAR(8) NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'void')),
    order_id     BIGINT REFERENCES billing_orders(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_to > period_from)
);
CREATE INDEX ON billing_charges (head_id, status);

-- Buyurtma turlari: renew — paket (0 = faqat 1-sanagacha kunbay), module — modulni yoqish, charges — qarzlar
ALTER TABLE billing_orders DROP CONSTRAINT billing_orders_months_fkey;
ALTER TABLE billing_orders ADD CONSTRAINT billing_orders_months_check CHECK (months BETWEEN 0 AND 24);
ALTER TABLE billing_orders
    ADD COLUMN kind           VARCHAR(8) NOT NULL DEFAULT 'renew' CHECK (kind IN ('renew', 'module', 'charges')),
    ADD COLUMN module_code    VARCHAR(40) REFERENCES modules(code),
    ADD COLUMN lines          JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN charge_ids     BIGINT[] NOT NULL DEFAULT '{}',
    ADD COLUMN period_ends_at TIMESTAMPTZ;

-- ════════════════════════════════════════════════════════════════════════════
--  2. HISOB FUNKSIYALARI
-- ════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION app.chain_head(p_business BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(parent_id, id) FROM businesses WHERE id = p_business
$$;

-- Toshkent vaqti bo'yicha oyning boshi va "keyingi 1-sana" (aniq 1-sana 00:00 bo'lsa — o'zi)
CREATE FUNCTION app.month_start(p_ts TIMESTAMPTZ) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$
    SELECT date_trunc('month', p_ts AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'
$$;
CREATE FUNCTION app.next_first(p_ts TIMESTAMPTZ) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_ts = app.month_start(p_ts) THEN p_ts ELSE app.month_start(p_ts) + interval '1 month' END
$$;

-- Kunbay summa: [from, to) oralig'i kalendar oylariga bo'linadi, har bo'lak = oylik × kunlar / oydagi kunlar.
-- Kunlar Toshkent sanasi bo'yicha (12-noyabr soat 15:00 dan 1-dekabrgacha = 19 kun). Pastga yaxlitlanadi.
CREATE FUNCTION app.prorate(p_fee BIGINT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ) RETURNS BIGINT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    d_from DATE := (p_from AT TIME ZONE 'Asia/Tashkent')::date;
    d_to   DATE := (p_to   AT TIME ZONE 'Asia/Tashkent')::date;
    cur    DATE;
    m_end  DATE;
    seg    DATE;
    v      NUMERIC := 0;
BEGIN
    IF p_fee <= 0 OR d_to <= d_from THEN RETURN 0; END IF;
    cur := d_from;
    WHILE cur < d_to LOOP
        m_end := (date_trunc('month', cur) + interval '1 month')::date;
        seg := least(m_end, d_to);
        v := v + p_fee::numeric * (seg - cur) / (m_end - date_trunc('month', cur)::date);
        cur := seg;
    END LOOP;
    RETURN floor(v)::bigint;
END $$;

-- Filial chegirmasi (%): asosiy muassasa tarifidan, maxsus narxda — 30
CREATE FUNCTION app.branch_discount(p_head BIGINT) RETURNS SMALLINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce((SELECT p.branch_discount_pct FROM billing_plans p JOIN businesses b ON b.plan_id = p.id
                      WHERE b.id = p_head), 30::smallint)
$$;

-- Bitta filialning oylik qatori
CREATE FUNCTION app.branch_fee(p_head BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT (b.monthly_fee * (100 - app.branch_discount(p_head))) / 100 FROM businesses b WHERE b.id = p_head
$$;

-- Tarmoqning oylik tarkibi: asosiy, filiallar (chegirma bilan), pullik modullar (bir marta)
CREATE FUNCTION app.chain_lines(p_head BIGINT)
RETURNS TABLE (kind TEXT, business_id BIGINT, module_code TEXT, label TEXT, discount_pct SMALLINT, amount BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT 'base', b.id, NULL::text, b.name || coalesce(' · ' || b.branch_name, ''), 0::smallint, b.monthly_fee
      FROM businesses b WHERE b.id = p_head
    UNION ALL
    SELECT * FROM (
        SELECT 'branch', c.id, NULL::text, c.name || coalesce(' · ' || c.branch_name, ''), app.branch_discount(p_head),
               app.branch_fee(p_head)
          FROM businesses c WHERE c.parent_id = p_head AND c.status <> 'blocked' ORDER BY c.id) br
    UNION ALL
    SELECT * FROM (
        SELECT DISTINCT ON (mp.module_code) 'module', NULL::bigint, mp.module_code::text, m.name::text, 0::smallint,
               mp.monthly_fee
          FROM module_prices mp
          JOIN modules m ON m.code = mp.module_code
          JOIN business_modules bm ON bm.module_code = mp.module_code AND bm.source = 'paid' AND bm.enabled
                                  AND bm.expires_at IS NULL
          JOIN businesses x ON x.id = bm.business_id AND (x.id = p_head OR x.parent_id = p_head)
         WHERE mp.monthly_fee > 0
         ORDER BY mp.module_code) md
$$;

CREATE FUNCTION app.chain_monthly(p_head BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(sum(amount), 0)::bigint FROM app.chain_lines(p_head)
$$;

-- Buyurtma narxi. Natija: summa, yangi muddat, tarkib (JSON), qo'shiladigan qarzlar.
--   renew   : kunbay (S -> keyingi 1-sana) + oylik × k × (100 - paket%) + to'lanmagan qarzlar; muddat = 1-sana + k oy
--   module  : modul narxi kunbay (hozir -> tarmoq muddati); tarmoq faol bo'lishi shart
--   charges : faqat to'lanmagan qarzlar
CREATE FUNCTION app.billing_quote(p_business BIGINT, p_kind TEXT, p_months SMALLINT, p_module TEXT DEFAULT NULL)
RETURNS TABLE (amount BIGINT, ends_at TIMESTAMPTZ, lines JSONB, charge_ids BIGINT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_head   BIGINT := app.chain_head(p_business);
    h        businesses%ROWTYPE;
    v_month  BIGINT;
    v_start  TIMESTAMPTZ;
    v_anchor TIMESTAMPTZ;
    v_part   BIGINT := 0;
    v_full   BIGINT := 0;
    v_pct    SMALLINT := 0;
    v_due    BIGINT;
    v_ids    BIGINT[];
    v_lines  JSONB := '[]';
    v_fee    BIGINT;
BEGIN
    SELECT * INTO h FROM businesses WHERE id = v_head;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT coalesce(sum(c.amount), 0), coalesce(array_agg(c.id ORDER BY c.id), '{}')
      INTO v_due, v_ids FROM billing_charges c WHERE c.head_id = v_head AND c.status = 'due';

    IF p_kind = 'charges' THEN
        IF v_due <= 0 THEN RETURN; END IF;
        RETURN QUERY SELECT v_due, h.subscription_ends_at,
            (SELECT jsonb_agg(jsonb_build_object('kind', c.kind, 'business_id', c.business_id, 'amount', c.amount,
                                                 'from', c.period_from, 'to', c.period_to) ORDER BY c.id)
               FROM billing_charges c WHERE c.id = ANY (v_ids)), v_ids;
        RETURN;
    END IF;

    IF p_kind = 'module' THEN
        SELECT mp.monthly_fee INTO v_fee FROM module_prices mp
         WHERE mp.module_code = p_module AND mp.is_addon AND mp.monthly_fee > 0;
        IF v_fee IS NULL OR h.subscription_ends_at IS NULL OR h.subscription_ends_at <= now() THEN RETURN; END IF;
        RETURN QUERY SELECT greatest(app.prorate(v_fee, now(), h.subscription_ends_at), 1), h.subscription_ends_at,
            jsonb_build_array(jsonb_build_object('kind', 'module', 'module_code', p_module, 'monthly_fee', v_fee,
                                                 'from', now(), 'to', h.subscription_ends_at)), '{}'::bigint[];
        RETURN;
    END IF;

    -- renew
    v_month := app.chain_monthly(v_head);
    IF v_month <= 0 THEN RETURN; END IF;
    IF p_months > 0 THEN
        SELECT p.discount_pct INTO v_pct FROM billing_packages p WHERE p.months = p_months AND p.is_active;
        IF NOT FOUND THEN RETURN; END IF;
    END IF;
    v_start  := greatest(coalesce(h.subscription_ends_at, now()), now());
    v_anchor := app.next_first(v_start);
    v_part   := app.prorate(v_month, v_start, v_anchor);
    IF p_months = 0 AND v_part = 0 THEN RETURN; END IF;       -- muddat allaqachon 1-sanada: kunbay variant yo'q
    v_full   := (v_month * p_months * (100 - v_pct)) / 100;
    IF v_part > 0 THEN
        v_lines := v_lines || jsonb_build_object('kind', 'prorate', 'from', v_start, 'to', v_anchor, 'amount', v_part,
                                                 'days', ((v_anchor AT TIME ZONE 'Asia/Tashkent')::date
                                                          - (v_start AT TIME ZONE 'Asia/Tashkent')::date));
    END IF;
    IF p_months > 0 THEN
        v_lines := v_lines || jsonb_build_object('kind', 'months', 'months', p_months, 'discount_pct', v_pct,
                                                 'amount', v_full, 'monthly', v_month);
    END IF;
    IF v_due > 0 THEN
        v_lines := v_lines || jsonb_build_object('kind', 'charges', 'amount', v_due);
    END IF;
    RETURN QUERY SELECT greatest(v_part + v_full + v_due, 1), v_anchor + make_interval(months => p_months), v_lines, v_ids;
END $$;

-- Eski nom (paket narxi) — endi yangi hisob orqali
CREATE OR REPLACE FUNCTION app.billing_price(p_business BIGINT, p_months SMALLINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT q.amount FROM app.billing_quote(p_business, 'renew', p_months) q
$$;

-- To'lov qiluvchi: asosiy muassasa direktori. Filial sahifasidan ham shu tarmoq uchun to'lanadi
CREATE OR REPLACE FUNCTION app.billing_owner(p_business BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM business_members m
          JOIN businesses b ON b.id = m.business_id AND b.status IN ('active', 'pending')
          JOIN users u      ON u.id = m.user_id AND u.status = 'active'
         WHERE m.business_id IN (p_business, app.chain_head(p_business))
           AND m.user_id = app.uid() AND m.role = 'owner' AND m.is_active
           AND EXISTS (SELECT 1 FROM business_members hm
                        WHERE hm.business_id = app.chain_head(p_business) AND hm.user_id = app.uid()
                          AND hm.role = 'owner' AND hm.is_active))
$$;

-- Buyurtma ochilganda: tarmoq boshiga yoziladi, summa va tarkibni bazaning o'zi qo'yadi
CREATE OR REPLACE FUNCTION app.guard_billing_orders() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    q RECORD;
BEGIN
    NEW.business_id := app.chain_head(NEW.business_id);
    IF NEW.kind <> 'module' THEN NEW.module_code := NULL; END IF;
    IF NEW.kind <> 'renew' THEN NEW.months := 0; END IF;
    SELECT * INTO q FROM app.billing_quote(NEW.business_id, NEW.kind, NEW.months, NEW.module_code);
    IF q.amount IS NULL THEN
        RAISE EXCEPTION 'billing_package_unavailable' USING ERRCODE = '22023';
    END IF;
    NEW.amount := q.amount;
    NEW.period_ends_at := q.ends_at;
    NEW.lines := q.lines;
    NEW.charge_ids := q.charge_ids;
    NEW.status := 'created';
    NEW.created_by := app.uid();
    NEW.created_at := now();
    NEW.paid_at := NULL;
    NEW.payment_id := NULL;
    RETURN NEW;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
--  3. TO'LOV TASDIQLANGANDA
-- ════════════════════════════════════════════════════════════════════════════
-- renew   : tarmoqning HAMMA muassasasi muddati = buyurtmadagi yangi muddat; qo'shilgan qarzlar to'landi
-- charges : har qarz o'z muassasasi muddatini qarz oxirigacha uzaytiradi
-- module  : modul tarmoqning hamma muassasasida yoqiladi (paid)
-- Bir buyurtma bir marta qo'llanadi.
CREATE OR REPLACE FUNCTION app.billing_apply(p_order BIGINT, p_method TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    o     billing_orders%ROWTYPE;
    h     businesses%ROWTYPE;
    c     RECORD;
    v_pay BIGINT;
    v_note TEXT;
    v_old TIMESTAMPTZ;
BEGIN
    SELECT * INTO o FROM billing_orders WHERE id = p_order FOR UPDATE;
    IF NOT FOUND OR o.status = 'paid' THEN RETURN; END IF;
    SELECT * INTO h FROM businesses WHERE id = o.business_id FOR UPDATE;
    v_old := h.subscription_ends_at;

    IF o.kind = 'renew' THEN
        UPDATE businesses SET subscription_ends_at = o.period_ends_at, is_active = TRUE, updated_at = now()
         WHERE id = h.id OR parent_id = h.id;
        v_note := CASE WHEN o.months > 0 THEN o.months || ' oy' ELSE '1-sanagacha' END;
    ELSIF o.kind = 'charges' THEN
        v_note := 'faollashtirish / filial';
    ELSE
        INSERT INTO business_modules (business_id, module_code, enabled, expires_at, source)
        SELECT x.id, o.module_code, TRUE, NULL, 'paid' FROM businesses x WHERE x.id = h.id OR x.parent_id = h.id
        ON CONFLICT (business_id, module_code)
        DO UPDATE SET enabled = TRUE, expires_at = NULL, source = 'paid';
        v_note := 'modul: ' || o.module_code;
    END IF;

    FOR c IN SELECT * FROM billing_charges WHERE id = ANY (o.charge_ids) AND status = 'due' FOR UPDATE LOOP
        UPDATE billing_charges SET status = 'paid', order_id = o.id WHERE id = c.id;
        IF o.kind <> 'renew' THEN
            UPDATE businesses SET subscription_ends_at = greatest(coalesce(subscription_ends_at, now()), c.period_to),
                                  is_active = TRUE, updated_at = now()
             WHERE id = c.business_id;
        END IF;
    END LOOP;

    SELECT subscription_ends_at INTO h.subscription_ends_at FROM businesses WHERE id = h.id;
    INSERT INTO subscription_payments (business_id, business_name, days, amount, method, note, ends_at)
    VALUES (h.id, h.name,
            greatest(1, ceil(extract(epoch FROM coalesce(h.subscription_ends_at, now()) - greatest(coalesce(v_old, now()), now())) / 86400))::int,
            o.amount, p_method, v_note || ', buyurtma #' || o.id, h.subscription_ends_at)
    RETURNING id INTO v_pay;
    UPDATE billing_orders SET status = 'paid', paid_at = now(), payment_id = v_pay WHERE id = o.id;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (h.id, NULL, 'renew', 'subscription', h.id,
            jsonb_build_object('order_id', o.id, 'kind', o.kind, 'months', o.months, 'amount', o.amount,
                               'method', p_method, 'ends_at', h.subscription_ends_at, 'lines', o.lines));
END $$;

-- ════════════════════════════════════════════════════════════════════════════
--  4. FAOLLASHTIRISH (Super Admin kompaniya/filial qo'shganda)
-- ════════════════════════════════════════════════════════════════════════════
-- Mustaqil (yoki asosiy) muassasa: muddat = hozir + muhlat; qarz = oylik × kunlar (hozir -> keyingi 1-sana).
-- Filial: faol tarmoqda — muddat = hozir + muhlat (tarmoqdan oshmaydi), qarz = filial qatori × kunlar
--         (hozir -> tarmoq muddati); tarmoq muddatsiz — filial ham muddatsiz; tarmoq tugagan — filial ham.
CREATE FUNCTION app.billing_activate(p_business BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    b       businesses%ROWTYPE;
    h       businesses%ROWTYPE;
    v_grace INTERVAL := make_interval(days => (SELECT activation_grace_days FROM billing_settings));
    v_to    TIMESTAMPTZ;
    v_amt   BIGINT;
BEGIN
    IF app.is_app_role() AND NOT app.is_superadmin() THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO b FROM businesses WHERE id = p_business FOR UPDATE;
    UPDATE billing_charges SET status = 'void' WHERE business_id = b.id AND status = 'due';
    IF b.parent_id IS NULL THEN
        v_to  := app.next_first(now());
        v_amt := app.prorate(b.monthly_fee, now(), v_to);
        UPDATE businesses SET subscription_ends_at = now() + v_grace, is_active = TRUE WHERE id = b.id;
    ELSE
        SELECT * INTO h FROM businesses WHERE id = b.parent_id;
        IF h.subscription_ends_at IS NULL THEN
            UPDATE businesses SET subscription_ends_at = NULL, is_active = TRUE WHERE id = b.id;
            RETURN;
        END IF;
        IF h.subscription_ends_at <= now() THEN
            UPDATE businesses SET subscription_ends_at = h.subscription_ends_at WHERE id = b.id;
            RETURN;
        END IF;
        v_to  := h.subscription_ends_at;
        v_amt := app.prorate(app.branch_fee(h.id), now(), v_to);
        UPDATE businesses SET subscription_ends_at = least(now() + v_grace, v_to), is_active = TRUE WHERE id = b.id;
    END IF;
    IF v_amt > 0 THEN
        INSERT INTO billing_charges (head_id, business_id, kind, amount, period_from, period_to)
        VALUES (coalesce(b.parent_id, b.id), b.id, CASE WHEN b.parent_id IS NULL THEN 'activation' ELSE 'branch' END,
                v_amt, now(), v_to);
    ELSE
        UPDATE businesses SET subscription_ends_at = v_to WHERE id = b.id;
    END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
--  5. HUQUQLAR
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE billing_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON billing_settings TO app_api;
CREATE POLICY read_all ON billing_settings FOR SELECT TO app_api USING (TRUE);
CREATE POLICY superadmin_update ON billing_settings FOR UPDATE TO app_api
    USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());

ALTER TABLE module_prices ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE (monthly_fee, is_addon) ON module_prices TO app_api;
CREATE POLICY read_all ON module_prices FOR SELECT TO app_api USING (TRUE);
CREATE POLICY superadmin_update ON module_prices FOR UPDATE TO app_api
    USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());

ALTER TABLE billing_charges ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON billing_charges TO app_api;
CREATE POLICY owner_read ON billing_charges FOR SELECT TO app_api
    USING (app.is_superadmin() OR app.billing_owner(head_id));

-- Direktor modul manbasini o'zgartira olmaydi; obunani faqat to'lov/Super Admin uzaytiradi (guard_businesses)
CREATE FUNCTION app.guard_business_modules() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF app.is_app_role() AND NOT app.is_superadmin() THEN
        RAISE EXCEPTION 'module_forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER guard_business_modules BEFORE INSERT OR UPDATE ON business_modules
    FOR EACH ROW EXECUTE FUNCTION app.guard_business_modules();

-- Direktor pullik modulni muddat oxirigacha o'chiradi / shu muddat ichida qayta yoqadi
CREATE FUNCTION app.addon_set(p_business BIGINT, p_module TEXT, p_on BOOLEAN) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_head BIGINT := app.chain_head(p_business);
    v_ends TIMESTAMPTZ;
BEGIN
    IF NOT app.billing_owner(v_head) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT subscription_ends_at INTO v_ends FROM businesses WHERE id = v_head;
    UPDATE business_modules bm
       SET expires_at = CASE WHEN p_on THEN NULL ELSE coalesce(v_ends, now()) END
      FROM businesses x
     WHERE bm.business_id = x.id AND (x.id = v_head OR x.parent_id = v_head)
       AND bm.module_code = p_module AND bm.source = 'paid'
       AND (p_on IS FALSE OR (bm.expires_at IS NOT NULL AND bm.expires_at > now()));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
END $$;

-- Super Admin qo'lda (naqd/o'tkazma) uzaytirganda tarmoq qarzlari yopiladi
CREATE FUNCTION app.billing_settle_manual(p_head BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT app.is_superadmin() THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    UPDATE billing_charges SET status = 'paid' WHERE head_id = p_head AND status = 'due';
END $$;
REVOKE ALL ON FUNCTION app.billing_settle_manual(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_settle_manual(BIGINT) TO app_api;

REVOKE ALL ON FUNCTION app.chain_head(BIGINT), app.prorate(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ),
                       app.branch_discount(BIGINT), app.branch_fee(BIGINT), app.chain_lines(BIGINT),
                       app.chain_monthly(BIGINT), app.billing_quote(BIGINT, TEXT, SMALLINT, TEXT),
                       app.billing_activate(BIGINT), app.addon_set(BIGINT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.chain_head(BIGINT), app.prorate(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ),
                          app.branch_discount(BIGINT), app.branch_fee(BIGINT), app.chain_lines(BIGINT),
                          app.chain_monthly(BIGINT), app.billing_quote(BIGINT, TEXT, SMALLINT, TEXT),
                          app.billing_activate(BIGINT), app.addon_set(BIGINT, TEXT, BOOLEAN) TO app_api;
