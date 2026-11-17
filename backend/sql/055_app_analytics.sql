-- Ilova analitikasi (pullik servislarsiz, o'z bazamizda): qaysi ekran, tugma va modul ishlatilyapti,
-- nima qidirilyapti. Super Admin "Analitika" sahifasi shu jadvaldan hisoblaydi.
--
-- * Yozish — faqat app.log_events() orqali (ilova to'g'ridan jadvalga yozolmaydi). Foydalanuvchi app.uid()
--   dan olinadi — so'rovda boshqa odam nomidan yozib bo'lmaydi. Mehmon — faqat qurilmaning tasodifiy anon_id si.
-- * Shaxsiy ma'lumot yozilmaydi: hodisa nomi + kichik props (masalan, qidiruv so'zi, natijalar soni, bo'lim).
--   Telefon raqami ko'rinishidagi matn qidiruv so'zidan olib tashlanadi.
-- * O'qish — faqat Super Admin. 180 kundan eskilari worker tomonidan o'chiriladi.
-- * Hisob o'chirilsa — hodisalar foydalanuvchidan va qurilmadan uziladi (anonim statistika qoladi).

CREATE TABLE app_events (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    anon_id      VARCHAR(64),
    platform     VARCHAR(10) NOT NULL CHECK (platform IN ('android', 'ios', 'web', 'market', 'panel')),
    app_version  VARCHAR(20),
    name         VARCHAR(60) NOT NULL CHECK (name ~ '^[a-z][a-z0-9_.]{1,59}$'),
    props        JSONB CHECK (props IS NULL OR (jsonb_typeof(props) = 'object' AND length(props::text) <= 1000))
);
CREATE INDEX ON app_events (created_at);
CREATE INDEX ON app_events (name, created_at);

ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON app_events TO app_api;
CREATE POLICY superadmin_read ON app_events FOR SELECT TO app_api USING (app.is_superadmin());

-- Bir so'rovda ko'pi bilan 50 hodisa. Noto'g'ri hodisa butun to'plamni buzmaydi — tashlab yuboriladi.
CREATE FUNCTION app.log_events(p_anon TEXT, p_platform TEXT, p_version TEXT, p_events JSONB) RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    e      JSONB;
    v_n    INTEGER := 0;
    v_uid  BIGINT := app.uid();
    v_name TEXT;
    v_prop JSONB;
    v_at   TIMESTAMPTZ;
BEGIN
    IF jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 50 THEN
        RAISE EXCEPTION 'too_many_events' USING ERRCODE = '22023';
    END IF;
    IF p_platform NOT IN ('android', 'ios', 'web', 'market', 'panel') THEN
        RAISE EXCEPTION 'bad_platform' USING ERRCODE = '22023';
    END IF;
    FOR e IN SELECT * FROM jsonb_array_elements(p_events) LOOP
        v_name := e ->> 'name';
        CONTINUE WHEN v_name IS NULL OR v_name !~ '^[a-z][a-z0-9_.]{1,59}$';
        v_prop := CASE WHEN jsonb_typeof(e -> 'props') = 'object' THEN e -> 'props' END;
        -- Qidiruv so'zida telefon raqami bo'lsa — yozmaymiz (shaxsiy ma'lumot)
        IF v_prop ? 'q' THEN
            v_prop := jsonb_set(v_prop, '{q}', to_jsonb(left(lower(trim(regexp_replace(v_prop ->> 'q', '\+?\d[\d\s()-]{6,}', '', 'g'))), 60)));
        END IF;
        CONTINUE WHEN v_prop IS NOT NULL AND length(v_prop::text) > 1000;
        -- Qurilma vaqti: navbatda kutgan hodisa — lekin kelajak yoki 2 kundan eski vaqtga ishonilmaydi
        BEGIN
            v_at := (e ->> 'at')::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            v_at := NULL;
        END;
        IF v_at IS NULL OR v_at > now() OR v_at < now() - INTERVAL '2 days' THEN
            v_at := now();
        END IF;
        INSERT INTO app_events (created_at, user_id, anon_id, platform, app_version, name, props)
        VALUES (v_at, v_uid, left(nullif(p_anon, ''), 64), p_platform, left(nullif(p_version, ''), 20), v_name, v_prop);
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION app.log_events(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.log_events(TEXT, TEXT, TEXT, JSONB) TO app_api;

-- Eski hodisalarni tozalash (worker, kuniga bir marta yetarli — har chaqiruvda ko'pi bilan 20 000 qator)
CREATE FUNCTION app.purge_app_events() RETURNS INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH gone AS (
        DELETE FROM app_events WHERE id IN (
            SELECT id FROM app_events WHERE created_at < now() - INTERVAL '180 days' ORDER BY id LIMIT 20000)
        RETURNING 1)
    SELECT count(*)::int FROM gone
$$;
REVOKE ALL ON FUNCTION app.purge_app_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_app_events() TO app_worker;

-- Hisob o'chirilsa: hodisalar shaxsdan va qurilmadan uziladi
CREATE FUNCTION app.unlink_deleted_user_events() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE app_events SET user_id = NULL, anon_id = NULL WHERE user_id = NEW.id;
    RETURN NEW;
END $$;
CREATE TRIGGER unlink_deleted_user_events AFTER UPDATE OF status ON users
    FOR EACH ROW WHEN (NEW.status = 'deleted' AND OLD.status IS DISTINCT FROM 'deleted')
    EXECUTE FUNCTION app.unlink_deleted_user_events();
