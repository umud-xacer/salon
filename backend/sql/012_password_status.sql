-- Vaqtinchalik parol: direktor yoki Super Admin o'rnatgan parolni egasi birinchi kirishda almashtiradi.
-- Parolning o'zi hech kimga ko'rinmaydi (faqat xesh saqlanadi). Super Admin holatni ko'radi: yo'q, vaqtinchalik, o'z paroli.
ALTER TABLE users
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN password_changed_at  TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION app.set_member_password(p_business BIGINT, p_member BIGINT, p_hash TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_reason TEXT := app.password_block_reason(p_business, p_member);
    v_user   BIGINT;
BEGIN
    IF v_reason = 'not_found' THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    ELSIF v_reason = 'shared_account' THEN
        RAISE EXCEPTION 'shared_account' USING ERRCODE = 'P0410';
    ELSIF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;

    SELECT user_id INTO v_user FROM business_members WHERE id = p_member;
    UPDATE users
       SET password_hash = p_hash, must_change_password = TRUE, password_changed_at = now(),
           failed_login_attempts = 0, locked_until = NULL, token_version = token_version + 1
     WHERE id = v_user;
    UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id)
    VALUES (p_business, app.uid(), 'password_set', 'member', p_member);
END $$;
