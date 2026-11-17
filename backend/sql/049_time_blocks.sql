-- Kalendarda vaqtni bloklash (tushlik, tozalash, majlis...) — Fresha tahlili, 1-bosqich.
--
-- Blok — bu staff_time_off qatori, faqat block_type_id to'ldirilgan. Shuning uchun bo'sh vaqtlar
-- hisobi (app.compute_slots) va barcha bron yo'llari (ilova, qabulxona, ko'chirish) uni hech
-- qanday o'zgarishsiz band vaqt deb biladi. block_type_id IS NULL — eski ta'til/dam olish.

CREATE TABLE time_block_types (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
    duration_min SMALLINT NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 720),
    sort_order   SMALLINT NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 999),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, name),
    UNIQUE (business_id, id)
);
CREATE INDEX ON time_block_types (business_id, sort_order, id);

ALTER TABLE time_block_types ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_block_types TO app_api;
CREATE POLICY member_read ON time_block_types FOR SELECT TO app_api
    USING (business_id = ANY (app.my_business_ids()));
CREATE POLICY manage ON time_block_types FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));

CREATE FUNCTION app.normalize_block_type() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.name := regexp_replace(btrim(NEW.name), '\s+', ' ', 'g');
    IF TG_OP = 'UPDATE' AND NEW.business_id <> OLD.business_id THEN
        RAISE EXCEPTION 'business_id_immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER normalize_block_type BEFORE INSERT OR UPDATE ON time_block_types
    FOR EACH ROW EXECUTE FUNCTION app.normalize_block_type();

-- ─── Blok = staff_time_off + tur ─────────────────────────────────────────────────────────────
-- Tur o'chirilsa blok qoladi (vaqt band bo'lib turadi), faqat nomi "reason" da saqlanadi.
ALTER TABLE staff_time_off
    ADD COLUMN block_type_id BIGINT,
    ADD COLUMN created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN is_block      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT time_off_block_type_fk FOREIGN KEY (business_id, block_type_id)
        REFERENCES time_block_types (business_id, id) ON DELETE SET NULL (block_type_id),
    -- Blok kalendardagi qisqa oraliq: bir kundan oshmaydi (ta'til uchun cheklov yo'q)
    ADD CONSTRAINT time_off_block_len CHECK (NOT is_block OR ends_at - starts_at <= INTERVAL '12 hours');
CREATE INDEX ON staff_time_off (business_id, starts_at);

-- Qabulxona (bron yaratadigan) ustaning vaqtini bloklay oladi, lekin ta'til bera olmaydi —
-- ta'til eskicha: 'staff.manage' yoki xodimning o'zi (002_security.sql dagi 'manage' siyosati)
CREATE POLICY reception_blocks ON staff_time_off TO app_api
    USING (is_block AND app.has_perm(business_id, 'appointments.manage'))
    WITH CHECK (is_block AND app.has_perm(business_id, 'appointments.manage'));

-- ─── Standart turlar har yangi muassasaga ────────────────────────────────────────────────────
CREATE FUNCTION app.seed_block_types(p_business BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    INSERT INTO time_block_types (business_id, name, duration_min, sort_order)
    SELECT p_business, x.name, x.dur, x.ord
      FROM (VALUES ('Tushlik', 60, 10), ('Tanaffus', 15, 20), ('Tozalash', 15, 30),
                   ('Majlis', 60, 40), ('Shaxsiy ish', 30, 50)) AS x(name, dur, ord)
    ON CONFLICT (business_id, name) DO NOTHING
$$;
REVOKE ALL ON FUNCTION app.seed_block_types(BIGINT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.businesses_seed_defaults() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM app.seed_cancel_reasons(NEW.id);
    PERFORM app.seed_block_types(NEW.id);
    RETURN NEW;
END $$;

SELECT app.seed_block_types(id) FROM businesses;
