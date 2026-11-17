-- Hududiy analitika: ilova qaysi viloyat/shahar/tumanda ochilyapti, talab va ulangan muassasalar solishtirmasi.
--
-- Maxfiylik (Google Play / App Store talablari va 6-band):
--   * Joylashuv shaxsga bog'lanmaydi: user_id saqlanmaydi, faqat qurilmaning tasodifiy anon ID si (analitika).
--   * Koordinata ~110 m gacha yaxlitlanadi (3 xona) — aniq uy manzili saqlanmaydi.
--   * Super Admin faqat umumlashtirilgan statistikani ko'radi; xarita nuqtalari ~1 km katakda va kamida 3 ta
--     turli qurilma bo'lgan joydagina chiqadi (bitta odamning uyi ko'rinib qolmasin).
--   * 180 kundan eskilari o'chiriladi (worker).
-- Geokodlash: geo_cache (yaxlitlangan nuqta → viloyat/shahar/tuman). Keshda bo'lmagan nuqtani worker Nominatim
-- orqali sekundiga bittadan aniqlaydi va eski yozuvlarni to'ldiradi — so'rov foydalanuvchini kuttirmaydi.

CREATE TABLE geo_cache (
    lat_grid    NUMERIC(6,3) NOT NULL,
    lng_grid    NUMERIC(6,3) NOT NULL,
    region      VARCHAR(60),
    city        VARCHAR(60),
    district    VARCHAR(80),
    failed      BOOLEAN NOT NULL DEFAULT false,       -- aniqlab bo'lmadi (dengiz, chet el...) — qayta so'ralmaydi
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lat_grid, lng_grid)
);

CREATE TABLE user_location_logs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_id   VARCHAR(64) NOT NULL,
    lat_grid    NUMERIC(6,3),
    lng_grid    NUMERIC(6,3),
    region      VARCHAR(60),
    city        VARCHAR(60),
    district    VARCHAR(80),
    source      VARCHAR(3)  NOT NULL CHECK (source IN ('gps', 'ip')),
    platform    VARCHAR(10) NOT NULL CHECK (platform IN ('android', 'ios', 'web', 'market', 'panel')),
    CHECK ((lat_grid IS NULL) = (lng_grid IS NULL)),
    CHECK (source = 'ip' OR lat_grid IS NOT NULL)
);
CREATE INDEX ON user_location_logs (created_at);
CREATE INDEX ON user_location_logs (device_id, created_at DESC);
CREATE INDEX ON user_location_logs (lat_grid, lng_grid) WHERE region IS NULL AND lat_grid IS NOT NULL;

ALTER TABLE geo_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_location_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON geo_cache TO app_api;                       -- hudud nomlari maxfiy emas (kesh)
GRANT SELECT ON user_location_logs TO app_api;
CREATE POLICY read_all ON geo_cache FOR SELECT TO app_api USING (true);
CREATE POLICY superadmin_read ON user_location_logs FOR SELECT TO app_api USING (app.is_superadmin());

