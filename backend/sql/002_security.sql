-- ════════════════════════════════════════════════════════════════════════════
--  XAVFSIZLIK: rollar, Row-Level Security (RLS), himoya triggerlari
--
--  Baza rollari:
--    (egasi)   — migratsiyalarni yurgizadi, jadvallar egasi. Ilova u bilan ULANMAYDI.
--    app_auth  — faqat kirish jarayoni: users, otp_codes, refresh_tokens.
--    app_api   — qolgan barcha so'rovlar. Har bir tranzaksiyada `app.user_id` o'rnatiladi,
--                RLS siyosatlari faqat shu foydalanuvchiga ruxsat etilgan qatorlarni ochadi.
--
--  Ilova kodida xato bo'lsa ham (masalan, filtr unutilsa) baza boshqa salon
--  ma'lumotini bermaydi va ruxsatsiz o'zgartirishni rad etadi.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_api')  THEN CREATE ROLE app_api  NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_auth') THEN CREATE ROLE app_auth NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_api, app_auth;
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_api, app_auth;


-- ════════════════════════════════════════════════════════════════════════════
--  Yordamchi funksiyalar
--  SECURITY DEFINER — RLS'ni chetlab o'tib faqat kerakli faktni qaytaradi
--  (aks holda siyosatlar bir-birini cheksiz chaqiradi).
-- ════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION app.uid() RETURNS BIGINT
LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::BIGINT
$$;

CREATE FUNCTION app.is_superadmin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce((SELECT is_superadmin FROM users WHERE id = app.uid() AND status = 'active'), false)
$$;

