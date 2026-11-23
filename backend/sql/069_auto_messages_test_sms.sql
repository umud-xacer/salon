-- Avtomatik xabarlar (054) davomi (TZ 2026-11-23):
--   1) "Sinab ko'rish": direktor tanlangan xabarni O'ZIGA yuboradi (ilovadagi Xabarlar + Telegram bog'langan bo'lsa).
--      Mijozlarga hech narsa ketmaydi, jurnalga (auto_messages_sent) yozilmaydi. Soatiga 10 tadan ko'p emas.
--   2) SMS'ga tayyorgarlik: muassasa "SMS orqali ham" ni yoqsa, ILOVASI YO'Q mijozlarga tug'ilgan kun va qaytarish
--      xabarlari SMS bilan ketadi. Lekin faqat server .env da AUTO_SMS_ENABLED=true bo'lganda (worker p_sms ni
--      beradi) — SMS matnlari avval Eskiz moderatsiyasidan o'tishi kerak. Sharh so'rash SMS bilan yuborilmaydi
--      (baholash ilovada).

ALTER TABLE auto_message_settings ADD COLUMN sms_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auto_messages_sent    ADD COLUMN sms         BOOLEAN NOT NULL DEFAULT false;

-- Bitta joyda: sarlavha va matn (scan ham, sinov ham shuni ishlatadi)
CREATE FUNCTION app.auto_message_text(p_kind TEXT, p_business_name TEXT, p_custom TEXT,
                                      OUT title TEXT, OUT body TEXT)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE p_kind WHEN 'birthday' THEN 'Tug''ilgan kuningiz bilan!'
                       WHEN 'review'   THEN 'Xizmatimizdan mamnun bo''ldingizmi?'
                       ELSE 'Sizni sog''indik!' END,
           CASE p_kind
               WHEN 'birthday' THEN coalesce(nullif(trim(p_custom), ''),
                                    p_business_name || ' jamoasi sizni tabriklaydi! Sizni yana kutib qolamiz.')
               WHEN 'review'   THEN p_business_name
                                    || ': tashrifingiz uchun rahmat! Iltimos, xizmatni va ustangizni baholang.'
               ELSE coalesce(nullif(trim(p_custom), ''),
                             p_business_name || ': ancha vaqtdan beri ko''rinmadingiz. Qulay vaqtni tanlab, qayta keling!')
           END
$$;

DROP FUNCTION app.auto_messages_scan(BIGINT, TIMESTAMPTZ);

