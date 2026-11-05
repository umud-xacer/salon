"""Tasdiqlanmagan bronlarni avtomatik bekor qilish (sql/030_expire_pending.sql)."""
import os

import pytest
from sqlalchemy import create_engine, text

from app import worker
from tests.conftest import auth_header, create_business, new_phone, otp_login
from tests.test_schedule import new_master, new_service


@pytest.fixture(scope="module")
def admin():
    engine = create_engine(os.environ["MIGRATION_DATABASE_URL"])
    yield engine
    engine.dispose()


@pytest.fixture(scope="module")
def setup(client, superadmin, admin):
    biz = create_business(client, superadmin)
    s = new_service(client, biz)
    master = new_master(client, biz, s)
    customer = otp_login(client, new_phone(), "Nodira Mijoz")
    with admin.begin() as c:
        client_id = c.execute(text("""
            INSERT INTO business_clients (business_id, user_id, full_name, phone) VALUES (:b, :u, 'Nodira Mijoz', :p)
            RETURNING id"""), {"b": biz["id"], "u": customer["user"]["id"], "p": customer["user"]["phone"]}).scalar()
        # Ish vaqti: har kuni 09:00–18:00 (Toshkent)
        c.execute(text("DELETE FROM business_hours WHERE business_id = :b"), {"b": biz["id"]})
        c.execute(text("INSERT INTO business_hours (business_id, weekday, opens_at, closes_at) "
                       "SELECT :b, d, '09:00', '18:00' FROM generate_series(1, 7) d"), {"b": biz["id"]})
    return {"biz": biz, "master": master, "customer": customer, "client_id": client_id}


def deadline(admin, biz, created: str, starts: str) -> str:
    with admin.connect() as c:
        return c.execute(text("""
            SELECT to_char(app.confirm_deadline(:b, CAST(:c AS timestamptz), CAST(:s AS timestamptz))
                           AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD HH24:MI')"""),
            {"b": biz["id"], "c": created, "s": starts}).scalar()


def test_deadline_counts_working_hours(admin, setup):
    biz = setup["biz"]
    far = "2027-03-20 15:00+05"
    assert deadline(admin, biz, "2027-03-10 10:00+05", far) == "2027-03-10 11:00"   # ish vaqtida: +60 daqiqa
    assert deadline(admin, biz, "2027-03-10 23:00+05", far) == "2027-03-11 10:00"   # kechasi: ertalab ochilgach
    assert deadline(admin, biz, "2027-03-10 07:30+05", far) == "2027-03-10 10:00"   # ochilishdan oldin
    # Bron vaqti muddatdan oldin kelsa — bron vaqtida
    assert deadline(admin, biz, "2027-03-10 23:00+05", "2027-03-11 09:30+05") == "2027-03-11 09:30"
    # Direktor muddatni o'zgartirsa
    with admin.begin() as c:
        c.execute(text("UPDATE businesses SET confirm_timeout_min = 30 WHERE id = :b"), {"b": biz["id"]})
    assert deadline(admin, biz, "2027-03-10 10:00+05", far) == "2027-03-10 10:30"
    with admin.begin() as c:
        c.execute(text("UPDATE businesses SET confirm_timeout_min = 60 WHERE id = :b"), {"b": biz["id"]})


def make(admin, setup, *, starts_in_min: int, created: str, status="pending") -> int:
    with admin.begin() as c:
        return c.execute(text(f"""
            INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status, created_at)
            VALUES (:b, :c, :m, now() + make_interval(mins => :x), now() + make_interval(mins => :x + 30),
                    CAST(:st AS appointment_status), {created}) RETURNING id"""),
            {"b": setup["biz"]["id"], "c": setup["client_id"], "m": setup["master"]["member"]["id"],
             "x": starts_in_min, "st": status}).scalar()


def state(admin, appointment_id):
    with admin.connect() as c:
        return c.execute(text("SELECT status::text, cancel_reason FROM appointments WHERE id = :a"),
                         {"a": appointment_id}).one()


def test_worker_cancels_unconfirmed_and_frees_slot(client, admin, setup):
    biz = setup["biz"]
    # Ish vaqti ta'sir qilmasin: kun bo'yi ochiq
    with admin.begin() as c:
        c.execute(text("UPDATE business_hours SET opens_at = '00:00', closes_at = '23:59' WHERE business_id = :b"),
                  {"b": biz["id"]})
    overdue = make(admin, setup, starts_in_min=24 * 60, created="now() - interval '2 hours'")
    started = make(admin, setup, starts_in_min=-10, created="now() - interval '20 minutes'")
    fresh = make(admin, setup, starts_in_min=3 * 60, created="now() - interval '10 minutes'")
    confirmed = make(admin, setup, starts_in_min=-60, created="now() - interval '1 day'", status="confirmed")

    # API mijozga "qachongacha" ni ko'rsatadi
    mine = client.get("/api/v1/appointments/mine?upcoming=false", headers=auth_header(setup["customer"])).json()
    assert next(a for a in mine if a["id"] == fresh)["confirm_by"] is not None
    assert next(a for a in mine if a["id"] == confirmed)["confirm_by"] is None

    result = worker.run_once()
    assert result["auto_cancelled"] >= 2
    s, reason = state(admin, overdue)
    assert s == "cancelled" and "tasdiqlamadi" in reason
    s, reason = state(admin, started)
    assert s == "cancelled" and "vaqti o'tdi" in reason
    assert state(admin, fresh)[0] == "pending"
    assert state(admin, confirmed)[0] == "confirmed"                 # tasdiqlanganiga tegilmaydi

    # Mijozga xabar, jurnalga yozuv
    inbox = client.get("/api/v1/notifications", headers=auth_header(setup["customer"])).json()
    ids = {n["data"]["appointment_id"] for n in inbox if n["type"] == "appointment_cancelled"}
    assert {overdue, started} <= ids
    with admin.connect() as c:
        n = c.execute(text("SELECT count(*) FROM audit_logs WHERE action = 'auto_cancel' AND entity_id IN (:a, :b)"),
                      {"a": overdue, "b": started}).scalar()
    assert n == 2

    # Vaqt bo'shadi: aynan shu vaqtga boshqa bron qo'yish mumkin
    with admin.begin() as c:
        c.execute(text("""
            INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status)
            SELECT business_id, client_id, member_id, starts_at, ends_at, 'confirmed' FROM appointments WHERE id = :a"""),
            {"a": overdue})

    # Takroriy ishga tushirish hech narsani o'zgartirmaydi
    assert worker.expire_pending() == 0