-- Men a'zo bo'lgan bizneslar (faol a'zolik)
CREATE FUNCTION app.my_business_ids() RETURNS BIGINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(array_agg(business_id), '{}') FROM business_members
     WHERE user_id = app.uid() AND is_active
$$;

-- Mening xodim yozuvlarim (business_members.id)
CREATE FUNCTION app.my_member_ids() RETURNS BIGINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(array_agg(id), '{}') FROM business_members
     WHERE user_id = app.uid() AND is_active
$$;

-- Mijoz sifatidagi yozuvlarim (business_clients.id)
CREATE FUNCTION app.my_client_ids() RETURNS BIGINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(array_agg(id), '{}') FROM business_clients WHERE user_id = app.uid()
$$;

-- Biznes mijozlar ilovasida ochiqmi
CREATE FUNCTION app.business_is_public(p_business BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM businesses WHERE id = p_business AND status = 'active' AND is_listed)
$$;

CREATE FUNCTION app.member_business(p_member BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT business_id FROM business_members WHERE id = p_member
$$;

-- Modul yoqilganmi: Super Admin istisnosi (business_modules) > faol obuna tarifi
CREATE FUNCTION app.module_enabled(p_business BIGINT, p_module TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT p_module IS NULL OR coalesce(
        (SELECT bm.enabled AND (bm.expires_at IS NULL OR bm.expires_at > now())
           FROM business_modules bm
          WHERE bm.business_id = p_business AND bm.module_code = p_module),
        EXISTS (SELECT 1 FROM business_subscriptions s
                  JOIN plan_modules pm ON pm.plan_id = s.plan_id
                 WHERE s.business_id = p_business AND pm.module_code = p_module
                   AND now() >= s.starts_at AND now() < s.ends_at)
    )
$$;

-- ASOSIY TEKSHIRUV: joriy foydalanuvchida shu biznesda shu huquq bormi.
-- Huquq = rol huquqlari + shaxsiy berilgan − shaxsiy olib qo'yilgan, va modul yoqilgan bo'lishi shart.
-- Bloklangan biznesda hech kimda huquq yo'q (Super Admindan tashqari).
CREATE FUNCTION app.has_perm(p_business BIGINT, p_perm TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT app.is_superadmin() OR EXISTS (
        SELECT 1
          FROM business_members m
          JOIN businesses b ON b.id = m.business_id AND b.status IN ('active', 'pending')
          JOIN users u      ON u.id = m.user_id     AND u.status = 'active'
         WHERE m.business_id = p_business
           AND m.user_id = app.uid()
           AND m.is_active
           AND coalesce(
                 (SELECT mp.granted FROM member_permissions mp
                   WHERE mp.member_id = m.id AND mp.permission_code = p_perm),
                 EXISTS (SELECT 1 FROM role_permissions rp
                          WHERE rp.role = m.role AND rp.permission_code = p_perm))
           AND app.module_enabled(p_business, (SELECT module_code FROM permissions WHERE code = p_perm))
    )
$$;

-- Xodim qo'shishda foydalanuvchini telefon bo'yicha topish yoki yaratish.
-- app_api users jadvaliga to'g'ridan-to'g'ri INSERT qila olmaydi — faqat shu funksiya orqali.
CREATE FUNCTION app.ensure_user(p_phone TEXT, p_full_name TEXT) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id BIGINT;
BEGIN
    IF NOT (app.is_superadmin() OR EXISTS (
            SELECT 1 FROM unnest(app.my_business_ids()) b WHERE app.has_perm(b, 'staff.manage'))) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
    END IF;
    INSERT INTO users (phone, full_name) VALUES (p_phone, coalesce(p_full_name, ''))
    ON CONFLICT (phone) DO UPDATE
        SET full_name = CASE WHEN users.full_name = '' THEN EXCLUDED.full_name ELSE users.full_name END
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_api;
GRANT EXECUTE ON FUNCTION app.uid(), app.is_superadmin() TO app_auth;


-- ════════════════════════════════════════════════════════════════════════════
--  Ruxsatlar (GRANT) — avval umumiy, keyin cheklash
-- ════════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_api, app_auth;

-- Kirish jadvallari app_api uchun butunlay yopiq
REVOKE ALL ON otp_codes, refresh_tokens FROM app_api;

-- users: app_api faqat profil maydonlarini o'zgartira oladi; parol, token, bloklash — faqat app_auth
REVOKE ALL ON users FROM app_api;
GRANT SELECT ON users TO app_api;
GRANT UPDATE (full_name, email, avatar_url, language, status) ON users TO app_api;

-- Faqat qo'shiladigan (o'zgartirilmaydigan) jurnallar
REVOKE UPDATE, DELETE ON audit_logs, stock_movements FROM app_api;
REVOKE DELETE ON payments, appointments FROM app_api;          -- o'chirish o'rniga bekor qilish / qaytarish

-- PostGIS ma'lumotnoma jadvali
REVOKE ALL ON spatial_ref_sys FROM app_api;
GRANT SELECT ON spatial_ref_sys TO app_api;

-- app_auth: faqat kirish uchun kerakli jadvallar
GRANT SELECT, INSERT, UPDATE ON users TO app_auth;
GRANT SELECT, INSERT, UPDATE ON otp_codes, refresh_tokens TO app_auth;


-- ════════════════════════════════════════════════════════════════════════════
--  RLS yoqish va Super Admin siyosati (barcha jadvallarga)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY superadmin_all ON %I TO app_api USING (app.is_superadmin()) WITH CHECK (app.is_superadmin())', t);
    END LOOP;
END $$;

-- ─── Kirish jadvallari (faqat app_auth) ────────────────────────────────────
CREATE POLICY auth_all ON users          TO app_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON otp_codes      TO app_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON refresh_tokens TO app_auth USING (true) WITH CHECK (true);

-- ─── users ──────────────────────────────────────────────────────────────────
CREATE POLICY self_read   ON users FOR SELECT TO app_api USING (id = app.uid());
CREATE POLICY self_update ON users FOR UPDATE TO app_api USING (id = app.uid()) WITH CHECK (id = app.uid());
-- Hamkasblar (bir biznesdagi xodimlar) ismini ko'rish
CREATE POLICY colleague_read ON users FOR SELECT TO app_api USING (
    id IN (SELECT user_id FROM business_members WHERE business_id = ANY (app.my_business_ids()))
);

-- ─── Ma'lumotnomalar: hamma o'qiydi, faqat Super Admin yozadi ──────────────
CREATE POLICY read_all ON business_categories FOR SELECT TO app_api USING (true);
CREATE POLICY read_all ON modules             FOR SELECT TO app_api USING (true);
CREATE POLICY read_all ON plans               FOR SELECT TO app_api USING (true);
CREATE POLICY read_all ON plan_modules        FOR SELECT TO app_api USING (true);
CREATE POLICY read_all ON permissions         FOR SELECT TO app_api USING (true);
CREATE POLICY read_all ON role_permissions    FOR SELECT TO app_api USING (true);

-- ─── businesses ─────────────────────────────────────────────────────────────
CREATE POLICY public_read ON businesses FOR SELECT TO app_api USING (status = 'active' AND is_listed);
CREATE POLICY member_read ON businesses FOR SELECT TO app_api USING (id = ANY (app.my_business_ids()));
CREATE POLICY manage      ON businesses FOR UPDATE TO app_api
    USING (app.has_perm(id, 'business.manage')) WITH CHECK (app.has_perm(id, 'business.manage'));

-- ─── Biznesning ochiq ma'lumotlari ─────────────────────────────────────────
CREATE POLICY public_read ON business_hours  FOR SELECT TO app_api USING (app.business_is_public(business_id) OR business_id = ANY (app.my_business_ids()));
CREATE POLICY manage      ON business_hours  TO app_api USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));
CREATE POLICY public_read ON business_photos FOR SELECT TO app_api USING (app.business_is_public(business_id) OR business_id = ANY (app.my_business_ids()));
CREATE POLICY manage      ON business_photos TO app_api USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));