-- chat_id — Telegram'ga, phone — SMS'ga (ikkalasidan biri to'ldiriladi)
CREATE FUNCTION app.auto_messages_scan(p_business BIGINT DEFAULT NULL, p_now TIMESTAMPTZ DEFAULT now(),
                                       p_sms BOOLEAN DEFAULT false)
RETURNS TABLE (chat_id BIGINT, phone TEXT, title TEXT, body TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    r       RECORD;
    v_text  RECORD;
    v_type  TEXT;
    v_data  JSONB;
    v_chat  BIGINT;
BEGIN
    FOR r IN
        -- Tug'ilgan kun: bugun (muassasa vaqti), kunduzi. Ilovasi bor mijoz — ilovaga; yo'q — SMS (yoqilgan bo'lsa)
        SELECT 'birthday'::text AS kind, c.business_id, c.id AS client_id, c.user_id, c.phone, b.name AS business_name,
               b.slug, extract(year FROM p_now AT TIME ZONE b.timezone)::text AS ref, s.birthday_text AS custom,
               NULL::bigint AS appointment_id
          FROM auto_message_settings s
          JOIN businesses b       ON b.id = s.business_id AND b.is_active
          JOIN business_clients c ON c.business_id = s.business_id
          LEFT JOIN users u       ON u.id = c.user_id
         WHERE s.birthday_enabled AND (p_business IS NULL OR s.business_id = p_business)
           AND (u.status = 'active' OR (c.user_id IS NULL AND p_sms AND s.sms_enabled))
           AND extract(hour FROM p_now AT TIME ZONE b.timezone) BETWEEN 10 AND 19
           AND coalesce(c.birth_date, u.birth_date) IS NOT NULL
           AND (to_char(coalesce(c.birth_date, u.birth_date), 'MM-DD') = to_char(p_now AT TIME ZONE b.timezone, 'MM-DD')
                -- 29-fevralda tug'ilganlar kabisa bo'lmagan yilda 28-fevralda tabriklanadi
                OR (to_char(coalesce(c.birth_date, u.birth_date), 'MM-DD') = '02-29'
                    AND to_char(p_now AT TIME ZONE b.timezone, 'MM-DD') = '02-28'
                    AND to_char((p_now AT TIME ZONE b.timezone)::date + 1, 'MM-DD') = '03-01'))
        UNION ALL
        -- Sharh so'rash: faqat ilovasi bor mijozga (baholash ilovada), yakunlangan tashrifdan N soat o'tib
        SELECT 'review', a.business_id, a.client_id, c.user_id, c.phone, b.name, b.slug, a.id::text, NULL, a.id
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
        SELECT 'winback', c.business_id, c.id, c.user_id, c.phone, b.name, b.slug,
               (lv.last_at AT TIME ZONE b.timezone)::date::text, s.winback_text, NULL
          FROM auto_message_settings s
          JOIN businesses b       ON b.id = s.business_id AND b.is_active
          JOIN business_clients c ON c.business_id = s.business_id
          LEFT JOIN users u       ON u.id = c.user_id
          CROSS JOIN LATERAL (SELECT max(a.starts_at) AS last_at FROM appointments a
                               WHERE a.client_id = c.id AND a.status = 'completed') lv
         WHERE s.winback_enabled AND (p_business IS NULL OR s.business_id = p_business)
           AND (u.status = 'active' OR (c.user_id IS NULL AND p_sms AND s.sms_enabled))
           AND extract(hour FROM p_now AT TIME ZONE b.timezone) BETWEEN 10 AND 19
           AND lv.last_at IS NOT NULL
           AND lv.last_at < p_now - make_interval(days => s.winback_days)
           AND lv.last_at > p_now - make_interval(days => s.winback_days + 30)    -- juda eskilarni bezovta qilmaymiz
           AND NOT EXISTS (SELECT 1 FROM appointments f WHERE f.client_id = c.id
                             AND f.status IN ('pending', 'confirmed', 'in_progress') AND f.starts_at > lv.last_at)
        LIMIT 500
    LOOP
        -- Navbatdagi tekshiruvlar bilan poyga bo'lsa ham bir marta: avval jurnalga yozamiz
        INSERT INTO auto_messages_sent (business_id, client_id, kind, ref_key, sms)
        VALUES (r.business_id, r.client_id, r.kind, r.ref, r.user_id IS NULL)
        ON CONFLICT DO NOTHING;
        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        v_text := app.auto_message_text(r.kind, r.business_name, r.custom);

        IF r.user_id IS NULL THEN                         -- ilovasiz mijoz: faqat SMS
            chat_id := NULL;
            phone   := r.phone;
            title   := v_text.title;
            body    := v_text.body;
            RETURN NEXT;
            CONTINUE;
        END IF;

        v_data := jsonb_build_object('business_id', r.business_id, 'slug', r.slug);
        v_type := CASE r.kind WHEN 'birthday' THEN 'promo_birthday' WHEN 'review' THEN 'review_request'
                              ELSE 'promo_winback' END;
        IF r.kind = 'review' THEN
            v_data := jsonb_build_object('appointment_id', r.appointment_id, 'action', 'review');
        END IF;
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        VALUES (r.user_id, r.business_id, v_type, v_text.title, v_text.body, v_data);

        SELECT i.chat_id INTO v_chat FROM user_identities i
         WHERE i.user_id = r.user_id AND i.provider = 'telegram' AND i.chat_id IS NOT NULL LIMIT 1;
        IF v_chat IS NOT NULL THEN
            UPDATE auto_messages_sent SET telegram = true
             WHERE business_id = r.business_id AND client_id = r.client_id AND kind = r.kind AND ref_key = r.ref;
            chat_id := v_chat;
            phone   := NULL;
            title   := v_text.title;
            body    := v_text.body;
            RETURN NEXT;
        END IF;
    END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.auto_messages_scan(BIGINT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auto_messages_scan(BIGINT, TIMESTAMPTZ, BOOLEAN) TO app_worker;

-- "Sinab ko'rish": joriy saqlangan matn bilan xabarni direktorning o'ziga yuboradi. Telegram chat_id qaytaradi
-- (bog'lanmagan bo'lsa NULL) — API uni bot orqali yuboradi.
CREATE FUNCTION app.auto_message_test(p_business BIGINT, p_kind TEXT,
                                      OUT chat_id BIGINT, OUT title TEXT, OUT body TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_name   TEXT;
    v_custom TEXT;
    v_text   RECORD;
BEGIN
    IF NOT app.has_perm(p_business, 'business.manage') THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF p_kind NOT IN ('birthday', 'review', 'winback') THEN
        RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM notifications n
         WHERE n.user_id = app.uid() AND n.business_id = p_business AND n.type = 'auto_message_test'
           AND n.created_at > now() - INTERVAL '1 hour') >= 10 THEN
        RAISE EXCEPTION 'too_many_tests' USING ERRCODE = 'P0429';
    END IF;

    SELECT b.name, CASE p_kind WHEN 'birthday' THEN s.birthday_text WHEN 'winback' THEN s.winback_text END
      INTO v_name, v_custom
      FROM businesses b LEFT JOIN auto_message_settings s ON s.business_id = b.id
     WHERE b.id = p_business;

    v_text := app.auto_message_text(p_kind, v_name, v_custom);
    title  := '[Sinov] ' || v_text.title;
    body   := v_text.body;

    INSERT INTO notifications (user_id, business_id, type, title, body, data)
    VALUES (app.uid(), p_business, 'auto_message_test', title, body,
            jsonb_build_object('business_id', p_business, 'kind', p_kind, 'test', true));

    SELECT i.chat_id INTO chat_id FROM user_identities i
     WHERE i.user_id = app.uid() AND i.provider = 'telegram' AND i.chat_id IS NOT NULL LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION app.auto_message_test(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auto_message_test(BIGINT, TEXT) TO app_api;
