-- Xodim va direktor parollarini faqat rahbar beradi (foydalanuvchi qarori, 2026-11-04):
--   direktorga — Super Admin, xodimga — direktor (yoki Super Admin). Odam o'zi almashtira olmaydi,
--   shuning uchun parol doim rahbar bergan parol va rahbarga ko'rinib turadi.
-- Oddiy mijozlar va Super Admin o'z parolini o'zi boshqaradi — ularniki hech kimga ko'rinmaydi.

-- Parolni rahbar boshqaradimi: salonda faol a'zo va Super Admin emas. app_auth ham chaqiradi.
CREATE FUNCTION app.password_managed(p_user BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce((SELECT NOT u.is_superadmin FROM users u WHERE u.id = p_user), false)
       AND EXISTS (SELECT 1 FROM business_members m WHERE m.user_id = p_user AND m.is_active);
$$;

-- Parol holati panel uchun: none | issued (rahbar bergan, ko'rinadi) | temporary (eski) | own
CREATE FUNCTION app.password_state(p_user BIGINT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN u.password_hash IS NULL THEN 'none'
                WHEN u.issued_password_enc IS NOT NULL THEN 'issued'
                WHEN u.must_change_password THEN 'temporary'
                ELSE 'own' END
      FROM users u WHERE u.id = p_user;
$$;

REVOKE ALL ON FUNCTION app.password_managed(BIGINT), app.password_state(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.password_managed(BIGINT), app.password_state(BIGINT) TO app_api, app_auth;

-- Berilgan parol izi: parol boshqa yo'l bilan o'zgarsa yoki olib tashlansa — o'chadi.
-- set_member_password xesh va shifrni birga yozadi, shuning uchun u saqlanadi.
CREATE OR REPLACE FUNCTION app.clear_issued_password() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.password_hash IS NULL THEN
        NEW.issued_password_enc := NULL;
    ELSIF TG_OP = 'UPDATE' AND NEW.password_hash IS DISTINCT FROM OLD.password_hash
          AND NEW.issued_password_enc IS NOT DISTINCT FROM OLD.issued_password_enc THEN
        NEW.issued_password_enc := NULL;
    END IF;
    RETURN NEW;
END $$;

-- Rahbar bergan parol endi doimiy: birinchi kirishda almashtirish talab qilinmaydi
CREATE OR REPLACE FUNCTION app.set_member_password(p_business BIGINT, p_member BIGINT, p_hash TEXT, p_enc TEXT DEFAULT NULL)
RETURNS VOID
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
       SET password_hash = p_hash, must_change_password = FALSE, password_changed_at = now(),
           issued_password_enc = p_enc,
           failed_login_attempts = 0, locked_until = NULL, token_version = token_version + 1
     WHERE id = v_user;
    UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id)
    VALUES (p_business, app.uid(), 'password_set', 'member', p_member);
END $$;

-- Mavjud xodimlar: o'zi almashtira olmaydi, shuning uchun "avval almashtiring" talabi olib tashlanadi
-- (aks holda panelga kira olmay qolishadi). Parollari o'zgarmaydi.
UPDATE users SET must_change_password = FALSE
 WHERE must_change_password AND app.password_managed(id);