CREATE POLICY public_read ON service_categories FOR SELECT TO app_api USING (app.business_is_public(business_id) OR business_id = ANY (app.my_business_ids()));
CREATE POLICY manage      ON service_categories TO app_api USING (app.has_perm(business_id, 'services.manage')) WITH CHECK (app.has_perm(business_id, 'services.manage'));
CREATE POLICY public_read ON services           FOR SELECT TO app_api USING ((is_active AND app.business_is_public(business_id)) OR business_id = ANY (app.my_business_ids()));
CREATE POLICY manage      ON services           TO app_api USING (app.has_perm(business_id, 'services.manage')) WITH CHECK (app.has_perm(business_id, 'services.manage'));

CREATE POLICY public_read ON member_services FOR SELECT TO app_api USING (app.business_is_public(business_id) OR business_id = ANY (app.my_business_ids()));
CREATE POLICY manage      ON member_services TO app_api USING (app.has_perm(business_id, 'staff.manage')) WITH CHECK (app.has_perm(business_id, 'staff.manage'));
CREATE POLICY public_read ON staff_schedules FOR SELECT TO app_api USING (app.business_is_public(business_id) OR business_id = ANY (app.my_business_ids()));
CREATE POLICY manage      ON staff_schedules TO app_api USING (app.has_perm(business_id, 'staff.manage')) WITH CHECK (app.has_perm(business_id, 'staff.manage'));

CREATE POLICY member_read ON staff_time_off FOR SELECT TO app_api USING (business_id = ANY (app.my_business_ids()));
CREATE POLICY manage      ON staff_time_off TO app_api
    USING (app.has_perm(business_id, 'staff.manage') OR member_id = ANY (app.my_member_ids()))
    WITH CHECK (app.has_perm(business_id, 'staff.manage') OR member_id = ANY (app.my_member_ids()));

-- ─── Obuna va modullar: a'zolar o'qiydi, Super Admin yozadi ────────────────
CREATE POLICY member_read ON business_subscriptions FOR SELECT TO app_api USING (business_id = ANY (app.my_business_ids()));
CREATE POLICY member_read ON business_modules       FOR SELECT TO app_api USING (business_id = ANY (app.my_business_ids()));

-- ─── Xodimlar ──────────────────────────────────────────────────────────────
CREATE POLICY public_read ON business_members FOR SELECT TO app_api
    USING (is_active AND is_bookable AND app.business_is_public(business_id));
CREATE POLICY member_read ON business_members FOR SELECT TO app_api
    USING (business_id = ANY (app.my_business_ids()));
CREATE POLICY manage ON business_members TO app_api
    USING (app.has_perm(business_id, 'staff.manage')) WITH CHECK (app.has_perm(business_id, 'staff.manage'));

