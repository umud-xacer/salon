-- Kassa smenasi: kun boshida kassani ochish (boshlang'ich naqd), kun davomida to'lov usullari bo'yicha tushum,
-- naqd kirim/chiqim (inkassatsiya, mayda xarajat), kun oxirida yopish — sanalgan naqd va kutilgan naqd farqi.
--
-- * Muassasada bir vaqtda bitta ochiq smena (unikal indeks).
-- * Tushum to'lovlardan (payments) hisoblanadi: smena oralig'ida qabul qilingan to'lovlar, qaytarishlar —
--   qaytarilgan vaqtiga ko'ra (kunlik kassa bilan bir xil qoida).
-- * Kutilgan naqd = boshlang'ich + naqd tushum − naqd qaytarish + kirim − chiqim. Yopilganda hammasi suratga
--   olinadi (totals) — keyin to'lov qaytarilsa ham yopilgan smena hisoboti o'zgarmaydi.
-- * Yozish faqat funksiyalar orqali; ochish/yopish — 'payments.accept', ko'rish — u yoki 'finance.view'.

CREATE TABLE cash_shifts (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id    BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    opened_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_cash   BIGINT NOT NULL CHECK (opening_cash >= 0),
    closed_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    closed_at      TIMESTAMPTZ,
    counted_cash   BIGINT CHECK (counted_cash >= 0),
    expected_cash  BIGINT,
    totals         JSONB,                                   -- yopilgandagi surat: usullar, kirim/chiqim
    note           VARCHAR(500),
    UNIQUE (business_id, id),
    CHECK ((closed_at IS NULL) = (counted_cash IS NULL))
);
CREATE UNIQUE INDEX one_open_shift ON cash_shifts (business_id) WHERE closed_at IS NULL;
CREATE INDEX ON cash_shifts (business_id, opened_at DESC);

CREATE TABLE cash_movements (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL,
    shift_id     BIGINT NOT NULL,
    kind         VARCHAR(3) NOT NULL CHECK (kind IN ('in', 'out')),
    amount       BIGINT NOT NULL CHECK (amount > 0),
    note         VARCHAR(200) NOT NULL CHECK (length(btrim(note)) >= 2),
    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (business_id, shift_id) REFERENCES cash_shifts (business_id, id) ON DELETE CASCADE
);
CREATE INDEX ON cash_movements (shift_id);

ALTER TABLE cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON cash_shifts, cash_movements TO app_api;
CREATE POLICY view ON cash_shifts FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'payments.accept') OR app.has_perm(business_id, 'finance.view'));
CREATE POLICY view ON cash_movements FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'payments.accept') OR app.has_perm(business_id, 'finance.view'));

-- Smena oralig'idagi tushum (usul bo'yicha)
CREATE FUNCTION app.shift_totals(p_shift BIGINT)
RETURNS TABLE (method TEXT, income BIGINT, refunds BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    s cash_shifts;
BEGIN
    SELECT * INTO s FROM cash_shifts WHERE id = p_shift;
    IF s.id IS NULL OR NOT (app.has_perm(s.business_id, 'payments.accept') OR app.has_perm(s.business_id, 'finance.view')) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT p.method::text,
           coalesce(sum(p.amount) FILTER (WHERE p.paid_at >= s.opened_at AND p.paid_at < coalesce(s.closed_at, now())), 0)::bigint,
           coalesce(sum(p.amount) FILTER (WHERE p.refunded_at >= s.opened_at AND p.refunded_at < coalesce(s.closed_at, now())), 0)::bigint
      FROM payments p
     WHERE p.business_id = s.business_id
       AND ((p.paid_at >= s.opened_at AND p.paid_at < coalesce(s.closed_at, now()))
         OR (p.refunded_at >= s.opened_at AND p.refunded_at < coalesce(s.closed_at, now())))
     GROUP BY p.method ORDER BY 2 DESC, 1;
END $$;
REVOKE ALL ON FUNCTION app.shift_totals(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.shift_totals(BIGINT) TO app_api;

CREATE FUNCTION app.shift_expected_cash(p_shift BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT s.opening_cash
         + coalesce((SELECT sum(t.income - t.refunds) FROM app.shift_totals(s.id) t WHERE t.method = 'cash'), 0)
         + coalesce((SELECT sum(CASE m.kind WHEN 'in' THEN m.amount ELSE -m.amount END) FROM cash_movements m
                      WHERE m.shift_id = s.id), 0)
      FROM cash_shifts s WHERE s.id = p_shift
$$;
REVOKE ALL ON FUNCTION app.shift_expected_cash(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.shift_expected_cash(BIGINT) TO app_api;

CREATE FUNCTION app.open_shift(p_business BIGINT, p_opening BIGINT) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF NOT app.has_perm(p_business, 'payments.accept') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM cash_shifts WHERE business_id = p_business AND closed_at IS NULL) THEN
        RAISE EXCEPTION 'shift_already_open' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO cash_shifts (business_id, opened_by, opening_cash) VALUES (p_business, app.uid(), p_opening)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION app.cash_move(p_business BIGINT, p_kind TEXT, p_amount BIGINT, p_note TEXT) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_shift BIGINT;
    v_id    BIGINT;
BEGIN
    IF NOT app.has_perm(p_business, 'payments.accept') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    SELECT id INTO v_shift FROM cash_shifts WHERE business_id = p_business AND closed_at IS NULL FOR UPDATE;
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'no_open_shift' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO cash_movements (business_id, shift_id, kind, amount, note, created_by)
    VALUES (p_business, v_shift, p_kind, p_amount, btrim(p_note), app.uid()) RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION app.close_shift(p_business BIGINT, p_counted BIGINT, p_note TEXT) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_shift BIGINT;
    v_now   TIMESTAMPTZ := now();
BEGIN
    IF NOT app.has_perm(p_business, 'payments.accept') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    SELECT id INTO v_shift FROM cash_shifts WHERE business_id = p_business AND closed_at IS NULL FOR UPDATE;
    IF v_shift IS NULL THEN
        RAISE EXCEPTION 'no_open_shift' USING ERRCODE = 'P0001';
    END IF;
    -- Avval yopilish vaqti qo'yiladi (hisob shu chegaragacha), keyin surat olinadi
    UPDATE cash_shifts SET closed_at = v_now, closed_by = app.uid(), counted_cash = p_counted, note = nullif(btrim(p_note), '')
     WHERE id = v_shift;
    UPDATE cash_shifts s SET
        expected_cash = app.shift_expected_cash(s.id),
        totals = jsonb_build_object(
            'methods', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM app.shift_totals(s.id) t), '[]'),
            'cash_in', coalesce((SELECT sum(amount) FROM cash_movements WHERE shift_id = s.id AND kind = 'in'), 0),
            'cash_out', coalesce((SELECT sum(amount) FROM cash_movements WHERE shift_id = s.id AND kind = 'out'), 0))
     WHERE s.id = v_shift;
    RETURN v_shift;
END $$;

REVOKE ALL ON FUNCTION app.open_shift(BIGINT, BIGINT), app.cash_move(BIGINT, TEXT, BIGINT, TEXT),
                       app.close_shift(BIGINT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.open_shift(BIGINT, BIGINT), app.cash_move(BIGINT, TEXT, BIGINT, TEXT),
                          app.close_shift(BIGINT, BIGINT, TEXT) TO app_api;
