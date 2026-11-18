-- Xalqaro telefon raqamlar (2026-11-18): Rossiya, Qozog'iston va boshqa davlat fuqarolari ham kira olsin.
--   O'zbekiston: +998 va 9 raqam (avvalgidek qat'iy).
--   Boshqa davlatlar: E.164 — "+", mamlakat kodi 1-9 bilan boshlanadi, jami 10–15 raqam (masalan +79161234567).
-- Eski "faqat +998" cheklovlari olib tashlanadi, ustunlar 16 belgigacha kengaytiriladi.
CREATE FUNCTION app.phone_ok(p TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT p ~ '^\+(998[0-9]{9}|(?!998)[1-9][0-9]{9,14})$'
$$;
GRANT EXECUTE ON FUNCTION app.phone_ok(TEXT) TO PUBLIC;

DO $$
DECLARE
    col RECORD;
    con RECORD;
BEGIN
    FOR col IN SELECT * FROM (VALUES ('users', 'phone'), ('users', 'backup_phone'), ('otp_codes', 'phone'),
                                     ('businesses', 'phone'), ('business_clients', 'phone'),
                                     ('telegram_logins', 'phone')) v(tbl, cname)
    LOOP
        FOR con IN
            SELECT c.conname FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
             WHERE t.relname = col.tbl AND a.attname = col.cname AND c.contype = 'c'
               AND pg_get_constraintdef(c.oid) LIKE '%998%'
        LOOP
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', col.tbl, con.conname);
        END LOOP;
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE VARCHAR(16)', col.tbl, col.cname);
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (app.phone_ok(%I))',
                       col.tbl, col.tbl || '_' || col.cname || '_e164', col.cname);
    END LOOP;
END $$;