CREATE POLICY own_or_manager ON member_compensation FOR SELECT TO app_api USING (
    member_id = ANY (app.my_member_ids())
    OR app.has_perm(business_id, 'payroll.manage') OR app.has_perm(business_id, 'staff.manage'));
CREATE POLICY manage ON member_compensation TO app_api
    USING (app.has_perm(business_id, 'payroll.manage') OR app.has_perm(business_id, 'staff.manage'))
    WITH CHECK (app.has_perm(business_id, 'payroll.manage') OR app.has_perm(business_id, 'staff.manage'));

CREATE POLICY own_or_manager ON member_permissions FOR SELECT TO app_api USING (
    member_id = ANY (app.my_member_ids()) OR app.has_perm(app.member_business(member_id), 'staff.manage'));
CREATE POLICY manage ON member_permissions TO app_api
    USING (app.has_perm(app.member_business(member_id), 'staff.manage'))
    WITH CHECK (app.has_perm(app.member_business(member_id), 'staff.manage'));

-- ─── Mijozlar ──────────────────────────────────────────────────────────────
CREATE POLICY staff_read ON business_clients FOR SELECT TO app_api USING (app.has_perm(business_id, 'clients.view'));
CREATE POLICY self_read  ON business_clients FOR SELECT TO app_api USING (user_id = app.uid());
CREATE POLICY manage ON business_clients FOR INSERT TO app_api
    WITH CHECK (app.has_perm(business_id, 'appointments.manage') OR app.has_perm(business_id, 'clients.view'));
CREATE POLICY manage_upd ON business_clients FOR UPDATE TO app_api
    USING (app.has_perm(business_id, 'clients.view')) WITH CHECK (app.has_perm(business_id, 'clients.view'));
CREATE POLICY manage_del ON business_clients FOR DELETE TO app_api USING (app.has_perm(business_id, 'business.manage'));

CREATE POLICY own ON favorites     TO app_api USING (user_id = app.uid()) WITH CHECK (user_id = app.uid());
CREATE POLICY own ON device_tokens TO app_api USING (user_id = app.uid()) WITH CHECK (user_id = app.uid());

-- ─── Bronlar ───────────────────────────────────────────────────────────────
CREATE POLICY read ON appointments FOR SELECT TO app_api USING (
    app.has_perm(business_id, 'appointments.view_all')
    OR (member_id = ANY (app.my_member_ids()) AND app.has_perm(business_id, 'appointments.view_own'))
    OR client_id = ANY (app.my_client_ids())
);
CREATE POLICY manage_ins ON appointments FOR INSERT TO app_api
    WITH CHECK (app.has_perm(business_id, 'appointments.manage'));
-- Xodim o'z bronini yangilay oladi (faqat holat — trigger cheklaydi)
CREATE POLICY manage_upd ON appointments FOR UPDATE TO app_api
    USING (app.has_perm(business_id, 'appointments.manage')
           OR (member_id = ANY (app.my_member_ids()) AND app.has_perm(business_id, 'appointments.view_own')))
    WITH CHECK (app.has_perm(business_id, 'appointments.manage')
           OR (member_id = ANY (app.my_member_ids()) AND app.has_perm(business_id, 'appointments.view_own')));

-- Xizmat qatorlari: bronni ko'ra olgan kishi ko'radi (ichki so'rov ham RLS ostida)
CREATE POLICY read ON appointment_services FOR SELECT TO app_api
    USING (EXISTS (SELECT 1 FROM appointments a WHERE a.id = appointment_id));
CREATE POLICY manage ON appointment_services TO app_api
    USING (app.has_perm(business_id, 'appointments.manage')) WITH CHECK (app.has_perm(business_id, 'appointments.manage'));

-- ─── Pul ───────────────────────────────────────────────────────────────────
CREATE POLICY read ON payments FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'finance.view') OR app.has_perm(business_id, 'payments.accept'));
CREATE POLICY accept ON payments FOR INSERT TO app_api WITH CHECK (app.has_perm(business_id, 'payments.accept'));
CREATE POLICY manage ON payments FOR UPDATE TO app_api
    USING (app.has_perm(business_id, 'finance.view')) WITH CHECK (app.has_perm(business_id, 'finance.view'));

