"""Baza darajasidagi himoya. Ilova kodi chetlab o'tiladi — app_api roli bilan to'g'ridan-to'g'ri SQL.
Ya'ni: API'da xato bo'lsa ham, baza quyidagilarga yo'l qo'ymaydi."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import api_session
from tests.conftest import add_member, create_business, new_phone, otp_login


def sqlstate(exc_info) -> str:
    return exc_info.value.orig.sqlstate


@pytest.fixture(scope="module")
def world(client, superadmin):
    """Ikki biznes (A, B), A da usta va qabulxona, A va B da bittadan mijoz."""
    a = create_business(client, superadmin, modules=("booking", "inventory"))
    b = create_business(client, superadmin, modules=("booking",))
    usta = add_member(client, a, "staff")
    rec = add_member(client, a, "receptionist")
    usta_b = add_member(client, b, "staff")
    customer = otp_login(client, new_phone(), "Mijoz")

    with api_session(a["owner"]["user"]["id"]) as db:
        client_a = db.execute(text(
            "INSERT INTO business_clients (business_id, user_id, full_name, phone) "
            "VALUES (:b, :u, 'Mijoz', :p) RETURNING id"),
            {"b": a["id"], "u": customer["user"]["id"], "p": customer["user"]["phone"]}).scalar()
        db.commit()
    with api_session(b["owner"]["user"]["id"]) as db:
        client_b = db.execute(text(
            "INSERT INTO business_clients (business_id, full_name, phone) VALUES (:b, 'B mijoz', :p) RETURNING id"),
            {"b": b["id"], "p": new_phone()}).scalar()
        db.commit()
    return {"a": a, "b": b, "usta": usta, "rec": rec, "usta_b": usta_b, "customer": customer,
            "client_a": client_a, "client_b": client_b}


def uid(tokens) -> int:
    return tokens["user"]["id"]


def book(db, business_id, client_id, member_id, start, end, status="pending"):
    return db.execute(text("""
        INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status)
        VALUES (:b, :c, :m, :s, :e, :st) RETURNING id"""),
        {"b": business_id, "c": client_id, "m": member_id, "s": start, "e": end, "st": status}).scalar()


# ─── Ikki marta bron ────────────────────────────────────────────────────────
def test_double_booking_impossible(world):
    a, usta = world["a"], world["usta"]["member"]["id"]
    with api_session(uid(a["owner"])) as db:
        book(db, a["id"], world["client_a"], usta, "2026-12-01 10:00+05", "2026-12-01 11:00+05")
        db.commit()
        with pytest.raises(DBAPIError) as e:
            book(db, a["id"], world["client_a"], usta, "2026-12-01 10:59+05", "2026-12-01 11:30+05")
        assert sqlstate(e) == "23P01"
        db.rollback()
        # Ketma-ket (11:00 dan) — ruxsat
        book(db, a["id"], world["client_a"], usta, "2026-12-01 11:00+05", "2026-12-01 11:30+05")
        db.commit()


def test_cancelled_booking_frees_slot(world):
    a, usta = world["a"], world["usta"]["member"]["id"]
    with api_session(uid(a["owner"])) as db:
        appt = book(db, a["id"], world["client_a"], usta, "2026-12-02 10:00+05", "2026-12-02 11:00+05")
        db.execute(text("UPDATE appointments SET status = 'cancelled' WHERE id = :id"), {"id": appt})
        book(db, a["id"], world["client_a"], usta, "2026-12-02 10:00+05", "2026-12-02 11:00+05")
        db.commit()


def test_cannot_book_other_business_staff_or_client(world):
    a = world["a"]
    with api_session(uid(a["owner"])) as db:
        # B biznesning ustasi — kompozit FK rad etadi
        with pytest.raises(DBAPIError) as e:
            book(db, a["id"], world["client_a"], world["usta_b"]["member"]["id"], "2026-12-03 10:00+05", "2026-12-03 11:00+05")
        assert sqlstate(e) in ("23503", "42501")
        db.rollback()
        # B biznesning mijozi
        with pytest.raises(DBAPIError) as e:
            book(db, a["id"], world["client_b"], world["usta"]["member"]["id"], "2026-12-03 10:00+05", "2026-12-03 11:00+05")
        assert sqlstate(e) in ("23503", "42501")
        db.rollback()
        # B biznes nomidan yozish — RLS
        with pytest.raises(DBAPIError) as e:
            book(db, world["b"]["id"], world["client_b"], world["usta_b"]["member"]["id"], "2026-12-03 10:00+05", "2026-12-03 11:00+05")
        assert sqlstate(e) == "42501"


# ─── Ma'lumotlarni ajratish (RLS) ───────────────────────────────────────────
def test_tenant_isolation(world):
    with api_session(uid(world["a"]["owner"])) as db:
        biz_ids = {r[0] for r in db.execute(text("SELECT DISTINCT business_id FROM business_clients"))}
        assert biz_ids == {world["a"]["id"]}
        # B ning yozuvini o'zgartirish/o'chirish — 0 qator (ko'rinmaydi)
        assert db.execute(text("UPDATE business_clients SET notes = 'x' WHERE id = :id"), {"id": world["client_b"]}).rowcount == 0
        assert db.execute(text("DELETE FROM business_clients WHERE id = :id"), {"id": world["client_b"]}).rowcount == 0
        db.rollback()


def test_staff_sees_only_own_appointments(world):
    a = world["a"]
    usta, rec = world["usta"], world["rec"]
    with api_session(uid(a["owner"])) as db:
        other = add_staff_member_sql(db, a["id"])
        mine = book(db, a["id"], world["client_a"], usta["member"]["id"], "2026-12-04 10:00+05", "2026-12-04 11:00+05")
        theirs = book(db, a["id"], world["client_a"], other, "2026-12-04 10:00+05", "2026-12-04 11:00+05")
        db.commit()
    with api_session(uid(usta["tokens"])) as db:
        ids = {r[0] for r in db.execute(text("SELECT id FROM appointments"))}
        assert mine in ids and theirs not in ids
        # Mijozlar bazasi — ko'rinmaydi
        assert db.execute(text("SELECT count(*) FROM business_clients")).scalar() == 0
    with api_session(uid(rec["tokens"])) as db:
        ids = {r[0] for r in db.execute(text("SELECT id FROM appointments"))}
        assert {mine, theirs} <= ids


def add_staff_member_sql(db, business_id) -> int:
    u = db.execute(text("SELECT app.ensure_user(:p, 'Boshqa Usta')"), {"p": new_phone()}).scalar()
    return db.execute(text("INSERT INTO business_members (business_id, user_id, role) VALUES (:b, :u, 'staff') RETURNING id"),
                      {"b": business_id, "u": u}).scalar()


def test_staff_can_only_change_status_of_own_booking(world):
    a, usta = world["a"], world["usta"]
    with api_session(uid(a["owner"])) as db:
        appt = book(db, a["id"], world["client_a"], usta["member"]["id"], "2026-12-05 10:00+05", "2026-12-05 11:00+05")
        db.execute(text("UPDATE appointments SET total_price = 100000 WHERE id = :id"), {"id": appt})
        db.commit()
    with api_session(uid(usta["tokens"])) as db:
        db.execute(text("UPDATE appointments SET status = 'in_progress' WHERE id = :id"), {"id": appt})
        db.commit()
        with pytest.raises(DBAPIError) as e:                       # narxni tushirib yuborish
            db.execute(text("UPDATE appointments SET total_price = 1 WHERE id = :id"), {"id": appt})
        assert sqlstate(e) == "42501"
        db.rollback()
        with pytest.raises(DBAPIError) as e:                       # vaqtni surish
            db.execute(text("UPDATE appointments SET starts_at = starts_at + interval '1 hour', "
                            "ends_at = ends_at + interval '1 hour' WHERE id = :id"), {"id": appt})
        assert sqlstate(e) == "42501"
        db.rollback()
        with pytest.raises(DBAPIError):                            # bronni o'chirish — huquq yo'q
            db.execute(text("DELETE FROM appointments WHERE id = :id"), {"id": appt})


def test_customer_sees_only_own_bookings(world):
    with api_session(uid(world["customer"])) as db:
        rows = db.execute(text("SELECT DISTINCT client_id FROM appointments")).all()
        assert {r[0] for r in rows} <= {world["client_a"]}
        # O'zi bron yarata olmaydi (keyinroq maxsus bron funksiyasi orqali bo'ladi)
        with pytest.raises(DBAPIError) as e:
            book(db, world["a"]["id"], world["client_a"], world["usta"]["member"]["id"], "2026-12-06 10:00+05", "2026-12-06 11:00+05")
        assert sqlstate(e) == "42501"


# ─── Hisob va huquqlar ──────────────────────────────────────────────────────
def test_cannot_make_self_superadmin(world):
    me = uid(world["customer"])
    with api_session(me) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("UPDATE users SET is_superadmin = true WHERE id = :id"), {"id": me})
        assert sqlstate(e) == "42501"                                # ustunga yozish huquqi yo'q
        db.rollback()
        with pytest.raises(DBAPIError) as e:
            db.execute(text("UPDATE users SET status = 'active', token_version = 0 WHERE id = :id"), {"id": me})
        assert sqlstate(e) == "42501"


def test_auth_tables_closed_for_api_role(world):
    with api_session(uid(world["a"]["owner"])) as db:
        for table in ("otp_codes", "refresh_tokens", "telegram_logins", "user_identities"):
            with pytest.raises(DBAPIError) as e:
                db.execute(text(f"SELECT * FROM {table} LIMIT 1"))
            assert sqlstate(e) == "42501"
            db.rollback()


def test_no_user_context_sees_nothing_private(world):
    with api_session(None) as db:
        assert db.execute(text("SELECT count(*) FROM users")).scalar() == 0
        assert db.execute(text("SELECT count(*) FROM appointments")).scalar() == 0
        assert db.execute(text("SELECT count(*) FROM business_clients")).scalar() == 0
        # Ochiq katalog (faol bizneslar) esa ko'rinadi
        assert db.execute(text("SELECT count(*) FROM businesses")).scalar() >= 2


def test_owner_cannot_unblock_or_change_own_status(world):
    a = world["a"]
    with api_session(uid(a["owner"])) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("UPDATE businesses SET status = 'active', rating_avg = 5 WHERE id = :id"), {"id": a["id"]})
        assert sqlstate(e) == "42501"
        db.rollback()
        # Profilni tahrirlash esa mumkin
        assert db.execute(text("UPDATE businesses SET description = 'Yangi' WHERE id = :id"), {"id": a["id"]}).rowcount == 1
        db.rollback()


def test_stock_cannot_go_negative_or_be_edited_directly(world):
    a, usta = world["a"], world["usta"]
    with api_session(uid(a["owner"])) as db:
        pid = db.execute(text("INSERT INTO products (business_id, name, unit) VALUES (:b, 'Shampun', 'ml') RETURNING id"),
                         {"b": a["id"]}).scalar()
        db.execute(text("INSERT INTO stock_movements (business_id, product_id, type, qty) VALUES (:b, :p, 'purchase', 500)"),
                   {"b": a["id"], "p": pid})
        db.commit()
        with pytest.raises(DBAPIError) as e:                          # qoldiqni qo'lda o'zgartirish
            db.execute(text("UPDATE products SET current_qty = 9999 WHERE id = :id"), {"id": pid})
        assert sqlstate(e) == "42501"
        db.rollback()
    with api_session(uid(usta["tokens"])) as db:
        # Usta o'zi ishlatganini yozadi
        db.execute(text("INSERT INTO stock_movements (business_id, product_id, type, qty, member_id) "
                        "VALUES (:b, :p, 'usage', -100, :m)"), {"b": a["id"], "p": pid, "m": usta["member"]["id"]})
        db.commit()
        with pytest.raises(DBAPIError) as e:                          # mavjuddan ko'p ishlatish
            db.execute(text("INSERT INTO stock_movements (business_id, product_id, type, qty, member_id) "
                            "VALUES (:b, :p, 'usage', -1000, :m)"), {"b": a["id"], "p": pid, "m": usta["member"]["id"]})
        assert sqlstate(e) == "P0414"
        db.rollback()
        with pytest.raises(DBAPIError) as e:                          # o'ziga kirim qilish
            db.execute(text("INSERT INTO stock_movements (business_id, product_id, type, qty, member_id) "
                            "VALUES (:b, :p, 'purchase', 1000, :m)"), {"b": a["id"], "p": pid, "m": usta["member"]["id"]})
        assert sqlstate(e) == "42501"
    with api_session(uid(a["owner"])) as db:
        assert db.execute(text("SELECT current_qty FROM products WHERE id = :id"), {"id": pid}).scalar() == 400


def test_member_cannot_write_notifications_to_anyone(world):
    """Usta yoki direktor boshqa odamga (mijozga) o'z nomidan push yoza olmaydi — faqat bazadagi funksiyalar yozadi."""
    victim = uid(world["customer"])
    for tokens in (world["a"]["owner"], world["usta"]["tokens"], world["customer"]):
        with api_session(uid(tokens)) as db:
            with pytest.raises(DBAPIError) as e:
                db.execute(text("INSERT INTO notifications (user_id, business_id, type, title) "
                                "VALUES (:u, :b, 'promo', 'Soxta xabar')"), {"u": victim, "b": world["a"]["id"]})
            assert sqlstate(e) == "42501"
            db.rollback()
            with pytest.raises(DBAPIError) as e:
                db.execute(text("DELETE FROM notifications"))
            assert sqlstate(e) == "42501"
            db.rollback()


