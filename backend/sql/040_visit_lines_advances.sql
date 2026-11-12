-- Qabulxona, foizli oylik va bo'limma-bo'lim chek (TZ 2026-11-11):
--   1) Tashrif qatorlari: bitta tashrifga bir nechta xizmat, har birining o'z ijrochisi (ko'rik — shifokor,
--      tahlil — laborant yoki muassasa hisobiga). Foiz shu qatorlar bo'yicha taqsimlanadi.
--   2) Oldindan to'lov: mijoz kelmasidan oldin ham to'lov qabul qilinadi (bekor qilingan bronga — yo'q).
--   3) Avanslar: berilgan avans darhol Kassaga xarajat bo'lib tushadi va oylikdan avtomatik ayiriladi.
--   4) Tezkor qabul: yozilmasdan kelgan mijoz hozir bo'sh turgan mutaxassisga shu daqiqadan yoziladi.
-- Pulga ta'sir qiladigan hamma yozuv faqat shu yerdagi funksiyalar orqali o'zgaradi.

-- ════════════════════════════════════════════════════════════════════════════
--  1. TASHRIF QATORLARI
-- ════════════════════════════════════════════════════════════════════════════
-- member_id NULL = bronning o'z mutaxassisi bajargan. house = TRUE: muassasa hisobiga, hech kimga foiz berilmaydi.
ALTER TABLE appointment_services
    ADD COLUMN member_id BIGINT,
    ADD COLUMN house     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN added_by  BIGINT REFERENCES users(id),
    ADD CONSTRAINT appointment_services_member_fk
        FOREIGN KEY (business_id, member_id) REFERENCES business_members(business_id, id),
    ADD CONSTRAINT house_line_has_no_member CHECK (NOT house OR member_id IS NULL);

-- Ilova qatorlarni to'g'ridan-to'g'ri yoza olmaydi: aks holda narx yoki ijrochini soxtalashtirib,
-- bron summasi va xodim foizini o'zgartirish mumkin edi. O'qish (read siyosati) o'zgarmaydi.
DROP POLICY manage ON appointment_services;
REVOKE INSERT, UPDATE, DELETE ON appointment_services FROM app_api;

-- Tashrifga xizmat qo'shadi. Narx bazadan (ijrochining maxsus narxi bo'lsa — o'sha), bron summasi birga oshadi.
CREATE FUNCTION app.add_visit_service(p_business BIGINT, p_appointment BIGINT, p_service BIGINT,
                                      p_member BIGINT DEFAULT NULL, p_house BOOLEAN DEFAULT FALSE)
RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    a        RECORD;
    s        RECORD;
    v_member BIGINT := CASE WHEN p_house THEN NULL ELSE p_member END;
    v_price  BIGINT;
    v_id     BIGINT;
BEGIN
    IF NOT app.has_perm(p_business, 'appointments.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT ap.id, ap.member_id, ap.status INTO a
      FROM appointments ap WHERE ap.id = p_appointment AND ap.business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    IF a.status IN ('cancelled', 'no_show') THEN
        RAISE EXCEPTION 'not_changeable' USING ERRCODE = 'P0409';
    END IF;
    SELECT sv.name, sv.price, sv.duration_min INTO s
      FROM services sv WHERE sv.id = p_service AND sv.business_id = p_business AND sv.is_active;
    IF NOT FOUND
       OR (v_member IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM business_members bm
             WHERE bm.id = v_member AND bm.business_id = p_business AND bm.is_active)) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF (SELECT count(*) FROM appointment_services l WHERE l.appointment_id = p_appointment) >= 30 THEN
        RAISE EXCEPTION 'too_many_lines' USING ERRCODE = '23514';
    END IF;

    v_price := s.price;
    IF NOT p_house THEN
        SELECT coalesce(ms.custom_price, s.price) INTO v_price
          FROM member_services ms
         WHERE ms.member_id = coalesce(v_member, a.member_id) AND ms.service_id = p_service;
        v_price := coalesce(v_price, s.price);
    END IF;

    INSERT INTO appointment_services (business_id, appointment_id, service_id, service_name, price, duration_min,
                                      member_id, house, added_by)
    VALUES (p_business, p_appointment, p_service, s.name, v_price, s.duration_min, v_member, p_house, app.uid())
    RETURNING id INTO v_id;
    UPDATE appointments SET total_price = total_price + v_price WHERE id = p_appointment;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'add_service', 'appointment', p_appointment,
            jsonb_build_object('service_id', p_service, 'price', v_price, 'member_id', v_member, 'house', p_house));
    RETURN v_id;
