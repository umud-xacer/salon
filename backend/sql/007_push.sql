-- ════════════════════════════════════════════════════════════════════════════
--  Push bildirishnomalar (budilnik kabi). SMS endi faqat OTP va parol tiklash uchun:
--  eslatma havolasi (/r/{token}) olib tashlandi, "Boraman" ilova ichida.
--
--  notifications — chiqish navbati: qator qaysi yo'l bilan yozilgan bo'lsa ham,
--  worker uni foydalanuvchi qurilmalariga yuboradi va pushed_at ni belgilaydi.
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION app.confirm_attendance_by_token(TEXT);
DROP FUNCTION app.reminder_by_token(TEXT);
DROP FUNCTION app.next_due_reminder(INTEGER);
DROP FUNCTION app.record_reminder(BIGINT, TEXT, BOOLEAN);
ALTER TABLE appointment_reminders DROP COLUMN token_hash;

ALTER TABLE notifications ADD COLUMN pushed_at TIMESTAMPTZ;
UPDATE notifications SET pushed_at = created_at;
CREATE INDEX ON notifications (created_at) WHERE pushed_at IS NULL;

ALTER TABLE device_tokens ADD CONSTRAINT expo_token_format CHECK (token ~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$');
ALTER TABLE device_tokens ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX ON device_tokens (user_id);

-- Qurilma boshqa hisobga kirsa, token yangi egasiga o'tadi: eski foydalanuvchining
-- xabarlari bu telefonga kelmasin. RLS bilan begona qatorni yangilab bo'lmagani uchun funksiya orqali.
CREATE FUNCTION app.register_device(p_token TEXT, p_platform TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF app.uid() IS NULL THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    INSERT INTO device_tokens (user_id, token, platform) VALUES (app.uid(), p_token, p_platform)
    ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now();
END $$;


-- ─── Fon jarayoni ───────────────────────────────────────────────────────────
-- Eslatma vaqti kelgan bronlar. Ilova akkaunti yo'q mijozga yetkazib bo'lmaydi: delivered = false,
-- usta javob muddatini kutmasdan darhol ogohlantiriladi.
CREATE FUNCTION app.create_due_reminders(p_lead_min INTEGER) RETURNS INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH due AS (
        SELECT a.id, a.business_id, a.starts_at, c.user_id, b.name, b.timezone
          FROM appointments a
          JOIN business_clients c ON c.id = a.client_id
          JOIN businesses b       ON b.id = a.business_id AND b.status = 'active'
         WHERE a.status IN ('pending', 'confirmed')
           AND a.starts_at > now()
           AND a.starts_at <= now() + make_interval(mins => p_lead_min)
           AND a.created_at < a.starts_at - make_interval(mins => p_lead_min)
           AND NOT EXISTS (SELECT 1 FROM appointment_reminders r WHERE r.appointment_id = a.id)
           FOR UPDATE OF a SKIP LOCKED
    ), added AS (
        INSERT INTO appointment_reminders (appointment_id, business_id, sent_at, delivered)
        SELECT d.id, d.business_id, now(), d.user_id IS NOT NULL FROM due d
        ON CONFLICT (appointment_id) DO NOTHING
        RETURNING appointment_id
    ), sent AS (
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        SELECT d.user_id, d.business_id, 'appointment_reminder', 'Broningiz yaqinlashmoqda',
               d.name || ', ' || to_char(d.starts_at AT TIME ZONE d.timezone, 'HH24:MI') || '. Borasizmi?',
               jsonb_build_object('appointment_id', d.id, 'action', 'confirm_attendance')
          FROM due d JOIN added x ON x.appointment_id = d.id
         WHERE d.user_id IS NOT NULL
        RETURNING 1
    )
    SELECT count(*)::int FROM added
$$;

CREATE FUNCTION app.next_push()
RETURNS TABLE (id BIGINT, type TEXT, title TEXT, body TEXT, data JSONB, tokens TEXT[])
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT n.id, n.type::text, n.title::text, n.body, n.data,
           coalesce((SELECT array_agg(d.token) FROM device_tokens d WHERE d.user_id = n.user_id), '{}')
      FROM notifications n
     WHERE n.pushed_at IS NULL AND n.created_at > now() - interval '1 hour'
     ORDER BY n.created_at
     LIMIT 1
       FOR UPDATE OF n SKIP LOCKED
$$;

-- Eslatma hech bir qurilmaga yetmasa, usta darhol ogohlantiriladi (raise_attendance_alerts)
CREATE FUNCTION app.mark_pushed(p_id BIGINT, p_delivered BOOLEAN, p_dead_tokens TEXT[]) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    n notifications%ROWTYPE;
BEGIN
    UPDATE notifications SET pushed_at = now() WHERE id = p_id RETURNING * INTO n;
    DELETE FROM device_tokens WHERE token = ANY (p_dead_tokens);
    IF n.type = 'appointment_reminder' AND NOT p_delivered THEN
        UPDATE appointment_reminders SET delivered = false WHERE appointment_id = (n.data ->> 'appointment_id')::bigint;
    END IF;
END $$;


-- ─── Bron o'zgarishlari haqida xabar ────────────────────────────────────────
-- Trigger: bron qaysi yo'l bilan o'zgarmasin, usta bilib turadi. Mijoz esa o'zi qilmagan o'zgarishni bilib turadi.
CREATE FUNCTION app.notify_booking() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_type  TEXT;
    v_title TEXT;
    v_when  TEXT;
    v_name  TEXT;
    v_user  BIGINT;
    v_owner BIGINT;
    v_biz   TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.source <> 'app' THEN RETURN NEW; END IF;
        v_type := 'booking_new'; v_title := 'Yangi bron';
    ELSIF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
        v_type := 'booking_cancelled'; v_title := 'Bron bekor qilindi';
    ELSIF NEW.starts_at <> OLD.starts_at THEN
        v_type := 'booking_moved'; v_title := 'Bron vaqti o''zgardi';
    ELSE
        RETURN NEW;
    END IF;

    SELECT to_char(NEW.starts_at AT TIME ZONE b.timezone, 'DD.MM HH24:MI'), b.name INTO v_when, v_biz
      FROM businesses b WHERE b.id = NEW.business_id;
    SELECT c.full_name, c.user_id INTO v_name, v_user FROM business_clients c WHERE c.id = NEW.client_id;
    SELECT m.user_id INTO v_owner FROM business_members m WHERE m.id = NEW.member_id;

    IF v_owner IS DISTINCT FROM app.uid() THEN
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        VALUES (v_owner, NEW.business_id, v_type, v_title, v_name || ', ' || v_when,
                jsonb_build_object('appointment_id', NEW.id));
    END IF;
    IF v_user IS NOT NULL AND v_user IS DISTINCT FROM app.uid() AND TG_OP = 'UPDATE' THEN
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        VALUES (v_user, NEW.business_id, v_type, v_title, v_biz || ', ' || v_when,
                jsonb_build_object('appointment_id', NEW.id));
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER notify_booking AFTER INSERT OR UPDATE OF status, starts_at ON appointments
    FOR EACH ROW EXECUTE FUNCTION app.notify_booking();


REVOKE ALL ON FUNCTION app.register_device(TEXT, TEXT), app.create_due_reminders(INTEGER), app.next_push(),
                       app.mark_pushed(BIGINT, BOOLEAN, TEXT[]), app.notify_booking() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_device(TEXT, TEXT) TO app_api;
GRANT EXECUTE ON FUNCTION app.create_due_reminders(INTEGER), app.next_push(),
                          app.mark_pushed(BIGINT, BOOLEAN, TEXT[]) TO app_worker;