def test_only_superadmin_writes_business_types(world, superadmin):
    """Muassasa turlari (tavsiya xizmatlar, ish vaqti) — direktor ham, mijoz ham o'zgartira olmaydi."""
    for tokens in (world["a"]["owner"], world["customer"]):
        with api_session(uid(tokens)) as db:
            assert db.execute(text("UPDATE business_categories SET name_uz = 'Buzildi'")).rowcount == 0
            assert db.execute(text("DELETE FROM business_categories")).rowcount == 0
            with pytest.raises(DBAPIError):
                db.execute(text("INSERT INTO business_categories (slug, name_uz, name_ru) VALUES ('hack', 'X', 'X')"))
            db.rollback()
    with api_session(uid(superadmin)) as db:
        assert db.execute(text("UPDATE business_categories SET sort_order = sort_order WHERE slug = 'pharmacy'")).rowcount == 1
        db.rollback()


# ─── Bekor qilish sabablari (048) ──────────────────────────────────────────
def test_cancel_reasons_rls(world):
    a, b = world["a"], world["b"]
    with api_session(uid(b["owner"])) as db:
        b_reason = db.execute(text("SELECT id FROM cancel_reasons WHERE business_id = :b LIMIT 1"),
                              {"b": b["id"]}).scalar()
    assert b_reason is not None                          # yangi muassasaga standart ro'yxat
    with api_session(uid(a["owner"])) as db:
        # Boshqa muassasa sabablari ko'rinmaydi va o'zgarmaydi
        assert {r[0] for r in db.execute(text("SELECT DISTINCT business_id FROM cancel_reasons"))} == {a["id"]}
        assert db.execute(text("UPDATE cancel_reasons SET name = 'xx' WHERE id = :id"), {"id": b_reason}).rowcount == 0
        assert db.execute(text("DELETE FROM cancel_reasons WHERE id = :id"), {"id": b_reason}).rowcount == 0
        with pytest.raises(DBAPIError) as e:
            db.execute(text("INSERT INTO cancel_reasons (business_id, name) VALUES (:b, 'Begona')"), {"b": b["id"]})
        assert sqlstate(e) == "42501"
        db.rollback()
        # O'z sababini boshqa muassasaga "ko'chirish" — yo'q
        own = db.execute(text("SELECT id FROM cancel_reasons LIMIT 1")).scalar()
        with pytest.raises(DBAPIError) as e:
            db.execute(text("UPDATE cancel_reasons SET business_id = :b WHERE id = :id"), {"b": b["id"], "id": own})
        assert sqlstate(e) == "42501"
        db.rollback()
    # Qabulxona o'qiydi, yoza olmaydi; usta umuman ko'rmaydi
    with api_session(uid(world["rec"]["tokens"])) as db:
        assert db.execute(text("SELECT count(*) FROM cancel_reasons")).scalar() > 0
        with pytest.raises(DBAPIError) as e:
            db.execute(text("INSERT INTO cancel_reasons (business_id, name) VALUES (:b, 'Qabul')"), {"b": a["id"]})
        assert sqlstate(e) == "42501"
        db.rollback()
    with api_session(uid(world["usta"]["tokens"])) as db:
        assert db.execute(text("SELECT count(*) FROM cancel_reasons")).scalar() == 0


