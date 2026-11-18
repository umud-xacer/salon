-- API himoyasi: shubhali IP/qurilma vaqtincha bloklanadi (app/core/ip_guard.py), har bir blok audit jurnaliga.
-- Himoya qatlami so'rovgacha ishlaydi (foydalanuvchi va RLS konteksti yo'q), shuning uchun yozuv SECURITY DEFINER
-- funksiya orqali: faqat entity_type = 'security', o'zgarishlar JSON'da (IP, sabab, User-Agent, oxirgi so'rovlar).
CREATE FUNCTION app.log_security_event(p_action TEXT, p_ip TEXT, p_user BIGINT, p_details JSONB) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes, ip)
    VALUES (NULL, p_user, left(p_action, 40), 'security', NULL, p_details,
            CASE WHEN p_ip ~ '^[0-9a-fA-F:.]+$' THEN p_ip::inet END);
$$;
REVOKE ALL ON FUNCTION app.log_security_event(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.log_security_event(TEXT, TEXT, BIGINT, JSONB) TO app_api;
