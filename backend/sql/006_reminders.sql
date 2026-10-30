-- ════════════════════════════════════════════════════════════════════════════
--  Eslatma va tashrifni tasdiqlash ("Boraman")
--
--  Oqim: bron oldidan eslatma -> mijoz "Boraman" bosadi -> bosmasa yoki SMS yetmasa
--  ustaga ogohlantirish -> usta mijozga qo'ng'iroq qiladi.
--  Fon jarayoni (app.worker) app_worker roli bilan ishlaydi: u jadvallarni umuman o'qiy olmaydi,
--  faqat shu fayldagi funksiyalarni chaqiradi.
-- ════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_worker') THEN CREATE ROLE app_worker NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA app TO app_worker;

CREATE TABLE appointment_reminders (
    appointment_id BIGINT PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
    business_id    BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    token_hash     TEXT UNIQUE,                               -- SMS havolasi; bazada faqat SHA-256
    sent_at        TIMESTAMPTZ,
    delivered      BOOLEAN NOT NULL DEFAULT TRUE,             -- false: SMS provayderi rad etdi
    confirmed_at   TIMESTAMPTZ,                               -- mijoz "Boraman" bosdi
    alerted_at     TIMESTAMPTZ                                -- ustaga ogohlantirish ketdi
);
CREATE INDEX ON appointment_reminders (sent_at) WHERE confirmed_at IS NULL AND alerted_at IS NULL;

ALTER TABLE appointment_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY superadmin_all ON appointment_reminders TO app_api
    USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());
-- Bronni ko'ra olgan kishi holatini ko'radi. token_hash ustuni ochilmaydi, yozish faqat funksiyalar orqali.
CREATE POLICY read ON appointment_reminders FOR SELECT TO app_api
    USING (EXISTS (SELECT 1 FROM appointments a WHERE a.id = appointment_id));
GRANT SELECT (appointment_id, sent_at, delivered, confirmed_at, alerted_at) ON appointment_reminders TO app_api;

-- Vaqt o'zgarsa eslatma jarayoni boshidan boshlanadi
CREATE FUNCTION app.reset_reminder() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    DELETE FROM appointment_reminders WHERE appointment_id = NEW.id;
    RETURN NEW;
END $$;
CREATE TRIGGER reset_reminder AFTER UPDATE OF starts_at ON appointments FOR EACH ROW
    WHEN (OLD.starts_at IS DISTINCT FROM NEW.starts_at) EXECUTE FUNCTION app.reset_reminder();


-- ─── Fon jarayoni uchun ─────────────────────────────────────────────────────
-- Navbatdagi eslatma. Qator tranzaksiya oxirigacha qulflanadi: ikkita worker bitta SMS ni ikki marta yubormaydi.
-- Boshlanishiga oz qolganda qilingan bron eslatilmaydi: mijoz hozirgina yozildi.
CREATE FUNCTION app.next_due_reminder(p_lead_min INTEGER)
RETURNS TABLE (appointment_id BIGINT, phone TEXT, business_name TEXT, slot_time TEXT)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT a.id, c.phone::text, b.name::text, to_char(a.starts_at AT TIME ZONE b.timezone, 'HH24:MI')
      FROM appointments a
      JOIN business_clients c ON c.id = a.client_id
      JOIN businesses b       ON b.id = a.business_id AND b.status = 'active'
     WHERE a.status IN ('pending', 'confirmed')
       AND a.starts_at > now()
       AND a.starts_at <= now() + make_interval(mins => p_lead_min)
       AND a.created_at < a.starts_at - make_interval(mins => p_lead_min)
       AND NOT EXISTS (SELECT 1 FROM appointment_reminders r WHERE r.appointment_id = a.id)
     ORDER BY a.starts_at
     LIMIT 1
       FOR UPDATE OF a SKIP LOCKED
$$;

CREATE FUNCTION app.record_reminder(p_id BIGINT, p_token_hash TEXT, p_delivered BOOLEAN) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    INSERT INTO appointment_reminders (appointment_id, business_id, token_hash, sent_at, delivered)
    SELECT a.id, a.business_id, p_token_hash, now(), p_delivered FROM appointments a WHERE a.id = p_id;

    INSERT INTO notifications (user_id, business_id, type, title, body, data)
    SELECT c.user_id, a.business_id, 'appointment_reminder', 'Broningiz yaqinlashmoqda',
           b.name || ', ' || to_char(a.starts_at AT TIME ZONE b.timezone, 'HH24:MI') || '. Borasizmi?',
           jsonb_build_object('appointment_id', a.id, 'action', 'confirm_attendance')
      FROM appointments a
      JOIN business_clients c ON c.id = a.client_id
      JOIN businesses b       ON b.id = a.business_id
     WHERE a.id = p_id AND c.user_id IS NOT NULL;
END $$;

-- Javob muddati o'tgan (yoki SMS yetmagan) bronlar uchun ustaga ogohlantirish. Telefon xabarga yozilmaydi:
-- usta uni app.client_contact orqali oladi, ogohlantirish yopilgach raqam ham yopiladi.
CREATE FUNCTION app.raise_attendance_alerts(p_response_min INTEGER) RETURNS INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH due AS (
        UPDATE appointment_reminders r SET alerted_at = now()
          FROM appointments a
         WHERE a.id = r.appointment_id
           AND r.sent_at IS NOT NULL AND r.confirmed_at IS NULL AND r.alerted_at IS NULL
           AND a.status IN ('pending', 'confirmed') AND a.ends_at > now()
           AND (NOT r.delivered OR least(r.sent_at + make_interval(mins => p_response_min), a.starts_at) <= now())
        RETURNING r.appointment_id
    ), sent AS (
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        SELECT m.user_id, a.business_id, 'attendance_alert', 'Mijoz javob bermayapti',
               c.full_name || ', ' || to_char(a.starts_at AT TIME ZONE b.timezone, 'HH24:MI')
                   || ': mijoz javob bermayapti yoki bronni tasdiqlamadi, iltimos bog''laning',
               jsonb_build_object('appointment_id', a.id, 'action', 'call_client')
          FROM due d
          JOIN appointments a     ON a.id = d.appointment_id
          JOIN business_members m ON m.id = a.member_id
          JOIN business_clients c ON c.id = a.client_id
          JOIN businesses b       ON b.id = a.business_id
        RETURNING 1
    )
    SELECT count(*)::int FROM sent