def test_arrival_only_through_function_for_staff(world):
    """Usta checked_in_at ni faqat o'z broniga qo'ya oladi (RLS), mark_arrived ham shu qoidada."""
    a, usta = world["a"], world["usta"]
    with api_session(uid(a["owner"])) as db:
        other = add_staff_member_sql(db, a["id"])
        foreign = book(db, a["id"], world["client_a"], other, "2026-12-20 10:00+05", "2026-12-20 11:00+05")
        db.commit()
    with api_session(uid(usta["tokens"])) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("SELECT app.mark_arrived(:b, :id)"), {"b": a["id"], "id": foreign})
        assert sqlstate(e) == "P0002"
        db.rollback()
        assert db.execute(text("UPDATE appointments SET checked_in_at = now() WHERE id = :id"),
                          {"id": foreign}).rowcount == 0


# ─── Kalendar bloklari (049) ───────────────────────────────────────────────
def test_reception_can_block_but_not_grant_vacation(world):
    a, rec, usta = world["a"], world["rec"], world["usta"]["member"]["id"]
    with api_session(uid(rec["tokens"])) as db:
        db.execute(text("INSERT INTO staff_time_off (business_id, member_id, starts_at, ends_at, reason, is_block) "
                        "VALUES (:b, :m, '2026-12-21 13:00+05', '2026-12-21 14:00+05', 'Tushlik', TRUE)"),
                   {"b": a["id"], "m": usta})
        db.commit()
        # Ta'til (is_block = false) — faqat 'staff.manage' yoki xodimning o'zi
        with pytest.raises(DBAPIError) as e:
            db.execute(text("INSERT INTO staff_time_off (business_id, member_id, starts_at, ends_at, is_block) "
                            "VALUES (:b, :m, '2026-12-22', '2026-12-25', FALSE)"), {"b": a["id"], "m": usta})
        assert sqlstate(e) == "42501"
        db.rollback()
        # Blokni ta'tilga aylantirib bo'lmaydi
        with pytest.raises(DBAPIError) as e:
            db.execute(text("UPDATE staff_time_off SET is_block = FALSE WHERE member_id = :m AND is_block"), {"m": usta})
        assert sqlstate(e) == "42501"
        db.rollback()