END $$;

-- Qatorni olib tashlaydi. Oxirgi qator qolishi shart; summa allaqachon to'langan puldan kamaymaydi.
CREATE FUNCTION app.remove_visit_service(p_business BIGINT, p_line BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    l      RECORD;
    a      RECORD;
    v_paid BIGINT;
BEGIN
    IF NOT app.has_perm(p_business, 'appointments.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT x.id, x.appointment_id, x.price, x.service_id INTO l
      FROM appointment_services x WHERE x.id = p_line AND x.business_id = p_business;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    SELECT ap.status, ap.total_price, ap.discount INTO a
      FROM appointments ap WHERE ap.id = l.appointment_id FOR UPDATE;
    IF a.status IN ('cancelled', 'no_show') THEN
        RAISE EXCEPTION 'not_changeable' USING ERRCODE = 'P0409';
    END IF;
    SELECT coalesce(sum(p.amount), 0) INTO v_paid
      FROM payments p WHERE p.appointment_id = l.appointment_id AND p.status = 'paid';
    IF (SELECT count(*) FROM appointment_services x WHERE x.appointment_id = l.appointment_id) <= 1
       OR a.total_price - l.price < a.discount
       OR a.total_price - l.price - a.discount < v_paid THEN
        RAISE EXCEPTION 'line_not_removable' USING ERRCODE = 'P0421';
    END IF;

    DELETE FROM appointment_services WHERE id = p_line;
    UPDATE appointments SET total_price = total_price - l.price WHERE id = l.appointment_id;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'remove_service', 'appointment', l.appointment_id,
            jsonb_build_object('service_id', l.service_id, 'price', l.price));
END $$;

REVOKE ALL ON FUNCTION app.add_visit_service(BIGINT, BIGINT, BIGINT, BIGINT, BOOLEAN),
                       app.remove_visit_service(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.add_visit_service(BIGINT, BIGINT, BIGINT, BIGINT, BOOLEAN),
                          app.remove_visit_service(BIGINT, BIGINT) TO app_api;


-- ════════════════════════════════════════════════════════════════════════════
--  2. OLDINDAN TO'LOV
-- ════════════════════════════════════════════════════════════════════════════
-- Avval to'lov faqat mijoz kelgandan keyin olinardi. Endi kutilayotgan/tasdiqlangan bronga ham olinadi;
-- faqat bekor qilingan yoki kelmagan bronga pul yozilmaydi. Qolgan qoidalar (qarzdan oshmaslik, qulf) o'sha.
CREATE OR REPLACE FUNCTION app.accept_payment(p_business BIGINT, p_appointment BIGINT, p_amount BIGINT, p_method TEXT,
                                              p_note TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    a    RECORD;
    v_paid BIGINT;
    v_id BIGINT;
BEGIN
    IF NOT app.has_perm(p_business, 'payments.accept') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF p_method NOT IN ('cash', 'card', 'click', 'payme', 'uzum') THEN
        RAISE EXCEPTION 'invalid_method' USING ERRCODE = '23514';
    END IF;

    SELECT id, client_id, status, total_price - discount AS due INTO a
      FROM appointments WHERE id = p_appointment AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    IF a.status IN ('cancelled', 'no_show') THEN
        RAISE EXCEPTION 'not_payable' USING ERRCODE = 'P0412';
    END IF;

    SELECT coalesce(sum(amount), 0) INTO v_paid
      FROM payments WHERE appointment_id = p_appointment AND status = 'paid';
    IF p_amount <= 0 OR p_amount > a.due - v_paid THEN
        RAISE EXCEPTION 'overpaid' USING ERRCODE = 'P0411';
    END IF;

    INSERT INTO payments (business_id, appointment_id, client_id, amount, method, received_by, note)
    VALUES (p_business, p_appointment, a.client_id, p_amount, p_method::payment_method,
            app.my_member_in(p_business), p_note)
    RETURNING id INTO v_id;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'accept', 'payment', v_id,
            jsonb_build_object('appointment_id', p_appointment, 'amount', p_amount, 'method', p_method,
                               'prepaid', a.status IN ('pending', 'confirmed')));
    RETURN v_id;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
--  3. AVANSLAR VA OYLIK
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE payrolls DROP CONSTRAINT payroll_total_not_negative;
ALTER TABLE payrolls DROP COLUMN total;
ALTER TABLE payrolls
    ADD COLUMN advances BIGINT  NOT NULL DEFAULT 0 CHECK (advances >= 0),     -- shu oylikdan ayirilgan avanslar
    ADD COLUMN clients  INTEGER NOT NULL DEFAULT 0 CHECK (clients >= 0),      -- pul tushgan tashriflar soni
    ADD COLUMN total    BIGINT GENERATED ALWAYS AS (base_salary + commission + bonus - deductions - advances) STORED,
    ADD CONSTRAINT payroll_total_not_negative CHECK (base_salary + commission + bonus >= deductions + advances);

-- payroll_id NULL = hali oylikdan ayirilmagan. expense_id NULL = oldingi davrdan ko'chgan qoldiq (pul yangi berilmagan).
CREATE TABLE payroll_advances (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    member_id   BIGINT NOT NULL,
    amount      BIGINT NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
    given_on    DATE   NOT NULL,
    note        TEXT CHECK (char_length(note) <= 500),
    expense_id  BIGINT REFERENCES expenses(id) ON DELETE SET NULL,
    payroll_id  BIGINT REFERENCES payrolls(id) ON DELETE SET NULL,
    created_by  BIGINT REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (business_id, member_id) REFERENCES business_members(business_id, id) ON DELETE CASCADE
);
CREATE INDEX ON payroll_advances (member_id, given_on) WHERE payroll_id IS NULL;
CREATE INDEX ON payroll_advances (business_id, given_on DESC);

ALTER TABLE payroll_advances ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON payroll_advances TO app_api;                    -- yozish faqat funksiyalar orqali
CREATE POLICY manager_read ON payroll_advances FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'payroll.manage'));
CREATE POLICY own_read ON payroll_advances FOR SELECT TO app_api
    USING (member_id = ANY (app.my_member_ids()));

