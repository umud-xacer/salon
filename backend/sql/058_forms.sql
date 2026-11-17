-- 3-bosqich, 1-modul: anketalar va mijoz/bemor kartalari.
--
-- * form_templates / form_fields — muassasa o'z anketalarini quradi (stomatologiya kartasi, kosmetologik
--   protsedura oldi, SPA salomatlik so'rovnomasi). Maydon turlari: text, textarea, radio, checkbox, boolean,
--   date, number, file. Har maydon majburiy/ixtiyoriy; "xavfli javob" (alert_values) — shu javob tanlansa
--   mijoz kartasida va kalendarda qizil ogohlantirish chiqadi (alert_label, masalan "Allergiya: penitsillin").
-- * client_form_submissions — to'ldirilgan anketa. Shablon keyin o'zgarsa ham eski javob buzilmasin:
--   maydonlar surati (fields) javob bilan birga saqlanadi. Ogohlantirishlar bazada hisoblanadi (trigger).
-- * client_files — rentgen, tahlil, "oldin/keyin" rasmlari va imzo. Tibbiy ma'lumot ochiq /media ga
--   qo'yilmaydi: bazada (RLS ostida) saqlanadi va faqat token bilan API orqali beriladi.
-- * Huquq: shablonlar — direktor ('business.manage'); anketa va fayllar — mijozlar bazasi ('clients.view').
--   Ogohlantirishlar bron ustasiga ham app.client_flags orqali ko'rinadi (050 dagi qoida).

CREATE TABLE form_templates (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id        BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title              VARCHAR(120) NOT NULL CHECK (length(btrim(title)) >= 2),
    description        VARCHAR(1000),
    is_active          BOOLEAN NOT NULL DEFAULT true,
    require_signature  BOOLEAN NOT NULL DEFAULT false,
    sort_order         SMALLINT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, id)
);

CREATE TABLE form_fields (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id   BIGINT NOT NULL,
    template_id   BIGINT NOT NULL,
    sort_order    SMALLINT NOT NULL DEFAULT 0,
    label         VARCHAR(300) NOT NULL CHECK (length(btrim(label)) >= 2),
    help          VARCHAR(300),
    type          VARCHAR(10) NOT NULL CHECK (type IN ('text', 'textarea', 'radio', 'checkbox', 'boolean', 'date', 'number', 'file')),
    options       TEXT[] NOT NULL DEFAULT '{}',          -- radio/checkbox variantlari
    required      BOOLEAN NOT NULL DEFAULT false,
    alert_values  TEXT[] NOT NULL DEFAULT '{}',          -- shu javob(lar) ogohlantirish: boolean uchun {'true'}
    alert_label   VARCHAR(80),                            -- badge matni ("Allergiya", "Qandli diabet")
    FOREIGN KEY (business_id, template_id) REFERENCES form_templates (business_id, id) ON DELETE CASCADE,
    CHECK (type NOT IN ('radio', 'checkbox') OR cardinality(options) BETWEEN 1 AND 30),
    CHECK (cardinality(alert_values) = 0 OR alert_label IS NOT NULL)
);
CREATE INDEX ON form_fields (template_id, sort_order);

CREATE TABLE client_form_submissions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL,
    client_id       BIGINT NOT NULL,
    template_id     BIGINT,
    title           VARCHAR(120) NOT NULL,                -- shablon nomi (surat)
    fields          JSONB NOT NULL,                       -- maydonlar surati: [{id,label,type,options,alert_values,alert_label}]
    answers         JSONB NOT NULL DEFAULT '{}',          -- {"<field_id>": qiymat}
    alerts          TEXT[] NOT NULL DEFAULT '{}',         -- hisoblangan ogohlantirishlar (trigger)
    appointment_id  BIGINT,
    signature_file  BIGINT,                               -- client_files.id (imzo rasmi)
    signed_at       TIMESTAMPTZ,
    filled_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, id),
    FOREIGN KEY (business_id, client_id) REFERENCES business_clients (business_id, id) ON DELETE CASCADE,
    FOREIGN KEY (business_id, template_id) REFERENCES form_templates (business_id, id) ON DELETE SET NULL (template_id),
    FOREIGN KEY (business_id, appointment_id) REFERENCES appointments (business_id, id) ON DELETE SET NULL (appointment_id),
    CHECK (jsonb_typeof(answers) = 'object' AND jsonb_typeof(fields) = 'array')
);
CREATE INDEX ON client_form_submissions (client_id, created_at DESC);

CREATE TABLE client_files (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id     BIGINT NOT NULL,
    client_id       BIGINT NOT NULL,
    submission_id   BIGINT,
    appointment_id  BIGINT,
    kind            VARCHAR(10) NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo', 'signature')),
    caption         VARCHAR(200),
    mime            VARCHAR(40) NOT NULL CHECK (mime IN ('image/webp', 'image/png')),
    content         BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 3000000),
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, id),
    FOREIGN KEY (business_id, client_id) REFERENCES business_clients (business_id, id) ON DELETE CASCADE,
    FOREIGN KEY (business_id, submission_id) REFERENCES client_form_submissions (business_id, id) ON DELETE CASCADE,
    FOREIGN KEY (business_id, appointment_id) REFERENCES appointments (business_id, id) ON DELETE SET NULL (appointment_id)
);
CREATE INDEX ON client_files (client_id, created_at DESC);
ALTER TABLE client_form_submissions
    ADD FOREIGN KEY (business_id, signature_file) REFERENCES client_files (business_id, id) ON DELETE SET NULL (signature_file);

