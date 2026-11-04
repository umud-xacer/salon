-- Eslatma eskalatsiyasi (TZ, 2026-11-04):
--   30 daqiqa qolganda mijozga budilnik ("Tasdiqlayman / Bormayman") — mavjud (create_due_reminders).
--   Mijoz javob bermasa, bron vaqtiga N daqiqa (standart 20) qolganda: ustaga VA bronlarni boshqaruvchi
--   xodimlarga (qabulxona, direktor — 'appointments.manage') "Mijoz bilan bog'laning!" ogohlantirishi.
--   Push yetkazilmagan bo'lsa (masalan, ilova o'chirilgan) — darhol.

-- Boshqa foydalanuvchi nomidan huquq (worker uchun: app.uid() yo'q)
CREATE FUNCTION app.member_has_perm(p_member BIGINT, p_perm TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM business_members m
          JOIN users u ON u.id = m.user_id AND u.status = 'active'
         WHERE m.id = p_member AND m.is_active
           AND coalesce((SELECT mp.granted FROM member_permissions mp
                          WHERE mp.member_id = m.id AND mp.permission_code = p_perm),
                        EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = m.role AND rp.permission_code = p_perm))
           AND app.module_enabled(m.business_id, (SELECT module_code FROM permissions WHERE code = p_perm))
    )
$$;
REVOKE ALL ON FUNCTION app.member_has_perm(BIGINT, TEXT) FROM PUBLIC;

DROP FUNCTION app.raise_attendance_alerts(INTEGER);
CREATE FUNCTION app.raise_attendance_alerts(p_before_min INTEGER) RETURNS INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH due AS (
        UPDATE appointment_reminders r SET alerted_at = now()
          FROM appointments a
         WHERE a.id = r.appointment_id
           AND r.sent_at IS NOT NULL AND r.confirmed_at IS NULL AND r.alerted_at IS NULL
           AND a.status IN ('pending', 'confirmed') AND a.ends_at > now()
           AND (NOT r.delivered OR a.starts_at - make_interval(mins => p_before_min) <= now())
        RETURNING r.appointment_id
    ), targets AS (
        -- Usta o'zi + bronlarni boshqaradiganlar (bir kishi ikki marta olmaydi)
        SELECT DISTINCT d.appointment_id, m.user_id
          FROM due d
          JOIN appointments a     ON a.id = d.appointment_id
          JOIN business_members m ON m.business_id = a.business_id AND m.is_active
         WHERE m.id = a.member_id OR app.member_has_perm(m.id, 'appointments.manage')
    ), sent AS (
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        SELECT t.user_id, a.business_id, 'attendance_alert', 'Mijoz bilan bog''laning!',
               c.full_name || ', ' || to_char(a.starts_at AT TIME ZONE b.timezone, 'HH24:MI')
                   || ' — bron vaqtiga ' || greatest(ceil(extract(epoch FROM a.starts_at - now()) / 60), 0)::int
                   || ' daqiqa qoldi. Mijoz bronni tasdiqlamadi',
               jsonb_build_object('appointment_id', a.id, 'action', 'call_client', 'client_name', c.full_name,
                                  'starts_at', a.starts_at, 'master', mu.full_name)
          FROM targets t
          JOIN appointments a     ON a.id = t.appointment_id
          JOIN business_clients c ON c.id = a.client_id
          JOIN businesses b       ON b.id = a.business_id
          JOIN business_members am ON am.id = a.member_id
          JOIN users mu            ON mu.id = am.user_id
        RETURNING 1
    )
    SELECT count(*)::int FROM sent
$$;
REVOKE ALL ON FUNCTION app.raise_attendance_alerts(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.raise_attendance_alerts(INTEGER) TO app_worker;
