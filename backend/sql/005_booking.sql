-- ════════════════════════════════════════════════════════════════════════════
--  P1.4 — Bron qilish, bekor qilish, ko'chirish
--
--  Mijozda appointments ga yozish huquqi yo'q (RLS). Bron faqat shu funksiyalar orqali:
--  ular vaqtni, egalikni va holatni tekshiradi. Ikki kishi bir vaqtga yozilishiga
--  no_double_booking (EXCLUDE) yo'l qo'ymaydi — bir vaqtdagi so'rovlarda ham.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE appointments ADD CONSTRAINT client_note_len   CHECK (length(client_note) <= 500),
                         ADD CONSTRAINT cancel_reason_len CHECK (length(cancel_reason) <= 300);

-- available_slots hisobi + p_exclude: ko'chirishda bronning o'z vaqti band sanalmaydi.
-- Bu funksiya ilovaga ochilmaydi: p_exclude orqali begona bron vaqtini aniqlab bo'lmasin.
CREATE FUNCTION app.compute_slots(p_member BIGINT, p_service BIGINT, p_day DATE, p_step INTEGER, p_exclude BIGINT)
RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ, slot_time TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_business BIGINT;
    v_tz       TEXT;
    v_duration INTERVAL;
    v_today    DATE;
BEGIN
    IF p_step NOT IN (5, 10, 15, 20, 30, 60) THEN
        RAISE EXCEPTION 'invalid_step' USING ERRCODE = '22023';
    END IF;

    SELECT m.business_id, b.timezone, make_interval(mins => coalesce(ms.custom_duration, s.duration_min))
      INTO v_business, v_tz, v_duration
      FROM business_members m
      JOIN users u            ON u.id = m.user_id AND u.status = 'active'
      JOIN businesses b       ON b.id = m.business_id
      JOIN member_services ms ON ms.member_id = m.id AND ms.service_id = p_service
      JOIN services s         ON s.id = ms.service_id AND s.is_active
     WHERE m.id = p_member AND m.is_active AND m.is_bookable
       AND (app.business_is_public(m.business_id) OR m.business_id = ANY (app.my_business_ids()));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    v_today := (now() AT TIME ZONE v_tz)::date;
    IF p_day < v_today OR p_day > v_today + 60 THEN
        RAISE EXCEPTION 'date_out_of_range' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH work AS (
        SELECT (p_day + w.s) AT TIME ZONE v_tz AS w_start, (p_day + w.e) AT TIME ZONE v_tz AS w_end
          FROM (SELECT ss.start_time AS s, ss.end_time AS e FROM staff_schedules ss
                 WHERE ss.member_id = p_member AND ss.weekday = extract(isodow FROM p_day)
                UNION ALL
                SELECT bh.opens_at, bh.closes_at FROM business_hours bh
                 WHERE bh.business_id = v_business AND bh.weekday = extract(isodow FROM p_day)
                   AND NOT EXISTS (SELECT 1 FROM staff_schedules ss WHERE ss.member_id = p_member)) w
    ), busy AS (
        SELECT a.starts_at AS b_start, a.ends_at AS b_end FROM appointments a
         WHERE a.member_id = p_member AND a.status IN ('pending', 'confirmed', 'in_progress')
           AND a.id IS DISTINCT FROM p_exclude
           AND tstzrange(a.starts_at, a.ends_at) && tstzrange(p_day::timestamp AT TIME ZONE v_tz,
                                                              (p_day + 1)::timestamp AT TIME ZONE v_tz)
        UNION ALL
        SELECT t.starts_at, t.ends_at FROM staff_time_off t
         WHERE t.member_id = p_member
           AND tstzrange(t.starts_at, t.ends_at) && tstzrange(p_day::timestamp AT TIME ZONE v_tz,
                                                              (p_day + 1)::timestamp AT TIME ZONE v_tz)
    ), candidates AS (
        SELECT g AS c_start
          FROM work w, generate_series(w.w_start, w.w_end - v_duration, make_interval(mins => p_step)) g
        UNION
        SELECT b.b_end FROM busy b, work w
         WHERE b.b_end >= w.w_start AND b.b_end <= w.w_end - v_duration
    )
    SELECT c.c_start, c.c_start + v_duration, to_char(c.c_start AT TIME ZONE v_tz, 'HH24:MI')
      FROM candidates c
     WHERE c.c_start >= now()
       AND NOT EXISTS (SELECT 1 FROM busy b
                        WHERE tstzrange(b.b_start, b.b_end) && tstzrange(c.c_start, c.c_start + v_duration))
     ORDER BY c.c_start;
