-- Mijoz kartochkasi: tug'ilgan kun, jins, manba, teglar, ogohlantirish, allergiya, eslatmalar
-- (Fresha tahlili, 1-bosqich).
--
-- business_clients qatorini mijozning o'zi ham o'qiy oladi (self_read siyosati). Shuning uchun
-- salonning ICHKI ma'lumotlari (teglar, ogohlantirish, allergiya, eslatmalar) alohida jadvallarda —
-- ularni faqat 'clients.view' huquqi borlar ko'radi. Usta o'z bronidagi mijozning ogohlantirish va
-- allergiyasini app.client_flags() orqali ko'radi (xavfsizlik uchun muhim: masalan, bo'yoqqa allergiya).

-- ─── Mijozning o'z ma'lumotlari ──────────────────────────────────────────────────────────────
ALTER TABLE business_clients
    ADD COLUMN birth_date DATE CHECK (birth_date >= DATE '1900-01-01'),
    ADD COLUMN gender     TEXT CHECK (gender IN ('male', 'female')),
    -- Qayerdan keldi: marketing samaradorligi uchun (Sozlamalardagi ro'yxat emas — qat'iy kodlar)
    ADD COLUMN source     TEXT CHECK (source IN ('instagram', 'telegram', 'recommendation', 'walk_by',
                                                 'google', 'chronix', 'advert', 'other'));

-- Kelajakdagi tug'ilgan kun — xato kiritilgan (CHECK da current_date ishlatib bo'lmaydi)
CREATE FUNCTION app.check_client_birth_date() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.birth_date > current_date THEN
        RAISE EXCEPTION 'birth_date_in_future' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER check_client_birth_date BEFORE INSERT OR UPDATE OF birth_date ON business_clients
    FOR EACH ROW EXECUTE FUNCTION app.check_client_birth_date();

-- ─── Salonning ichki ma'lumotlari ────────────────────────────────────────────────────────────
CREATE TABLE client_internal (
    client_id   BIGINT PRIMARY KEY,
    business_id BIGINT NOT NULL,
    tags        TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
    alert       TEXT CHECK (length(alert) BETWEEN 1 AND 300),          -- jamoa uchun ogohlantirish
    allergies   TEXT CHECK (length(allergies) BETWEEN 1 AND 500),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (business_id, client_id) REFERENCES business_clients (business_id, id) ON DELETE CASCADE
);
CREATE INDEX ON client_internal USING gin (tags);
CREATE INDEX ON client_internal (business_id);

-- Teglar: bo'sh joylar olinadi, takrorlar (katta-kichik harfdan qat'i nazar) bitta qoladi, har biri 1–30 belgi
CREATE FUNCTION app.normalize_client_internal() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_tag TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id) THEN
        RAISE EXCEPTION 'client_immutable' USING ERRCODE = '42501';
    END IF;
    NEW.tags := coalesce((
        SELECT array_agg(t ORDER BY ord)
          FROM (SELECT DISTINCT ON (lower(t)) t, ord
                  FROM (SELECT regexp_replace(btrim(x), '\s+', ' ', 'g') AS t, ord
                          FROM unnest(NEW.tags) WITH ORDINALITY AS u(x, ord)) s
                 WHERE t <> ''
                 ORDER BY lower(t), ord) d), '{}');
    FOREACH v_tag IN ARRAY NEW.tags LOOP
        IF length(v_tag) > 30 THEN
            RAISE EXCEPTION 'tag_too_long' USING ERRCODE = '23514';
        END IF;
    END LOOP;
    NEW.alert := nullif(btrim(NEW.alert), '');
    NEW.allergies := nullif(btrim(NEW.allergies), '');
    NEW.updated_at := now();
    NEW.updated_by := app.uid();
    RETURN NEW;
END $$;
CREATE TRIGGER normalize_client_internal BEFORE INSERT OR UPDATE ON client_internal
    FOR EACH ROW EXECUTE FUNCTION app.normalize_client_internal();

ALTER TABLE client_internal ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_internal TO app_api;
CREATE POLICY staff_all ON client_internal FOR ALL TO app_api
    USING (app.has_perm(business_id, 'clients.view')) WITH CHECK (app.has_perm(business_id, 'clients.view'));

-- ─── Eslatmalar (vaqt bo'yicha tarix) ────────────────────────────────────────────────────────
-- O'zgartirilmaydi: yangisi yoziladi. O'chirish — muallif yoki 'business.manage'.
CREATE TABLE client_notes (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL,
    client_id   BIGINT NOT NULL,
    body        TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
    created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL DEFAULT app.uid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (business_id, client_id) REFERENCES business_clients (business_id, id) ON DELETE CASCADE
);
CREATE INDEX ON client_notes (client_id, created_at DESC);

ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON client_notes TO app_api;
CREATE POLICY staff_read ON client_notes FOR SELECT TO app_api USING (app.has_perm(business_id, 'clients.view'));
CREATE POLICY staff_add ON client_notes FOR INSERT TO app_api
    WITH CHECK (app.has_perm(business_id, 'clients.view') AND created_by = app.uid());
CREATE POLICY author_delete ON client_notes FOR DELETE TO app_api
    USING (app.has_perm(business_id, 'clients.view')
           AND (created_by = app.uid() OR app.has_perm(business_id, 'business.manage')));

-- Eski bitta "Izoh" maydoni eslatmalar tarixiga ko'chiriladi (ustun mobil API uchun qoladi)
INSERT INTO client_notes (business_id, client_id, body, created_by, created_at)
SELECT business_id, id, left(btrim(notes), 2000), NULL, created_at
  FROM business_clients WHERE nullif(btrim(notes), '') IS NOT NULL;

-- ─── Bron uchun ogohlantirish va allergiya ───────────────────────────────────────────────────
-- Mijozlar bazasi huquqi bor xodim yoki shu bronning ustasi ko'radi; boshqalarga NULL.
CREATE FUNCTION app.client_flags(p_appointment BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object('alert', ci.alert, 'allergies', ci.allergies))
      FROM appointments a
      JOIN client_internal ci ON ci.client_id = a.client_id
     WHERE a.id = p_appointment
       AND (ci.alert IS NOT NULL OR ci.allergies IS NOT NULL)
       AND (app.has_perm(a.business_id, 'clients.view')
            OR (a.member_id = ANY (app.my_member_ids()) AND app.has_perm(a.business_id, 'appointments.view_own')))
$$;
REVOKE ALL ON FUNCTION app.client_flags(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.client_flags(BIGINT) TO app_api;