def test_block_type_must_belong_to_same_business(world):
    a, b = world["a"], world["b"]
    with api_session(uid(b["owner"])) as db:
        b_type = db.execute(text("SELECT id FROM time_block_types LIMIT 1")).scalar()
    with api_session(uid(a["owner"])) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("INSERT INTO staff_time_off (business_id, member_id, starts_at, ends_at, is_block, block_type_id) "
                            "VALUES (:b, :m, '2026-12-23 10:00+05', '2026-12-23 11:00+05', TRUE, :t)"),
                       {"b": a["id"], "m": world["usta"]["member"]["id"], "t": b_type})
        assert sqlstate(e) == "23503"
        db.rollback()
        assert db.execute(text("UPDATE time_block_types SET name = 'xx' WHERE id = :id"), {"id": b_type}).rowcount == 0


# ─── Mijoz kartochkasi (050) ───────────────────────────────────────────────
def test_client_internal_card_hidden_from_customer_and_staff(world):
    a = world["a"]
    with api_session(uid(a["owner"])) as db:
        db.execute(text("INSERT INTO client_internal (business_id, client_id, tags, alert) "
                        "VALUES (:b, :c, ARRAY['VIP'], 'Maxfiy ogohlantirish') "
                        "ON CONFLICT (client_id) DO UPDATE SET alert = EXCLUDED.alert"),
                   {"b": a["id"], "c": world["client_a"]})
        db.execute(text("INSERT INTO client_notes (business_id, client_id, body) VALUES (:b, :c, 'Ichki eslatma')"),
                   {"b": a["id"], "c": world["client_a"]})
        db.commit()
    # Mijozning o'zi o'z business_clients qatorini ko'radi, lekin ichki kartochkani emas
    with api_session(uid(world["customer"])) as db:
        assert db.execute(text("SELECT count(*) FROM business_clients")).scalar() >= 1
        assert db.execute(text("SELECT count(*) FROM client_internal")).scalar() == 0
        assert db.execute(text("SELECT count(*) FROM client_notes")).scalar() == 0
    # Usta mijozlar bazasini ko'rmaydi
    with api_session(uid(world["usta"]["tokens"])) as db:
        assert db.execute(text("SELECT count(*) FROM client_internal")).scalar() == 0
        with pytest.raises(DBAPIError) as e:
            db.execute(text("INSERT INTO client_notes (business_id, client_id, body) VALUES (:b, :c, 'x')"),
                       {"b": a["id"], "c": world["client_a"]})
        assert sqlstate(e) == "42501"
        db.rollback()
    # Boshqa muassasa
    with api_session(uid(world["b"]["owner"])) as db:
        assert db.execute(text("SELECT count(*) FROM client_internal WHERE client_id = :c"),
                          {"c": world["client_a"]}).scalar() == 0
        with pytest.raises(DBAPIError) as e:
            db.execute(text("INSERT INTO client_internal (business_id, client_id, alert) VALUES (:b, :c, 'x')"),
                       {"b": a["id"], "c": world["client_a"]})
        assert sqlstate(e) == "42501"
        db.rollback()


