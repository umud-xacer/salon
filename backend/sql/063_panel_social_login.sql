-- Biznes paneliga Telegram va Google orqali kirish (2026-11-18).
-- Panelga faqat biror muassasada faol a'zo (direktor/xodim) yoki Super Admin kira oladi.
-- Telegram/Google orqali panelga kirishda yangi mijoz yaratilmaydi: hisob biznesga ulanmagan bo'lsa — rad.
-- app_auth business_members'ni ko'rmaydi, shuning uchun tekshiruv SECURITY DEFINER funksiyada.
CREATE FUNCTION app.panel_access(p_user BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce((SELECT u.is_superadmin FROM users u WHERE u.id = p_user), false)
        OR EXISTS (SELECT 1 FROM business_members m WHERE m.user_id = p_user AND m.is_active);
$$;

REVOKE ALL ON FUNCTION app.panel_access(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.panel_access(BIGINT) TO app_api, app_auth;
