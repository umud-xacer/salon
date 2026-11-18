-- Sayt sozlamalari (2026-11-18): chronix.uz pastki qismidagi (footer) havolalar va kontaktlar Super Admin panelidan
-- boshqariladi. Bitta qator (id = 1). Bo'sh havola — saytda ko'rsatilmaydi.
CREATE TABLE site_settings (
    id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    telegram_url    VARCHAR(300) NOT NULL DEFAULT '',
    instagram_url   VARCHAR(300) NOT NULL DEFAULT '',
    youtube_url     VARCHAR(300) NOT NULL DEFAULT '',
    play_url        VARCHAR(300) NOT NULL DEFAULT '',
    appstore_url    VARCHAR(300) NOT NULL DEFAULT '',
    phone           VARCHAR(32)  NOT NULL DEFAULT '',
    email           VARCHAR(120) NOT NULL DEFAULT '',
    address_uz      VARCHAR(300) NOT NULL DEFAULT '',
    address_ru      VARCHAR(300) NOT NULL DEFAULT '',
    work_hours_uz   VARCHAR(120) NOT NULL DEFAULT '',
    work_hours_ru   VARCHAR(120) NOT NULL DEFAULT '',
    about_uz        VARCHAR(400) NOT NULL DEFAULT '',
    about_ru        VARCHAR(400) NOT NULL DEFAULT '',
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Havolalar faqat https:// (javascript: va boshqa sxemalar o'tmaydi)
    CONSTRAINT site_links_https CHECK (
        (telegram_url = '' OR telegram_url ~ '^https://[^\s<>"]+$') AND
        (instagram_url = '' OR instagram_url ~ '^https://[^\s<>"]+$') AND
        (youtube_url = '' OR youtube_url ~ '^https://[^\s<>"]+$') AND
        (play_url = '' OR play_url ~ '^https://[^\s<>"]+$') AND
        (appstore_url = '' OR appstore_url ~ '^https://[^\s<>"]+$')),
    CONSTRAINT site_phone_ok CHECK (phone = '' OR phone ~ '^\+[0-9 ()-]{7,30}$'),
    CONSTRAINT site_email_ok CHECK (email = '' OR email ~ '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$')
);
INSERT INTO site_settings (telegram_url, phone) VALUES ('https://t.me/JabborqulovUmidjon', '+998 20 003 55 99');

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON site_settings TO app_api;
-- O'qish — hamma (sayt ochiq ma'lumoti), o'zgartirish — faqat Super Admin
CREATE POLICY read_all ON site_settings FOR SELECT TO app_api USING (TRUE);
CREATE POLICY superadmin_update ON site_settings FOR UPDATE TO app_api
    USING (app.is_superadmin()) WITH CHECK (app.is_superadmin());