CREATE POLICY manage ON expense_categories TO app_api USING (app.has_perm(business_id, 'finance.view')) WITH CHECK (app.has_perm(business_id, 'finance.view'));
CREATE POLICY manage ON expenses           TO app_api USING (app.has_perm(business_id, 'finance.view')) WITH CHECK (app.has_perm(business_id, 'finance.view'));

CREATE POLICY own_read ON payrolls FOR SELECT TO app_api USING (member_id = ANY (app.my_member_ids()));
CREATE POLICY manage   ON payrolls TO app_api USING (app.has_perm(business_id, 'payroll.manage')) WITH CHECK (app.has_perm(business_id, 'payroll.manage'));

-- ─── Ombor ─────────────────────────────────────────────────────────────────
CREATE POLICY read   ON products FOR SELECT TO app_api USING (app.has_perm(business_id, 'inventory.view'));
CREATE POLICY manage ON products TO app_api USING (app.has_perm(business_id, 'inventory.manage')) WITH CHECK (app.has_perm(business_id, 'inventory.manage'));

CREATE POLICY read ON stock_movements FOR SELECT TO app_api
    USING (app.has_perm(business_id, 'inventory.view') OR member_id = ANY (app.my_member_ids()));
CREATE POLICY manage ON stock_movements FOR INSERT TO app_api WITH CHECK (
    app.has_perm(business_id, 'inventory.manage')
    -- usta o'zi ishlatgan materialni yozadi (faqat chiqim)
    OR (type = 'usage' AND qty < 0 AND member_id = ANY (app.my_member_ids()))
);

-- ─── Sharhlar ──────────────────────────────────────────────────────────────
CREATE POLICY public_read ON reviews FOR SELECT TO app_api USING (true);
-- Faqat o'z, yakunlangan bronga sharh yozish mumkin
CREATE POLICY write_own ON reviews FOR INSERT TO app_api WITH CHECK (
    user_id = app.uid() AND EXISTS (
        SELECT 1 FROM appointments a
         WHERE a.id = appointment_id AND a.business_id = reviews.business_id
           AND a.status = 'completed' AND a.client_id = ANY (app.my_client_ids()))
);
CREATE POLICY reply ON reviews FOR UPDATE TO app_api
    USING (app.has_perm(business_id, 'business.manage')) WITH CHECK (app.has_perm(business_id, 'business.manage'));

-- ─── Bildirishnoma va audit ────────────────────────────────────────────────
CREATE POLICY own ON notifications FOR SELECT TO app_api USING (user_id = app.uid());
CREATE POLICY own_upd ON notifications FOR UPDATE TO app_api USING (user_id = app.uid()) WITH CHECK (user_id = app.uid());
CREATE POLICY business_ins ON notifications FOR INSERT TO app_api WITH CHECK (business_id = ANY (app.my_business_ids()));

CREATE POLICY read ON audit_logs FOR SELECT TO app_api USING (app.has_perm(business_id, 'business.manage'));
CREATE POLICY write ON audit_logs FOR INSERT TO app_api
    WITH CHECK (user_id = app.uid() AND (business_id IS NULL OR business_id = ANY (app.my_business_ids())));


-- ════════════════════════════════════════════════════════════════════════════
--  HIMOYA TRIGGERLARI — RLS ruxsat bergan o'zgarish ichida ham
--  huquqni oshirish (privilege escalation) va soxtalashtirishni to'xtatadi
-- ════════════════════════════════════════════════════════════════════════════

-- Ilova rollarimi (egasi/migratsiya emas)
CREATE FUNCTION app.is_app_role() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT current_user IN ('app_api', 'app_auth') $$;

