-- ════════════════════════════════════════════════════════════════════════════
--  P1.2 — Katalog: ochiq ma'lumotlar va qo'shimcha cheklovlar
-- ════════════════════════════════════════════════════════════════════════════

-- Xodimlarning OCHIQ profili (mijoz ilovasi uchun).
-- users jadvali RLS bilan yopiq (telefon va boshqa shaxsiy ma'lumotlar). Bu ko'rinish faqat
-- xavfsiz ustunlarni va faqat faol, ochiq biznesdagi, bron qilsa bo'ladigan xodimlarni beradi.
-- Ko'rinish egasining huquqi bilan ishlaydi; security_barrier — filtrlarni chetlab o'tishga
-- urinuvchi funksiyalar (leaky functions) yopiq qatorlarni ko'ra olmaydi.
CREATE VIEW public_staff WITH (security_barrier = true) AS
SELECT m.id          AS member_id,
       m.business_id,
       u.full_name,
       m.title,
       m.bio,
       m.photo_url,
       m.rating_avg,
       m.rating_count
  FROM business_members m
  JOIN users u      ON u.id = m.user_id     AND u.status = 'active'
  JOIN businesses b ON b.id = m.business_id AND b.status = 'active' AND b.is_listed
 WHERE m.is_active AND m.is_bookable;

REVOKE ALL ON public_staff FROM PUBLIC;
GRANT SELECT ON public_staff TO app_api;

-- Havolalar faqat https:// — admin panelda `javascript:` / `data:` orqali XSS bo'lmasin
ALTER TABLE businesses       ADD CONSTRAINT logo_url_https   CHECK (logo_url  ~ '^https://[^\s<>"]+$'),
                             ADD CONSTRAINT cover_url_https  CHECK (cover_url ~ '^https://[^\s<>"]+$'),
                             ADD CONSTRAINT description_len  CHECK (length(description) <= 3000),
                             ADD CONSTRAINT address_len      CHECK (length(address) <= 300);
ALTER TABLE business_photos  ADD CONSTRAINT url_https        CHECK (url ~ '^https://[^\s<>"]+$');
ALTER TABLE business_members ADD CONSTRAINT photo_url_https  CHECK (photo_url ~ '^https://[^\s<>"]+$');
ALTER TABLE users            ADD CONSTRAINT avatar_url_https CHECK (avatar_url ~ '^https://[^\s<>"]+$');

-- Narx va nomlarga oqilona chegaralar (xato kiritish / to'lib ketishdan himoya)
ALTER TABLE services ADD CONSTRAINT price_max       CHECK (price <= 100000000),     -- 100 mln so'm
                     ADD CONSTRAINT description_len CHECK (length(description) <= 2000);
ALTER TABLE member_services ADD CONSTRAINT custom_price_max CHECK (custom_price <= 100000000);
ALTER TABLE service_categories ADD CONSTRAINT name_not_blank CHECK (length(trim(name)) > 0),
                               ADD CONSTRAINT unique_name UNIQUE (business_id, name);

-- Bitta biznesda rasmlar soni cheklangan
CREATE FUNCTION app.limit_business_photos() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF (SELECT count(*) FROM business_photos WHERE business_id = NEW.business_id) >= 20 THEN
        RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER limit_business_photos BEFORE INSERT ON business_photos
    FOR EACH ROW EXECUTE FUNCTION app.limit_business_photos();

-- Katalog tezligi uchun
CREATE INDEX businesses_public_idx ON businesses (category_id) WHERE status = 'active' AND is_listed;
CREATE INDEX ON member_services (business_id);
