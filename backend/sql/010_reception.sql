-- Qabulxona: mijoz nomidan bron va "istalgan usta".
-- Narx, davomiylik va bo'sh vaqt doim bazadan olinadi; ikki marta bron no_double_booking cheklovi bilan to'xtaydi.

-- Xizmatni bajaradigan ustalar orasida kamida bittasi bo'sh bo'lgan vaqtlar
CREATE FUNCTION app.any_staff_slots(p_business BIGINT, p_service BIGINT, p_day DATE, p_step INTEGER DEFAULT 30)
RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ, slot_time TEXT, free_staff INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT app.has_perm(p_business, 'appointments.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT c.slot_start, min(c.slot_end), c.slot_time, count(*)::int
      FROM business_members m
      JOIN users u            ON u.id = m.user_id AND u.status = 'active'
      JOIN member_services ms ON ms.member_id = m.id AND ms.service_id = p_service
      JOIN services s         ON s.id = ms.service_id AND s.is_active
     CROSS JOIN LATERAL app.compute_slots(m.id, p_service, p_day, p_step, NULL) c
     WHERE m.business_id = p_business AND m.is_active AND m.is_bookable
     GROUP BY c.slot_start, c.slot_time
     ORDER BY c.slot_start;
END $$;

-- p_member NULL = istalgan usta: shu vaqtda bo'sh ustalardan o'sha kuni bronlari eng kami tanlanadi.
-- Boshqa qabulxona oldinroq band qilsa, keyingi bo'sh usta sinaladi.
CREATE FUNCTION app.reception_book(p_business BIGINT, p_member BIGINT, p_service BIGINT, p_starts_at TIMESTAMPTZ,
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
    IF NOT app.has_perm(p_business, 'appointments.manage') THEN
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

REVOKE ALL ON FUNCTION app.any_staff_slots(BIGINT, BIGINT, DATE, INTEGER),
                       app.reception_book(BIGINT, BIGINT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.any_staff_slots(BIGINT, BIGINT, DATE, INTEGER),
                          app.reception_book(BIGINT, BIGINT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO app_api;
