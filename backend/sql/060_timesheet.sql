-- 3-bosqich, 3-modul: xodimlar tabeli va ish vaqti hisobi.
--
-- * staff_days — kunlik reja (haftalik jadval ustidan): "ish" (alohida smena soatlari bilan yoki haftalik jadval
--   bo'yicha), "dam olish", "ta'til", "kasallik", "sababsiz kelmadi". Ish bo'lmagan kunda onlayn bron yopiladi
--   (slots_core shu jadvalni hisobga oladi).
-- * staff_attendance — keldi/ketdi (kuniga bitta yozuv). Xodim o'zi belgilaydi (vaqtni server qo'yadi —
--   soxtalashtirib bo'lmaydi) yoki direktor/menejer tabelda tuzatadi.
-- * timesheet_settings — kechikish chegarasi (standart 15 daqiqa).
-- * app.timesheet_days — har xodim × har kun: holat, reja, keldi/ketdi, ishlagan daqiqa, kechikish, erta ketish.
-- * Oylik: member_compensation.pay_type — oylik / kunbay / soatbay, stavkalar, kechikish va kelmaslik jarimasi.
--   app.generate_payroll asosiy maoshni tabeldan hisoblaydi; ko'rsatkichlar oylikda alohida ko'rinadi.
-- * Huquq: tabelni ko'rish va tahrirlash — 'staff.manage' yoki 'payroll.manage'; xodim o'zinikini ko'radi.

CREATE TABLE staff_days (
    business_id  BIGINT NOT NULL,
    member_id    BIGINT NOT NULL,
    day          DATE   NOT NULL,
    kind         VARCHAR(10) NOT NULL CHECK (kind IN ('work', 'day_off', 'vacation', 'sick', 'absent')),
    start_time   TIME,
    end_time     TIME,
    note         VARCHAR(200),
    updated_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, day),
    FOREIGN KEY (business_id, member_id) REFERENCES business_members (business_id, id) ON DELETE CASCADE,
    CHECK ((start_time IS NULL) = (end_time IS NULL) AND (start_time IS NULL OR end_time > start_time)),
    CHECK (kind = 'work' OR start_time IS NULL)
);
CREATE INDEX ON staff_days (business_id, day);

CREATE TABLE staff_attendance (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL,
    member_id    BIGINT NOT NULL,
    day          DATE   NOT NULL,
    check_in     TIMESTAMPTZ NOT NULL,
    check_out    TIMESTAMPTZ,
    source       VARCHAR(6) NOT NULL DEFAULT 'self' CHECK (source IN ('self', 'admin')),
    note         VARCHAR(200),
    updated_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, day),
    FOREIGN KEY (business_id, member_id) REFERENCES business_members (business_id, id) ON DELETE CASCADE,
    CHECK (check_out IS NULL OR check_out > check_in),
    CHECK (check_out IS NULL OR check_out - check_in <= INTERVAL '24 hours')
);
CREATE INDEX ON staff_attendance (business_id, day);

CREATE TABLE timesheet_settings (
    business_id     BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    late_grace_min  SMALLINT NOT NULL DEFAULT 15 CHECK (late_grace_min BETWEEN 0 AND 120)
);

ALTER TABLE member_compensation
    ADD COLUMN pay_type         VARCHAR(8) NOT NULL DEFAULT 'monthly' CHECK (pay_type IN ('monthly', 'daily', 'hourly')),
    ADD COLUMN daily_rate       BIGINT NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),
    ADD COLUMN hourly_rate      BIGINT NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
    ADD COLUMN late_penalty     BIGINT NOT NULL DEFAULT 0 CHECK (late_penalty >= 0),      -- har kechikish uchun
    ADD COLUMN absence_penalty  BIGINT NOT NULL DEFAULT 0 CHECK (absence_penalty >= 0);   -- har kelmagan kun uchun

ALTER TABLE payrolls
    ADD COLUMN pay_type        VARCHAR(8) NOT NULL DEFAULT 'monthly',
    ADD COLUMN worked_days     SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN worked_minutes  INTEGER  NOT NULL DEFAULT 0,
    ADD COLUMN late_count      SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN absent_days     SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN penalties       BIGINT   NOT NULL DEFAULT 0;    -- asosiy maoshdan ayirilgan (base_salary — ayirilgandan keyin)

