-- Yakka tadbirkor (solo) va jamoaviy rejim.
--
-- Ko'p kichik tadbirkor ishni bitta o'zi boshlaydi: ham direktor, ham yagona usta/shifokor. Yakka rejimda:
--   * direktor avtomatik mutaxassis bo'ladi (is_bookable) va barcha xizmatlar unga biriktiriladi —
--     keyin qo'shilgan xizmatlar ham (trigger);
--   * mijoz ilova/saytda "Usta tanlang" qadamini ko'rmaydi: bron to'g'ridan direktorga yoziladi
--     (app.solo_member — usta ko'rsatilmagan bronda);
--   * kalendar, mijoz kartalari, kassa va tabel — o'sha yagona mutaxassis (direktor) bo'yicha.
-- Rejim o'zi moslashadi: faol, bron qilinadigan xodim qo'shilsa — jamoa; oxirgi shunday xodim olib tashlansa
-- yoki o'chirilsa — yana yakka (direktor qayta yagona mutaxassis). Direktorning o'z qatori hisobga olinmaydi.
-- Jamoa rejimini Super Admin ataylab tanlagan (xodim hali qo'shilmagan) bo'lsa, u o'z-o'zidan yakkaga o'tmaydi.

ALTER TABLE businesses ADD COLUMN is_solo_mode BOOLEAN NOT NULL DEFAULT true;

-- Yakka rejimni qo'llash: direktor — mutaxassis, barcha faol xizmatlar unga
CREATE FUNCTION app.solo_apply(p_business BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_owner BIGINT;
BEGIN
    SELECT id INTO v_owner FROM business_members
     WHERE business_id = p_business AND role = 'owner' AND is_active ORDER BY id LIMIT 1;
    IF v_owner IS NULL THEN
        RETURN;
    END IF;
    UPDATE business_members SET is_bookable = true WHERE id = v_owner AND NOT is_bookable;
    INSERT INTO member_services (business_id, member_id, service_id)
    SELECT p_business, v_owner, s.id FROM services s
     WHERE s.business_id = p_business AND s.is_active
       AND NOT EXISTS (SELECT 1 FROM member_services ms WHERE ms.member_id = v_owner AND ms.service_id = s.id);
END $$;
REVOKE ALL ON FUNCTION app.solo_apply(BIGINT) FROM PUBLIC;

-- Mavjud muassasalar: bron qilinadigan xodimi yo'qlari — yakka (direktor mutaxassis bo'ladi), qolganlari — jamoa
UPDATE businesses b SET is_solo_mode = NOT EXISTS (
    SELECT 1 FROM business_members m
     WHERE m.business_id = b.id AND m.role <> 'owner' AND m.is_active AND m.is_bookable);
SELECT app.solo_apply(id) FROM businesses WHERE is_solo_mode;

-- ─── Avtomatik moslashish ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.solo_on_member_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    r business_members%ROWTYPE := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    v_provider BOOLEAN;
BEGIN
    IF r.role = 'owner' THEN
        RETURN NULL;
    END IF;
    -- Yangi faol mutaxassis — jamoa rejimi
    IF TG_OP <> 'DELETE' AND NEW.is_active AND NEW.is_bookable THEN
        UPDATE businesses SET is_solo_mode = false WHERE id = r.business_id AND is_solo_mode;
        RETURN NULL;
    END IF;
    -- Mutaxassis olib tashlandi/o'chirildi: boshqa mutaxassis qolmasa — yana yakka
    IF TG_OP = 'DELETE' OR (OLD.is_active AND OLD.is_bookable) THEN
        v_provider := EXISTS (SELECT 1 FROM business_members m
                               WHERE m.business_id = r.business_id AND m.role <> 'owner' AND m.is_active AND m.is_bookable
                                 AND m.id <> r.id);
        IF NOT v_provider AND EXISTS (SELECT 1 FROM businesses WHERE id = r.business_id AND NOT is_solo_mode) THEN
            UPDATE businesses SET is_solo_mode = true WHERE id = r.business_id;
            PERFORM app.solo_apply(r.business_id);
        END IF;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER solo_on_member_change AFTER INSERT OR UPDATE OF is_active, is_bookable, role OR DELETE ON business_members
    FOR EACH ROW EXECUTE FUNCTION app.solo_on_member_change();

-- Yakka rejimda yangi xizmat — darhol direktorga
CREATE FUNCTION app.solo_on_service() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.is_active AND EXISTS (SELECT 1 FROM businesses WHERE id = NEW.business_id AND is_solo_mode) THEN
        PERFORM app.solo_apply(NEW.business_id);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER solo_on_service AFTER INSERT OR UPDATE OF is_active ON services
    FOR EACH ROW EXECUTE FUNCTION app.solo_on_service();

-- ─── Bron: usta ko'rsatilmagan bo'lsa — yakka rejimdagi muassasaning direktori ──────────────────────
CREATE FUNCTION app.solo_member(p_service BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT m.id FROM services s
      JOIN businesses b       ON b.id = s.business_id AND b.is_solo_mode
      JOIN business_members m ON m.business_id = b.id AND m.role = 'owner' AND m.is_active AND m.is_bookable
     WHERE s.id = p_service AND s.is_active
     ORDER BY m.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.solo_member(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.solo_member(BIGINT) TO app_api;

-- Super Admin muassasa yaratganda yoki direktor rejimni o'zi tanlaganda (xodimi yo'q bo'lsa)
CREATE FUNCTION app.set_work_mode(p_business BIGINT, p_solo BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT (app.is_superadmin() OR app.has_perm(p_business, 'business.manage')) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    -- Faol mutaxassislar bor muassasani yakkaga o'tkazib bo'lmaydi (ularning bronlari bor)
    IF p_solo AND EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = p_business AND m.role <> 'owner'
                            AND m.is_active AND m.is_bookable) THEN
        RAISE EXCEPTION 'has_staff' USING ERRCODE = 'P0428';
    END IF;
    UPDATE businesses SET is_solo_mode = p_solo WHERE id = p_business;
    IF p_solo THEN
        PERFORM app.solo_apply(p_business);
    END IF;
    RETURN p_solo;
END $$;
REVOKE ALL ON FUNCTION app.set_work_mode(BIGINT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_work_mode(BIGINT, BOOLEAN) TO app_api;
