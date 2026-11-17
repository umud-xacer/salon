-- 3-bosqich, 2-modul: xonalar, kreslolar va apparatlar bandligi.
--
-- Muammo: 5 ta usta bor, lekin 3 ta kreslo yoki 1 ta lazer apparati — usta bo'sh bo'lsa ham resurs band.
--
-- * resources — kreslo / kabinet / apparat: sig'imi (bir vaqtda nechta mijoz), tozalash vaqti, ish vaqti, holati.
-- * service_resources — xizmatga mos resurslar ("Soch olish" → 1–3-kreslo; "Rentgen" → Rentgen xonasi).
--   Xizmatga resurs bog'lansa, bron faqat bo'sh resurs bilan yaratiladi (birortasi bo'sh bo'lishi kifoya).
-- * business_members.default_resource_id — ustaning "o'z" kreslosi: mos bo'lsa avval shu tanlanadi.
-- * appointments.resource_id — bronga biriktirilgan resurs. Qo'lda ham tanlanadi (qabulxona).
--
-- To'qnashuv himoyasi bazada: resurs tanlash/tekshirishdan oldin resurs qatori FOR UPDATE bilan qulflanadi —
-- ikki administrator bir soniyada bitta kreslo uchun yozsa ham, ikkinchisi birinchisini kutadi va band ko'radi.
-- Bo'sh vaqtlar (slots_core) ham resursni hisobga oladi: usta bo'sh-u, kreslo band bo'lsa — vaqt taklif qilinmaydi.

CREATE TABLE resources (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name         VARCHAR(80) NOT NULL CHECK (length(btrim(name)) >= 1),
    kind         VARCHAR(10) NOT NULL DEFAULT 'chair' CHECK (kind IN ('chair', 'room', 'device')),
    capacity     SMALLINT NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 50),
    cleanup_min  SMALLINT NOT NULL DEFAULT 0 CHECK (cleanup_min BETWEEN 0 AND 120),   -- tozalash/sterilizatsiya
    opens_at     TIME,                                                               -- NULL — muassasa vaqti
    closes_at    TIME,
    status       VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance')),
    sort_order   SMALLINT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, id),
    CHECK ((opens_at IS NULL) = (closes_at IS NULL) AND (opens_at IS NULL OR closes_at > opens_at))
);
CREATE UNIQUE INDEX resources_unique_name ON resources (business_id, lower(name));

CREATE TABLE service_resources (
    business_id  BIGINT NOT NULL,
    service_id   BIGINT NOT NULL,
    resource_id  BIGINT NOT NULL,
    PRIMARY KEY (service_id, resource_id),
    FOREIGN KEY (business_id, service_id) REFERENCES services (business_id, id) ON DELETE CASCADE,
    FOREIGN KEY (business_id, resource_id) REFERENCES resources (business_id, id) ON DELETE CASCADE
);
CREATE INDEX ON service_resources (resource_id);

ALTER TABLE business_members ADD COLUMN default_resource_id BIGINT;
ALTER TABLE business_members ADD FOREIGN KEY (business_id, default_resource_id)
    REFERENCES resources (business_id, id) ON DELETE SET NULL (default_resource_id);
ALTER TABLE appointments ADD COLUMN resource_id BIGINT;
ALTER TABLE appointments ADD FOREIGN KEY (business_id, resource_id)
    REFERENCES resources (business_id, id) ON DELETE SET NULL (resource_id);
CREATE INDEX ON appointments (resource_id, starts_at) WHERE resource_id IS NOT NULL;

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_resources ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON resources, service_resources TO app_api;
GRANT UPDATE (default_resource_id) ON business_members TO app_api;
-- resource_id faqat app.assign_resource orqali (sig'im tekshiruvi chetlab o'tilmasin)
-- Ko'rish — muassasa xodimlari (kalendar), boshqarish — direktor
CREATE POLICY staff_read ON resources FOR SELECT TO app_api USING (business_id = ANY (app.my_business_ids()));
CREATE POLICY manage ON resources FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));
CREATE POLICY staff_read ON service_resources FOR SELECT TO app_api USING (business_id = ANY (app.my_business_ids()));
CREATE POLICY manage ON service_resources FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));

