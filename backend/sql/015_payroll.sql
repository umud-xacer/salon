-- Oylik: stavka bo'yicha hisoblash, tasdiqlash, to'lash.
-- Pul yozuvi faqat shu funksiyalar orqali o'zgaradi: app_api payrolls jadvaliga to'g'ridan-to'g'ri yoza olmaydi.
-- Holat faqat oldinga yuradi: draft -> approved -> paid. Tasdiqlangan hisob o'zgarmaydi.

ALTER TABLE payrolls
    ADD COLUMN revenue            BIGINT NOT NULL DEFAULT 0 CHECK (revenue >= 0),
    ADD COLUMN commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN note               TEXT CHECK (char_length(note) <= 500),
    ADD COLUMN approved_at        TIMESTAMPTZ,
    ADD COLUMN approved_by        BIGINT REFERENCES users(id),
    ADD COLUMN paid_by            BIGINT REFERENCES users(id),
    ADD CONSTRAINT payroll_total_not_negative CHECK (base_salary + commission + bonus >= deductions);
CREATE INDEX ON payrolls (business_id, period_start DESC);

DROP POLICY own_read ON payrolls;
DROP POLICY manage ON payrolls;
REVOKE INSERT, UPDATE, DELETE ON payrolls FROM app_api;

-- Xodim o'z hisobini faqat tasdiqlangandan keyin ko'radi: qoralama hali o'zgarishi mumkin
CREATE POLICY own_read ON payrolls FOR SELECT TO app_api
    USING (status <> 'draft' AND member_id = ANY (app.my_member_ids()));
CREATE POLICY manager_read ON payrolls FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'payroll.manage'));

-- Stavkalardan qoralama yaratadi yoki yangilaydi. Tasdiqlanganiga tegmaydi, bonus va ushlanma saqlanadi.
-- Foiz haqiqatda tushgan puldan: qaytarilgan to'lovdan foiz berilmaydi.
CREATE FUNCTION app.generate_payroll(p_business BIGINT, p_start DATE, p_end DATE) RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_tz    TEXT;
    v_from  TIMESTAMPTZ;
    v_to    TIMESTAMPTZ;
    v_count INTEGER := 0;
    m       RECORD;
    v_rev   BIGINT;
BEGIN
    IF NOT app.has_perm(p_business, 'payroll.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF p_end < p_start OR p_end - p_start > 62 THEN
        RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
    END IF;

    SELECT timezone INTO v_tz FROM businesses WHERE id = p_business;
    v_from := p_start::timestamp AT TIME ZONE v_tz;
    v_to   := (p_end + 1)::timestamp AT TIME ZONE v_tz;

    FOR m IN
        SELECT c.member_id, c.base_salary, c.commission_percent
          FROM member_compensation c
          JOIN business_members bm ON bm.id = c.member_id AND bm.is_active
         WHERE c.business_id = p_business AND (c.base_salary > 0 OR c.commission_percent > 0)
    LOOP
        SELECT coalesce(sum(p.amount), 0) INTO v_rev
          FROM payments p
          JOIN appointments a ON a.id = p.appointment_id
         WHERE p.business_id = p_business AND a.member_id = m.member_id AND p.status = 'paid'
           AND p.paid_at >= v_from AND p.paid_at < v_to;

        INSERT INTO payrolls (business_id, member_id, period_start, period_end, base_salary, commission,
                              revenue, commission_percent)
        VALUES (p_business, m.member_id, p_start, p_end, m.base_salary,
                round(v_rev * m.commission_percent / 100), v_rev, m.commission_percent)
        ON CONFLICT (member_id, period_start, period_end) DO UPDATE
           SET base_salary = EXCLUDED.base_salary, commission = EXCLUDED.commission,
               revenue = EXCLUDED.revenue, commission_percent = EXCLUDED.commission_percent
         WHERE payrolls.status = 'draft';
        v_count := v_count + 1;
    END LOOP;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, changes)
    VALUES (p_business, app.uid(), 'generate', 'payroll',
            jsonb_build_object('from', p_start, 'to', p_end, 'members', v_count));
    RETURN v_count;
