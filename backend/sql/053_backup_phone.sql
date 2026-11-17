-- Mijozning zaxira telefoni va asosiy raqamni davriy tasdiqlash.
--
-- * backup_phone — asosiy raqam o'chib qolsa yoki javob bermasa, salon shu raqamga qo'ng'iroq qiladi
--   (ro'yxatdan o'tishda so'raladi, profilda o'zgartiriladi). Kirish uchun ishlatilmaydi.
-- * phone_confirmed_at — mijoz "raqamim hamon shu" deb oxirgi marta qachon tasdiqlagan. Ilova bron
--   oldidan, oxirgi tasdiqdan 7 kun o'tgan bo'lsa, so'raydi (no-show va bog'lana olmaslikning oldini olish).

ALTER TABLE users
    ADD COLUMN backup_phone       VARCHAR(13) CHECK (backup_phone ~ '^\+998[0-9]{9}$'),
    ADD COLUMN phone_confirmed_at TIMESTAMPTZ,
    ADD CONSTRAINT backup_phone_differs CHECK (backup_phone IS NULL OR backup_phone <> phone);

-- Foydalanuvchi o'zinikini o'qiydi va o'zgartiradi (self_read / self_update siyosatlari allaqachon bor)
GRANT SELECT (backup_phone, phone_confirmed_at) ON users TO app_api;
GRANT UPDATE (backup_phone, phone_confirmed_at) ON users TO app_api;

-- Salon uchun: mijozning zaxira raqami — faqat 'clients.view' huquqi borlarga (asosiy raqam bilan bir xil qoida)
CREATE FUNCTION app.client_backup_phone(p_client BIGINT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT u.backup_phone::text
      FROM business_clients c JOIN users u ON u.id = c.user_id
     WHERE c.id = p_client AND app.has_perm(c.business_id, 'clients.view')
$$;
REVOKE ALL ON FUNCTION app.client_backup_phone(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.client_backup_phone(BIGINT) TO app_api;
