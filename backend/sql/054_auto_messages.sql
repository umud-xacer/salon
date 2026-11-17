-- Avtomatik xabarlar (AI'siz, SMS'siz): ilovadagi Xabarlar + push, Telegram bog'langan bo'lsa — Telegram ham.
--
-- 1. Tug'ilgan kun tabrigi  — mijozning tug'ilgan kunida (muassasa vaqti bilan 10:00–20:00), ixtiyoriy sovg'a matni.
-- 2. Sharh so'rash          — tashrif yakunlangach N soatdan keyin (0 — darhol, avvalgidek 028 triggeri).
-- 3. Qaytarish (win-back)   — oxirgi tashrifdan N kun o'tgan va kelgusi broni yo'q mijozga bir marta eslatma.
--
-- Xabar faqat ilova hisobi bor mijozga ketadi (ilovasiz mijozga — keyin SMS yoqilganda). Har bir xabar
-- auto_messages_sent ga yoziladi: bir tadbir uchun qayta yuborilmaydi (UNIQUE), salon tarixni ko'radi.

CREATE TABLE auto_message_settings (
    business_id          BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    birthday_enabled     BOOLEAN NOT NULL DEFAULT false,
    birthday_text        VARCHAR(500),               -- bo'sh bo'lsa — standart tabrik
    review_enabled       BOOLEAN NOT NULL DEFAULT true,
    review_delay_hours   SMALLINT NOT NULL DEFAULT 0 CHECK (review_delay_hours BETWEEN 0 AND 72),
    winback_enabled      BOOLEAN NOT NULL DEFAULT false,
    winback_days         SMALLINT NOT NULL DEFAULT 45 CHECK (winback_days BETWEEN 14 AND 365),
    winback_text         VARCHAR(500),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auto_messages_sent (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    client_id    BIGINT NOT NULL,
    kind         VARCHAR(10) NOT NULL CHECK (kind IN ('birthday', 'review', 'winback')),
    ref_key      TEXT NOT NULL,                      -- birthday: yil; review: bron id; winback: oxirgi tashrif sanasi
    telegram     BOOLEAN NOT NULL DEFAULT false,     -- Telegram'ga ham yuborildi
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, client_id, kind, ref_key),
    FOREIGN KEY (business_id, client_id) REFERENCES business_clients (business_id, id) ON DELETE CASCADE
);
CREATE INDEX ON auto_messages_sent (business_id, sent_at DESC);

ALTER TABLE auto_message_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_messages_sent ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON auto_message_settings TO app_api;
GRANT SELECT ON auto_messages_sent TO app_api;
-- Sozlamalar — direktor; yuborilganlar tarixi — mijozlar bazasini ko'radiganlar
CREATE POLICY manage ON auto_message_settings FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));
CREATE POLICY read_log ON auto_messages_sent FOR SELECT TO app_api USING (app.has_perm(business_id, 'clients.view'));

-- ─── Sharh so'rash: kechiktirish sozlansa, darhol emas — skaner yuboradi ──────────────────────────
CREATE OR REPLACE FUNCTION app.request_review_after_completion() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
       AND NOT EXISTS (SELECT 1 FROM auto_message_settings s
                        WHERE s.business_id = NEW.business_id AND (NOT s.review_enabled OR s.review_delay_hours > 0)) THEN
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        SELECT c.user_id, NEW.business_id, 'review_request', 'Xizmatimizdan mamnun bo''ldingizmi?',
               b.name || ': iltimos, xizmatni va ustangizni baholang.',
               jsonb_build_object('appointment_id', NEW.id, 'action', 'review')
          FROM business_clients c JOIN businesses b ON b.id = NEW.business_id
         WHERE c.id = NEW.client_id AND c.user_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.appointment_id = NEW.id)
           AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = c.user_id AND n.type = 'review_request'
                             AND (n.data ->> 'appointment_id')::bigint = NEW.id);
    END IF;
    RETURN NEW;
END $$;