-- ─── Xavfsizlik ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_files ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON form_templates, form_fields TO app_api;
GRANT SELECT, INSERT, DELETE ON client_form_submissions, client_files TO app_api;
GRANT UPDATE (signature_file, signed_at) ON client_form_submissions TO app_api;

-- Shablonni anketa to'ldiradiganlar o'qiydi, direktor tahrirlaydi
CREATE POLICY read ON form_templates FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'clients.view') OR app.has_perm(business_id, 'business.manage'));
CREATE POLICY manage ON form_templates FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));
CREATE POLICY read ON form_fields FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'clients.view') OR app.has_perm(business_id, 'business.manage'));
CREATE POLICY manage ON form_fields FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));
CREATE POLICY clients ON client_form_submissions FOR ALL TO app_api
    USING (app.has_perm(business_id, 'clients.view')) WITH CHECK (app.has_perm(business_id, 'clients.view'));
CREATE POLICY clients ON client_files FOR ALL TO app_api
    USING (app.has_perm(business_id, 'clients.view')) WITH CHECK (app.has_perm(business_id, 'clients.view'));

-- Javob o'zgarmaydi (tibbiy hujjat): faqat imzo qo'shiladi; muallif va vaqt bazada qo'yiladi
CREATE FUNCTION app.form_submission_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    f      JSONB;
    v      JSONB;
    v_out  TEXT[] := '{}';
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.answers <> OLD.answers OR NEW.fields <> OLD.fields OR NEW.client_id <> OLD.client_id
           OR NEW.business_id <> OLD.business_id OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'submission_immutable' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;
    NEW.filled_by := app.uid();
    NEW.created_at := now();
    -- Ogohlantirishlar: xavfli javob tanlangan maydonlar
    FOR f IN SELECT * FROM jsonb_array_elements(NEW.fields) LOOP
        CONTINUE WHEN coalesce(jsonb_array_length(f -> 'alert_values'), 0) = 0;
        v := NEW.answers -> (f ->> 'id');
        CONTINUE WHEN v IS NULL OR v = 'null'::jsonb;
        IF (jsonb_typeof(v) = 'array' AND EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(v) a(x)
                 WHERE a.x IN (SELECT jsonb_array_elements_text(f -> 'alert_values'))))
           OR (jsonb_typeof(v) <> 'array' AND (v #>> '{}') IN (SELECT jsonb_array_elements_text(f -> 'alert_values'))) THEN
            v_out := v_out || (f ->> 'alert_label');
        END IF;
    END LOOP;
    NEW.alerts := v_out;
    RETURN NEW;
END $$;
CREATE TRIGGER form_submission_guard BEFORE INSERT OR UPDATE ON client_form_submissions
    FOR EACH ROW EXECUTE FUNCTION app.form_submission_guard();

CREATE FUNCTION app.client_file_stamp() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.created_by := app.uid();
    NEW.created_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER client_file_stamp BEFORE INSERT ON client_files FOR EACH ROW EXECUTE FUNCTION app.client_file_stamp();

-- ─── Mijoz ogohlantirishlari: kartochkadagi + har shablonning OXIRGI anketasidagi ──────────────────
-- SECURITY INVOKER: ilovadan chaqirilsa RLS ishlaydi (faqat 'clients.view'); client_flags (DEFINER) ichida — to'liq
CREATE FUNCTION app.client_medical_alerts(p_client BIGINT) RETURNS TEXT[]
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT coalesce(array_agg(DISTINCT a ORDER BY a), '{}')
      FROM (SELECT DISTINCT ON (coalesce(s.template_id, -s.id)) s.alerts
              FROM client_form_submissions s WHERE s.client_id = p_client
             ORDER BY coalesce(s.template_id, -s.id), s.created_at DESC) last, unnest(last.alerts) a
$$;
REVOKE ALL ON FUNCTION app.client_medical_alerts(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.client_medical_alerts(BIGINT) TO app_api;

-- Bron oynasi/kalendar: avvalgi alert/allergies + anketa ogohlantirishlari ('medical')
CREATE OR REPLACE FUNCTION app.client_flags(p_appointment BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT nullif(jsonb_strip_nulls(jsonb_build_object(
               'alert', ci.alert, 'allergies', ci.allergies,
               'medical', CASE WHEN cardinality(m.alerts) > 0 THEN to_jsonb(m.alerts) END)), '{}'::jsonb)
      FROM appointments a
      LEFT JOIN client_internal ci ON ci.client_id = a.client_id
      CROSS JOIN LATERAL (SELECT app.client_medical_alerts(a.client_id) AS alerts) m
     WHERE a.id = p_appointment
       AND (app.has_perm(a.business_id, 'clients.view')
            OR (a.member_id = ANY (app.my_member_ids()) AND app.has_perm(a.business_id, 'appointments.view_own')))
$$;
