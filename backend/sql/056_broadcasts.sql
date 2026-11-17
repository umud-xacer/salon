-- Mijoz segmentlari va ommaviy xabarlar (AI'siz, SMS'siz): ilova hisobi bor mijozlarga push + Xabarlar bo'limi,
-- Telegram bog'langan bo'lsa — Telegram'ga ham (worker yuboradi).
--
-- Segmentlar (p_kind, p_param):
--   all           — barcha mijozlar
--   inactive      — oxirgi tashrifdan p_param kun o'tgan, kelgusi broni yo'q (30/60/90)
--   birthday      — tug'ilgan kuni p_param kun ichida (7/14/30)
--   regular       — oxirgi 180 kunda kamida p_param ta tashrif (doimiy mijozlar)
--   new           — birinchi tashrifi oxirgi p_param kunda (yangi mijozlar)
-- Qo'shimcha filtrlar: teg (client_internal.tags), jins.
--
-- Spamdan himoya (bazada): muassasa kuniga ko'pi bilan 3 ta xabar yuboradi; bitta mijozga shu muassasadan
-- 72 soatda bittadan ortiq ommaviy xabar bormaydi (o'tkazib yuborilganlar soni ko'rsatiladi).

CREATE TABLE broadcasts (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id      BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    segment          JSONB  NOT NULL,
    title            VARCHAR(80)  NOT NULL CHECK (length(btrim(title)) >= 2),
    body             VARCHAR(500) NOT NULL CHECK (length(btrim(body)) >= 2),
    matched          INTEGER NOT NULL DEFAULT 0,      -- segmentga tushgan mijozlar (ilovasizlari ham)
    sent_app         INTEGER NOT NULL DEFAULT 0,      -- ilovaga yuborildi
    sent_telegram    INTEGER NOT NULL DEFAULT 0,      -- Telegram navbatiga qo'yildi
    skipped_recent   INTEGER NOT NULL DEFAULT 0,      -- 72 soat ichida xabar olgani uchun o'tkazildi
    created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, id)
);
CREATE INDEX ON broadcasts (business_id, created_at DESC);

CREATE TABLE broadcast_recipients (
    broadcast_id      BIGINT NOT NULL,
    business_id       BIGINT NOT NULL,
    client_id         BIGINT NOT NULL,
    user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_chat     BIGINT,                          -- NULL — Telegram'ga yuborilmaydi
    telegram_sent_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (broadcast_id, client_id),
    FOREIGN KEY (business_id, broadcast_id) REFERENCES broadcasts (business_id, id) ON DELETE CASCADE,
    FOREIGN KEY (business_id, client_id) REFERENCES business_clients (business_id, id) ON DELETE CASCADE
);
CREATE INDEX ON broadcast_recipients (business_id, client_id, created_at DESC);
CREATE INDEX ON broadcast_recipients (created_at) WHERE telegram_chat IS NOT NULL AND telegram_sent_at IS NULL;

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON broadcasts, broadcast_recipients TO app_api;
-- Yozish faqat app.send_broadcast orqali; o'qish — direktor (marketing)
CREATE POLICY manage_read ON broadcasts FOR SELECT TO app_api USING (app.has_perm(business_id, 'business.manage'));
CREATE POLICY manage_read ON broadcast_recipients FOR SELECT TO app_api USING (app.has_perm(business_id, 'business.manage'));