-- ─── Skaner (worker har daqiqada chaqiradi) ──────────────────────────────────────────────────────
-- p_now — testlar uchun (soat 10–20 oynasi). Qaytaradi: Telegram'ga ham yuborilishi kerak bo'lganlar (worker bot orqali yuboradi).
CREATE FUNCTION app.auto_messages_scan(p_business BIGINT DEFAULT NULL, p_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (chat_id BIGINT, title TEXT, body TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    r       RECORD;
    v_title TEXT;
    v_body  TEXT;
    v_type  TEXT;
    v_data  JSONB;
    v_ref   TEXT;
    v_chat  BIGINT;
BEGIN
    FOR r IN
        -- Tug'ilgan kun: bugun (muassasa vaqti), kunduzi
        SELECT 'birthday'::text AS kind, c.business_id, c.id AS client_id, c.user_id, b.name AS business_name, b.slug,
               extract(year FROM p_now AT TIME ZONE b.timezone)::text AS ref, s.birthday_text AS custom,
               NULL::bigint AS appointment_id, c.full_name
          FROM auto_message_settings s
          JOIN businesses b       ON b.id = s.business_id AND b.is_active
          JOIN business_clients c ON c.business_id = s.business_id AND c.user_id IS NOT NULL
          JOIN users u            ON u.id = c.user_id AND u.status = 'active'
         WHERE s.birthday_enabled AND (p_business IS NULL OR s.business_id = p_business)
           AND extract(hour FROM p_now AT TIME ZONE b.timezone) BETWEEN 10 AND 19
           AND coalesce(c.birth_date, u.birth_date) IS NOT NULL
           AND (to_char(coalesce(c.birth_date, u.birth_date), 'MM-DD') = to_char(p_now AT TIME ZONE b.timezone, 'MM-DD')
                -- 29-fevralda tug'ilganlar kabisa bo'lmagan yilda 28-fevralda tabriklanadi
                OR (to_char(coalesce(c.birth_date, u.birth_date), 'MM-DD') = '02-29'
                    AND to_char(p_now AT TIME ZONE b.timezone, 'MM-DD') = '02-28'
                    AND to_char((p_now AT TIME ZONE b.timezone)::date + 1, 'MM-DD') = '03-01'))
        UNION ALL
        -- Sharh so'rash: yakunlangan tashrifdan N soat o'tib (2 kundan eskisiga yuborilmaydi)
        SELECT 'review', a.business_id, a.client_id, c.user_id, b.name, b.slug, a.id::text, NULL, a.id, c.full_name
          FROM auto_message_settings s
          JOIN businesses b       ON b.id = s.business_id AND b.is_active
          JOIN appointments a     ON a.business_id = s.business_id AND a.status = 'completed'
          JOIN business_clients c ON c.id = a.client_id AND c.user_id IS NOT NULL
         WHERE s.review_enabled AND s.review_delay_hours > 0 AND (p_business IS NULL OR s.business_id = p_business)
           AND a.ends_at + make_interval(hours => s.review_delay_hours) <= p_now
           AND a.ends_at + make_interval(hours => s.review_delay_hours) > p_now - INTERVAL '2 days'
           AND NOT EXISTS (SELECT 1 FROM reviews v WHERE v.appointment_id = a.id)
           AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = c.user_id AND n.type = 'review_request'
                             AND (n.data ->> 'appointment_id')::bigint = a.id)
        UNION ALL
        -- Qaytarish: oxirgi tashrifdan N kun o'tgan, kelgusi/ochiq broni yo'q; shu tashrif uchun bir marta
        SELECT 'winback', c.business_id, c.id, c.user_id, b.name, b.slug, (lv.last_at AT TIME ZONE b.timezone)::date::text,
               s.winback_text, NULL, c.full_name
          FROM auto_message_settings s
          JOIN businesses b       ON b.id = s.business_id AND b.is_active
          JOIN business_clients c ON c.business_id = s.business_id AND c.user_id IS NOT NULL
          JOIN users u            ON u.id = c.user_id AND u.status = 'active'
          CROSS JOIN LATERAL (SELECT max(a.starts_at) AS last_at FROM appointments a
                               WHERE a.client_id = c.id AND a.status = 'completed') lv
         WHERE s.winback_enabled AND (p_business IS NULL OR s.business_id = p_business)
           AND extract(hour FROM p_now AT TIME ZONE b.timezone) BETWEEN 10 AND 19
           AND lv.last_at IS NOT NULL
           AND lv.last_at < p_now - make_interval(days => s.winback_days)
           AND lv.last_at > p_now - make_interval(days => s.winback_days + 30)    -- juda eskilarni bezovta qilmaymiz
           AND NOT EXISTS (SELECT 1 FROM appointments f WHERE f.client_id = c.id
                             AND f.status IN ('pending', 'confirmed', 'in_progress') AND f.starts_at > lv.last_at)
        LIMIT 500
    LOOP
        -- Navbatdagi tekshiruvlar bilan poyga bo'lsa ham bir marta: avval jurnalga yozamiz
        INSERT INTO auto_messages_sent (business_id, client_id, kind, ref_key)
        VALUES (r.business_id, r.client_id, r.kind, r.ref)
        ON CONFLICT DO NOTHING;
        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        v_data := jsonb_build_object('business_id', r.business_id, 'slug', r.slug);
        IF r.kind = 'birthday' THEN
            v_type  := 'promo_birthday';
            v_title := 'Tug''ilgan kuningiz bilan!';
            v_body  := coalesce(nullif(trim(r.custom), ''),
                                r.business_name || ' jamoasi sizni tabriklaydi! Sizni yana kutib qolamiz.');
        ELSIF r.kind = 'review' THEN
            v_type  := 'review_request';
            v_title := 'Xizmatimizdan mamnun bo''ldingizmi?';
            v_body  := r.business_name || ': tashrifingiz uchun rahmat! Iltimos, xizmatni va ustangizni baholang.';
            v_data  := jsonb_build_object('appointment_id', r.appointment_id, 'action', 'review');
        ELSE
            v_type  := 'promo_winback';
            v_title := 'Sizni sog''indik!';
            v_body  := coalesce(nullif(trim(r.custom), ''),
                                r.business_name || ': ancha vaqtdan beri ko''rinmadingiz. Qulay vaqtni tanlab, qayta keling!');
        END IF;

        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        VALUES (r.user_id, r.business_id, v_type, v_title, v_body, v_data);

        SELECT i.chat_id INTO v_chat FROM user_identities i
         WHERE i.user_id = r.user_id AND i.provider = 'telegram' AND i.chat_id IS NOT NULL LIMIT 1;
        IF v_chat IS NOT NULL THEN
            UPDATE auto_messages_sent SET telegram = true
             WHERE business_id = r.business_id AND client_id = r.client_id AND kind = r.kind AND ref_key = r.ref;
            chat_id := v_chat;
            title   := v_title;
            body    := v_body;
            RETURN NEXT;
        END IF;
    END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.auto_messages_scan(BIGINT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auto_messages_scan(BIGINT, TIMESTAMPTZ) TO app_worker;
