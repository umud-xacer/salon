-- Qabulxona rejimi (TZ 2026-11-15): xodimlar huquqi muassasada "Administrator" (receptionist) bor-yo'qligiga
-- qarab avtomatik o'zgaradi. Qaror bazada: API va panel shu yerdagi has_perm ga tayanadi.
--
--   A) Faol Administrator bor  -> oddiy xodim (staff) bron yarata olmaydi, to'lov ololmaydi — direktor unga
--      alohida huquq bergan bo'lsa ham (appointments.manage, payments.accept va *_own rad etiladi).
--      Xodim faqat o'z jadvali, o'z bronlari (holatini belgilaydi) va o'z mijozlarini ko'radi.
--   B) Administrator yo'q      -> oddiy xodim o'z kalendariga bron qo'shadi (appointments.manage_own) va
--      o'z mijozidan to'lov oladi (payments.accept_own). Boshqa xodimlar bronlariga tegolmaydi.
--   Direktor, menejer, administrator huquqlari o'zgarmaydi.

INSERT INTO permissions (code, module_code, description) VALUES
    ('appointments.manage_own', 'booking', 'O''z kalendariga bron qo''shish (qabulxona bo''lmasa)'),
    ('payments.accept_own',     'finance', 'O''z mijozidan to''lov olish (qabulxona bo''lmasa)');
INSERT INTO role_permissions (role, permission_code) VALUES
    ('staff', 'appointments.manage_own'), ('staff', 'payments.accept_own'),
    ('owner', 'appointments.manage_own'), ('owner', 'payments.accept_own');

-- Muassasada faol Administrator (qabulxona) bormi
CREATE FUNCTION app.has_reception(p_business BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM business_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
                    WHERE m.business_id = p_business AND m.role = 'receptionist' AND m.is_active)
$$;