-- ─── Resurs shu oraliqda bo'shmi (sig'im, tozalash vaqti, ish vaqti, holat) ─────────────────────────
CREATE FUNCTION app.resource_free(p_resource BIGINT, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_exclude BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    r     resources%ROWTYPE;
    v_tz  TEXT;
    v_end TIMESTAMPTZ;
    v_max INTEGER;
BEGIN
    SELECT * INTO r FROM resources WHERE id = p_resource;
    IF r.id IS NULL OR r.status <> 'active' THEN
        RETURN false;
    END IF;
    v_end := p_end + make_interval(mins => r.cleanup_min);
    IF r.opens_at IS NOT NULL THEN
        SELECT timezone INTO v_tz FROM businesses WHERE id = r.business_id;
        IF (p_start AT TIME ZONE v_tz)::time < r.opens_at OR (p_end AT TIME ZONE v_tz)::time > r.closes_at
           OR (p_start AT TIME ZONE v_tz)::date <> (p_end AT TIME ZONE v_tz)::date THEN
            RETURN false;
        END IF;
    END IF;
    -- Eng ko'p bir vaqtdagi band joylar: har bir bron boshlanishi (va yangi bron boshi) nuqtasida sanaladi
    SELECT coalesce(max(cnt), 0) INTO v_max FROM (
        SELECT (SELECT count(*) FROM appointments a2
                 WHERE a2.resource_id = r.id AND a2.status IN ('pending', 'confirmed', 'in_progress')
                   AND a2.id IS DISTINCT FROM p_exclude
                   AND tstzrange(a2.starts_at, a2.ends_at + make_interval(mins => r.cleanup_min)) @> pt.t) AS cnt
          FROM (SELECT p_start AS t
                UNION
                SELECT a.starts_at FROM appointments a
                 WHERE a.resource_id = r.id AND a.status IN ('pending', 'confirmed', 'in_progress')
                   AND a.id IS DISTINCT FROM p_exclude
                   AND a.starts_at >= p_start AND a.starts_at < v_end) pt) x;
    RETURN v_max < r.capacity;
END $$;
REVOKE ALL ON FUNCTION app.resource_free(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resource_free(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT) TO app_api;

-- Xizmatga mos resurslar (bo'sh ro'yxat — resurs talab qilinmaydi)
CREATE FUNCTION app.service_resource_ids(p_service BIGINT) RETURNS BIGINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(array_agg(sr.resource_id ORDER BY r.sort_order, r.id), '{}')
      FROM service_resources sr JOIN resources r ON r.id = sr.resource_id
     WHERE sr.service_id = p_service
$$;
REVOKE ALL ON FUNCTION app.service_resource_ids(BIGINT) FROM PUBLIC;

-- ─── Bronga resurs: tanlash yoki tekshirish (qulf bilan) ────────────────────────────────────────────
-- p_preferred — qo'lda tanlangan; NULL bo'lsa avtomatik (ustaning o'z kreslosi birinchi).
CREATE FUNCTION app.assign_resource(p_appointment BIGINT, p_preferred BIGINT DEFAULT NULL) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    a        appointments%ROWTYPE;
    v_svc    BIGINT;
    v_need   BIGINT[];
    v_member BIGINT;
    v_pick   BIGINT;
    v_cand   BIGINT;
BEGIN
    SELECT * INTO a FROM appointments WHERE id = p_appointment;
    IF a.id IS NULL OR a.status NOT IN ('pending', 'confirmed', 'in_progress') THEN
        RETURN a.resource_id;
    END IF;
    SELECT s.service_id INTO v_svc FROM appointment_services s WHERE s.appointment_id = a.id ORDER BY s.id LIMIT 1;
    v_need := CASE WHEN v_svc IS NULL THEN '{}' ELSE app.service_resource_ids(v_svc) END;
    v_pick := coalesce(p_preferred, a.resource_id);

    IF v_pick IS NOT NULL THEN
        IF cardinality(v_need) > 0 AND NOT v_pick = ANY (v_need) THEN
            RAISE EXCEPTION 'resource_not_suitable' USING ERRCODE = 'P0425';
        END IF;
        PERFORM 1 FROM resources WHERE id = v_pick AND business_id = a.business_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'resource_not_found' USING ERRCODE = 'P0404';
        END IF;
        IF app.resource_free(v_pick, a.starts_at, a.ends_at, a.id) THEN
            UPDATE appointments SET resource_id = v_pick WHERE id = a.id AND resource_id IS DISTINCT FROM v_pick;
            RETURN v_pick;
        END IF;
        -- Qo'lda tanlangan band — xato; avtomatik (oldingi) band bo'lsa, boshqasini qidiramiz
        IF p_preferred IS NOT NULL OR cardinality(v_need) = 0 THEN
            RAISE EXCEPTION 'resource_busy' USING ERRCODE = 'P0424';
        END IF;
    END IF;
    IF cardinality(v_need) = 0 THEN
        RETURN NULL;
    END IF;

    -- Barcha mos resurslar bir tartibda qulflanadi (deadlock bo'lmasin)
    PERFORM 1 FROM resources WHERE id = ANY (v_need) ORDER BY id FOR UPDATE;
    SELECT default_resource_id INTO v_member FROM business_members WHERE id = a.member_id;
    v_pick := NULL;
    FOR v_cand IN
        SELECT x FROM unnest(v_need) WITH ORDINALITY u(x, o) ORDER BY (x = v_member) DESC, o
    LOOP
        IF app.resource_free(v_cand, a.starts_at, a.ends_at, a.id) THEN
            v_pick := v_cand;
            EXIT;
        END IF;
    END LOOP;
    IF v_pick IS NULL THEN
        RAISE EXCEPTION 'resource_busy' USING ERRCODE = 'P0424';
    END IF;
    UPDATE appointments SET resource_id = v_pick WHERE id = a.id AND resource_id IS DISTINCT FROM v_pick;
    RETURN v_pick;
END $$;
REVOKE ALL ON FUNCTION app.assign_resource(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assign_resource(BIGINT, BIGINT) TO app_api;

-- Birinchi xizmat qatori qo'shilganda (bron yaratildi) — resurs avtomatik tanlanadi.
-- Har qanday yo'l (ilova, qabulxona, kutish ro'yxati, walk-in) shu yerdan o'tadi.
CREATE FUNCTION app.appointment_services_resource() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM appointment_services x WHERE x.appointment_id = NEW.appointment_id AND x.id < NEW.id) THEN
        PERFORM app.assign_resource(NEW.appointment_id, NULL);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER appointment_services_resource AFTER INSERT ON appointment_services
    FOR EACH ROW EXECUTE FUNCTION app.appointment_services_resource();

-- Vaqt ko'chirilsa yoki bron qayta faollashsa — resurs qayta tekshiriladi (kerak bo'lsa boshqasi tanlanadi)
CREATE FUNCTION app.appointments_recheck_resource() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.status IN ('pending', 'confirmed', 'in_progress')
       AND (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at
            OR OLD.status NOT IN ('pending', 'confirmed', 'in_progress')) THEN
        PERFORM app.assign_resource(NEW.id, NULL);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER appointments_recheck_resource AFTER UPDATE OF starts_at, ends_at, status ON appointments
    FOR EACH ROW EXECUTE FUNCTION app.appointments_recheck_resource();

-- ─── Bo'sh vaqtlar: resurs ham bo'sh bo'lishi shart ─────────────────────────────────────────────────
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
       AND (cardinality(v_need) = 0 OR EXISTS (
                SELECT 1 FROM unnest(v_need) rid WHERE app.resource_free(rid, c.c_start, c.c_start + v_duration, p_exclude)))
     ORDER BY c.c_start;
END $$;

-- ─── Ilova resource_id ni to'g'ridan yozolmaydi: faqat app.assign_resource (SECURITY DEFINER) orqali ───────
CREATE FUNCTION app.guard_appointment_resource() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF app.is_app_role() AND NEW.resource_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.resource_id END) THEN
        RAISE EXCEPTION 'resource_direct_write' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER guard_appointment_resource BEFORE INSERT OR UPDATE OF resource_id ON appointments
    FOR EACH ROW EXECUTE FUNCTION app.guard_appointment_resource();
