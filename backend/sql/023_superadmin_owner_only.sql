-- Super Admin faqat muassasa egasining (direktorning) parolini ko'radi, xodimlarnikini emas
-- (foydalanuvchi talabi, 2026-11-04). Xodim parolini direktor ko'radi.
CREATE OR REPLACE FUNCTION app.issued_password(p_business BIGINT, p_member BIGINT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_reason TEXT := app.password_block_reason(p_business, p_member);
    v_enc    TEXT;
    v_role   member_role;
BEGIN
    IF v_reason = 'not_found' THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    ELSIF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT u.issued_password_enc, m.role INTO v_enc, v_role
      FROM business_members m JOIN users u ON u.id = m.user_id WHERE m.id = p_member;
    IF app.is_superadmin() AND v_role <> 'owner' THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    IF v_enc IS NOT NULL THEN
        INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id)
        VALUES (p_business, app.uid(), 'password_viewed', 'member', p_member);
    END IF;
    RETURN v_enc;
END $$;
