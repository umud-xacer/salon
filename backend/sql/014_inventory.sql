-- Ombor: mahsulotlar, harakatlar himoyasi, kam qolganda ogohlantirish.
-- Qoldiq faqat stock_movements orqali o'zgaradi. Qoidalar bazada: ilovadagi xato ularni aylanib o'ta olmaydi.

-- Tarixi bor mahsulot o'chirilmaydi, faqat yashiriladi
REVOKE DELETE ON products FROM app_api;

ALTER TABLE products
    ADD CONSTRAINT product_name_len CHECK (char_length(trim(name)) >= 2),
    ADD CONSTRAINT product_unit_len CHECK (char_length(trim(unit)) >= 1);
ALTER TABLE stock_movements ADD CONSTRAINT stock_note_len CHECK (char_length(note) <= 500);
CREATE UNIQUE INDEX product_name_uq ON products (business_id, lower(name));
CREATE INDEX stock_movements_recent ON stock_movements (business_id, created_at DESC);

-- Yangi mahsulot noldan boshlanadi: boshlang'ich qoldiq ham harakat sifatida yoziladi
CREATE OR REPLACE FUNCTION app.guard_products() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT app.is_app_role() THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.current_qty <> 0 THEN
            RAISE EXCEPTION 'use_stock_movements' USING ERRCODE = '42501';
        END IF;
    ELSIF NEW.current_qty IS DISTINCT FROM OLD.current_qty OR NEW.business_id <> OLD.business_id THEN
        RAISE EXCEPTION 'use_stock_movements' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER guard_products ON products;
CREATE TRIGGER guard_products BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION app.guard_products();

-- Harakat turi miqdor belgisiga mos bo'lishi shart. Muallif va vaqtni ilova bera olmaydi.
-- Ustaning usage yozuvi has_perm dan o'tmaydi, shuning uchun modul va obuna shu yerda tekshiriladi.
CREATE FUNCTION app.guard_stock_movements() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF app.is_app_role() AND NOT app.is_superadmin()
       AND NOT (app.module_enabled(NEW.business_id, 'inventory') AND app.business_operational(NEW.business_id)) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;

    IF (NEW.type = 'purchase' AND NEW.qty < 0)
       OR (NEW.type IN ('sale', 'usage', 'to_staff', 'write_off') AND NEW.qty > 0) THEN
        RAISE EXCEPTION 'invalid_stock_sign' USING ERRCODE = '23514';
    END IF;
    IF NEW.type = 'to_staff' AND NEW.member_id IS NULL THEN
        RAISE EXCEPTION 'member_required' USING ERRCODE = '23514';
    END IF;
    IF NEW.type <> 'purchase' THEN
        NEW.unit_cost := NULL;
    END IF;

    NEW.created_by := app.uid();
    NEW.created_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER guard_stock_movements BEFORE INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION app.guard_stock_movements();

-- Mahsulot qatori qulflanadi: bir vaqtdagi chiqimlar qoldiqni manfiy qilmaydi.
-- Ogohlantirish faqat chegaradan o'tganda yuboriladi, har chiqimda emas.
CREATE OR REPLACE FUNCTION app.apply_stock_movement() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    p     RECORD;
    v_new NUMERIC(12,3);
BEGIN
    SELECT name, unit, current_qty, min_qty, is_active INTO p
      FROM products WHERE id = NEW.product_id AND business_id = NEW.business_id FOR UPDATE;
    IF NOT p.is_active THEN
        RAISE EXCEPTION 'product_inactive' USING ERRCODE = 'P0415';
    END IF;

    v_new := p.current_qty + NEW.qty;
    IF v_new < 0 THEN
        RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0414';
    END IF;
    UPDATE products SET current_qty = v_new WHERE id = NEW.product_id;

    IF p.min_qty > 0 AND p.current_qty > p.min_qty AND v_new <= p.min_qty THEN
        INSERT INTO notifications (user_id, business_id, type, title, body, data)
        SELECT m.user_id, NEW.business_id, 'low_stock', 'Mahsulot kam qoldi',
               p.name || ': ' || trim_scale(v_new)::text || ' ' || p.unit,
               jsonb_build_object('product_id', NEW.product_id)
          FROM business_members m
         WHERE m.business_id = NEW.business_id AND m.is_active
           AND coalesce(
                 (SELECT mp.granted FROM member_permissions mp
                   WHERE mp.member_id = m.id AND mp.permission_code = 'inventory.manage'),
                 EXISTS (SELECT 1 FROM role_permissions rp
                          WHERE rp.role = m.role AND rp.permission_code = 'inventory.manage'));
    END IF;
    RETURN NEW;
END $$;
