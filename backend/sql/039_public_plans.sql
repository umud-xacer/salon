-- Taqdimot sayti (landing) narxlarni Super Admin "Narxlar" sahifasidan oladi (TZ 2026-11-11).
-- billing_plans jadvali faqat Super Admin'ga ko'rinadi (RLS) va shunday qoladi: ochiq o'qish uchun
-- alohida funksiya faqat FAOL tariflarning nomi va oylik narxini beradi — id, o'chirilgan tariflar,
-- muassasalarning maxsus (kelishilgan) narxlari chiqmaydi.
CREATE FUNCTION app.public_billing_plans()
RETURNS TABLE (name TEXT, name_ru TEXT, monthly_fee BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT p.name::text, p.name_ru::text, p.monthly_fee
      FROM billing_plans p
     WHERE p.is_active
     ORDER BY p.sort_order, p.id
$$;
REVOKE ALL ON FUNCTION app.public_billing_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_billing_plans() TO app_api;