ALTER TABLE staff_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_days, staff_attendance TO app_api;
GRANT SELECT, INSERT, UPDATE ON timesheet_settings TO app_api;

CREATE FUNCTION app.can_timesheet(p_business BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT app.has_perm(p_business, 'staff.manage') OR app.has_perm(p_business, 'payroll.manage')
$$;
GRANT EXECUTE ON FUNCTION app.can_timesheet(BIGINT) TO app_api;

CREATE POLICY manage ON staff_days FOR ALL TO app_api
    USING (app.can_timesheet(business_id)) WITH CHECK (app.can_timesheet(business_id));
CREATE POLICY own_read ON staff_days FOR SELECT TO app_api USING (member_id = ANY (app.my_member_ids()));
-- Keldi/ketdi: direktor tuzatadi; xodim o'zinikini faqat ko'radi (belgilash — app.attendance_mark orqali)
CREATE POLICY manage ON staff_attendance FOR ALL TO app_api
    USING (app.can_timesheet(business_id)) WITH CHECK (app.can_timesheet(business_id));
CREATE POLICY own_read ON staff_attendance FOR SELECT TO app_api USING (member_id = ANY (app.my_member_ids()));
CREATE POLICY read ON timesheet_settings FOR SELECT TO app_api USING (business_id = ANY (app.my_business_ids()));
CREATE POLICY manage ON timesheet_settings FOR ALL TO app_api
    USING (app.can_timesheet(business_id)) WITH CHECK (app.can_timesheet(business_id));

CREATE FUNCTION app.timesheet_stamp() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_by := app.uid();
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER staff_days_stamp BEFORE INSERT OR UPDATE ON staff_days FOR EACH ROW EXECUTE FUNCTION app.timesheet_stamp();
CREATE TRIGGER staff_attendance_stamp BEFORE INSERT OR UPDATE ON staff_attendance FOR EACH ROW EXECUTE FUNCTION app.timesheet_stamp();

-- ─── Xodim o'zi: "Keldim" / "Ketdim" (vaqtni server qo'yadi) ─────────────────────────────────────────
CREATE FUNCTION app.attendance_mark(p_business BIGINT, p_action TEXT) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_member BIGINT;
    v_day    DATE;
    v_id     BIGINT;