-- users: Super Admin bayrog'ini ilova orqali hech kim o'rnata olmaydi;
-- holatni (bloklash) faqat Super Admin o'zgartiradi.
CREATE FUNCTION app.guard_users() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF app.is_app_role() THEN
        IF NEW.is_superadmin AND (TG_OP = 'INSERT' OR NOT OLD.is_superadmin) THEN
            RAISE EXCEPTION 'superadmin_flag_forbidden' USING ERRCODE = '42501';
        END IF;
        IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
           AND current_user = 'app_api' AND NOT app.is_superadmin() THEN
            RAISE EXCEPTION 'status_change_forbidden' USING ERRCODE = '42501';
        END IF;
        IF TG_OP = 'UPDATE' AND NEW.phone IS DISTINCT FROM OLD.phone THEN
            RAISE EXCEPTION 'phone_change_forbidden' USING ERRCODE = '42501';
        END IF;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER guard_users BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.guard_users();

-- businesses: holat, egasi, reyting — faqat Super Admin
CREATE FUNCTION app.guard_businesses() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF app.is_app_role() AND NOT app.is_superadmin() AND (
           NEW.status       IS DISTINCT FROM OLD.status
        OR NEW.created_by   IS DISTINCT FROM OLD.created_by
        OR NEW.parent_id    IS DISTINCT FROM OLD.parent_id
        OR NEW.rating_avg   IS DISTINCT FROM OLD.rating_avg
        OR NEW.rating_count IS DISTINCT FROM OLD.rating_count) THEN
        RAISE EXCEPTION 'business_field_forbidden' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER guard_businesses BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION app.guard_businesses();

-- business_members:
--   * 'owner' rolini faqat Super Admin beradi;
--   * 'manager' rolini faqat egasi beradi;
--   * hech kim o'z yozuvini (rol, faollik) o'zgartira olmaydi;
--   * egasining yozuvini egasi bo'lmagan o'zgartira olmaydi;
--   * a'zoni boshqa biznesga ko'chirib bo'lmaydi.
CREATE FUNCTION app.guard_members() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_actor_role member_role;
    v_row        business_members;
BEGIN
    IF NOT app.is_app_role() OR app.is_superadmin() THEN
        RETURN coalesce(NEW, OLD);
    END IF;
    v_row := coalesce(NEW, OLD);
    SELECT role INTO v_actor_role FROM business_members
     WHERE business_id = v_row.business_id AND user_id = app.uid() AND is_active;

    IF v_row.user_id = app.uid() THEN
        RAISE EXCEPTION 'cannot_modify_own_membership' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.business_id <> OLD.business_id THEN
        RAISE EXCEPTION 'business_id_immutable' USING ERRCODE = '42501';
    END IF;
    IF (TG_OP <> 'DELETE' AND NEW.role = 'owner') OR (TG_OP <> 'INSERT' AND OLD.role = 'owner') THEN
        RAISE EXCEPTION 'owner_managed_by_superadmin' USING ERRCODE = '42501';
    END IF;
    IF ((TG_OP <> 'DELETE' AND NEW.role = 'manager') OR (TG_OP <> 'INSERT' AND OLD.role = 'manager'))
       AND v_actor_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'only_owner_manages_managers' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        NEW.rating_avg := OLD.rating_avg;            -- reytingni qo'lda o'zgartirib bo'lmaydi
        NEW.rating_count := OLD.rating_count;
    END IF;
    RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER guard_members BEFORE INSERT OR UPDATE OR DELETE ON business_members
    FOR EACH ROW EXECUTE FUNCTION app.guard_members();

-- member_permissions: o'zingizda yo'q huquqni boshqaga bera olmaysiz; o'zingizga va egaga huquq o'zgartira olmaysiz
CREATE FUNCTION app.guard_member_permissions() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_row    member_permissions;
    v_target business_members;
BEGIN
    IF NOT app.is_app_role() OR app.is_superadmin() THEN
        RETURN coalesce(NEW, OLD);
    END IF;
    v_row := coalesce(NEW, OLD);
    SELECT * INTO v_target FROM business_members WHERE id = v_row.member_id;
    IF v_target.user_id = app.uid() THEN
        RAISE EXCEPTION 'cannot_modify_own_permissions' USING ERRCODE = '42501';
    END IF;
    IF v_target.role = 'owner' THEN
        RAISE EXCEPTION 'cannot_modify_owner_permissions' USING ERRCODE = '42501';
    END IF;
    IF NOT app.has_perm(v_target.business_id, v_row.permission_code) THEN
        RAISE EXCEPTION 'cannot_grant_permission_you_lack' USING ERRCODE = '42501';
    END IF;
    RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER guard_member_permissions BEFORE INSERT OR UPDATE OR DELETE ON member_permissions
    FOR EACH ROW EXECUTE FUNCTION app.guard_member_permissions();

