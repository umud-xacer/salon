-- Usta / shifokor o'zi bajaradigan xizmatning davomiyligini o'zi sozlaydi (TZ 2026-11-06).
--   Faqat O'ZIGA biriktirilgan xizmat va faqat VAQT (narx, xizmatlar ro'yxati — direktorda, staff.manage).
--   NULL — xizmatning umumiy davomiyligi ishlatiladi. Bo'sh vaqtlar (slots) custom_duration ni hisobga oladi.
CREATE FUNCTION app.set_my_service_duration(p_business BIGINT, p_service BIGINT, p_minutes INT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_member BIGINT := app.my_member_in(p_business);
BEGIN
    IF v_member IS NULL OR NOT EXISTS (SELECT 1 FROM businesses b WHERE b.id = p_business
                                         AND app.business_operational(b.id)) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF p_minutes IS NOT NULL AND (p_minutes < 5 OR p_minutes > 720 OR p_minutes % 5 <> 0) THEN
        RAISE EXCEPTION 'invalid_duration' USING ERRCODE = '22023';
    END IF;
    UPDATE member_services SET custom_duration = p_minutes
     WHERE member_id = v_member AND service_id = p_service AND business_id = p_business;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), 'update', 'member_services', v_member,
            jsonb_build_object('service_id', p_service, 'custom_duration', p_minutes));
END $$;
REVOKE ALL ON FUNCTION app.set_my_service_duration(BIGINT, BIGINT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_my_service_duration(BIGINT, BIGINT, INT) TO app_api;
