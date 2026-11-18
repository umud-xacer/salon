-- Direktor filialni o'zi qo'shadi + filial uchun imtiyozli davr (foydalanuvchi qarori, 2026-11-18):
--   * Yangi filialga branch_grace_days (standart 5) kun BEPUL imtiyoz beriladi. Masalan, 12-noyabrda qo'shilsa —
--     12..16 bepul, 17-noyabrdan tarmoq muddatigacha (odatda 1-dekabr) filial qatori kunbay hisoblanadi.
--   * Imtiyoz tugaguncha to'lanmasa filial yopiladi va direktorga to'lov oynasi chiqadi (mavjud paywall).
--   * Keyingi oyning 1-sanasidan tarmoq bitta chek bilan to'laydi: asosiy + barcha filiallar + pullik modullar.
--   * Imtiyoz tarmoq muddatidan oshsa — qarz yozilmaydi, filial tarmoq muddatiga bog'lanadi (1-sana cheki uni oladi).

ALTER TABLE billing_settings
    ADD COLUMN branch_grace_days SMALLINT NOT NULL DEFAULT 5 CHECK (branch_grace_days BETWEEN 0 AND 30);

-- Filial narxi va imtiyoz (direktor "Filial qo'shish" oynasida ko'radi)
CREATE FUNCTION app.branch_quote(p_head BIGINT)
RETURNS TABLE (monthly_fee BIGINT, discount_pct SMALLINT, free_until TIMESTAMPTZ, charge_to TIMESTAMPTZ, amount BIGINT,
               chain_unlimited BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    h      businesses%ROWTYPE;
    v_free TIMESTAMPTZ := now() + make_interval(days => (SELECT branch_grace_days FROM billing_settings));
BEGIN
    IF NOT (app.is_superadmin() OR app.billing_owner(p_head)) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO h FROM businesses WHERE id = p_head AND parent_id IS NULL;
    IF NOT FOUND THEN RETURN; END IF;
    RETURN QUERY SELECT app.branch_fee(h.id), app.branch_discount(h.id),
        CASE WHEN h.subscription_ends_at IS NULL THEN NULL ELSE least(v_free, h.subscription_ends_at) END,
        h.subscription_ends_at,
        CASE WHEN h.subscription_ends_at IS NULL OR v_free >= h.subscription_ends_at THEN 0::bigint
             ELSE app.prorate(app.branch_fee(h.id), v_free, h.subscription_ends_at) END,
        h.subscription_ends_at IS NULL;
END $$;

-- Faollashtirish: kompaniya — avvalgidek; filial — imtiyozli davr bilan. Direktor o'z tarmog'ining filiali uchun ham chaqiradi.
CREATE OR REPLACE FUNCTION app.billing_activate(p_business BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    b       businesses%ROWTYPE;
    h       businesses%ROWTYPE;
    v_grace INTERVAL := make_interval(days => (SELECT activation_grace_days FROM billing_settings));
    v_free  TIMESTAMPTZ := now() + make_interval(days => (SELECT branch_grace_days FROM billing_settings));
    v_to    TIMESTAMPTZ;
    v_amt   BIGINT;
BEGIN
    SELECT * INTO b FROM businesses WHERE id = p_business FOR UPDATE;
    IF app.is_app_role() AND NOT app.is_superadmin()
       AND NOT (b.parent_id IS NOT NULL AND app.billing_owner(b.parent_id)) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    UPDATE billing_charges SET status = 'void' WHERE business_id = b.id AND status = 'due';
    IF b.parent_id IS NULL THEN
        v_to  := app.next_first(now());
        v_amt := app.prorate(b.monthly_fee, now(), v_to);
        UPDATE businesses SET subscription_ends_at = now() + v_grace, is_active = TRUE WHERE id = b.id;
        IF v_amt > 0 THEN
            INSERT INTO billing_charges (head_id, business_id, kind, amount, period_from, period_to)
            VALUES (b.id, b.id, 'activation', v_amt, now(), v_to);
        ELSE
            UPDATE businesses SET subscription_ends_at = v_to WHERE id = b.id;
        END IF;
        RETURN;
    END IF;

    SELECT * INTO h FROM businesses WHERE id = b.parent_id;
    IF h.subscription_ends_at IS NULL THEN                         -- tarmoq muddatsiz — filial ham
        UPDATE businesses SET subscription_ends_at = NULL, is_active = TRUE WHERE id = b.id;
        RETURN;
    END IF;
    IF h.subscription_ends_at <= now() THEN                        -- tarmoq to'lanmagan — filial ham yopiq
        UPDATE businesses SET subscription_ends_at = h.subscription_ends_at WHERE id = b.id;
        RETURN;
    END IF;
    v_to := h.subscription_ends_at;
    IF v_free >= v_to THEN                                          -- imtiyoz tarmoq muddatigacha yetadi
        UPDATE businesses SET subscription_ends_at = v_to, is_active = TRUE WHERE id = b.id;
        RETURN;
    END IF;
    v_amt := app.prorate(app.branch_fee(h.id), v_free, v_to);
    UPDATE businesses SET subscription_ends_at = v_free, is_active = TRUE WHERE id = b.id;
    IF v_amt > 0 THEN
        INSERT INTO billing_charges (head_id, business_id, kind, amount, period_from, period_to)
        VALUES (h.id, b.id, 'branch', v_amt, v_free, v_to);
    ELSE
        UPDATE businesses SET subscription_ends_at = v_to WHERE id = b.id;
    END IF;
END $$;

-- Direktor filial qo'shadi: tur, tarif, ish vaqti va modullar asosiy muassasadan olinadi, direktor — o'zi.
-- Filial doim jamoa rejimida (xodimlar qo'shiladi). Slug avtomatik: <asosiy-slug>-<filial-nomi>.
CREATE FUNCTION app.create_branch(p_head BIGINT, p_branch_name TEXT, p_region TEXT, p_city TEXT, p_address TEXT,
                                  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    h      businesses%ROWTYPE;
    v_name TEXT := btrim(coalesce(p_branch_name, ''));
    v_base TEXT;
    v_slug TEXT;
    v_n    INT := 1;
    v_id   BIGINT;
BEGIN
    IF NOT app.billing_owner(p_head) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO h FROM businesses WHERE id = p_head;
    IF h.parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'branch_parent_invalid' USING ERRCODE = 'P0432';
    END IF;
    IF NOT app.business_operational(h.id) THEN
        RAISE EXCEPTION 'chain_inactive' USING ERRCODE = 'P0433';
    END IF;
    IF length(v_name) < 2 OR length(v_name) > 80 THEN
        RAISE EXCEPTION 'invalid_branch_name' USING ERRCODE = 'P0434';
    END IF;
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'location_required' USING ERRCODE = 'P0435';
    END IF;

    v_base := left(h.slug || '-' || coalesce(nullif(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), ''),
                                             'filial'), 130);
    v_base := btrim(v_base, '-');
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM businesses WHERE slug = v_slug) LOOP
        v_n := v_n + 1;
        v_slug := v_base || '-' || v_n;
    END LOOP;

    INSERT INTO businesses (name, slug, category_id, region, city, address, status, created_by, parent_id, branch_name,
                            plan_id, monthly_fee, is_solo_mode, location)
    VALUES (h.name, v_slug, h.category_id, nullif(btrim(p_region), ''), nullif(btrim(p_city), ''),
            nullif(btrim(p_address), ''), 'active', app.uid(), h.id, v_name, h.plan_id, h.monthly_fee, FALSE,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography)
    RETURNING id INTO v_id;

    INSERT INTO business_hours (business_id, weekday, opens_at, closes_at)
    SELECT v_id, weekday, opens_at, closes_at FROM business_hours WHERE business_id = h.id;
    INSERT INTO business_members (business_id, user_id, role, is_bookable)
    VALUES (v_id, app.uid(), 'owner', FALSE);
    INSERT INTO business_modules (business_id, module_code, enabled, expires_at, source)
    SELECT v_id, module_code, enabled, expires_at, source FROM business_modules WHERE business_id = h.id;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (v_id, app.uid(), 'create', 'branch', v_id,
            jsonb_build_object('parent_id', h.id, 'branch_name', v_name, 'by', 'director'));

    PERFORM app.billing_activate(v_id);
    RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.branch_quote(BIGINT), app.create_branch(BIGINT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION,
                                                                    DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.branch_quote(BIGINT), app.create_branch(BIGINT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION,
                                                                       DOUBLE PRECISION) TO app_api;