-- ─── Segment: mijozlar ro'yxati (ilovasizlari ham — hisob uchun) ────────────────────────────────
CREATE FUNCTION app.segment_clients(p_business BIGINT, p_kind TEXT, p_param INT, p_tag TEXT, p_gender TEXT)
RETURNS TABLE (client_id BIGINT, user_id BIGINT, full_name TEXT, chat_id BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_tz    TEXT;
    v_today DATE;
BEGIN
    IF NOT app.has_perm(p_business, 'business.manage') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF p_kind NOT IN ('all', 'inactive', 'birthday', 'regular', 'new') THEN
        RAISE EXCEPTION 'bad_segment' USING ERRCODE = '22023';
    END IF;
    IF p_gender IS NOT NULL AND p_gender NOT IN ('male', 'female') THEN
        RAISE EXCEPTION 'bad_gender' USING ERRCODE = '22023';
    END IF;
    SELECT timezone INTO v_tz FROM businesses WHERE id = p_business;
    v_today := (now() AT TIME ZONE v_tz)::date;

    RETURN QUERY
    WITH v AS (
        SELECT a.client_id,
               max(a.starts_at) FILTER (WHERE a.status = 'completed') AS last_at,
               min(a.starts_at) FILTER (WHERE a.status = 'completed') AS first_at,
               count(*) FILTER (WHERE a.status = 'completed' AND a.starts_at > now() - INTERVAL '180 days') AS recent,
               bool_or(a.status IN ('pending', 'confirmed', 'in_progress') AND a.starts_at > now()) AS has_future
          FROM appointments a WHERE a.business_id = p_business GROUP BY a.client_id
    )
    SELECT c.id, CASE WHEN u.status = 'active' THEN c.user_id END, c.full_name::text,
           (SELECT i.chat_id FROM user_identities i
             WHERE i.user_id = c.user_id AND u.status = 'active' AND i.provider = 'telegram' AND i.chat_id IS NOT NULL LIMIT 1)
      FROM business_clients c
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN v ON v.client_id = c.id
      LEFT JOIN client_internal ci ON ci.client_id = c.id
     WHERE c.business_id = p_business
       AND (p_tag IS NULL OR EXISTS (SELECT 1 FROM unnest(ci.tags) t WHERE lower(t) = lower(p_tag)))
       AND (p_gender IS NULL OR coalesce(c.gender, u.gender) = p_gender)
       AND CASE p_kind
             WHEN 'all' THEN true
             WHEN 'inactive' THEN v.last_at IS NOT NULL AND v.last_at < now() - make_interval(days => p_param)
                                  AND NOT coalesce(v.has_future, false)
             WHEN 'regular' THEN coalesce(v.recent, 0) >= p_param
             WHEN 'new' THEN v.first_at > now() - make_interval(days => p_param)
             WHEN 'birthday' THEN coalesce(c.birth_date, u.birth_date) IS NOT NULL AND (
                    -- keyingi tug'ilgan kunigacha qolgan kunlar (yil almashinuvi bilan)
                    (make_date(extract(year FROM v_today)::int, extract(month FROM coalesce(c.birth_date, u.birth_date))::int, 1)
                       + (extract(day FROM coalesce(c.birth_date, u.birth_date))::int - 1)) - v_today BETWEEN 0 AND p_param
                 OR (make_date(extract(year FROM v_today)::int + 1, extract(month FROM coalesce(c.birth_date, u.birth_date))::int, 1)
                       + (extract(day FROM coalesce(c.birth_date, u.birth_date))::int - 1)) - v_today BETWEEN 0 AND p_param)
           END
     ORDER BY c.full_name, c.id;
END $$;
REVOKE ALL ON FUNCTION app.segment_clients(BIGINT, TEXT, INT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.segment_clients(BIGINT, TEXT, INT, TEXT, TEXT) TO app_api;

-- ─── Yuborish ──────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.send_broadcast(p_business BIGINT, p_kind TEXT, p_param INT, p_tag TEXT, p_gender TEXT,
                                   p_title TEXT, p_body TEXT) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id    BIGINT;
    v_slug  TEXT;
    v_name  TEXT;
    v_match INT;
    v_app   INT;
    v_tg    INT;
    v_skip  INT;
BEGIN
    IF NOT app.has_perm(p_business, 'business.manage') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM businesses WHERE id = p_business FOR UPDATE;          -- bir vaqtda ikki yuborish poygasi
    IF (SELECT count(*) FROM broadcasts WHERE business_id = p_business AND created_at > now() - INTERVAL '24 hours') >= 3 THEN
        RAISE EXCEPTION 'broadcast_limit' USING ERRCODE = 'P0429';
    END IF;
    SELECT slug, name INTO v_slug, v_name FROM businesses WHERE id = p_business;

    INSERT INTO broadcasts (business_id, segment, title, body, created_by)
    VALUES (p_business, jsonb_build_object('kind', p_kind, 'param', p_param, 'tag', p_tag, 'gender', p_gender),
            btrim(p_title), btrim(p_body), app.uid())
    RETURNING id INTO v_id;

    CREATE TEMP TABLE _seg ON COMMIT DROP AS
        SELECT * FROM app.segment_clients(p_business, p_kind, p_param, p_tag, p_gender);
    v_match := (SELECT count(*) FROM _seg);
    v_skip := (SELECT count(*) FROM _seg s WHERE s.user_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM broadcast_recipients r WHERE r.business_id = p_business AND r.client_id = s.client_id
                      AND r.created_at > now() - INTERVAL '72 hours'));

    INSERT INTO broadcast_recipients (broadcast_id, business_id, client_id, user_id, telegram_chat)
    SELECT v_id, p_business, s.client_id, s.user_id, s.chat_id FROM _seg s
     WHERE s.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM broadcast_recipients r WHERE r.business_id = p_business AND r.client_id = s.client_id
                          AND r.created_at > now() - INTERVAL '72 hours');
    GET DIAGNOSTICS v_app = ROW_COUNT;

    INSERT INTO notifications (user_id, business_id, type, title, body, data)
    SELECT r.user_id, p_business, 'promo_broadcast', btrim(p_title), btrim(p_body),
           jsonb_build_object('business_id', p_business, 'slug', v_slug, 'broadcast_id', v_id)
      FROM broadcast_recipients r WHERE r.broadcast_id = v_id;
    v_tg := (SELECT count(*) FROM broadcast_recipients WHERE broadcast_id = v_id AND telegram_chat IS NOT NULL);

    UPDATE broadcasts SET matched = v_match, sent_app = v_app, sent_telegram = v_tg, skipped_recent = v_skip WHERE id = v_id;
    DROP TABLE _seg;
    RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.send_broadcast(BIGINT, TEXT, INT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.send_broadcast(BIGINT, TEXT, INT, TEXT, TEXT, TEXT, TEXT) TO app_api;

-- ─── Worker: Telegram navbati (bir chaqiruvda 50 ta, yuborilgan deb belgilanadi) ───────────────────
CREATE FUNCTION app.next_broadcast_telegram()
RETURNS TABLE (chat_id BIGINT, title TEXT, body TEXT, business_name TEXT)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH picked AS (
        SELECT r.broadcast_id, r.client_id FROM broadcast_recipients r
         WHERE r.telegram_chat IS NOT NULL AND r.telegram_sent_at IS NULL AND r.created_at > now() - INTERVAL '1 day'
         ORDER BY r.created_at LIMIT 50 FOR UPDATE SKIP LOCKED
    ), done AS (
        UPDATE broadcast_recipients r SET telegram_sent_at = now()
          FROM picked p WHERE r.broadcast_id = p.broadcast_id AND r.client_id = p.client_id
        RETURNING r.broadcast_id, r.telegram_chat
    )
    SELECT d.telegram_chat, b.title::text, b.body::text, bz.name::text
      FROM done d JOIN broadcasts b ON b.id = d.broadcast_id JOIN businesses bz ON bz.id = b.business_id
$$;
REVOKE ALL ON FUNCTION app.next_broadcast_telegram() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.next_broadcast_telegram() TO app_worker;
