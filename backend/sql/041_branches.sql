-- Filiallar (TZ 2026-11-15): bitta brend ostida bir nechta filial.
--   Filial — oddiy `businesses` qatori (o'z slug, xodimlar, ombor, kassa, bronlar, obuna; RLS o'zgarmaydi),
--   `parent_id` orqali asosiy kompaniyaga bog'lanadi. Tarmoq faqat bir darajali: asosiy -> filiallar.
--   `parent_id` ni faqat Super Admin o'zgartiradi (app.guard_businesses, 038).

-- Filial yorlig'i: "Chilonzor filiali". Ilovada va panelda nom yonida chiqadi; direktor ham tahrirlaydi
ALTER TABLE businesses ADD COLUMN branch_name VARCHAR(80)
    CHECK (branch_name IS NULL OR length(trim(branch_name)) > 0);
CREATE INDEX businesses_parent_idx ON businesses (parent_id) WHERE parent_id IS NOT NULL;

-- Tarmoq identifikatori: asosiy kompaniyaning id si (o'zi asosiy bo'lsa — o'z id si)
CREATE OR REPLACE FUNCTION app.chain_id(p_parent BIGINT, p_id BIGINT) RETURNS BIGINT
LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(p_parent, p_id) $$;

-- Bir daraja: filialning filiali bo'lmaydi, filiallari bor muassasa boshqasiga filial bo'lmaydi
CREATE OR REPLACE FUNCTION app.check_business_parent() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_id = NEW.id THEN
        RAISE EXCEPTION 'branch_self' USING ERRCODE = 'P0430';
    END IF;
    IF EXISTS (SELECT 1 FROM businesses p WHERE p.id = NEW.parent_id AND p.parent_id IS NOT NULL) THEN
        RAISE EXCEPTION 'branch_parent_is_branch' USING ERRCODE = 'P0430';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM businesses c WHERE c.parent_id = NEW.id) THEN
        RAISE EXCEPTION 'branch_has_children' USING ERRCODE = 'P0431';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER businesses_check_parent
    BEFORE INSERT OR UPDATE OF parent_id ON businesses
    FOR EACH ROW EXECUTE FUNCTION app.check_business_parent();
