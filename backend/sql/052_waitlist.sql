-- Kutish ro'yxati (Fresha tahlili, 2-bosqich).
--
-- Mijoz (ilova/chronix.uz orqali o'zi) yoki qabulxona kerakli xizmat, usta (ixtiyoriy), sanalar va
-- vaqt oralig'ini yozib qo'yadi. app.waitlist_scan() (worker har daqiqada + bron bekor qilinganda)
-- navbat tartibida har bir yozuvga mos birinchi bo'sh vaqtni topadi:
--   * topilsa — yozuv 'offered' bo'ladi, mijozga (ilovasi bo'lsa) push, panelda banner;
--   * bir vaqt bir paytda faqat bitta yozuvga taklif qilinadi;
--   * taklif qilingan vaqt keyin band bo'lsa — yozuv qayta 'waiting' ga qaytadi;
--   * mijoz shu xizmatga o'zi bron qilsa — 'booked'; sanasi o'tsa — 'expired'.
-- Qabulxona panelda bir bosishda taklif qilingan vaqtga bron qiladi (app.book_from_waitlist).

-- ─── Bo'sh vaqt hisobi: ichki yadro (ko'rinish tekshiruvisiz) ───────────────────────────────
-- compute_slots muassasa ilovada ochiq bo'lmasa ishlamaydi (begona odam yopiq salon jadvalini ko'rmasin).
-- Worker esa yopiq muassasaning kutish ro'yxatini ham tekshirishi kerak — yadro faqat SECURITY DEFINER
-- funksiyalar ichidan chaqiriladi, ilovaga ochilmaydi.
CREATE FUNCTION app.slots_core(p_member BIGINT, p_service BIGINT, p_day DATE, p_step INTEGER, p_exclude BIGINT)
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
     WHERE m.id = p_member AND m.is_active AND m.is_bookable;
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
REVOKE ALL ON FUNCTION app.slots_core(BIGINT, BIGINT, DATE, INTEGER, BIGINT) FROM PUBLIC, app_api;

-- Eski kirish nuqtasi o'zgarmaydi: avval ko'rinish tekshiruvi, keyin yadro
CREATE OR REPLACE FUNCTION app.compute_slots(p_member BIGINT, p_service BIGINT, p_day DATE, p_step INTEGER, p_exclude BIGINT)
RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ, slot_time TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM business_members m
                    WHERE m.id = p_member
                      AND (app.business_is_public(m.business_id) OR m.business_id = ANY (app.my_business_ids()))) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    RETURN QUERY SELECT * FROM app.slots_core(p_member, p_service, p_day, p_step, p_exclude);
END $$;
REVOKE ALL ON FUNCTION app.compute_slots(BIGINT, BIGINT, DATE, INTEGER, BIGINT) FROM PUBLIC, app_api;

-- ─── Jadval ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE waitlist_entries (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id       BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    client_id         BIGINT NOT NULL,
    service_id        BIGINT NOT NULL,
    member_id         BIGINT,                                  -- NULL — istalgan usta
    date_from         DATE NOT NULL,
    date_to           DATE NOT NULL,
    time_from         TIME,                                    -- NULL — kun bo'yi
    time_to           TIME,
    note              TEXT CHECK (length(note) <= 300),
    status            TEXT NOT NULL DEFAULT 'waiting'
                      CHECK (status IN ('waiting', 'offered', 'booked', 'expired', 'cancelled')),
    source            TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'app')),
    offered_member_id BIGINT,
    offered_starts_at TIMESTAMPTZ,
    offered_at        TIMESTAMPTZ,
    appointment_id    BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
    created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (date_to >= date_from AND date_to - date_from <= 30),
    CHECK ((time_from IS NULL) = (time_to IS NULL) AND (time_to IS NULL OR time_to > time_from)),
    CHECK (status <> 'offered' OR offered_starts_at IS NOT NULL),
    FOREIGN KEY (business_id, client_id)  REFERENCES business_clients (business_id, id) ON DELETE CASCADE,
    FOREIGN KEY (business_id, service_id) REFERENCES services (business_id, id) ON DELETE CASCADE,
    FOREIGN KEY (business_id, member_id)  REFERENCES business_members (business_id, id) ON DELETE SET NULL (member_id),
    FOREIGN KEY (business_id, offered_member_id) REFERENCES business_members (business_id, id)
        ON DELETE SET NULL (offered_member_id)
);
CREATE INDEX ON waitlist_entries (business_id, status, created_at);
CREATE INDEX ON waitlist_entries (client_id);

ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON waitlist_entries TO app_api;
-- Qabulxona (bron yaratadiganlar) boshqaradi; mijoz faqat o'z yozuvlarini ko'radi (yozish — funksiyalar orqali)
CREATE POLICY manage ON waitlist_entries FOR ALL TO app_api
    USING (app.has_perm(business_id, 'appointments.manage')) WITH CHECK (app.has_perm(business_id, 'appointments.manage'));