-- appointments: 'appointments.manage' huquqi bo'lmagan xodim faqat holat va vaqt belgilarini o'zgartiradi
-- (narx, mijoz, vaqt, usta — yo'q). Biznesni almashtirib bo'lmaydi.
CREATE FUNCTION app.guard_appointments() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT app.is_app_role() THEN RETURN NEW; END IF;
    IF NEW.business_id <> OLD.business_id THEN
        RAISE EXCEPTION 'business_id_immutable' USING ERRCODE = '42501';
    END IF;
    IF NOT app.has_perm(NEW.business_id, 'appointments.manage') THEN
        IF   NEW.client_id   IS DISTINCT FROM OLD.client_id
          OR NEW.member_id   IS DISTINCT FROM OLD.member_id
          OR NEW.starts_at   IS DISTINCT FROM OLD.starts_at
          OR NEW.ends_at     IS DISTINCT FROM OLD.ends_at
          OR NEW.total_price IS DISTINCT FROM OLD.total_price
          OR NEW.discount    IS DISTINCT FROM OLD.discount
          OR NEW.source      IS DISTINCT FROM OLD.source
          OR NEW.created_by  IS DISTINCT FROM OLD.created_by THEN
            RAISE EXCEPTION 'staff_can_change_status_only' USING ERRCODE = '42501';
        END IF;
        IF NEW.status NOT IN ('in_progress', 'completed', 'no_show') AND NEW.status <> OLD.status THEN
            RAISE EXCEPTION 'status_not_allowed' USING ERRCODE = '42501';
        END IF;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER guard_appointments BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION app.guard_appointments();

-- reviews: salon faqat javob (reply) yoza oladi, baho va matnni o'zgartira olmaydi
CREATE FUNCTION app.guard_reviews() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF app.is_app_role() AND NOT app.is_superadmin() AND (
           NEW.rating  IS DISTINCT FROM OLD.rating
        OR NEW.comment IS DISTINCT FROM OLD.comment
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id) THEN
        RAISE EXCEPTION 'review_is_immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER guard_reviews BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION app.guard_reviews();

-- Ombor qoldig'i faqat harakat orqali o'zgaradi. products.current_qty >= 0 cheklovi
-- mavjud bo'lmagan miqdorni ishlatishga yo'l qo'ymaydi.
CREATE FUNCTION app.apply_stock_movement() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE products SET current_qty = current_qty + NEW.qty
     WHERE id = NEW.product_id AND business_id = NEW.business_id;
    RETURN NEW;
END $$;
CREATE TRIGGER apply_stock_movement AFTER INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION app.apply_stock_movement();

CREATE FUNCTION app.guard_products() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF app.is_app_role() AND NEW.current_qty IS DISTINCT FROM OLD.current_qty THEN
        RAISE EXCEPTION 'use_stock_movements' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER guard_products BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION app.guard_products();

-- Kirish: bir raqamga 10 daqiqada 3 tadan, bir IP dan soatiga 20 tadan ko'p SMS so'ralmaydi
CREATE FUNCTION app.otp_rate_limit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT count(*) FROM otp_codes
         WHERE phone = NEW.phone AND created_at > now() - INTERVAL '10 minutes') >= 3 THEN
        RAISE EXCEPTION 'otp_rate_limited' USING ERRCODE = 'P0429';
    END IF;
    IF NEW.ip IS NOT NULL AND (SELECT count(*) FROM otp_codes
         WHERE ip = NEW.ip AND created_at > now() - INTERVAL '1 hour') >= 20 THEN
        RAISE EXCEPTION 'otp_rate_limited' USING ERRCODE = 'P0429';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER otp_rate_limit BEFORE INSERT ON otp_codes FOR EACH ROW EXECUTE FUNCTION app.otp_rate_limit();

GRANT EXECUTE ON FUNCTION app.is_app_role() TO app_api, app_auth;