-- Qabulxona rejimida oddiy xodimdan olinadigan huquqlar
CREATE FUNCTION app.reception_locked(p_role member_role, p_business BIGINT, p_perm TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT p_role = 'staff'
       AND p_perm IN ('appointments.manage', 'appointments.manage_own', 'payments.accept', 'payments.accept_own')
       AND app.has_reception(p_business)
$$;

CREATE OR REPLACE FUNCTION app.has_perm(p_business BIGINT, p_perm TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT app.is_superadmin() OR EXISTS (
        SELECT 1
          FROM business_members m
          JOIN businesses b ON b.id = m.business_id AND b.status IN ('active', 'pending')
                           AND app.subscription_ok(b.is_active, b.subscription_ends_at)
          JOIN users u      ON u.id = m.user_id     AND u.status = 'active'
         WHERE m.business_id = p_business
           AND m.user_id = app.uid()
           AND m.is_active
           AND coalesce(
                 (SELECT mp.granted FROM member_permissions mp
                   WHERE mp.member_id = m.id AND mp.permission_code = p_perm),
                 EXISTS (SELECT 1 FROM role_permissions rp
                          WHERE rp.role = m.role AND rp.permission_code = p_perm))
           AND app.module_enabled(p_business, (SELECT module_code FROM permissions WHERE code = p_perm))
           AND NOT app.reception_locked(m.role, p_business, p_perm)
    )
$$;

CREATE OR REPLACE FUNCTION app.member_has_perm(p_member BIGINT, p_perm TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM business_members m
          JOIN users u ON u.id = m.user_id AND u.status = 'active'
         WHERE m.id = p_member AND m.is_active
           AND coalesce((SELECT mp.granted FROM member_permissions mp
                          WHERE mp.member_id = m.id AND mp.permission_code = p_perm),
                        EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = m.role AND rp.permission_code = p_perm))
           AND app.module_enabled(m.business_id, (SELECT module_code FROM permissions WHERE code = p_perm))
           AND NOT app.reception_locked(m.role, m.business_id, p_perm)
    )
$$;

-- Shu mutaxassisga bron qo'sha oladimi: umumiy huquq yoki (qabulxonasiz) faqat o'ziga
CREATE FUNCTION app.can_book_for(p_business BIGINT, p_member BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT app.has_perm(p_business, 'appointments.manage')
        OR (p_member IS NOT NULL AND p_member = app.my_member_in(p_business)
            AND app.has_perm(p_business, 'appointments.manage_own'))
$$;

-- Shu mutaxassis bronidan to'lov ola oladimi
CREATE FUNCTION app.can_accept_for(p_business BIGINT, p_member BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT app.has_perm(p_business, 'payments.accept')
        OR (p_member IS NOT NULL AND p_member = app.my_member_in(p_business)
            AND app.has_perm(p_business, 'payments.accept_own'))
$$;

-- Bron: qabulxona istalgan mutaxassisga, qabulxonasiz muassasada oddiy xodim faqat o'ziga
CREATE OR REPLACE FUNCTION app.reception_book(p_business BIGINT, p_member BIGINT, p_service BIGINT, p_starts_at TIMESTAMPTZ,
                                   p_client_name TEXT, p_client_phone TEXT, p_note TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid    BIGINT := app.uid();
    v_tz     TEXT;
    v_day    DATE;
    v_client BIGINT;
    v_id     BIGINT;
    v        RECORD;
BEGIN
    -- Qabulxona/direktor — istalgan mutaxassisga; qabulxonasiz muassasada oddiy xodim — faqat o'ziga
    IF NOT app.can_book_for(p_business, p_member) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM services s WHERE s.id = p_service AND s.business_id = p_business AND s.is_active)
       OR (p_member IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM member_services ms
             WHERE ms.member_id = p_member AND ms.service_id = p_service AND ms.business_id = p_business)) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT b.timezone INTO v_tz FROM businesses b WHERE b.id = p_business;
    v_day := (p_starts_at AT TIME ZONE v_tz)::date;

    -- Mavjud mijozning ismi o'zgarmaydi: bir raqam ostida boshqa odam nomi yozilib ketmasin
    INSERT INTO business_clients (business_id, full_name, phone)
    VALUES (p_business, p_client_name, p_client_phone)
    ON CONFLICT (business_id, phone) DO UPDATE SET full_name = business_clients.full_name
    RETURNING id INTO v_client;

    FOR v IN
        SELECT m.id AS member_id, coalesce(ms.custom_price, s.price) AS price, s.name, c.slot_end
          FROM business_members m
          JOIN users u            ON u.id = m.user_id AND u.status = 'active'
          JOIN member_services ms ON ms.member_id = m.id AND ms.service_id = p_service
          JOIN services s         ON s.id = ms.service_id AND s.is_active
         CROSS JOIN LATERAL app.compute_slots(m.id, p_service, v_day, 5, NULL) c
         WHERE m.business_id = p_business AND m.is_active AND m.is_bookable
           AND (p_member IS NULL OR m.id = p_member)
           AND c.slot_start = p_starts_at
         ORDER BY (SELECT count(*) FROM appointments a
                    WHERE a.member_id = m.id AND a.status IN ('pending', 'confirmed', 'in_progress')
                      AND a.starts_at >= v_day::timestamp AT TIME ZONE v_tz
                      AND a.starts_at <  (v_day + 1)::timestamp AT TIME ZONE v_tz), m.id
    LOOP
        BEGIN
            INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status, source,
                                      total_price, client_note, created_by)
            VALUES (p_business, v_client, v.member_id, p_starts_at, v.slot_end, 'confirmed', 'admin',
                    v.price, p_note, v_uid)
            RETURNING id INTO v_id;
        EXCEPTION WHEN exclusion_violation THEN
            CONTINUE;
        END;

        INSERT INTO appointment_services (business_id, appointment_id, service_id, service_name, price, duration_min)
        VALUES (p_business, v_id, p_service, v.name, v.price,
                extract(epoch FROM v.slot_end - p_starts_at)::int / 60);

        INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
        VALUES (p_business, v_uid, 'create', 'appointment', v_id,
                jsonb_build_object('member_id', v.member_id, 'service_id', p_service, 'starts_at', p_starts_at,
                                   'any_staff', p_member IS NULL));
        RETURN v_id;
    END LOOP;

    RAISE EXCEPTION 'slot_not_available' USING ERRCODE = '23P01';
END $$;

-- To'lov: kassir istalgan bronga, qabulxonasiz muassasada oddiy xodim faqat o'z mijozidan
CREATE OR REPLACE FUNCTION app.accept_payment(p_business BIGINT, p_appointment BIGINT, p_amount BIGINT, p_method TEXT,
                                              p_note TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    a    RECORD;
    v_paid BIGINT;
    v_id BIGINT;
BEGIN
    IF p_method NOT IN ('cash', 'card', 'click', 'payme', 'uzum') THEN
        RAISE EXCEPTION 'invalid_method' USING ERRCODE = '23514';
    END IF;

    SELECT id, client_id, member_id, status, total_price - discount AS due INTO a
      FROM appointments WHERE id = p_appointment AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    -- Kassir/qabulxona — istalgan bronga; qabulxonasiz muassasada oddiy xodim — faqat o'z mijozidan
    IF NOT app.can_accept_for(p_business, a.member_id) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
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

-- Xodim o'z bronlarining to'lovlarini ko'radi (qabulxonasiz rejimda — o'zi olgani uchun)
DROP POLICY read ON payments;
CREATE POLICY read ON payments FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'finance.view') OR app.has_perm(business_id, 'payments.accept')
           OR (app.has_perm(business_id, 'payments.accept_own')
               AND EXISTS (SELECT 1 FROM appointments a
                            WHERE a.id = appointment_id AND a.member_id = ANY (app.my_member_ids()))));

