-- Kassa: to'lov qabul qilish, qaytarish, xarajatlar.
-- Pul yozuvi faqat shu funksiyalar orqali o'zgaradi: app_api payments jadvaliga to'g'ridan-to'g'ri yoza olmaydi.
-- Shunda ilovada xato bo'lsa ham summa, sana yoki qabul qilgan xodimni soxtalashtirib bo'lmaydi.

ALTER TABLE payments
    ADD COLUMN refunded_at   TIMESTAMPTZ,
    ADD COLUMN refunded_by   BIGINT,
    ADD COLUMN refund_reason TEXT CHECK (char_length(refund_reason) <= 500),
    ADD CONSTRAINT payments_note_len CHECK (char_length(note) <= 500),
    ADD CONSTRAINT payments_refunded_by_fk FOREIGN KEY (business_id, refunded_by)
        REFERENCES business_members(business_id, id),
    ADD CONSTRAINT payments_refund_complete CHECK ((status = 'refunded') = (refunded_at IS NOT NULL));
CREATE INDEX ON payments (appointment_id);
CREATE INDEX ON payments (business_id, refunded_at) WHERE refunded_at IS NOT NULL;

ALTER TABLE expenses ADD CONSTRAINT expenses_note_len CHECK (char_length(note) <= 500);
ALTER TABLE expense_categories ADD CONSTRAINT expense_category_name_len CHECK (char_length(trim(name)) >= 2);
CREATE UNIQUE INDEX expense_category_name_uq ON expense_categories (business_id, lower(name));

-- Qaytarish alohida huquq: to'lovni qabul qilgan odam o'zi "qaytarib" pulni olib qololmasin.
-- Direktorda standart bor, boshqa xodimga direktor alohida berishi mumkin.
INSERT INTO permissions (code, module_code, description) VALUES
    ('payments.refund', 'finance', 'To''lovni qaytarish');
INSERT INTO role_permissions (role, permission_code) VALUES ('owner', 'payments.refund');

DROP POLICY accept ON payments;
DROP POLICY manage ON payments;
REVOKE INSERT, UPDATE ON payments FROM app_api;

-- Joriy foydalanuvchining shu biznesdagi xodim yozuvi. Super Admin uchun NULL.
CREATE FUNCTION app.my_member_in(p_business BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT id FROM business_members WHERE business_id = p_business AND user_id = app.uid() AND is_active
$$;

-- Bron qatori qulflanadi: ikki kassir bir vaqtda bosganda qarzdan ortiq yozilmaydi.
CREATE FUNCTION app.accept_payment(p_business BIGINT, p_appointment BIGINT, p_amount BIGINT, p_method TEXT,
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
    -- Karta va onlayn to'lovlar kassir tasdig'i bilan yoziladi. bonus hozircha yo'q.
    IF p_method NOT IN ('cash', 'card', 'click', 'payme', 'uzum') THEN
        RAISE EXCEPTION 'invalid_method' USING ERRCODE = '23514';
    END IF;

    SELECT id, client_id, status, total_price - discount AS due INTO a
      FROM appointments WHERE id = p_appointment AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    IF a.status NOT IN ('in_progress', 'completed') THEN
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
            jsonb_build_object('appointment_id', p_appointment, 'amount', p_amount, 'method', p_method));
    RETURN v_id;
END $$;

-- To'lov o'chmaydi: asl yozuv qoladi, qaytarish o'z sanasida hisobga olinadi.
CREATE FUNCTION app.refund_payment(p_business BIGINT, p_payment BIGINT, p_reason TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_status payment_status;
    v_amount BIGINT;
BEGIN
    IF NOT app.has_perm(p_business, 'payments.refund') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF char_length(trim(coalesce(p_reason, ''))) < 3 THEN
        RAISE EXCEPTION 'reason_required' USING ERRCODE = '23514';
    END IF;

    SELECT status, amount INTO v_status, v_amount
      FROM payments WHERE id = p_payment AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    IF v_status <> 'paid' THEN
        RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'P0413';
    END IF;

    UPDATE payments
       SET status = 'refunded', refunded_at = now(), refunded_by = app.my_member_in(p_business),
           refund_reason = trim(p_reason)
     WHERE id = p_payment;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'refund', 'payment', p_payment,
            jsonb_build_object('amount', v_amount, 'reason', trim(p_reason)));
END $$;

REVOKE ALL ON FUNCTION app.my_member_in(BIGINT), app.accept_payment(BIGINT, BIGINT, BIGINT, TEXT, TEXT),
                       app.refund_payment(BIGINT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.my_member_in(BIGINT), app.accept_payment(BIGINT, BIGINT, BIGINT, TEXT, TEXT),
                          app.refund_payment(BIGINT, BIGINT, TEXT) TO app_api;

-- Xarajatni kim yozgani soxtalashtirilmaydi, har bir o'zgarish va o'chirish jurnalda summasi bilan qoladi.
CREATE FUNCTION app.guard_expenses() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
        VALUES (OLD.business_id, app.uid(), 'delete', 'expense', OLD.id,
                jsonb_build_object('amount', OLD.amount, 'spent_at', OLD.spent_at, 'note', OLD.note));
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := app.uid();
        NEW.created_at := now();
        RETURN NEW;
    END IF;
    IF NEW.business_id <> OLD.business_id THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (OLD.business_id, app.uid(), 'update', 'expense', OLD.id,
            jsonb_build_object('amount', jsonb_build_array(OLD.amount, NEW.amount),
                               'spent_at', jsonb_build_array(OLD.spent_at, NEW.spent_at)));
    RETURN NEW;
END $$;

CREATE TRIGGER guard_expenses BEFORE INSERT OR UPDATE OR DELETE ON expenses
    FOR EACH ROW EXECUTE FUNCTION app.guard_expenses();
