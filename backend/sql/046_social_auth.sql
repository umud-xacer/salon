-- ════════════════════════════════════════════════════════════════════════════
--  Telegram / Google orqali kirish va hisobni o'chirish (Google Play talabi)
--
--  * telegram_logins — ilova ochgan kirish so'rovi (nonce). Telegram bot foydalanuvchining
--    O'Z kontaktini (raqamini) olgach "ready" bo'ladi, ilova tokenlarni oladi.
--  * user_identities — tashqi hisob (Google) qaysi foydalanuvchiga bog'langan.
--  Ikkala jadval faqat app_auth (kirish jarayoni) uchun; app_api ularni ko'rmaydi.
--
--  * app.delete_my_account() — mijoz o'z hisobini o'chiradi: shaxsiy ma'lumot tozalanadi,
--    raqam bo'shaydi (keyin qayta ro'yxatdan o'tish mumkin), kelgusi bronlar bekor qilinadi.
--    Muassasaning o'z tashrif yozuvlari (business_clients, appointments) ularning hisobida qoladi.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE telegram_logins (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nonce_hash  TEXT        NOT NULL UNIQUE,                  -- SHA-256, nonce'ning o'zi saqlanmaydi
    status      VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'used')),
    tg_user_id  BIGINT,
    tg_chat_id  BIGINT,
    phone       VARCHAR(13) CHECK (phone ~ '^\+998[0-9]{9}$'),
    full_name   VARCHAR(120),
    link_token  TEXT,                                          -- Google bog'lash so'rovi (imzolangan, qisqa muddatli)
    ip          INET,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status = 'pending' OR phone IS NOT NULL)
);
CREATE INDEX ON telegram_logins (tg_user_id, created_at DESC);
CREATE INDEX ON telegram_logins (ip, created_at DESC);

CREATE TABLE user_identities (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'telegram')),
    subject     VARCHAR(255) NOT NULL,
    email       CITEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, subject),
    UNIQUE (user_id, provider)
);

ALTER TABLE telegram_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON telegram_logins, user_identities FROM app_api;
GRANT SELECT, INSERT, UPDATE ON telegram_logins TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_identities TO app_auth;
CREATE POLICY auth_all ON telegram_logins TO app_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON user_identities TO app_auth USING (true) WITH CHECK (true);

-- Bir IP dan juda ko'p kirish so'rovi ochilmasin (otp_codes dagi kabi baza darajasida)
CREATE FUNCTION app.telegram_login_rate_limit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.ip IS NOT NULL AND (SELECT count(*) FROM telegram_logins
                                WHERE ip = NEW.ip AND created_at > now() - interval '10 minutes') >= 20 THEN
        RAISE EXCEPTION 'telegram_rate_limited' USING ERRCODE = 'P0429';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER telegram_login_rate_limit BEFORE INSERT ON telegram_logins
    FOR EACH ROW EXECUTE FUNCTION app.telegram_login_rate_limit();
REVOKE ALL ON FUNCTION app.telegram_login_rate_limit() FROM PUBLIC;


-- ─── Hisobni o'chirish ──────────────────────────────────────────────────────
CREATE FUNCTION app.delete_my_account() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid   BIGINT := app.uid();
    v_phone TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
    SELECT phone INTO v_phone FROM users WHERE id = v_uid AND status <> 'deleted' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0404';
    END IF;
    -- Salon xodimi yoki direktori: hisobi biznesga bog'langan — qo'llab-quvvatlash orqali
    IF EXISTS (SELECT 1 FROM business_members WHERE user_id = v_uid AND is_active)
       OR EXISTS (SELECT 1 FROM users WHERE id = v_uid AND is_superadmin) THEN
        RAISE EXCEPTION 'business_account' USING ERRCODE = 'P0450';
    END IF;

    -- Kelgusi bronlar bekor (salon kutib o'tirmasin)
    UPDATE appointments a
       SET status = 'cancelled', cancel_reason = 'Mijoz hisobini o''chirdi', updated_at = now()
     WHERE a.status IN ('pending', 'confirmed') AND a.starts_at > now()
       AND a.client_id IN (SELECT id FROM business_clients WHERE user_id = v_uid);

    DELETE FROM favorites           WHERE user_id = v_uid;
    DELETE FROM favorite_businesses WHERE user_id = v_uid;
    DELETE FROM notifications       WHERE user_id = v_uid;
    DELETE FROM device_tokens       WHERE user_id = v_uid;
    DELETE FROM refresh_tokens      WHERE user_id = v_uid;
    DELETE FROM user_identities     WHERE user_id = v_uid;
    DELETE FROM otp_codes           WHERE phone = v_phone;
    DELETE FROM telegram_logins     WHERE phone = v_phone;
    UPDATE business_clients SET user_id = NULL WHERE user_id = v_uid;

    -- +9980XXXXXXXX — O'zbekistonda mavjud bo'lmagan "0" prefiks: unikal va haqiqiy raqamni egallamaydi
    UPDATE users
       SET status = 'deleted',
           phone = '+9980' || lpad(v_uid::TEXT, 8, '0'),
           full_name = '', email = NULL, avatar_url = NULL, birth_date = NULL, gender = NULL,
           password_hash = NULL, must_change_password = FALSE, token_version = token_version + 1
     WHERE id = v_uid;
END $$;
REVOKE ALL ON FUNCTION app.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_my_account() TO app_api;
