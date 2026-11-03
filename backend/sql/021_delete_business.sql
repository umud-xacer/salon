-- Super Admin muassasani butunlay o'chiradi. app_api da businesses ga DELETE huquqi yo'q (ataylab),
-- shuning uchun faqat shu funksiya orqali: Super Admin tekshiruvi bazaning o'zida.
-- Bog'liq jadvallar ON DELETE CASCADE bilan o'chadi. Odamlarning hisoblari (users) qoladi.
CREATE FUNCTION app.delete_business(p_id BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT app.is_superadmin() THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    UPDATE businesses SET parent_id = NULL WHERE parent_id = p_id;     -- filiallar mustaqil bo'lib qoladi
    -- Bir-biriga kaskadsiz bog'langan yozuvlar: avval bolalari (aks holda kaskad tartibi xato beradi)
    DELETE FROM reviews         WHERE business_id = p_id;
    DELETE FROM payments        WHERE business_id = p_id;
    DELETE FROM stock_movements WHERE business_id = p_id;
    DELETE FROM payrolls        WHERE business_id = p_id;
    DELETE FROM appointments    WHERE business_id = p_id;          -- appointment_services bilan
    DELETE FROM businesses WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0404';
    END IF;
END $$;
REVOKE ALL ON FUNCTION app.delete_business(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_business(BIGINT) TO app_api;

-- Xarajat o'chirilganda jurnalga yoziladi. Butun biznes o'chayotgan bo'lsa — yoziladigan biznes yo'q,
-- jurnal ham u bilan birga o'chadi: yozuv qo'shilmaydi.
CREATE OR REPLACE FUNCTION app.guard_expenses() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = OLD.business_id) THEN
            RETURN OLD;
        END IF;
        INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
        VALUES (OLD.business_id, app.uid(), 'delete', 'expense', OLD.id,
                jsonb_build_object('amount', OLD.amount, 'spent_at', OLD.spent_at, 'note', OLD.note));
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := app.uid();
        NEW.created_at := now();
        RETURN NEW;
    END IF;
    IF NEW.business_id <> OLD.business_id THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
    VALUES (OLD.business_id, app.uid(), 'update', 'expense', OLD.id,
            jsonb_build_object('amount', jsonb_build_array(OLD.amount, NEW.amount),
                               'spent_at', jsonb_build_array(OLD.spent_at, NEW.spent_at)));
    RETURN NEW;
END $$;
