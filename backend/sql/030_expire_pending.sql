-- Tasdiqlanmagan bronlarni avtomatik bekor qilish (TZ 2026-11-06).
--   Ilovadan qilingan bron 'pending' bo'lib turadi, salon "Tasdiqlash" ni bosadi (qabulxona yozgani darhol 'confirmed').
--   Worker har daqiqada 'pending' bronni bekor qiladi, agar:
--     a) bron vaqti kelib qolgan bo'lsa (starts_at <= now()), yoki
--     b) salon belgilangan muddatda (businesses.confirm_timeout_min, standart 60 daqiqa) tasdiqlamagan bo'lsa.
--   Muddat salonning ISH VAQTI bo'yicha hisoblanadi: kechasi 23:00 da qilingan bron ertalab salon ochilgach
--   60 daqiqa kutadi, salon yopiq paytda bekor bo'lib ketmaydi.
--   Vaqt bo'shaydi (cancelled EXCLUDE cheklovidan chiqadi), mijozga xabar boradi, jurnalga yoziladi.
ALTER TABLE businesses
    ADD COLUMN confirm_timeout_min SMALLINT NOT NULL DEFAULT 60 CHECK (confirm_timeout_min BETWEEN 15 AND 1440);

-- Salon tasdiqlashi kerak bo'lgan oxirgi vaqt (bron vaqtidan kech emas)
CREATE FUNCTION app.confirm_deadline(p_business BIGINT, p_created TIMESTAMPTZ, p_starts TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH b AS (
        SELECT timezone, confirm_timeout_min, (p_created AT TIME ZONE timezone) AS lt
          FROM businesses WHERE id = p_business
    ), win AS (
        -- Keyingi 8 kundagi ish oynalari (mahalliy vaqt)
        SELECT (b.lt::date + d) + h.opens_at AS o, (b.lt::date + d) + h.closes_at AS c
          FROM b CROSS JOIN generate_series(0, 7) d
          JOIN business_hours h ON h.business_id = p_business
                               AND h.weekday = extract(isodow FROM b.lt::date + d)
    ), start_local AS (
        -- Ish vaqti ichida bo'lsa — o'sha payt, aks holda keyingi ochilish. Ish vaqti kiritilmagan bo'lsa — o'sha payt
        SELECT coalesce((SELECT min(greatest(w.o, b.lt)) FROM win w WHERE w.c > b.lt), b.lt) AS s FROM b
    )
    SELECT least(p_starts, ((s.s + make_interval(mins => b.confirm_timeout_min)) AT TIME ZONE b.timezone))
      FROM b, start_local s
$$;

CREATE FUNCTION app.expire_pending_appointments() RETURNS INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH due AS (
        SELECT a.id
          FROM appointments a
         WHERE a.status = 'pending'
           AND app.confirm_deadline(a.business_id, a.created_at, a.starts_at) <= now()
           FOR UPDATE OF a SKIP LOCKED
    ), done AS (
        UPDATE appointments a
           SET status = 'cancelled',
               cancel_reason = CASE WHEN a.starts_at <= now() THEN 'Avtomatik: bron vaqti o''tdi, salon tasdiqlamadi'
                                    ELSE 'Avtomatik: salon belgilangan vaqtda tasdiqlamadi' END
          FROM due WHERE a.id = due.id
        RETURNING a.id, a.business_id, a.client_id, a.starts_at, a.cancel_reason
    ), logged AS (
        INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
        SELECT d.business_id, NULL, 'auto_cancel', 'appointment', d.id, jsonb_build_object('reason', d.cancel_reason)
          FROM done d
        RETURNING 1
    ), notified AS (
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        SELECT c.user_id, d.business_id, 'appointment_cancelled', 'Bron bekor qilindi',
               b.name || ', ' || to_char(d.starts_at AT TIME ZONE b.timezone, 'DD.MM HH24:MI')
                      || ': salon bronni tasdiqlamadi. Boshqa vaqt yoki salonni tanlashingiz mumkin.',
               jsonb_build_object('appointment_id', d.id, 'action', 'rebook')
          FROM done d
          JOIN business_clients c ON c.id = d.client_id AND c.user_id IS NOT NULL
          JOIN businesses b ON b.id = d.business_id
        RETURNING 1
    )
    SELECT count(*)::int FROM done
$$;

REVOKE ALL ON FUNCTION app.confirm_deadline(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ), app.expire_pending_appointments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confirm_deadline(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO app_api;
GRANT EXECUTE ON FUNCTION app.expire_pending_appointments() TO app_worker;