END $$;

CREATE FUNCTION app.adjust_payroll(p_business BIGINT, p_id BIGINT, p_bonus BIGINT, p_deductions BIGINT, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v payrolls%ROWTYPE;
BEGIN
    IF NOT app.has_perm(p_business, 'payroll.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v FROM payrolls WHERE id = p_id AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    IF v.status <> 'draft' THEN
        RAISE EXCEPTION 'payroll_locked' USING ERRCODE = 'P0416';
    END IF;
    UPDATE payrolls SET bonus = p_bonus, deductions = p_deductions, note = p_note WHERE id = p_id;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'adjust', 'payroll', p_id,
            jsonb_build_object('bonus', jsonb_build_array(v.bonus, p_bonus),
                               'deductions', jsonb_build_array(v.deductions, p_deductions)));
END $$;

CREATE FUNCTION app.approve_payroll(p_business BIGINT, p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_status payroll_status;
BEGIN
    IF NOT app.has_perm(p_business, 'payroll.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT status INTO v_status FROM payrolls WHERE id = p_id AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    IF v_status <> 'draft' THEN
        RAISE EXCEPTION 'payroll_locked' USING ERRCODE = 'P0416';
    END IF;
    UPDATE payrolls SET status = 'approved', approved_at = now(), approved_by = app.uid() WHERE id = p_id;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id)
    VALUES (p_business, app.uid(), 'approve', 'payroll', p_id);
END $$;

-- To'langan oylik Kassaga xarajat bo'lib tushadi, shunda sof tushum to'g'ri chiqadi. Qator qulfi ikki marta to'lashni to'xtatadi.
CREATE FUNCTION app.pay_payroll(p_business BIGINT, p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v         payrolls%ROWTYPE;
    v_cat     BIGINT;
    v_name    TEXT;
    v_tz      TEXT;
BEGIN
    IF NOT app.has_perm(p_business, 'payroll.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v FROM payrolls WHERE id = p_id AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    IF v.status <> 'approved' THEN
        RAISE EXCEPTION 'payroll_not_approved' USING ERRCODE = 'P0417';
    END IF;

    UPDATE payrolls SET status = 'paid', paid_at = now(), paid_by = app.uid() WHERE id = p_id;

    IF v.total > 0 THEN
        INSERT INTO expense_categories (business_id, name) VALUES (p_business, 'Oylik')
        ON CONFLICT (business_id, lower(name)) DO NOTHING;
        SELECT id INTO v_cat FROM expense_categories WHERE business_id = p_business AND lower(name) = 'oylik';
        SELECT u.full_name, b.timezone INTO v_name, v_tz
          FROM business_members m JOIN users u ON u.id = m.user_id JOIN businesses b ON b.id = m.business_id
         WHERE m.id = v.member_id;
        INSERT INTO expenses (business_id, category_id, amount, spent_at, note)
        VALUES (p_business, v_cat, v.total, (now() AT TIME ZONE v_tz)::date,
                'Oylik: ' || v_name || ', ' || to_char(v.period_start, 'MM.YYYY'));
    END IF;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'pay', 'payroll', p_id, jsonb_build_object('total', v.total));
END $$;

REVOKE ALL ON FUNCTION app.generate_payroll(BIGINT, DATE, DATE),
                       app.adjust_payroll(BIGINT, BIGINT, BIGINT, BIGINT, TEXT),
                       app.approve_payroll(BIGINT, BIGINT),
                       app.pay_payroll(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.generate_payroll(BIGINT, DATE, DATE),
                          app.adjust_payroll(BIGINT, BIGINT, BIGINT, BIGINT, TEXT),
                          app.approve_payroll(BIGINT, BIGINT),
                          app.pay_payroll(BIGINT, BIGINT) TO app_api;