BEGIN
    SELECT m.id INTO v_member FROM business_members m
     WHERE m.business_id = p_business AND m.user_id = app.uid() AND m.is_active;
    IF v_member IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    SELECT (now() AT TIME ZONE timezone)::date INTO v_day FROM businesses WHERE id = p_business;
    IF p_action = 'in' THEN
        INSERT INTO staff_attendance (business_id, member_id, day, check_in, source)
        VALUES (p_business, v_member, v_day, now(), 'self')
        ON CONFLICT (member_id, day) DO NOTHING
        RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RAISE EXCEPTION 'already_checked_in' USING ERRCODE = 'P0426';
        END IF;
    ELSIF p_action = 'out' THEN
        UPDATE staff_attendance SET check_out = now()
         WHERE member_id = v_member AND day = v_day AND check_out IS NULL
        RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RAISE EXCEPTION 'not_checked_in' USING ERRCODE = 'P0427';
        END IF;
    ELSE
        RAISE EXCEPTION 'bad_action' USING ERRCODE = '22023';
    END IF;
    RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.attendance_mark(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.attendance_mark(BIGINT, TEXT) TO app_api;

-- ─── Rejadagi ish oynasi (kun bo'yicha): kunlik reja > haftalik jadval > muassasa ish vaqti ────────────
-- Natija: (kind, start, end). kind: 'work' (soatlar bilan), 'day_off'/'vacation'/'sick'/'absent' (kunlik reja),
-- 'off' (jadval bo'yicha ish kuni emas).
CREATE FUNCTION app.planned_day(p_member BIGINT, p_day DATE)
RETURNS TABLE (kind TEXT, start_time TIME, end_time TIME)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    d staff_days%ROWTYPE;
BEGIN
    SELECT * INTO d FROM staff_days sd WHERE sd.member_id = p_member AND sd.day = p_day;
    IF d.member_id IS NOT NULL AND (d.kind <> 'work' OR d.start_time IS NOT NULL) THEN
        RETURN QUERY SELECT d.kind::text, d.start_time, d.end_time;
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM staff_schedules ss WHERE ss.member_id = p_member) THEN
        RETURN QUERY SELECT CASE WHEN min(ss.start_time) IS NULL THEN 'off' ELSE 'work' END, min(ss.start_time), max(ss.end_time)
                       FROM staff_schedules ss WHERE ss.member_id = p_member AND ss.weekday = extract(isodow FROM p_day);
    ELSE
        RETURN QUERY SELECT CASE WHEN min(bh.opens_at) IS NULL THEN 'off' ELSE 'work' END, min(bh.opens_at), max(bh.closes_at)
                       FROM business_members m JOIN business_hours bh ON bh.business_id = m.business_id
                      WHERE m.id = p_member AND bh.weekday = extract(isodow FROM p_day);
    END IF;
END $$;
REVOKE ALL ON FUNCTION app.planned_day(BIGINT, DATE) FROM PUBLIC;

-- ─── Tabel: har xodim × har kun ──────────────────────────────────────────────────────────────────────
-- status: work | late | absent | day_off | vacation | sick | off | planned | today
CREATE FUNCTION app.timesheet_days(p_business BIGINT, p_start DATE, p_end DATE, p_member BIGINT DEFAULT NULL)
RETURNS TABLE (member_id BIGINT, day DATE, status TEXT, planned_start TIME, planned_end TIME,
               check_in TIMESTAMPTZ, check_out TIMESTAMPTZ, worked_min INTEGER, late_min INTEGER, early_min INTEGER,
               note TEXT, source TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_tz    TEXT;
    v_today DATE;
    v_grace INTEGER;
BEGIN
    IF NOT (app.can_timesheet(p_business)
            OR (p_member IS NOT NULL AND p_member = ANY (app.my_member_ids()))) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF p_end < p_start OR p_end - p_start > 62 THEN
        RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
    END IF;
    SELECT timezone INTO v_tz FROM businesses WHERE id = p_business;
    v_today := (now() AT TIME ZONE v_tz)::date;
    v_grace := coalesce((SELECT late_grace_min FROM timesheet_settings WHERE business_id = p_business), 15);

    RETURN QUERY
    WITH base AS (
        SELECT m.id AS mid, g.d AS d, p.kind AS pkind, p.start_time AS ps, p.end_time AS pe,
               a.check_in AS ci, a.check_out AS co, a.source AS src,
               coalesce(a.note, sd.note) AS nt,
               EXISTS (SELECT 1 FROM staff_time_off t WHERE t.member_id = m.id
                         AND tstzrange(t.starts_at, t.ends_at) && tstzrange(g.d::timestamp AT TIME ZONE v_tz,
                                                                            (g.d + 1)::timestamp AT TIME ZONE v_tz)) AS off_range
          FROM business_members m
          CROSS JOIN (SELECT gs::date AS d FROM generate_series(p_start::timestamp, p_end::timestamp, INTERVAL '1 day') gs) g
          CROSS JOIN LATERAL app.planned_day(m.id, g.d) p
          LEFT JOIN staff_attendance a ON a.member_id = m.id AND a.day = g.d
          LEFT JOIN staff_days sd ON sd.member_id = m.id AND sd.day = g.d
         WHERE m.business_id = p_business AND m.is_active AND (p_member IS NULL OR m.id = p_member)
           -- Direktor tabelga faqat o'zi ham xizmat ko'rsatsa tushadi
           AND (m.role <> 'owner' OR p_member IS NOT NULL
                OR EXISTS (SELECT 1 FROM member_services ms WHERE ms.member_id = m.id))
    )
    SELECT b.mid, b.d,
           CASE
               WHEN b.pkind IN ('day_off', 'vacation', 'sick', 'absent') AND b.ci IS NULL THEN b.pkind
               WHEN b.ci IS NOT NULL AND b.ps IS NOT NULL
                    AND b.ci > ((b.d + b.ps) AT TIME ZONE v_tz) + make_interval(mins => v_grace) THEN 'late'
               WHEN b.ci IS NOT NULL THEN 'work'
               WHEN b.off_range THEN 'vacation'
               WHEN b.pkind = 'work' AND b.d < v_today THEN 'absent'
               WHEN b.pkind = 'work' AND b.d = v_today THEN 'today'
               WHEN b.pkind = 'work' THEN 'planned'
               ELSE 'off'
           END,
           b.ps, b.pe, b.ci, b.co,
           CASE WHEN b.ci IS NOT NULL AND b.co IS NOT NULL THEN (extract(epoch FROM b.co - b.ci) / 60)::int ELSE 0 END,
           CASE WHEN b.ci IS NOT NULL AND b.ps IS NOT NULL
                     AND b.ci > ((b.d + b.ps) AT TIME ZONE v_tz) + make_interval(mins => v_grace)
                THEN (extract(epoch FROM b.ci - ((b.d + b.ps) AT TIME ZONE v_tz)) / 60)::int ELSE 0 END,
           CASE WHEN b.co IS NOT NULL AND b.pe IS NOT NULL
                     AND b.co < ((b.d + b.pe) AT TIME ZONE v_tz) - make_interval(mins => v_grace)
                THEN (extract(epoch FROM ((b.d + b.pe) AT TIME ZONE v_tz) - b.co) / 60)::int ELSE 0 END,
           b.nt::text, b.src::text
      FROM base b
     ORDER BY b.mid, b.d;
END $$;
REVOKE ALL ON FUNCTION app.timesheet_days(BIGINT, DATE, DATE, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.timesheet_days(BIGINT, DATE, DATE, BIGINT) TO app_api;

-- ─── Bo'sh vaqtlar: kunlik reja (dam olish, ta'til, kasallik, alohida smena) hisobga olinadi ───────────
CREATE OR REPLACE FUNCTION app.slots_core(p_member BIGINT, p_service BIGINT, p_day DATE, p_step INTEGER, p_exclude BIGINT)
RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ, slot_time TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_business BIGINT;
    v_tz       TEXT;
    v_duration INTERVAL;
    v_buffer   INTERVAL;
    v_today    DATE;
    v_need     BIGINT[];
    v_plan     RECORD;
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
     WHERE m.id = p_member AND m.is_active AND m.is_bookable;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    v_today := (now() AT TIME ZONE v_tz)::date;
    IF p_day < v_today OR p_day > v_today + 60 THEN
        RAISE EXCEPTION 'date_out_of_range' USING ERRCODE = '22023';
    END IF;
    v_need := app.service_resource_ids(p_service);
    -- Kunlik reja: ish bo'lmagan kun — bo'sh vaqt yo'q; alohida smena — faqat shu oraliq
    SELECT * INTO v_plan FROM staff_days sd WHERE sd.member_id = p_member AND sd.day = p_day;
    IF v_plan.kind IS NOT NULL AND v_plan.kind <> 'work' THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH work AS (
        SELECT (p_day + w.s) AT TIME ZONE v_tz AS w_start, (p_day + w.e) AT TIME ZONE v_tz AS w_end
          FROM (SELECT v_plan.start_time AS s, v_plan.end_time AS e WHERE v_plan.start_time IS NOT NULL
                UNION ALL
                SELECT ss.start_time, ss.end_time FROM staff_schedules ss
                 WHERE v_plan.start_time IS NULL
                   AND ss.member_id = p_member AND ss.weekday = extract(isodow FROM p_day)
                UNION ALL
                SELECT bh.opens_at, bh.closes_at FROM business_hours bh
                 WHERE v_plan.start_time IS NULL
                   AND bh.business_id = v_business AND bh.weekday = extract(isodow FROM p_day)
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
       AND (cardinality(v_need) = 0 OR EXISTS (
                SELECT 1 FROM unnest(v_need) rid WHERE app.resource_free(rid, c.c_start, c.c_start + v_duration, p_exclude)))
     ORDER BY c.c_start;
END $$;

-- ─── Oylik: asosiy maosh tabeldan (kunbay/soatbay), jarimalar ayiriladi ──────────────────────────────────
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
    v_days    INTEGER;
    v_mins    INTEGER;
    v_late    INTEGER;
    v_absent  INTEGER;
    v_earned  BIGINT;
    v_pen     BIGINT;
    v_base    BIGINT;
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
        SELECT c.member_id, c.base_salary, c.commission_percent, c.pay_type, c.daily_rate, c.hourly_rate,
               c.late_penalty, c.absence_penalty
          FROM member_compensation c
          JOIN business_members bm ON bm.id = c.member_id AND bm.is_active
         WHERE c.business_id = p_business
           AND (c.base_salary > 0 OR c.commission_percent > 0 OR c.daily_rate > 0 OR c.hourly_rate > 0)
    LOOP
        SELECT coalesce(sum(round(pay.paid * sh.share)), 0)::bigint, count(*)::int INTO v_rev, v_clients
          FROM appointments a
          JOIN LATERAL (SELECT sum(p.amount) AS paid FROM payments p
                         WHERE p.appointment_id = a.id AND p.status = 'paid'
                           AND p.paid_at >= v_from AND p.paid_at < v_to) pay ON pay.paid > 0
          JOIN LATERAL (
                SELECT CASE WHEN count(*) = 0 THEN (a.member_id = m.member_id)::int::numeric
                            WHEN sum(l.price) = 0 THEN 0::numeric
                            ELSE coalesce(sum(l.price) FILTER (
                                     WHERE NOT l.house AND coalesce(l.member_id, a.member_id) = m.member_id), 0)::numeric
                                 / sum(l.price) END AS share,
                       (count(*) = 0 AND a.member_id = m.member_id)
                       OR count(*) FILTER (WHERE NOT l.house AND coalesce(l.member_id, a.member_id) = m.member_id) > 0
                           AS mine
                  FROM appointment_services l WHERE l.appointment_id = a.id) sh ON sh.mine
         WHERE a.business_id = p_business;

        -- Tabel ko'rsatkichlari (kelajakdagi kunlar hisoblanmaydi)
        SELECT count(*) FILTER (WHERE t.status IN ('work', 'late'))::int,
               coalesce(sum(t.worked_min), 0)::int,
               count(*) FILTER (WHERE t.status = 'late')::int,
               count(*) FILTER (WHERE t.status = 'absent')::int
          INTO v_days, v_mins, v_late, v_absent
          FROM app.timesheet_days(p_business, p_start, p_end, m.member_id) t;

        v_earned := CASE m.pay_type
                        WHEN 'daily'  THEN v_days * m.daily_rate
                        WHEN 'hourly' THEN round(v_mins * m.hourly_rate / 60.0)::bigint
                        ELSE m.base_salary END;
        v_pen  := least(v_earned, v_late * m.late_penalty + v_absent * m.absence_penalty);
        v_base := v_earned - v_pen;
        v_comm := round(v_rev * m.commission_percent / 100);
        v_open := app.open_advances(m.member_id, p_end);

        INSERT INTO payrolls (business_id, member_id, period_start, period_end, base_salary, commission,
                              revenue, commission_percent, clients, advances,
                              pay_type, worked_days, worked_minutes, late_count, absent_days, penalties)
        VALUES (p_business, m.member_id, p_start, p_end, v_base, v_comm, v_rev, m.commission_percent,
                v_clients, least(v_open, v_base + v_comm),
                m.pay_type, v_days, v_mins, v_late, v_absent, v_pen)
        ON CONFLICT (member_id, period_start, period_end) DO UPDATE
           SET base_salary = EXCLUDED.base_salary, commission = EXCLUDED.commission,
               revenue = EXCLUDED.revenue, commission_percent = EXCLUDED.commission_percent,
               clients = EXCLUDED.clients, pay_type = EXCLUDED.pay_type, worked_days = EXCLUDED.worked_days,
               worked_minutes = EXCLUDED.worked_minutes, late_count = EXCLUDED.late_count,
               absent_days = EXCLUDED.absent_days, penalties = EXCLUDED.penalties,
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
