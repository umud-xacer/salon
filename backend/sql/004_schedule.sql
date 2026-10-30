-- ════════════════════════════════════════════════════════════════════════════
--  P1.3 — Ish jadvali va bo'sh vaqtlar
-- ════════════════════════════════════════════════════════════════════════════

-- Tanaffus alohida saqlanmaydi: kun bir nechta ish oralig'idan iborat, tanaffus — ular orasidagi bo'shliq.
-- Bir kunda oraliqlar ustma-ust tushmasin.
ALTER TABLE staff_schedules ADD CONSTRAINT no_schedule_overlap EXCLUDE USING GIST (
    member_id WITH =,
    weekday   WITH =,
    tsrange(DATE '2000-01-01' + start_time, DATE '2000-01-01' + end_time) WITH &&
);

CREATE INDEX ON staff_time_off (member_id, starts_at);

-- Bo'sh vaqtlar. Mijoz bronlar va ta'tillarni o'qiy olmaydi (RLS), shuning uchun hisob SECURITY DEFINER
-- funksiyada: tashqariga faqat bo'sh vaqtlar chiqadi — kimning broni yoki ta'til sababi emas.
-- Jadvali kiritilmagan usta biznes ish soatlari bo'yicha ishlaydi.
-- Nomzodlar: har p_step daqiqalik to'r + har bir band vaqtning tugashi (bronlar orasida teshik qolmasin).
CREATE FUNCTION app.available_slots(p_member BIGINT, p_service BIGINT, p_day DATE, p_step INTEGER DEFAULT 30)
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

REVOKE ALL ON FUNCTION app.available_slots(BIGINT, BIGINT, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.available_slots(BIGINT, BIGINT, DATE, INTEGER) TO app_api;