END $$;

REVOKE ALL ON FUNCTION app.compute_slots(BIGINT, BIGINT, DATE, INTEGER, BIGINT) FROM PUBLIC, app_api;

CREATE OR REPLACE FUNCTION app.available_slots(p_member BIGINT, p_service BIGINT, p_day DATE, p_step INTEGER DEFAULT 30)
RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ, slot_time TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT * FROM app.compute_slots(p_member, p_service, p_day, p_step, NULL)
$$;

-- Mijoz o'zi uchun bron qiladi. Mijoz kim ekani tokendan (app.uid), parametrdan emas.
-- Boshlanish vaqti ish jadvalidagi 5 daqiqalik to'rda yoki band vaqt tugagan paytda bo'lishi kerak.
CREATE FUNCTION app.book_appointment(p_member BIGINT, p_service BIGINT, p_starts_at TIMESTAMPTZ, p_note TEXT DEFAULT NULL)
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

    INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, source, total_price,
                              client_note, created_by)
    VALUES (v_business, v_client, p_member, p_starts_at, v_end, 'app', v_price, p_note, v_uid)
    RETURNING id INTO v_id;

    INSERT INTO appointment_services (business_id, appointment_id, service_id, service_name, price, duration_min)
    VALUES (v_business, v_id, p_service, v_name, v_price, extract(epoch FROM v_end - p_starts_at)::int / 60);

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (v_business, v_uid, 'create', 'appointment', v_id,
            jsonb_build_object('member_id', p_member, 'service_id', p_service, 'starts_at', p_starts_at));
    RETURN v_id;
END $$;

-- Bekor qilish va ko'chirishni bronning mijozi yoki 'appointments.manage' egasi bajaradi.
-- Begona bron uchun "topilmadi": bron borligi ham oshkor bo'lmasin.
CREATE FUNCTION app.cancel_appointment(p_id BIGINT, p_reason TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v appointments%ROWTYPE;
BEGIN
    SELECT * INTO v FROM appointments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR NOT (v.client_id = ANY (app.my_client_ids()) OR app.has_perm(v.business_id, 'appointments.manage')) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v.status NOT IN ('pending', 'confirmed') OR v.starts_at <= now() THEN
        RAISE EXCEPTION 'not_changeable' USING ERRCODE = 'P0409';
    END IF;

    UPDATE appointments SET status = 'cancelled', cancel_reason = p_reason, updated_at = now() WHERE id = p_id;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (v.business_id, app.uid(), 'cancel', 'appointment', p_id, jsonb_build_object('reason', p_reason));
END $$;

-- Usta va xizmat o'zgarmaydi, narx bron paytidagicha qoladi.
-- Mijoz ko'chirsa, salon yangi vaqtni qayta tasdiqlaydi.
CREATE FUNCTION app.reschedule_appointment(p_id BIGINT, p_starts_at TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v         appointments%ROWTYPE;
    v_salon   BOOLEAN;
    v_tz      TEXT;
    v_service BIGINT;
    v_end     TIMESTAMPTZ;
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

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (v.business_id, app.uid(), 'reschedule', 'appointment', p_id,
            jsonb_build_object('from', v.starts_at, 'to', p_starts_at));
END $$;

REVOKE ALL ON FUNCTION app.book_appointment(BIGINT, BIGINT, TIMESTAMPTZ, TEXT),
                       app.cancel_appointment(BIGINT, TEXT),
                       app.reschedule_appointment(BIGINT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.book_appointment(BIGINT, BIGINT, TIMESTAMPTZ, TEXT),
                          app.cancel_appointment(BIGINT, TEXT),
                          app.reschedule_appointment(BIGINT, TIMESTAMPTZ) TO app_api;
