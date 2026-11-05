-- Reyting va baholash (TZ 2026-11-05).
--   Baho faqat REAL mijozdan: o'z broni, holati 'completed', tugaganiga 30 kundan oshmagan, bitta tashrif — bitta baho.
--   Yozish faqat app.create_review() orqali (to'g'ridan-to'g'ri INSERT yopiq) — kim, qaysi salon, qaysi usta
--   bazaning o'zi bronidan oladi, so'rovga ishonilmaydi.
--   O'rtacha ball (businesses / business_members .rating_avg, .rating_count) trigger bilan qayta hisoblanadi;
--   qo'lda o'zgartirib bo'lmaydi (guard_businesses, guard_members allaqachon to'sadi).
--   Direktor faqat javob yozadi. Super Admin haqoratli bahoni yashira oladi (o'rtachaga kirmaydi).

-- Bitta tashrif — bitta baho, ikki qismli:
--   muassasaga: rating (umumiy), cleanliness (tozalik), service_quality (qabul va xizmat sifati), comment;
--   xizmat ko'rsatgan ustaga / shifokorga: staff_rating, staff_comment. Usta mijoz tanlovi bilan emas,
--   BRONNING O'ZIDAN olinadi (member_id) — mijoz o'zi xizmat olmagan ustaga baho qo'ya olmaydi.
--   Ustaning shaxsiy reytingi (business_members.rating_avg) faqat staff_rating dan hisoblanadi.
ALTER TABLE reviews
    ADD COLUMN cleanliness     SMALLINT CHECK (cleanliness BETWEEN 1 AND 5),
    ADD COLUMN service_quality SMALLINT CHECK (service_quality BETWEEN 1 AND 5),
    ADD COLUMN staff_rating    SMALLINT CHECK (staff_rating BETWEEN 1 AND 5),
    ADD COLUMN staff_comment   TEXT CHECK (length(staff_comment) <= 1000),
    ADD COLUMN reply_at        TIMESTAMPTZ,
    ADD COLUMN replied_by      BIGINT REFERENCES users(id),
    ADD COLUMN is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT reviews_reply_len CHECK (reply IS NULL OR length(trim(reply)) BETWEEN 1 AND 1000);
CREATE INDEX ON reviews (member_id) WHERE member_id IS NOT NULL;

-- Yashirilgan baho faqat salon rahbariyati, muallif va Super Admin'ga ko'rinadi
DROP POLICY public_read ON reviews;
CREATE POLICY public_read ON reviews FOR SELECT TO app_api
    USING (NOT is_hidden OR user_id = app.uid() OR app.has_perm(business_id, 'business.manage'));
-- To'g'ridan-to'g'ri yozish yopiq: faqat app.create_review()
DROP POLICY write_own ON reviews;
REVOKE INSERT, DELETE ON reviews FROM app_api;

-- Salon (direktor) faqat javob yozadi; javob vaqti va muallifi bazada qo'yiladi
CREATE OR REPLACE FUNCTION app.guard_reviews() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF app.is_app_role() AND NOT app.is_superadmin() AND (
           NEW.rating          IS DISTINCT FROM OLD.rating
        OR NEW.cleanliness     IS DISTINCT FROM OLD.cleanliness
        OR NEW.service_quality IS DISTINCT FROM OLD.service_quality
        OR NEW.staff_rating    IS DISTINCT FROM OLD.staff_rating
        OR NEW.staff_comment   IS DISTINCT FROM OLD.staff_comment
        OR NEW.comment         IS DISTINCT FROM OLD.comment
        OR NEW.user_id         IS DISTINCT FROM OLD.user_id
        OR NEW.business_id     IS DISTINCT FROM OLD.business_id
        OR NEW.member_id       IS DISTINCT FROM OLD.member_id
        OR NEW.appointment_id  IS DISTINCT FROM OLD.appointment_id
        OR NEW.created_at      IS DISTINCT FROM OLD.created_at
        OR NEW.is_hidden       IS DISTINCT FROM OLD.is_hidden) THEN
        RAISE EXCEPTION 'review_is_immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.reply IS DISTINCT FROM OLD.reply THEN
        NEW.reply_at   := CASE WHEN NEW.reply IS NULL THEN NULL ELSE now() END;
        NEW.replied_by := CASE WHEN NEW.reply IS NULL THEN NULL ELSE app.uid() END;
    ELSE
        NEW.reply_at   := OLD.reply_at;
        NEW.replied_by := OLD.replied_by;
    END IF;
    RETURN NEW;
END $$;

-- O'rtacha ballni qayta hisoblash (salon va usta). Yashirilganlar hisobga kirmaydi.
CREATE FUNCTION app.refresh_ratings(p_business BIGINT, p_member BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE businesses b
       SET rating_avg = coalesce(s.avg, 0), rating_count = coalesce(s.cnt, 0)
      FROM (SELECT round(avg(rating), 1) AS avg, count(*) AS cnt
              FROM reviews WHERE business_id = p_business AND NOT is_hidden) s
     WHERE b.id = p_business;
    IF p_member IS NOT NULL THEN
        UPDATE business_members m
           SET rating_avg = coalesce(s.avg, 0), rating_count = coalesce(s.cnt, 0)
          FROM (SELECT round(avg(staff_rating), 1) AS avg, count(*) AS cnt
                  FROM reviews WHERE member_id = p_member AND staff_rating IS NOT NULL AND NOT is_hidden) s
         WHERE m.id = p_member;
    END IF;
END $$;
REVOKE ALL ON FUNCTION app.refresh_ratings(BIGINT, BIGINT) FROM PUBLIC;

CREATE FUNCTION app.reviews_after_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Butun muassasa o'chirilayotgan bo'lsa, yangilanadigan joy yo'q
        IF EXISTS (SELECT 1 FROM businesses WHERE id = OLD.business_id) THEN
            PERFORM app.refresh_ratings(OLD.business_id, OLD.member_id);
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.rating IS DISTINCT FROM OLD.rating OR NEW.staff_rating IS DISTINCT FROM OLD.staff_rating
       OR NEW.is_hidden IS DISTINCT FROM OLD.is_hidden THEN
        PERFORM app.refresh_ratings(NEW.business_id, NEW.member_id);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER reviews_after_change AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION app.reviews_after_change();

-- Mijoz baho beradi. Xatolar: not_found (bron yo'q yoki begona), not_completed, review_expired, already_reviewed
CREATE FUNCTION app.create_review(p_appointment BIGINT, p_rating INT, p_cleanliness INT, p_quality INT, p_comment TEXT,
                                  p_staff_rating INT, p_staff_comment TEXT)
RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v    appointments%ROWTYPE;
    v_id BIGINT;
BEGIN
    IF app.uid() IS NULL THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v FROM appointments WHERE appointments.id = p_appointment FOR UPDATE;
    IF NOT FOUND OR NOT v.client_id = ANY (app.my_client_ids()) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v.status <> 'completed' THEN
        RAISE EXCEPTION 'not_completed' USING ERRCODE = 'P0418';
    END IF;
    IF coalesce(v.completed_at, v.ends_at) < now() - interval '30 days' THEN
        RAISE EXCEPTION 'review_expired' USING ERRCODE = 'P0419';
    END IF;
    IF EXISTS (SELECT 1 FROM reviews r WHERE r.appointment_id = p_appointment) THEN
        RAISE EXCEPTION 'already_reviewed' USING ERRCODE = 'P0420';
    END IF;

    INSERT INTO reviews (business_id, appointment_id, user_id, member_id, rating, cleanliness, service_quality, comment,
                         staff_rating, staff_comment)
    VALUES (v.business_id, v.id, app.uid(), v.member_id, p_rating, p_cleanliness, p_quality,
            nullif(trim(p_comment), ''), p_staff_rating,
            CASE WHEN p_staff_rating IS NULL THEN NULL ELSE nullif(trim(p_staff_comment), '') END)
    RETURNING reviews.id INTO v_id;

    -- "Baholang" xabari endi kerak emas
    UPDATE notifications SET read_at = coalesce(read_at, now())
     WHERE user_id = app.uid() AND type = 'review_request' AND (data ->> 'appointment_id')::bigint = v.id;

    -- Direktor(lar)ga xabar
    INSERT INTO notifications (user_id, business_id, type, title, body, data)
    SELECT m.user_id, v.business_id, 'new_review', 'Yangi baho: ' || repeat('★', p_rating),
           left(coalesce(nullif(trim(p_comment), ''), 'Izohsiz'), 160),
           jsonb_build_object('review_id', v_id, 'appointment_id', v.id)
      FROM business_members m
     WHERE m.business_id = v.business_id AND m.role = 'owner' AND m.is_active;
    RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.create_review(BIGINT, INT, INT, INT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_review(BIGINT, INT, INT, INT, TEXT, INT, TEXT) TO app_api;

-- Xizmat yakunlangach mijozga avtomatik "Baholang" xabari (ilovadagi Xabarlar va push).
-- Faqat ilova hisobi bor mijozga (qabulxona yozgan, ilovasiz mijozda user_id yo'q).
CREATE FUNCTION app.request_review_after_completion() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
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
CREATE TRIGGER request_review_after_completion AFTER UPDATE OF status ON appointments
    FOR EACH ROW EXECUTE FUNCTION app.request_review_after_completion();

-- Ommaviy ro'yxat (ilova, kirishsiz ham): muallif — faqat ism va familiyaning bosh harfi, telefon yo'q
-- p_member berilsa: faqat shu usta/shifokorga baho qo'yilganlar (usta profili uchun)
CREATE FUNCTION app.public_reviews(p_business BIGINT, p_member BIGINT, p_limit INT, p_offset INT)
RETURNS TABLE (id BIGINT, author TEXT, member_id BIGINT, member_name TEXT, rating SMALLINT, cleanliness SMALLINT,
               service_quality SMALLINT, comment TEXT, staff_rating SMALLINT, staff_comment TEXT,
               reply TEXT, reply_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.id,
           CASE WHEN coalesce(trim(u.full_name), '') = '' THEN 'Mijoz'
                ELSE split_part(trim(u.full_name), ' ', 1)
                     || coalesce(' ' || nullif(left(split_part(trim(u.full_name), ' ', 2), 1), '') || '.', '') END,
           r.member_id, mu.full_name::text, r.rating, r.cleanliness, r.service_quality, r.comment,
           r.staff_rating, r.staff_comment, r.reply, r.reply_at, r.created_at
      FROM reviews r
      JOIN businesses b ON b.id = r.business_id AND app.business_is_public(b.id)
      JOIN users u ON u.id = r.user_id
      LEFT JOIN business_members m ON m.id = r.member_id
      LEFT JOIN users mu ON mu.id = m.user_id
     WHERE r.business_id = p_business AND NOT r.is_hidden
       AND (p_member IS NULL OR (r.member_id = p_member AND r.staff_rating IS NOT NULL))
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT least(greatest(p_limit, 1), 50) OFFSET greatest(p_offset, 0)
$$;

CREATE FUNCTION app.public_review_summary(p_business BIGINT)
RETURNS TABLE (count BIGINT, rating_avg NUMERIC, cleanliness_avg NUMERIC, quality_avg NUMERIC,
               s1 BIGINT, s2 BIGINT, s3 BIGINT, s4 BIGINT, s5 BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT count(*), round(avg(rating), 1), round(avg(cleanliness), 1), round(avg(service_quality), 1),
           count(*) FILTER (WHERE rating = 1), count(*) FILTER (WHERE rating = 2), count(*) FILTER (WHERE rating = 3),
           count(*) FILTER (WHERE rating = 4), count(*) FILTER (WHERE rating = 5)
      FROM reviews r
     WHERE r.business_id = p_business AND NOT r.is_hidden AND app.business_is_public(p_business)
$$;
REVOKE ALL ON FUNCTION app.public_reviews(BIGINT, BIGINT, INT, INT), app.public_review_summary(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_reviews(BIGINT, BIGINT, INT, INT), app.public_review_summary(BIGINT) TO app_api;
