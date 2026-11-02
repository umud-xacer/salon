-- Bir vaqtdagi chiqimlarda deadlock bo'lmasin: tashqi kalit tekshiruvi mahsulot qatoriga yengil qulf oladi,
-- apply_stock_movement esa keyin uni kuchaytirardi va ikki tranzaksiya bir-birini kutib qolardi.
-- Endi qator harakat yozilishidan oldin darhol kuchli qulf bilan olinadi.
CREATE FUNCTION app.lock_stock_product(p_business BIGINT, p_product BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT 1 FROM products WHERE id = p_product AND business_id = p_business FOR UPDATE
$$;
REVOKE ALL ON FUNCTION app.lock_stock_product(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lock_stock_product(BIGINT, BIGINT) TO app_api;

CREATE OR REPLACE FUNCTION app.guard_stock_movements() RETURNS TRIGGER
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

    PERFORM app.lock_stock_product(NEW.business_id, NEW.product_id);

    NEW.created_by := app.uid();
    NEW.created_at := now();
    RETURN NEW;
END $$;