-- ─── Yozish (ilova): bitta qurilmadan 15 daqiqada ko'pi bilan bitta yozuv ───────────────────────────
-- Keshda bo'lsa hudud darhol qo'yiladi, bo'lmasa — worker keyin to'ldiradi. IP bo'yicha hudud API'da aniqlanadi.
CREATE FUNCTION app.log_location(p_device TEXT, p_lat NUMERIC, p_lng NUMERIC, p_platform TEXT,
                                 p_region TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_lat NUMERIC(6,3) := round(p_lat, 3);
    v_lng NUMERIC(6,3) := round(p_lng, 3);
    c     geo_cache%ROWTYPE;
BEGIN
    IF p_device IS NULL OR length(p_device) NOT BETWEEN 8 AND 64 THEN
        RAISE EXCEPTION 'bad_device' USING ERRCODE = '22023';
    END IF;
    IF (p_lat IS NULL) <> (p_lng IS NULL) OR (p_lat IS NOT NULL AND (abs(p_lat) > 90 OR abs(p_lng) > 180)) THEN
        RAISE EXCEPTION 'bad_coordinates' USING ERRCODE = '22023';
    END IF;
    -- Poyga bo'lmasin: bitta qurilma bo'yicha navbat
    PERFORM pg_advisory_xact_lock(hashtext('loc:' || p_device));
    IF EXISTS (SELECT 1 FROM user_location_logs WHERE device_id = p_device AND created_at > now() - INTERVAL '15 minutes') THEN
        RETURN false;
    END IF;
    IF v_lat IS NOT NULL THEN
        SELECT * INTO c FROM geo_cache WHERE lat_grid = v_lat AND lng_grid = v_lng;
        INSERT INTO user_location_logs (device_id, lat_grid, lng_grid, region, city, district, source, platform)
        VALUES (p_device, v_lat, v_lng, c.region, c.city, c.district, 'gps', p_platform);
    ELSE
        INSERT INTO user_location_logs (device_id, region, city, source, platform)
        VALUES (p_device, left(p_region, 60), left(p_city, 60), 'ip', p_platform);
    END IF;
    RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.log_location(TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.log_location(TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO app_api;

-- ─── Worker: aniqlanmagan nuqtalar (foydalanuvchilar va muassasalar) ───────────────────────────────────
CREATE FUNCTION app.geo_pending(p_limit INT) RETURNS TABLE (lat_grid NUMERIC, lng_grid NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT g.lat_grid, g.lng_grid FROM (
        SELECT l.lat_grid, l.lng_grid, count(*) AS n FROM user_location_logs l
         WHERE l.region IS NULL AND l.lat_grid IS NOT NULL GROUP BY 1, 2
        UNION ALL
        SELECT round(ST_Y(b.location::geometry)::numeric, 3), round(ST_X(b.location::geometry)::numeric, 3), 1000
          FROM businesses b WHERE b.location IS NOT NULL
    ) g
     WHERE NOT EXISTS (SELECT 1 FROM geo_cache c WHERE c.lat_grid = g.lat_grid AND c.lng_grid = g.lng_grid)
     GROUP BY 1, 2 ORDER BY sum(g.n) DESC LIMIT p_limit
$$;

CREATE FUNCTION app.geo_resolve(p_lat NUMERIC, p_lng NUMERIC, p_region TEXT, p_city TEXT, p_district TEXT)
RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_n INTEGER;
BEGIN
    INSERT INTO geo_cache (lat_grid, lng_grid, region, city, district, failed)
    VALUES (p_lat, p_lng, p_region, p_city, p_district, p_region IS NULL)
    ON CONFLICT (lat_grid, lng_grid) DO UPDATE SET region = EXCLUDED.region, city = EXCLUDED.city,
           district = EXCLUDED.district, failed = EXCLUDED.failed, updated_at = now();
    UPDATE user_location_logs SET region = coalesce(p_region, 'Aniqlanmagan'), city = p_city, district = p_district
     WHERE lat_grid = p_lat AND lng_grid = p_lng AND region IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- Eski yozuvlar (180 kun) — analitika hodisalari bilan bir xil muddat
CREATE OR REPLACE FUNCTION app.purge_app_events() RETURNS INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH gone AS (
        DELETE FROM app_events WHERE id IN (
            SELECT id FROM app_events WHERE created_at < now() - INTERVAL '180 days' ORDER BY id LIMIT 20000)
        RETURNING 1),
    gone_loc AS (
        DELETE FROM user_location_logs WHERE id IN (
            SELECT id FROM user_location_logs WHERE created_at < now() - INTERVAL '180 days' ORDER BY id LIMIT 20000)
        RETURNING 1)
    SELECT ((SELECT count(*) FROM gone) + (SELECT count(*) FROM gone_loc))::int
$$;

REVOKE ALL ON FUNCTION app.geo_pending(INT), app.geo_resolve(NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.geo_pending(INT), app.geo_resolve(NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO app_worker;

-- ─── Tuzatish (055): qidiruvdan faqat haqiqiy telefon raqami olib tashlansin (kamida 9 raqam).
-- Avval 7 ta raqamli istalgan ketma-ketlik ("salon 1234567") ham o'chib ketardi.
CREATE OR REPLACE FUNCTION app.log_events(p_anon TEXT, p_platform TEXT, p_version TEXT, p_events JSONB) RETURNS INTEGER
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
            v_prop := jsonb_set(v_prop, '{q}', to_jsonb(left(lower(trim(regexp_replace(v_prop ->> 'q', '\+?\d(?:[\s()-]*\d){8,}', '', 'g'))), 60)));
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
