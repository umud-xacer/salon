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
        for table in ("otp_codes", "refresh_tokens"):
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
        assert sqlstate(e) == "23514"
        db.rollback()
        with pytest.raises(DBAPIError) as e:                          # o'ziga kirim qilish
            db.execute(text("INSERT INTO stock_movements (business_id, product_id, type, qty, member_id) "
                            "VALUES (:b, :p, 'purchase', 1000, :m)"), {"b": a["id"], "p": pid, "m": usta["member"]["id"]})
        assert sqlstate(e) == "42501"
    with api_session(uid(a["owner"])) as db:
        assert db.execute(text("SELECT current_qty FROM products WHERE id = :id"), {"id": pid}).scalar() == 400