def test_client_note_author_is_forced(world):
    """Eslatmani boshqa xodim nomidan yozib bo'lmaydi."""
    a = world["a"]
    with api_session(uid(world["rec"]["tokens"])) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("INSERT INTO client_notes (business_id, client_id, body, created_by) "
                            "VALUES (:b, :c, 'Soxta', :u)"),
                       {"b": a["id"], "c": world["client_a"], "u": uid(a["owner"])})
        assert sqlstate(e) == "42501"
        db.rollback()


# ─── Kutish ro'yxati (052) ─────────────────────────────────────────────────
def test_waitlist_rls(world):
    a = world["a"]
    with api_session(uid(a["owner"])) as db:
        svc = db.execute(text("INSERT INTO services (business_id, name, duration_min, price) "
                              "VALUES (:b, 'Navbat xizmati', 30, 1000) RETURNING id"), {"b": a["id"]}).scalar()
        entry = db.execute(text("INSERT INTO waitlist_entries (business_id, client_id, service_id, date_from, date_to) "
                                "VALUES (:b, :c, :s, current_date + 1, current_date + 2) RETURNING id"),
                           {"b": a["id"], "c": world["client_a"], "s": svc}).scalar()
        db.commit()
    # Mijoz o'z yozuvini ko'radi, lekin o'zgartira olmaydi (faqat funksiya orqali bekor qiladi)
    with api_session(uid(world["customer"])) as db:
        assert db.execute(text("SELECT count(*) FROM waitlist_entries WHERE id = :id"), {"id": entry}).scalar() == 1
        assert db.execute(text("UPDATE waitlist_entries SET status = 'booked' WHERE id = :id"), {"id": entry}).rowcount == 0
    # Usta va boshqa muassasa ko'rmaydi
    for tokens in (world["usta"]["tokens"], world["b"]["owner"]):
        with api_session(uid(tokens)) as db:
            assert db.execute(text("SELECT count(*) FROM waitlist_entries WHERE id = :id"), {"id": entry}).scalar() == 0
    # Ichki bo'sh vaqt yadrosi ilovaga yopiq
    with api_session(uid(a["owner"])) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("SELECT * FROM app.slots_core(1, 1, current_date, 30, NULL)"))
        assert sqlstate(e) == "42501"