CREATE POLICY own_read ON waitlist_entries FOR SELECT TO app_api USING (client_id = ANY (app.my_client_ids()));

CREATE FUNCTION app.waitlist_touch() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id) THEN
        RAISE EXCEPTION 'waitlist_immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.status <> 'offered' THEN
        NEW.offered_member_id := NULL;
        NEW.offered_starts_at := NULL;
    END IF;
    NEW.note := nullif(btrim(NEW.note), '');
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER waitlist_touch BEFORE INSERT OR UPDATE ON waitlist_entries
    FOR EACH ROW EXECUTE FUNCTION app.waitlist_touch();

-- ─── Moslarini topish ────────────────────────────────────────────────────────────────────────
-- Natija: yangi berilgan takliflar soni. p_business NULL — barcha muassasalar (worker).
CREATE FUNCTION app.waitlist_scan(p_business BIGINT DEFAULT NULL) RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    e       RECORD;
    v_today DATE;
    v_m     BIGINT;
    v_start TIMESTAMPTZ;
    v_new   INTEGER := 0;
BEGIN
    -- Muddati o'tganlar
    UPDATE waitlist_entries w SET status = 'expired'
      FROM businesses b
     WHERE b.id = w.business_id AND w.status IN ('waiting', 'offered')
       AND w.date_to < (now() AT TIME ZONE b.timezone)::date
       AND (p_business IS NULL OR w.business_id = p_business);

    -- Mijoz shu xizmatga o'zi (ilovadan yoki qabulxona orqali) bron qilgan bo'lsa — navbatdan chiqadi
    UPDATE waitlist_entries w SET status = 'booked', appointment_id = x.id
      FROM (SELECT DISTINCT ON (w2.id) w2.id AS entry_id, a.id
              FROM waitlist_entries w2
              JOIN businesses b ON b.id = w2.business_id
              JOIN appointments a ON a.client_id = w2.client_id AND a.created_at >= w2.created_at
                                 AND a.status IN ('pending', 'confirmed', 'in_progress', 'completed')
              JOIN appointment_services s ON s.appointment_id = a.id AND s.service_id = w2.service_id
             WHERE w2.status IN ('waiting', 'offered')
               AND (a.starts_at AT TIME ZONE b.timezone)::date BETWEEN w2.date_from AND w2.date_to
               AND (p_business IS NULL OR w2.business_id = p_business)
             ORDER BY w2.id, a.starts_at) x
     WHERE w.id = x.entry_id;

    -- Navbat tartibida: avval yozilgan — avval taklif oladi
    FOR e IN
        SELECT w.*, b.timezone, b.name AS business_name, b.slug, c.user_id
          FROM waitlist_entries w
          JOIN businesses b       ON b.id = w.business_id
          JOIN business_clients c ON c.id = w.client_id
         WHERE w.status IN ('waiting', 'offered') AND (p_business IS NULL OR w.business_id = p_business)
         ORDER BY w.business_id, w.created_at, w.id
           FOR UPDATE OF w SKIP LOCKED
    LOOP
        v_today := (now() AT TIME ZONE e.timezone)::date;

        v_m := NULL;
        v_start := NULL;
        BEGIN
            -- Berilgan taklif hamon bo'sh bo'lsa — o'zgarishsiz (mijozga qayta xabar bormaydi)
            IF e.status = 'offered' AND e.offered_member_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM app.slots_core(e.offered_member_id, e.service_id,
                                             (e.offered_starts_at AT TIME ZONE e.timezone)::date, 5, NULL) c
                 WHERE c.slot_start = e.offered_starts_at AND c.slot_start > now()) THEN
                CONTINUE;
            END IF;

            SELECT m.id, c.slot_start INTO v_m, v_start
              FROM generate_series(greatest(e.date_from, v_today), least(e.date_to, v_today + 60), INTERVAL '1 day') g(d)
             CROSS JOIN business_members m
              JOIN users u            ON u.id = m.user_id AND u.status = 'active'
              JOIN member_services ms ON ms.member_id = m.id AND ms.service_id = e.service_id
              JOIN services s         ON s.id = e.service_id AND s.is_active
             CROSS JOIN LATERAL app.slots_core(m.id, e.service_id, g.d::date, 15, NULL) c
             WHERE m.business_id = e.business_id AND m.is_active AND m.is_bookable
               AND (e.member_id IS NULL OR m.id = e.member_id)
               AND c.slot_start > now() + INTERVAL '30 minutes'          -- mijoz yetib kelishga ulgursin
               AND (e.time_from IS NULL
                    OR ((c.slot_start AT TIME ZONE e.timezone)::time >= e.time_from
                        AND (c.slot_start AT TIME ZONE e.timezone)::time < e.time_to))
               -- Bir vaqt — bitta taklif: boshqa yozuvga berilgan vaqt o'tkazib yuboriladi
               AND NOT EXISTS (SELECT 1 FROM waitlist_entries o
                                WHERE o.id <> e.id AND o.status = 'offered'
                                  AND o.offered_member_id = m.id AND o.offered_starts_at = c.slot_start)
             ORDER BY c.slot_start, m.id
             LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_m := NULL;                                              -- bitta yozuv xatosi butun tekshiruvni to'xtatmasin
        END;

        IF v_m IS NULL THEN
            IF e.status = 'offered' THEN
                UPDATE waitlist_entries SET status = 'waiting' WHERE id = e.id;
            END IF;
            CONTINUE;
        END IF;

        UPDATE waitlist_entries
           SET status = 'offered', offered_member_id = v_m, offered_starts_at = v_start, offered_at = now()
         WHERE id = e.id;
        v_new := v_new + 1;

        IF e.user_id IS NOT NULL THEN
            INSERT INTO notifications (user_id, business_id, type, title, body, data)
            VALUES (e.user_id, e.business_id, 'waitlist_offer', 'Siz kutgan vaqt bo''shadi',
                    e.business_name || ', ' || to_char(v_start AT TIME ZONE e.timezone, 'DD.MM HH24:MI')
                        || '. Tezroq bron qiling — vaqt boshqalarga ham ochiq.',
                    jsonb_build_object('business_id', e.business_id, 'slug', e.slug, 'service_id', e.service_id,
                                       'member_id', v_m, 'starts_at', v_start, 'waitlist_id', e.id));
        END IF;
    END LOOP;
    RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION app.waitlist_scan(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.waitlist_scan(BIGINT) TO app_worker, app_api;

-- ─── Mijoz o'zi yoziladi (ilova / chronix.uz) ────────────────────────────────────────────────
CREATE FUNCTION app.join_waitlist(p_business BIGINT, p_service BIGINT, p_member BIGINT, p_date_from DATE, p_date_to DATE,
                                  p_time_from TIME DEFAULT NULL, p_time_to TIME DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid    BIGINT := app.uid();
    v_user   users%ROWTYPE;
    v_tz     TEXT;
    v_client BIGINT;
    v_id     BIGINT;
BEGIN
    SELECT * INTO v_user FROM users WHERE id = v_uid AND status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT b.timezone INTO v_tz FROM businesses b
     WHERE b.id = p_business AND app.business_is_public(b.id) AND app.module_enabled(b.id, 'booking');
    IF NOT FOUND
       OR NOT EXISTS (SELECT 1 FROM services s WHERE s.id = p_service AND s.business_id = p_business AND s.is_active)
       OR (p_member IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM member_services ms JOIN business_members m ON m.id = ms.member_id AND m.is_active
             WHERE ms.member_id = p_member AND ms.service_id = p_service AND m.business_id = p_business)) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF p_date_from < (now() AT TIME ZONE v_tz)::date OR p_date_from > (now() AT TIME ZONE v_tz)::date + 60 THEN
        RAISE EXCEPTION 'date_out_of_range' USING ERRCODE = '22023';
    END IF;

    INSERT INTO business_clients (business_id, user_id, full_name, phone)
    VALUES (p_business, v_uid, v_user.full_name, v_user.phone)
    ON CONFLICT (business_id, phone) DO UPDATE SET user_id = coalesce(business_clients.user_id, EXCLUDED.user_id)
    RETURNING id INTO v_client;

    -- Bitta mijoz bitta muassasada ko'pi bilan 3 ta faol navbat
    IF (SELECT count(*) FROM waitlist_entries w
         WHERE w.client_id = v_client AND w.status IN ('waiting', 'offered')) >= 3 THEN
        RAISE EXCEPTION 'too_many_waitlist' USING ERRCODE = 'P0429';
    END IF;

    INSERT INTO waitlist_entries (business_id, client_id, service_id, member_id, date_from, date_to, time_from, time_to,
                                  note, source, created_by)
    VALUES (p_business, v_client, p_service, p_member, p_date_from, p_date_to, p_time_from, p_time_to,
            p_note, 'app', v_uid)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION app.cancel_my_waitlist(p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE waitlist_entries SET status = 'cancelled'
     WHERE id = p_id AND client_id = ANY (app.my_client_ids()) AND status IN ('waiting', 'offered');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
END $$;

-- ─── Qabulxona: taklif qilingan (yoki tanlangan) vaqtga bron ─────────────────────────────────
CREATE FUNCTION app.book_from_waitlist(p_business BIGINT, p_entry BIGINT, p_member BIGINT DEFAULT NULL,
                                       p_starts_at TIMESTAMPTZ DEFAULT NULL) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    w      waitlist_entries%ROWTYPE;
    c      business_clients%ROWTYPE;
    v_id   BIGINT;
BEGIN
    IF NOT app.has_perm(p_business, 'appointments.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO w FROM waitlist_entries WHERE id = p_entry AND business_id = p_business FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    IF w.status NOT IN ('waiting', 'offered') THEN
        RAISE EXCEPTION 'not_changeable' USING ERRCODE = 'P0409';
    END IF;
    SELECT * INTO c FROM business_clients WHERE id = w.client_id;

    v_id := app.reception_book(p_business, coalesce(p_member, w.offered_member_id, w.member_id), w.service_id,
                               coalesce(p_starts_at, w.offered_starts_at), c.full_name, c.phone,
                               coalesce(w.note, 'Kutish ro''yxatidan'));
    UPDATE waitlist_entries SET status = 'booked', appointment_id = v_id WHERE id = p_entry;
    RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.join_waitlist(BIGINT, BIGINT, BIGINT, DATE, DATE, TIME, TIME, TEXT),
                       app.cancel_my_waitlist(BIGINT), app.book_from_waitlist(BIGINT, BIGINT, BIGINT, TIMESTAMPTZ)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.join_waitlist(BIGINT, BIGINT, BIGINT, DATE, DATE, TIME, TIME, TEXT),
                          app.cancel_my_waitlist(BIGINT), app.book_from_waitlist(BIGINT, BIGINT, BIGINT, TIMESTAMPTZ)
    TO app_api;
