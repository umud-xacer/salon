-- Tuzatish (2026-11-16): prod bazasi UTC da ishlaydi. 043 dagi next_first() va paket muddati oy qo'shishni
-- UTC da qilardi: 30-noyabr 19:00 UTC (= 1-dekabr 00:00 Toshkent) + 1 oy = 30-dekabr 19:00 UTC — 1-yanvar emas.
-- Endi oy qo'shish Toshkent mahalliy vaqtida, natija yana timestamptz.

CREATE FUNCTION app.add_months_local(p_ts TIMESTAMPTZ, p_months INTEGER) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$
    SELECT ((p_ts AT TIME ZONE 'Asia/Tashkent') + make_interval(months => p_months)) AT TIME ZONE 'Asia/Tashkent'
$$;

CREATE OR REPLACE FUNCTION app.next_first(p_ts TIMESTAMPTZ) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_ts = app.month_start(p_ts) THEN p_ts ELSE app.add_months_local(app.month_start(p_ts), 1) END
$$;

CREATE OR REPLACE FUNCTION app.billing_quote(p_business BIGINT, p_kind TEXT, p_months SMALLINT, p_module TEXT DEFAULT NULL)
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
    RETURN QUERY SELECT greatest(v_part + v_full + v_due, 1), app.add_months_local(v_anchor, p_months), v_lines, v_ids;
END $$;

REVOKE ALL ON FUNCTION app.add_months_local(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.add_months_local(TIMESTAMPTZ, INTEGER) TO app_api;