-- Usta mijoz telefonini ko'rmaydi (mijozlar bazasi — muassasaniki; 2026-11 dan beri shu qoida, testlar bor).
-- Faqat o'z bronidagi mijozning ISMI ko'rinadi — bron ro'yxatida "Mijoz" o'rniga.
CREATE FUNCTION app.own_client_name(p_appointment BIGINT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT c.full_name::text
      FROM appointments a JOIN business_clients c ON c.id = a.client_id
     WHERE a.id = p_appointment
       AND a.member_id = ANY (app.my_member_ids())
       AND app.has_perm(a.business_id, 'appointments.view_own')
$$;

-- "Mijozlarim": xodimning o'z bronlaridagi mijozlar (har ikki rejimda). Mijozlar bazasi huquqi kerak emas
CREATE FUNCTION app.my_clients(p_business BIGINT)
RETURNS TABLE (client_id BIGINT, full_name TEXT, phone TEXT, visits INTEGER, last_visit TIMESTAMPTZ,
               next_visit TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT c.id, c.full_name::text,
           CASE WHEN app.has_perm(p_business, 'clients.view') THEN c.phone::text END,   -- ustaga telefon yo'q
           (count(*) FILTER (WHERE a.status = 'completed'))::int,
           max(a.starts_at) FILTER (WHERE a.status = 'completed'),
           min(a.starts_at) FILTER (WHERE a.status IN ('pending', 'confirmed') AND a.starts_at > now())
      FROM appointments a
      JOIN business_clients c ON c.id = a.client_id
     WHERE a.business_id = p_business
       AND a.member_id = app.my_member_in(p_business)
       AND app.has_perm(p_business, 'appointments.view_own')
     GROUP BY c.id, c.full_name, c.phone
     ORDER BY max(a.starts_at) DESC
$$;

REVOKE ALL ON FUNCTION app.has_reception(BIGINT), app.reception_locked(member_role, BIGINT, TEXT),
                       app.can_book_for(BIGINT, BIGINT), app.can_accept_for(BIGINT, BIGINT),
                       app.my_clients(BIGINT), app.own_client_name(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_reception(BIGINT), app.can_book_for(BIGINT, BIGINT),
                          app.can_accept_for(BIGINT, BIGINT), app.my_clients(BIGINT),
                          app.own_client_name(BIGINT) TO app_api;