$$;


-- ─── "Boraman" ──────────────────────────────────────────────────────────────
-- Ogohlantirishdan keyin tasdiqlansa, usta bilib qo'ysin: qo'ng'iroq kerak emas
CREATE FUNCTION app.mark_attending(p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_was_alerted BOOLEAN;
BEGIN
    SELECT r.alerted_at IS NOT NULL AND r.confirmed_at IS NULL INTO v_was_alerted
      FROM appointment_reminders r WHERE r.appointment_id = p_id;

    INSERT INTO appointment_reminders (appointment_id, business_id, confirmed_at)
    SELECT a.id, a.business_id, now() FROM appointments a WHERE a.id = p_id
    ON CONFLICT (appointment_id) DO UPDATE
        SET confirmed_at = coalesce(appointment_reminders.confirmed_at, EXCLUDED.confirmed_at);

    IF v_was_alerted THEN
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        SELECT m.user_id, a.business_id, 'attendance_confirmed', 'Mijoz tasdiqladi',
               c.full_name || ' keladi, qo''ng''iroq kerak emas', jsonb_build_object('appointment_id', a.id)
          FROM appointments a
          JOIN business_members m ON m.id = a.member_id
          JOIN business_clients c ON c.id = a.client_id
         WHERE a.id = p_id;
    END IF;
END $$;

-- Ilovadagi tugma: faqat bronning o'z mijozi
CREATE FUNCTION app.confirm_attendance(p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v appointments%ROWTYPE;
BEGIN
    SELECT * INTO v FROM appointments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR NOT v.client_id = ANY (app.my_client_ids()) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v.status NOT IN ('pending', 'confirmed') OR v.starts_at <= now() THEN
        RAISE EXCEPTION 'not_changeable' USING ERRCODE = 'P0409';
    END IF;
    PERFORM app.mark_attending(p_id);
END $$;

-- SMS havolasi: kirishsiz ishlaydi, token bron boshlanguncha amal qiladi
CREATE FUNCTION app.reminder_by_token(p_token_hash TEXT)
RETURNS TABLE (appointment_id BIGINT, business_name TEXT, slot_time TEXT, confirmed BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT a.id, b.name::text, to_char(a.starts_at AT TIME ZONE b.timezone, 'HH24:MI'), r.confirmed_at IS NOT NULL
      FROM appointment_reminders r
      JOIN appointments a ON a.id = r.appointment_id
      JOIN businesses b   ON b.id = a.business_id
     WHERE r.token_hash = p_token_hash AND a.status IN ('pending', 'confirmed') AND a.starts_at > now()
$$;

CREATE FUNCTION app.confirm_attendance_by_token(p_token_hash TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id BIGINT;
BEGIN
    SELECT t.appointment_id INTO v_id FROM app.reminder_by_token(p_token_hash) t;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    PERFORM app.mark_attending(v_id);
END $$;


-- ─── Qo'ng'iroq tugmasi ─────────────────────────────────────────────────────
-- Oddiy usta mijozlar bazasini ko'rmaydi. Raqam faqat ochiq ogohlantirish bo'yicha va faqat
-- shu bronning ustasiga yoki 'appointments.manage' egasiga beriladi; har bir ko'rish auditda.
CREATE FUNCTION app.client_contact(p_id BIGINT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v       appointments%ROWTYPE;
    v_phone TEXT;
BEGIN
    SELECT * INTO v FROM appointments WHERE id = p_id;
    IF NOT FOUND OR NOT (v.member_id = ANY (app.my_member_ids()) OR app.has_perm(v.business_id, 'appointments.manage')) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v.status NOT IN ('pending', 'confirmed') OR v.ends_at <= now() OR NOT EXISTS (
           SELECT 1 FROM appointment_reminders r
            WHERE r.appointment_id = p_id AND r.alerted_at IS NOT NULL AND r.confirmed_at IS NULL) THEN
        RAISE EXCEPTION 'no_open_alert' USING ERRCODE = '42501';
    END IF;

    SELECT phone INTO v_phone FROM business_clients WHERE id = v.client_id;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id)
    VALUES (v.business_id, app.uid(), 'view_phone', 'appointment', p_id);
    RETURN v_phone;
END $$;


REVOKE ALL ON FUNCTION app.reset_reminder(), app.next_due_reminder(INTEGER), app.record_reminder(BIGINT, TEXT, BOOLEAN),
                       app.raise_attendance_alerts(INTEGER), app.mark_attending(BIGINT), app.confirm_attendance(BIGINT),
                       app.reminder_by_token(TEXT), app.confirm_attendance_by_token(TEXT), app.client_contact(BIGINT)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confirm_attendance(BIGINT), app.reminder_by_token(TEXT),
                          app.confirm_attendance_by_token(TEXT), app.client_contact(BIGINT) TO app_api;
GRANT EXECUTE ON FUNCTION app.next_due_reminder(INTEGER), app.record_reminder(BIGINT, TEXT, BOOLEAN),
                          app.raise_attendance_alerts(INTEGER) TO app_worker;
