-- Parolni boshqa odam o'rnatishi. Parol ustuni app_api uchun yopiq, yagona yo'l shu funksiya.
--   Super Admin: istalgan salon xodimi va direktori (boshqa Super Admin emas).
--   Direktor: faqat o'z salonidagi xodimlar.
-- Hisobni egallashdan himoya: direktor istalgan telefonni "xodim" qilib qo'sha oladi. Shu raqam boshqa salonda
-- ishlasa yoki mijoz sifatida ro'yxatdan o'tgan bo'lsa, parolini faqat egasi yoki Super Admin o'zgartiradi.

-- NULL = ruxsat bor. Aks holda sabab: not_found, forbidden, shared_account
CREATE FUNCTION app.password_block_reason(p_business BIGINT, p_member BIGINT) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user       BIGINT;
    v_role       member_role;
    v_superadmin BOOLEAN;
BEGIN
    SELECT m.user_id, m.role, u.is_superadmin INTO v_user, v_role, v_superadmin
      FROM business_members m JOIN users u ON u.id = m.user_id
     WHERE m.id = p_member AND m.business_id = p_business;
    IF NOT FOUND THEN
        RETURN 'not_found';
    END IF;
    IF v_superadmin THEN
        RETURN 'forbidden';
    END IF;
    IF app.is_superadmin() THEN
        RETURN NULL;
    END IF;

    IF NOT app.business_operational(p_business) OR NOT EXISTS (
            SELECT 1 FROM business_members o
             WHERE o.business_id = p_business AND o.user_id = app.uid() AND o.role = 'owner' AND o.is_active) THEN
        RETURN 'forbidden';
    END IF;
    IF v_user = app.uid() OR v_role = 'owner' THEN
        RETURN 'forbidden';
    END IF;

    IF EXISTS (SELECT 1 FROM business_members o WHERE o.user_id = v_user AND o.business_id <> p_business)
       OR EXISTS (SELECT 1 FROM business_clients c WHERE c.user_id = v_user) THEN
        RETURN 'shared_account';
    END IF;
    RETURN NULL;
END $$;

-- Parol o'zgarishi bilan xodimning barcha sessiyalari yopiladi. Xesh bazada ham, jurnalda ham ochiq ko'rinmaydi.
CREATE FUNCTION app.set_member_password(p_business BIGINT, p_member BIGINT, p_hash TEXT) RETURNS VOID
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
       SET password_hash = p_hash, failed_login_attempts = 0, locked_until = NULL, token_version = token_version + 1
     WHERE id = v_user;
    UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id)
    VALUES (p_business, app.uid(), 'password_set', 'member', p_member);
END $$;

REVOKE ALL ON FUNCTION app.password_block_reason(BIGINT, BIGINT), app.set_member_password(BIGINT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.password_block_reason(BIGINT, BIGINT), app.set_member_password(BIGINT, BIGINT, TEXT) TO app_api;
