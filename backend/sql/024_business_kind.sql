-- Muassasa turiga qarab ish tartibi (TZ 5-band):
--   salon    — ustalar, xizmatlar, vaqtga bron (go'zallik saloni, barber, SPA, boshqalar)
--   pharmacy — farmatsevtlar, dorilar katalogi (narx, shtrix-kod, qoldiq holati) mijoz ilovasida
--   clinic   — shifokorlar mutaxassislik bo'yicha, bemorlar qabuli (klinika, stomatologiya)
ALTER TABLE business_categories
    ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'salon' CHECK (kind IN ('salon', 'pharmacy', 'clinic'));
UPDATE business_categories SET kind = 'pharmacy' WHERE slug = 'pharmacy';
UPDATE business_categories SET kind = 'clinic'   WHERE slug IN ('clinic', 'dental');

-- Mahsulot (dori) kategoriyasi va shtrix-kodi
ALTER TABLE products
    ADD COLUMN category VARCHAR(80) CHECK (char_length(trim(category)) BETWEEN 1 AND 80),
    ADD COLUMN barcode  VARCHAR(64) CHECK (barcode ~ '^[0-9A-Za-z-]{4,64}$');
CREATE UNIQUE INDEX products_business_barcode_key ON products (business_id, barcode) WHERE barcode IS NOT NULL;

-- Mijoz ilovasi uchun dorixona katalogi. Faqat xavfsiz ustunlar: tannarx va aniq qoldiq chiqmaydi,
-- holat — 'in' (bor), 'low' (kam qoldi), 'out' (tugagan). Faqat ochiq, faol dorixona va yoqilgan ombor moduli.
CREATE FUNCTION app.public_products(p_slug TEXT, p_q TEXT, p_category TEXT, p_limit INT, p_offset INT)
RETURNS TABLE (id BIGINT, name TEXT, category TEXT, unit TEXT, price BIGINT, stock TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT p.id, p.name::text, p.category::text, p.unit::text, p.sale_price,
           CASE WHEN p.current_qty <= 0 THEN 'out'
                WHEN p.min_qty > 0 AND p.current_qty <= p.min_qty THEN 'low' ELSE 'in' END
      FROM products p
      JOIN businesses b ON b.id = p.business_id
      JOIN business_categories c ON c.id = b.category_id
     WHERE b.slug = p_slug AND b.status = 'active' AND b.is_listed AND c.is_active AND c.kind = 'pharmacy'
       AND app.business_operational(b.id) AND app.module_enabled(b.id, 'inventory')
       AND p.is_active AND p.sale_price > 0
       AND (p_category IS NULL OR p.category = p_category)
       AND (p_q IS NULL OR p.name ILIKE '%' || p_q || '%' ESCAPE '\' OR p.barcode = p_q)
     ORDER BY (p.current_qty <= 0), p.name, p.id
     LIMIT least(greatest(p_limit, 1), 100) OFFSET greatest(p_offset, 0);
$$;

CREATE FUNCTION app.public_product_categories(p_slug TEXT) RETURNS TABLE (category TEXT, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT p.category::text, count(*)
      FROM products p
      JOIN businesses b ON b.id = p.business_id
      JOIN business_categories c ON c.id = b.category_id
     WHERE b.slug = p_slug AND b.status = 'active' AND b.is_listed AND c.is_active AND c.kind = 'pharmacy'
       AND app.business_operational(b.id) AND app.module_enabled(b.id, 'inventory')
       AND p.is_active AND p.sale_price > 0 AND p.category IS NOT NULL
     GROUP BY p.category ORDER BY p.category;
$$;

-- Dorixona ilovada ko'rinishi uchun: xizmat yoki katalogdagi mahsulot bo'lishi kifoya
CREATE FUNCTION app.has_public_offer(p_business BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM services s WHERE s.business_id = p_business AND s.is_active)
        OR EXISTS (SELECT 1 FROM products p
                     JOIN businesses b ON b.id = p.business_id
                     JOIN business_categories c ON c.id = b.category_id
                    WHERE p.business_id = p_business AND p.is_active AND p.sale_price > 0
                      AND c.kind = 'pharmacy' AND app.module_enabled(p_business, 'inventory'));
$$;

REVOKE ALL ON FUNCTION app.public_products(TEXT, TEXT, TEXT, INT, INT), app.public_product_categories(TEXT),
                       app.has_public_offer(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_products(TEXT, TEXT, TEXT, INT, INT), app.public_product_categories(TEXT),
                          app.has_public_offer(BIGINT) TO app_api;