-- Xodimning p_until sanasigacha berilgan, hali ayirilmagan avanslari
CREATE FUNCTION app.open_advances(p_member BIGINT, p_until DATE) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(sum(a.amount), 0)::bigint FROM payroll_advances a
     WHERE a.member_id = p_member AND a.payroll_id IS NULL AND a.given_on <= p_until
$$;

-- Qoralama oyliklardagi "avans" ustunini yangilaydi (avans berilganda, bekor qilinganda).
-- Oylikdan ko'p avans ayirilmaydi: ortig'i tasdiqlashda keyingi davrga ko'chadi.
CREATE FUNCTION app.refresh_draft_advances(p_member BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    UPDATE payrolls p
       SET advances = greatest(0, least(app.open_advances(p.member_id, p.period_end),
                                        p.base_salary + p.commission + p.bonus - p.deductions))
     WHERE p.member_id = p_member AND p.status = 'draft'
$$;

-- Avans berish: pul shu kuni kassadan chiqadi ("Avans" toifasidagi xarajat), oylikda esa avtomatik ayiriladi.
CREATE FUNCTION app.give_advance(p_business BIGINT, p_member BIGINT, p_amount BIGINT, p_note TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_name    TEXT;
    v_today   DATE;
    v_cat     BIGINT;
    v_expense BIGINT;
    v_id      BIGINT;
    v_note    TEXT := nullif(trim(coalesce(p_note, '')), '');
BEGIN
    IF NOT app.has_perm(p_business, 'payroll.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '23514';
    END IF;
    SELECT u.full_name, (now() AT TIME ZONE b.timezone)::date INTO v_name, v_today
      FROM business_members m JOIN users u ON u.id = m.user_id JOIN businesses b ON b.id = m.business_id
     WHERE m.id = p_member AND m.business_id = p_business AND m.is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;

    INSERT INTO expense_categories (business_id, name) VALUES (p_business, 'Avans')
    ON CONFLICT (business_id, lower(name)) DO NOTHING;
    SELECT id INTO v_cat FROM expense_categories WHERE business_id = p_business AND lower(name) = 'avans';
    INSERT INTO expenses (business_id, category_id, amount, spent_at, note)
    VALUES (p_business, v_cat, p_amount, v_today, 'Avans: ' || v_name || coalesce(' — ' || v_note, ''))
    RETURNING id INTO v_expense;

    INSERT INTO payroll_advances (business_id, member_id, amount, given_on, note, expense_id, created_by)
    VALUES (p_business, p_member, p_amount, v_today, v_note, v_expense, app.uid())
    RETURNING id INTO v_id;
    PERFORM app.refresh_draft_advances(p_member);

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'give', 'advance', v_id,
            jsonb_build_object('member_id', p_member, 'amount', p_amount));
    RETURN v_id;
END $$;

-- Xato yozilgan avansni bekor qilish — faqat hali oylikdan ayirilmagan bo'lsa. Kassadagi xarajat ham o'chadi.
CREATE FUNCTION app.cancel_advance(p_business BIGINT, p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v payroll_advances%ROWTYPE;
BEGIN
    IF NOT app.has_perm(p_business, 'payroll.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v FROM payroll_advances WHERE id = p_id AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    IF v.payroll_id IS NOT NULL THEN
        RAISE EXCEPTION 'advance_settled' USING ERRCODE = 'P0422';
    END IF;
    DELETE FROM payroll_advances WHERE id = p_id;
    IF v.expense_id IS NOT NULL THEN
        DELETE FROM expenses WHERE id = v.expense_id;
    END IF;
    PERFORM app.refresh_draft_advances(v.member_id);
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'cancel', 'advance', p_id,
            jsonb_build_object('member_id', v.member_id, 'amount', v.amount));
END $$;

-- Hisoblash. Foiz endi tashrif qatorlari bo'yicha: bron bo'yicha shu davrda tushgan pul qatorlar narxiga
-- mutanosib bo'linadi va har bir ulush o'z ijrochisiga yoziladi (chegirma ham mutanosib). "Muassasa hisobiga"
-- qatorlardan hech kimga foiz yo'q. Qaytarilgan to'lovdan foiz berilmaydi. Avanslar avtomatik ayiriladi.
CREATE OR REPLACE FUNCTION app.generate_payroll(p_business BIGINT, p_start DATE, p_end DATE) RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_tz      TEXT;
    v_from    TIMESTAMPTZ;
    v_to      TIMESTAMPTZ;
    v_count   INTEGER := 0;
    m         RECORD;
    v_rev     BIGINT;
    v_clients INTEGER;
    v_comm    BIGINT;
    v_open    BIGINT;
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
        SELECT coalesce(sum(round(pay.paid * sh.share)), 0)::bigint, count(*)::int INTO v_rev, v_clients
          FROM appointments a
          JOIN LATERAL (SELECT sum(p.amount) AS paid FROM payments p
                         WHERE p.appointment_id = a.id AND p.status = 'paid'
                           AND p.paid_at >= v_from AND p.paid_at < v_to) pay ON pay.paid > 0
          JOIN LATERAL (
                SELECT CASE WHEN count(*) = 0 THEN (a.member_id = m.member_id)::int::numeric   -- qatorsiz eski bron
                            WHEN sum(l.price) = 0 THEN 0::numeric
                            ELSE coalesce(sum(l.price) FILTER (
                                     WHERE NOT l.house AND coalesce(l.member_id, a.member_id) = m.member_id), 0)::numeric
                                 / sum(l.price) END AS share,
                       (count(*) = 0 AND a.member_id = m.member_id)
                       OR count(*) FILTER (WHERE NOT l.house AND coalesce(l.member_id, a.member_id) = m.member_id) > 0
                           AS mine
                  FROM appointment_services l WHERE l.appointment_id = a.id) sh ON sh.mine
         WHERE a.business_id = p_business;

        v_comm := round(v_rev * m.commission_percent / 100);
        v_open := app.open_advances(m.member_id, p_end);

        INSERT INTO payrolls (business_id, member_id, period_start, period_end, base_salary, commission,
                              revenue, commission_percent, clients, advances)
        VALUES (p_business, m.member_id, p_start, p_end, m.base_salary, v_comm, v_rev, m.commission_percent,
                v_clients, least(v_open, m.base_salary + v_comm))
        ON CONFLICT (member_id, period_start, period_end) DO UPDATE
           SET base_salary = EXCLUDED.base_salary, commission = EXCLUDED.commission,
               revenue = EXCLUDED.revenue, commission_percent = EXCLUDED.commission_percent,
               clients = EXCLUDED.clients,
               advances = greatest(0, least(v_open, EXCLUDED.base_salary + EXCLUDED.commission
                                                    + payrolls.bonus - payrolls.deductions))
         WHERE payrolls.status = 'draft';
        v_count := v_count + 1;
    END LOOP;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, changes)
    VALUES (p_business, app.uid(), 'generate', 'payroll',
            jsonb_build_object('from', p_start, 'to', p_end, 'members', v_count));
    RETURN v_count;
END $$;

-- Bonus/ushlanma o'zgarsa, ayiriladigan avans ham qayta hisoblanadi (oylikdan oshmasin)
CREATE OR REPLACE FUNCTION app.adjust_payroll(p_business BIGINT, p_id BIGINT, p_bonus BIGINT, p_deductions BIGINT, p_note TEXT)
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
    UPDATE payrolls
       SET bonus = p_bonus, deductions = p_deductions, note = p_note,
           advances = greatest(0, least(app.open_advances(v.member_id, v.period_end),
                                        v.base_salary + v.commission + p_bonus - p_deductions))
     WHERE id = p_id;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'adjust', 'payroll', p_id,
            jsonb_build_object('bonus', jsonb_build_array(v.bonus, p_bonus),
                               'deductions', jsonb_build_array(v.deductions, p_deductions)));
END $$;

-- Tasdiqlashda avanslar shu oylikka biriktiriladi (keyin bekor qilib bo'lmaydi). Avans oylikdan ko'p bo'lsa,
-- ortig'i keyingi davrga "qoldiq" bo'lib ko'chadi — xodim qarzi yo'qolmaydi, oylik manfiy bo'lmaydi.
CREATE OR REPLACE FUNCTION app.approve_payroll(p_business BIGINT, p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v       payrolls%ROWTYPE;
    v_open  BIGINT;
    v_apply BIGINT;
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

    PERFORM 1 FROM payroll_advances a
      WHERE a.member_id = v.member_id AND a.payroll_id IS NULL AND a.given_on <= v.period_end FOR UPDATE;
    v_open  := app.open_advances(v.member_id, v.period_end);
    v_apply := greatest(0, least(v_open, v.base_salary + v.commission + v.bonus - v.deductions));
    UPDATE payroll_advances SET payroll_id = p_id
     WHERE member_id = v.member_id AND payroll_id IS NULL AND given_on <= v.period_end;
    IF v_open > v_apply THEN
        INSERT INTO payroll_advances (business_id, member_id, amount, given_on, note, created_by)
        VALUES (p_business, v.member_id, v_open - v_apply, v.period_end + 1, 'Oldingi davrdan qolgan avans', app.uid());
    END IF;

    UPDATE payrolls SET advances = v_apply, status = 'approved', approved_at = now(), approved_by = app.uid()
     WHERE id = p_id;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'approve', 'payroll', p_id, jsonb_build_object('advances', v_apply));
END $$;

REVOKE ALL ON FUNCTION app.open_advances(BIGINT, DATE), app.refresh_draft_advances(BIGINT),
                       app.give_advance(BIGINT, BIGINT, BIGINT, TEXT), app.cancel_advance(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.give_advance(BIGINT, BIGINT, BIGINT, TEXT), app.cancel_advance(BIGINT, BIGINT) TO app_api;

-- Muassasa o'chirilganda avanslar ham (payrolls va xodimlardan oldin)
CREATE OR REPLACE FUNCTION app.delete_business(p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT app.is_superadmin() THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    UPDATE businesses SET parent_id = NULL WHERE parent_id = p_id;
    DELETE FROM reviews          WHERE business_id = p_id;
    DELETE FROM payments         WHERE business_id = p_id;
    DELETE FROM stock_movements  WHERE business_id = p_id;
    DELETE FROM payroll_advances WHERE business_id = p_id;
    DELETE FROM payrolls         WHERE business_id = p_id;
    DELETE FROM appointments     WHERE business_id = p_id;
    DELETE FROM businesses WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
--  4. TEZKOR QABUL (yozilmasdan kelgan mijoz)
-- ════════════════════════════════════════════════════════════════════════════
-- Shu xizmatni bajaradigan mutaxassislar: hozirdan xizmat tugaguncha bo'shmi, band bo'lsa qachongacha,
-- hozir ish vaqtidami (o'z jadvali, bo'lmasa muassasa ish soatlari).
CREATE FUNCTION app.walk_in_options(p_business BIGINT, p_service BIGINT)
RETURNS TABLE (member_id BIGINT, full_name TEXT, title TEXT, price BIGINT, duration_min INTEGER,
               free BOOLEAN, busy_until TIMESTAMPTZ, on_shift BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
    v_now  TIMESTAMPTZ := date_trunc('minute', now());
    v_tz   TEXT;
    v_dow  INTEGER;
    v_time TIME;
BEGIN
    IF NOT app.has_perm(p_business, 'appointments.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT b.timezone INTO v_tz FROM businesses b WHERE b.id = p_business;
    v_dow  := extract(isodow FROM v_now AT TIME ZONE v_tz);
    v_time := (v_now AT TIME ZONE v_tz)::time;

    RETURN QUERY
    SELECT m.id, u.full_name::text, m.title::text, coalesce(ms.custom_price, s.price),
           coalesce(ms.custom_duration, s.duration_min),
           busy.until IS NULL, busy.until,
           EXISTS (SELECT 1 FROM staff_schedules ss
                    WHERE ss.member_id = m.id AND ss.weekday = v_dow
                      AND ss.start_time <= v_time AND v_time < ss.end_time)
           OR (NOT EXISTS (SELECT 1 FROM staff_schedules ss WHERE ss.member_id = m.id)
               AND EXISTS (SELECT 1 FROM business_hours bh
                            WHERE bh.business_id = p_business AND bh.weekday = v_dow
                              AND bh.opens_at <= v_time AND v_time < bh.closes_at))
      FROM business_members m
      JOIN users u            ON u.id = m.user_id AND u.status = 'active'
      JOIN member_services ms ON ms.member_id = m.id AND ms.service_id = p_service
      JOIN services s         ON s.id = ms.service_id AND s.is_active
      LEFT JOIN LATERAL (
            SELECT max(x.b_end) AS until
              FROM (SELECT a.starts_at AS b_start, a.ends_at AS b_end FROM appointments a
                     WHERE a.member_id = m.id AND a.status IN ('pending', 'confirmed', 'in_progress')
                    UNION ALL
                    SELECT t.starts_at, t.ends_at FROM staff_time_off t WHERE t.member_id = m.id) x
             WHERE tstzrange(x.b_start, x.b_end)
                   && tstzrange(v_now, v_now + make_interval(mins => coalesce(ms.custom_duration, s.duration_min)))
           ) busy ON TRUE
     WHERE m.business_id = p_business AND m.is_active AND m.is_bookable
     ORDER BY (busy.until IS NULL) DESC, 8 DESC, u.full_name;
END $$;

-- Hozirdan boshlab yozadi va darhol "keldi" holatiga o'tkazadi. p_member NULL = ish vaqtidagi bo'sh
-- mutaxassislardan bugun bronlari eng kami. Ikki qabulxona bir vaqtda bossa, no_double_booking to'xtatadi.
CREATE FUNCTION app.walk_in_book(p_business BIGINT, p_member BIGINT, p_service BIGINT,
                                 p_client_name TEXT, p_client_phone TEXT, p_note TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid    BIGINT := app.uid();
    v_now    TIMESTAMPTZ := date_trunc('minute', now());
    v_tz     TEXT;
    v_day    DATE;
    v_name   TEXT;
    v_client BIGINT;
    v_id     BIGINT;
    v        RECORD;
BEGIN
    IF NOT app.has_perm(p_business, 'appointments.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT s.name INTO v_name FROM services s WHERE s.id = p_service AND s.business_id = p_business AND s.is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT b.timezone INTO v_tz FROM businesses b WHERE b.id = p_business;
    v_day := (v_now AT TIME ZONE v_tz)::date;

    INSERT INTO business_clients (business_id, full_name, phone)
    VALUES (p_business, p_client_name, p_client_phone)
    ON CONFLICT (business_id, phone) DO UPDATE SET full_name = business_clients.full_name
    RETURNING id INTO v_client;

    FOR v IN
        SELECT o.member_id, o.price, o.duration_min
          FROM app.walk_in_options(p_business, p_service) o
         WHERE o.free AND ((p_member IS NULL AND o.on_shift) OR o.member_id = p_member)
         ORDER BY (SELECT count(*) FROM appointments a
                    WHERE a.member_id = o.member_id AND a.status <> 'cancelled'
                      AND a.starts_at >= v_day::timestamp AT TIME ZONE v_tz
                      AND a.starts_at <  (v_day + 1)::timestamp AT TIME ZONE v_tz), o.member_id
    LOOP
        BEGIN
            INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status, source,
                                      total_price, client_note, created_by, checked_in_at)
            VALUES (p_business, v_client, v.member_id, v_now, v_now + make_interval(mins => v.duration_min),
                    'in_progress', 'walk_in', v.price, p_note, v_uid, now())
            RETURNING id INTO v_id;
        EXCEPTION WHEN exclusion_violation THEN
            CONTINUE;
        END;
        INSERT INTO appointment_services (business_id, appointment_id, service_id, service_name, price, duration_min,
                                          added_by)
        VALUES (p_business, v_id, p_service, v_name, v.price, v.duration_min, v_uid);
        INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
        VALUES (p_business, v_uid, 'create', 'appointment', v_id,
                jsonb_build_object('member_id', v.member_id, 'service_id', p_service, 'walk_in', TRUE,
                                   'any_staff', p_member IS NULL));
        RETURN v_id;
    END LOOP;

    RAISE EXCEPTION 'nobody_free' USING ERRCODE = 'P0423';
END $$;

REVOKE ALL ON FUNCTION app.walk_in_options(BIGINT, BIGINT),
                       app.walk_in_book(BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.walk_in_options(BIGINT, BIGINT),
                          app.walk_in_book(BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT) TO app_api;
