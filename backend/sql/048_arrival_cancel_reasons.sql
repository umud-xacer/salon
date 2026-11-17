-- "Mijoz keldi" belgisi va bekor qilish sabablari ro'yxati (Fresha tahlili, 1-bosqich).
--
-- "Mijoz keldi" alohida holat emas, balki appointments.checked_in_at belgisi: bron hamon faol
-- (pending/confirmed), shuning uchun band vaqt, ikki marta yozishni taqiqlash va eslatmalar
-- o'zgarmaydi. Keldi deb belgilangan 'pending' bron avtomatik 'confirmed' bo'ladi —
-- aks holda 030 dagi "salon tasdiqlamadi" avtomatik bekor qilish uni o'chirib yuborardi.

-- ─── Mijoz keldi ─────────────────────────────────────────────────────────────────────────────
-- Kim belgilaydi: 'appointments.manage' huquqi borlar (qabulxona, menejer, ega) yoki bron
-- o'ziniki bo'lgan usta. p_arrived = false — belgini olib tashlash (xato bosilgan bo'lsa).
CREATE FUNCTION app.mark_arrived(p_business BIGINT, p_id BIGINT, p_arrived BOOLEAN DEFAULT TRUE) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v appointments%ROWTYPE;
BEGIN
    SELECT * INTO v FROM appointments WHERE id = p_id AND business_id = p_business FOR UPDATE;
    IF NOT FOUND OR NOT (app.has_perm(p_business, 'appointments.manage')
                         OR (app.has_perm(p_business, 'appointments.view_own')
                             AND v.member_id = app.my_member_in(p_business))) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v.status NOT IN ('pending', 'confirmed') THEN
        RAISE EXCEPTION 'not_changeable' USING ERRCODE = 'P0409';
    END IF;

    UPDATE appointments
       SET checked_in_at = CASE WHEN p_arrived THEN coalesce(checked_in_at, now()) END,
           status        = CASE WHEN p_arrived THEN 'confirmed'::appointment_status ELSE status END,
           updated_at    = now()
     WHERE id = p_id;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (p_business, app.uid(), CASE WHEN p_arrived THEN 'arrived' ELSE 'arrived_undo' END,
            'appointment', p_id, NULL);
END $$;

REVOKE ALL ON FUNCTION app.mark_arrived(BIGINT, BIGINT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_arrived(BIGINT, BIGINT, BOOLEAN) TO app_api;

-- ─── Bekor qilish sabablari ──────────────────────────────────────────────────────────────────
-- Muassasa o'z ro'yxatini yuritadi (Sozlamalar). Bron bekor qilinganda tanlangan sabab matni
-- appointments.cancel_reason ga yoziladi — sabab keyin o'chirilsa ham tarix buzilmaydi.
CREATE TABLE cancel_reasons (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
    sort_order  SMALLINT NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 999),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, name)
);
CREATE INDEX ON cancel_reasons (business_id, sort_order, id);

ALTER TABLE cancel_reasons ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON cancel_reasons TO app_api;

-- Ro'yxatni bron bekor qila oladiganlar ko'radi; tahrirlash — faqat 'business.manage'
CREATE POLICY read ON cancel_reasons FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'appointments.manage') OR app.has_perm(business_id, 'business.manage'));
CREATE POLICY manage ON cancel_reasons FOR ALL TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));

CREATE FUNCTION app.normalize_cancel_reason() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.name := regexp_replace(btrim(NEW.name), '\s+', ' ', 'g');
    IF TG_OP = 'UPDATE' AND NEW.business_id <> OLD.business_id THEN
        RAISE EXCEPTION 'business_id_immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER normalize_cancel_reason BEFORE INSERT OR UPDATE ON cancel_reasons
    FOR EACH ROW EXECUTE FUNCTION app.normalize_cancel_reason();

-- Har yangi muassasaga standart ro'yxat (salon keyin o'zgartiradi)
CREATE FUNCTION app.seed_cancel_reasons(p_business BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    INSERT INTO cancel_reasons (business_id, name, sort_order)
    SELECT p_business, x.name, x.ord
      FROM (VALUES ('Mijozning rejasi o''zgardi', 10), ('Mijoz kasal bo''lib qoldi', 20),
                   ('Usta ishga chiqmadi', 30), ('Xato yozilgan', 40), ('Boshqa sabab', 50)) AS x(name, ord)
    ON CONFLICT (business_id, name) DO NOTHING
$$;
REVOKE ALL ON FUNCTION app.seed_cancel_reasons(BIGINT) FROM PUBLIC;

CREATE FUNCTION app.businesses_seed_defaults() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM app.seed_cancel_reasons(NEW.id);
    RETURN NEW;
END $$;
CREATE TRIGGER businesses_seed_defaults AFTER INSERT ON businesses
    FOR EACH ROW EXECUTE FUNCTION app.businesses_seed_defaults();

SELECT app.seed_cancel_reasons(id) FROM businesses;
