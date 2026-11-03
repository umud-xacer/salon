-- Rahbar bergan boshlang'ich (vaqtinchalik) parolni keyin ko'rish.
--
-- Qoida (ataylab): faqat Super Admin yoki direktor BERGAN parol ko'rinadi va u faqat odam o'z parolini
-- qo'ymaguncha saqlanadi. Odamning o'zi qo'ygan parol hech qachon qayta o'qiladigan holda saqlanmaydi —
-- u boshqa xizmatlarda (bank, Telegram) ham ishlatilgan bo'lishi mumkin.
--
-- Saqlash: AES-GCM bilan shifrlangan (kalit faqat API muhitida, bazada emas). Ustunni app_api to'g'ridan-to'g'ri
-- o'qiy olmaydi, faqat app.issued_password() orqali — u parol berish huquqi bilan bir xil tekshiradi va jurnalga yozadi.
ALTER TABLE users ADD COLUMN issued_password_enc TEXT CHECK (char_length(issued_password_enc) <= 400);

-- app_api: users jadvalidagi shu ustundan boshqa hammasini o'qiydi.
-- DIQQAT: users ga yangi ustun qo'shilsa, app_api uchun alohida GRANT SELECT (ustun) kerak.
REVOKE SELECT ON users FROM app_api;
DO $$
DECLARE cols TEXT;
BEGIN
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
      FROM pg_attribute
     WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped
       AND attname <> 'issued_password_enc';
    EXECUTE format('GRANT SELECT (%s) ON users TO app_api', cols);
END $$;

-- Odam o'z parolini qo'ysa, SMS bilan kirsa yoki parol olib tashlansa — berilgan parol izi qolmaydi
CREATE FUNCTION app.clear_issued_password() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT NEW.must_change_password OR NEW.password_hash IS NULL THEN
        NEW.issued_password_enc := NULL;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER users_clear_issued_password BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION app.clear_issued_password();

-- Parol berish: endi shifrlangan nusxa ham (ixtiyoriy) saqlanadi
DROP FUNCTION app.set_member_password(BIGINT, BIGINT, TEXT);
CREATE FUNCTION app.set_member_password(p_business BIGINT, p_member BIGINT, p_hash TEXT, p_enc TEXT DEFAULT NULL)
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
       SET password_hash = p_hash, must_change_password = TRUE, password_changed_at = now(),
           issued_password_enc = p_enc,
           failed_login_attempts = 0, locked_until = NULL, token_version = token_version + 1
     WHERE id = v_user;
    UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id)
    VALUES (p_business, app.uid(), 'password_set', 'member', p_member);
END $$;

-- Berilgan parolni ko'rish: parol berishga huquqi borlar uchun. Har bir ko'rish jurnalga yoziladi.
CREATE FUNCTION app.issued_password(p_business BIGINT, p_member BIGINT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_reason TEXT := app.password_block_reason(p_business, p_member);
    v_enc    TEXT;
BEGIN
    IF v_reason = 'not_found' THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    ELSIF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    SELECT u.issued_password_enc INTO v_enc
      FROM business_members m JOIN users u ON u.id = m.user_id WHERE m.id = p_member;
    IF v_enc IS NOT NULL THEN
        INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id)
        VALUES (p_business, app.uid(), 'password_viewed', 'member', p_member);
    END IF;
    RETURN v_enc;
END $$;

REVOKE ALL ON FUNCTION app.set_member_password(BIGINT, BIGINT, TEXT, TEXT), app.issued_password(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_member_password(BIGINT, BIGINT, TEXT, TEXT), app.issued_password(BIGINT, BIGINT) TO app_api;
