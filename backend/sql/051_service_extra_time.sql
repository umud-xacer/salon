-- Xizmatga qo'shimcha vaqt (Fresha tahlili, 1-bosqich):
--   * kutish vaqti (processing) — masalan, bo'yoq ta'sir qilayotgan payt: mijoz o'tiradi,
--     usta esa bo'sh, shu oraliqqa boshqa mijozni yozish mumkin;
--   * bufer (buffer) — xizmatdan keyin tozalash/tayyorlanish: mijoz ketgan, usta hali band.
--
-- Qanday ishlaydi: appointments.busy (tstzmultirange) — ustaning HAQIQIY band oralig'i:
--   [boshlanish, tugash + bufer) minus [boshlanish + kutish boshi, + kutish davomiyligi).
-- no_double_booking endi shu ustunda tekshiriladi. Bron yaratuvchi funksiyalar o'zgarmaydi:
-- bron qatori avval oddiy oraliq bilan yoziladi, xizmat qatori (appointment_services) qo'shilganda
-- xizmatning kutish/bufer qiymatlari bronga ko'chiriladi va busy qayta hisoblanadi.
-- Kutish oynasiga keyin qo'yilgan qisqa bron to'qnashmaydi; uzun xizmatni mavjud bron atrofiga
-- "o'rash" esa taklif qilinmaydi (bo'sh vaqt hisobi to'liq oraliqni bo'sh talab qiladi).

-- ─── Xizmat sozlamalari ──────────────────────────────────────────────────────────────────────
ALTER TABLE services
    ADD COLUMN processing_offset_min SMALLINT NOT NULL DEFAULT 0 CHECK (processing_offset_min BETWEEN 0 AND 715),
    ADD COLUMN processing_min        SMALLINT NOT NULL DEFAULT 0 CHECK (processing_min BETWEEN 0 AND 710),
    ADD COLUMN buffer_min            SMALLINT NOT NULL DEFAULT 0 CHECK (buffer_min BETWEEN 0 AND 120),
    -- Kutish xizmat ichida: oldidan ham, keyin ham usta ishlaydigan qism bo'lishi kerak
    ADD CONSTRAINT processing_inside_service CHECK (
        processing_min = 0 OR (processing_offset_min > 0 AND processing_offset_min + processing_min < duration_min));

-- ─── Bronga nusxa (xizmat keyin o'zgarsa ham eski bron buzilmaydi) ───────────────────────────
ALTER TABLE appointments
    ADD COLUMN processing_offset_min SMALLINT NOT NULL DEFAULT 0 CHECK (processing_offset_min >= 0),
    ADD COLUMN processing_min        SMALLINT NOT NULL DEFAULT 0 CHECK (processing_min >= 0),
    ADD COLUMN buffer_min            SMALLINT NOT NULL DEFAULT 0 CHECK (buffer_min BETWEEN 0 AND 120),
    ADD COLUMN busy                  tstzmultirange;

CREATE FUNCTION app.appointment_busy(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_off INTEGER, p_proc INTEGER,
                                     p_buffer INTEGER) RETURNS tstzmultirange
LANGUAGE sql STABLE AS $$
    SELECT CASE
        -- Kutish oynasi bron ichida bo'lsagina ayiriladi (bron qisqartirilgan bo'lsa — e'tiborsiz)
        WHEN p_proc > 0 AND p_off > 0 AND p_start + make_interval(mins => p_off + p_proc) < p_end
        THEN tstzmultirange(tstzrange(p_start, p_end + make_interval(mins => p_buffer)))
             - tstzmultirange(tstzrange(p_start + make_interval(mins => p_off),
                                        p_start + make_interval(mins => p_off + p_proc)))
        ELSE tstzmultirange(tstzrange(p_start, p_end + make_interval(mins => p_buffer)))
    END
$$;

CREATE FUNCTION app.appointments_set_busy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.busy := app.appointment_busy(NEW.starts_at, NEW.ends_at, NEW.processing_offset_min, NEW.processing_min,
                                     NEW.buffer_min);
    RETURN NEW;
END $$;
-- Nomi "a_" bilan: guard_appointments dan oldin ishlaydi (triggerlar alifbo tartibida)
CREATE TRIGGER a_appointments_set_busy BEFORE INSERT OR UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION app.appointments_set_busy();

UPDATE appointments SET busy = tstzmultirange(tstzrange(starts_at, ends_at));
ALTER TABLE appointments ALTER COLUMN busy SET NOT NULL;

ALTER TABLE appointments DROP CONSTRAINT no_double_booking;
ALTER TABLE appointments ADD CONSTRAINT no_double_booking EXCLUDE USING GIST (
    member_id WITH =,
    busy WITH &&
) WHERE (status IN ('pending', 'confirmed', 'in_progress'));

-- Xizmat qatori qo'shilganda: bronning BIRINCHI xizmatidan kutish/bufer nusxalanadi.
-- Bufer keyingi bron bilan to'qnashsa — no_double_booking (23P01), bron yaratilmaydi.
CREATE FUNCTION app.appointment_services_copy_extra_time() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    s services%ROWTYPE;
BEGIN
    IF EXISTS (SELECT 1 FROM appointment_services x WHERE x.appointment_id = NEW.appointment_id AND x.id < NEW.id) THEN
        RETURN NEW;
    END IF;
    SELECT * INTO s FROM services WHERE id = NEW.service_id;
    IF s.processing_min > 0 OR s.buffer_min > 0 THEN
        UPDATE appointments
           SET processing_offset_min = CASE WHEN s.processing_offset_min + s.processing_min < NEW.duration_min
                                            THEN s.processing_offset_min ELSE 0 END,
               processing_min        = CASE WHEN s.processing_offset_min + s.processing_min < NEW.duration_min
                                            THEN s.processing_min ELSE 0 END,
               buffer_min            = s.buffer_min
         WHERE id = NEW.appointment_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER appointment_services_copy_extra_time AFTER INSERT ON appointment_services
    FOR EACH ROW EXECUTE FUNCTION app.appointment_services_copy_extra_time();

-- ─── Bo'sh vaqtlar: band = boshqa bronlarning busy qismlari; yangi bron uchun xizmat + bufer bo'sh bo'lsin ──
CREATE OR REPLACE FUNCTION app.compute_slots(p_member BIGINT, p_service BIGINT, p_day DATE, p_step INTEGER, p_exclude BIGINT)
RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ, slot_time TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_business BIGINT;
    v_tz       TEXT;
    v_duration INTERVAL;
    v_buffer   INTERVAL;
    v_today    DATE;
BEGIN
    IF p_step NOT IN (5, 10, 15, 20, 30, 60) THEN
        RAISE EXCEPTION 'invalid_step' USING ERRCODE = '22023';
    END IF;

    SELECT m.business_id, b.timezone, make_interval(mins => coalesce(ms.custom_duration, s.duration_min)),
           make_interval(mins => s.buffer_min)
      INTO v_business, v_tz, v_duration, v_buffer
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
        SELECT lower(r) AS b_start, upper(r) AS b_end
          FROM appointments a, unnest(a.busy) r
         WHERE a.member_id = p_member AND a.status IN ('pending', 'confirmed', 'in_progress')
           AND a.id IS DISTINCT FROM p_exclude
           AND a.busy && tstzmultirange(tstzrange(p_day::timestamp AT TIME ZONE v_tz,
                                                  (p_day + 1)::timestamp AT TIME ZONE v_tz))
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
                        WHERE tstzrange(b.b_start, b.b_end) && tstzrange(c.c_start, c.c_start + v_duration + v_buffer))
     ORDER BY c.c_start;
END $$;

REVOKE ALL ON FUNCTION app.compute_slots(BIGINT, BIGINT, DATE, INTEGER, BIGINT) FROM PUBLIC, app_api;
