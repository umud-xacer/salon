"""Bron qilish, bekor qilish, ko'chirish: ikki marta bron, egalik, RLS, holatlar."""
import threading

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login
from tests.test_schedule import TZ, day_from_today, new_master, new_service, slots, url

API = "/api/v1/appointments"


def uid(tokens) -> int:
    return tokens["user"]["id"]


def customer(client) -> dict:
    return otp_login(client, new_phone(), "Mijoz Aliyev")


def at(day, clock) -> str:
    return f"{day}T{clock}:00{TZ}"


def book(client, tokens, master, service, day, clock, **extra):
    return client.post(API, headers=auth_header(tokens), json={
        "member_id": master["member"]["id"], "service_id": service["id"], "starts_at": at(day, clock), **extra})


@pytest.fixture(scope="module")
def biz(client, superadmin):
    return create_business(client, superadmin)


@pytest.fixture()
def setup(client, biz):
    s = new_service(client, biz, duration=60)
    return {"service": s, "master": new_master(client, biz, s), "day": day_from_today(biz, 1), "client": customer(client)}


def test_customer_books_and_slot_disappears(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    r = book(client, c, m, s, day, "10:00", note="Iltimos, vaqtida")
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["status"] == "pending" and a["total_price"] == 50000 and a["client_note"] == "Iltimos, vaqtida"
    assert a["services"] == [s["name"]] and a["business_id"] == biz["id"]
    assert a["member_name"] == "Xodim staff"

    free = slots(client, m, s, day)
    assert "10:00" not in free and "09:30" not in free and "10:30" not in free and "11:00" in free

    with api_session(uid(biz["owner"])) as db:
        row = db.execute(text("SELECT full_name, user_id FROM business_clients WHERE id = "
                              "(SELECT client_id FROM appointments WHERE id = :a)"), {"a": a["id"]}).one()
        assert row == ("Mijoz Aliyev", uid(c))
        assert db.scalar(text("SELECT count(*) FROM audit_logs WHERE entity_type = 'appointment' AND entity_id = :a"),
                         {"a": a["id"]}) == 1


def test_price_and_duration_come_from_server(client, biz):
    s = new_service(client, biz, duration=60)
    m = new_master(client, biz, s, custom_duration=90)
    r = client.put(url(biz, f"members/{m['member']['id']}/services"), headers=auth_header(biz["owner"]),
                   json={"services": [{"service_id": s["id"], "custom_price": 70000, "custom_duration": 90}]})
    assert r.status_code == 200
    a = book(client, customer(client), m, s, day_from_today(biz, 1), "09:00", total_price=1, ends_at="x").json()
    assert a["total_price"] == 70000
    assert a["ends_at"].endswith("05:30:00Z") or "10:30" in a["ends_at"]


def test_second_customer_gets_conflict(client, biz, setup):
    s, m, day = setup["service"], setup["master"], setup["day"]
    assert book(client, setup["client"], m, s, day, "10:00").status_code == 201
    other = customer(client)
    r = book(client, other, m, s, day, "10:00")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "time_conflict"
    assert book(client, other, m, s, day, "10:30").status_code == 409            # qisman ustma-ust
    assert book(client, other, m, s, day, "11:00").status_code == 201            # ketma-ket


def test_simultaneous_requests_only_one_wins(client, biz, setup):
    """Ikkala so'rov tekshiruvdan birga o'tsa ham EXCLUDE bittasini rad etadi."""
    s, m, day = setup["service"], setup["master"], setup["day"]
    users = [customer(client) for _ in range(8)]
    barrier = threading.Barrier(len(users))
    results = []

    def attempt(tokens):
        with api_session(uid(tokens)) as db:
            barrier.wait()
            try:
                db.execute(text("SELECT app.book_appointment(:m, :s, CAST(:t AS timestamptz))"),
                           {"m": m["member"]["id"], "s": s["id"], "t": at(day, "14:00")})
                db.commit()
                results.append("ok")
            except DBAPIError as e:
                db.rollback()
                results.append(e.orig.sqlstate)

    threads = [threading.Thread(target=attempt, args=(u,)) for u in users]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count("ok") == 1
    assert set(results) == {"ok", "23P01"}


@pytest.mark.parametrize("clock", ["13:00", "13:30", "12:30", "17:30", "08:00", "19:00", "09:03"])
def test_cannot_book_outside_available_time(client, biz, setup, clock):
    r = book(client, setup["client"], setup["master"], setup["service"], setup["day"], clock)
    assert r.status_code == 409, clock


def test_cannot_book_during_time_off_past_or_far_future(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    r = client.post(url(biz, f"members/{m['member']['id']}/time-off"), headers=auth_header(m["tokens"]), json={
        "starts_at": at(day, "15:00"), "ends_at": at(day, "16:00")})
    assert r.status_code == 201
    assert book(client, c, m, s, day, "15:00").status_code == 409
    assert book(client, c, m, s, day_from_today(biz, -1), "10:00").status_code == 422
    assert book(client, c, m, s, day_from_today(biz, 61), "10:00").status_code == 422


def test_invalid_input_and_login_required(client, biz, setup):
    s, m, day = setup["service"], setup["master"], setup["day"]
    body = {"member_id": m["member"]["id"], "service_id": s["id"], "starts_at": at(day, "10:00")}
    assert client.post(API, json=body).status_code == 401
    h = auth_header(setup["client"])
    assert client.post(API, headers=h, json={**body, "starts_at": f"{day}T10:00:00"}).status_code == 422
    assert client.post(API, headers=h, json={**body, "note": "x" * 501}).status_code == 422
    assert client.post(API, headers=h, json={**body, "service_id": 10 ** 9}).status_code == 404
    assert client.post(API, headers=h, json={**body, "member_id": 10 ** 9}).status_code == 404


def test_unlisted_business_and_disabled_module(client, superadmin):
    hidden = create_business(client, superadmin)
    s, day = new_service(client, hidden), day_from_today(hidden, 1)
    m = new_master(client, hidden, s)
    c = customer(client)
    h = auth_header(hidden["owner"])
    assert client.patch(url(hidden, "profile"), headers=h, json={"is_listed": False}).status_code == 200
    assert book(client, c, m, s, day, "10:00").status_code == 404
    assert client.patch(url(hidden, "profile"), headers=h, json={"is_listed": True}).status_code == 200

    r = client.put(f"/api/v1/superadmin/businesses/{hidden['id']}/modules/booking",
                   headers=auth_header(superadmin), json={"enabled": False})
    assert r.status_code in (200, 204), r.text
    assert book(client, c, m, s, day, "10:00").status_code == 404


def test_booking_limit_per_customer(client, biz, setup):
    s, m, c = setup["service"], setup["master"], setup["client"]
    day = day_from_today(biz, 6)
    for clock in ("09:00", "10:00", "11:00", "12:00", "14:00"):
        assert book(client, c, m, s, day, clock).status_code == 201
    r = book(client, c, m, s, day, "15:00")
    assert r.status_code == 429


def test_cancel_frees_slot_for_someone_else(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    a = book(client, c, m, s, day, "10:00").json()
    r = client.post(f"{API}/{a['id']}/cancel", headers=auth_header(c), json={"reason": "Reja o'zgardi"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled" and r.json()["cancel_reason"] == "Reja o'zgardi"
    assert "10:00" in slots(client, m, s, day)
    assert book(client, customer(client), m, s, day, "10:00").status_code == 201
    # Ikkinchi marta bekor qilib bo'lmaydi
    assert client.post(f"{API}/{a['id']}/cancel", headers=auth_header(c), json={}).status_code == 409


def test_owner_and_receptionist_can_cancel_staff_cannot(client, biz, setup):
    s, m, day = setup["service"], setup["master"], setup["day"]
    a = book(client, setup["client"], m, s, day, "10:00").json()
    b = book(client, setup["client"], m, s, day, "12:00").json()
    # Usta bronni ko'radi, lekin bekor qila olmaydi
    assert client.get(f"{API}/{a['id']}", headers=auth_header(m["tokens"])).status_code == 200
    assert client.post(f"{API}/{a['id']}/cancel", headers=auth_header(m["tokens"]), json={}).status_code == 404
    assert client.post(f"{API}/{a['id']}/cancel", headers=auth_header(biz["owner"]), json={}).status_code == 200
    rec = add_member(client, biz, "receptionist")
    assert client.post(f"{API}/{b['id']}/cancel", headers=auth_header(rec["tokens"]), json={}).status_code == 200


def test_reschedule(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    a = book(client, c, m, s, day, "10:00").json()

    # O'z vaqti bilan ustma-ust tushadigan yangi vaqt (10:30) — ruxsat
    r = client.post(f"{API}/{a['id']}/reschedule", headers=auth_header(c), json={"starts_at": at(day, "10:30")})
    assert r.status_code == 200, r.text
    free = slots(client, m, s, day)
    assert "09:30" in free and "10:00" not in free and "11:00" not in free and "11:30" in free

    # Band yoki ishdan tashqari vaqtga — yo'q, eski vaqt saqlanadi
    assert book(client, customer(client), m, s, day, "14:00").status_code == 201
    for clock in ("14:00", "13:00", "07:00"):
        r = client.post(f"{API}/{a['id']}/reschedule", headers=auth_header(c), json={"starts_at": at(day, clock)})
        assert r.status_code == 409, clock
    assert "10:30" in client.get(f"{API}/{a['id']}", headers=auth_header(c)).json()["starts_at"] or \
        client.get(f"{API}/{a['id']}", headers=auth_header(c)).json()["starts_at"].endswith("05:30:00Z")


def test_reschedule_confirmation_rules(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    a = book(client, c, m, s, day, "09:00").json()
    h = auth_header(biz["owner"])
    path = url(biz, f"appointments/{a['id']}/status")
    assert client.patch(path, headers=h, json={"status": "confirmed"}).json()["status"] == "confirmed"

    # Salon ko'chirsa — tasdiq saqlanadi; mijoz ko'chirsa — qayta tasdiqlash kerak
    r = client.post(f"{API}/{a['id']}/reschedule", headers=h, json={"starts_at": at(day, "10:00")})
    assert r.json()["status"] == "confirmed"
    r = client.post(f"{API}/{a['id']}/reschedule", headers=auth_header(c), json={"starts_at": at(day, "11:00")})
    assert r.json()["status"] == "pending"


def test_started_or_past_booking_cannot_change(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    a = book(client, c, m, s, day, "09:00").json()
    h = auth_header(biz["owner"])
    client_id = None
    with api_session(uid(biz["owner"])) as db:
        client_id = db.scalar(text("SELECT client_id FROM appointments WHERE id = :a"), {"a": a["id"]})
        past = db.scalar(text("""
            INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at)
            VALUES (:b, :c, :m, now() - interval '2 hours', now() - interval '1 hour') RETURNING id
        """), {"b": biz["id"], "c": client_id, "m": m["member"]["id"]})
        db.commit()
    assert client.post(f"{API}/{past}/cancel", headers=auth_header(c), json={}).status_code == 409
    assert client.post(f"{API}/{past}/reschedule", headers=auth_header(c),
                       json={"starts_at": at(day, "11:00")}).status_code == 409

    assert client.patch(url(biz, f"appointments/{a['id']}/status"), headers=h,
                        json={"status": "in_progress"}).status_code == 200
    assert client.post(f"{API}/{a['id']}/cancel", headers=auth_header(c), json={}).status_code == 409


def test_customer_sees_only_own_and_cannot_touch_others(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    a = book(client, c, m, s, day, "10:00").json()
    stranger = customer(client)
    h = auth_header(stranger)
    b = book(client, stranger, m, s, day, "12:00").json()

    assert [x["id"] for x in client.get(f"{API}/mine", headers=auth_header(c)).json()] == [a["id"]]
    assert [x["id"] for x in client.get(f"{API}/mine", headers=h).json()] == [b["id"]]
    # Boshqaning broni: mavjudligi ham oshkor bo'lmaydi
    assert client.get(f"{API}/{a['id']}", headers=h).status_code == 404
    assert client.post(f"{API}/{a['id']}/cancel", headers=h, json={}).status_code == 404
    assert client.post(f"{API}/{a['id']}/reschedule", headers=h, json={"starts_at": at(day, "15:00")}).status_code == 404
    assert client.get(f"{API}/{a['id']}", headers=auth_header(c)).json()["status"] == "pending"

    # Salon ro'yxati mijozga yopiq
    assert client.get(url(biz, "appointments"), headers=h, params={"date": str(day)}).status_code == 403


def test_rls_blocks_direct_sql_from_customer(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    a = book(client, c, m, s, day, "10:00").json()
    stranger = customer(client)
    book(client, stranger, m, s, day, "12:00")

    with api_session(uid(stranger)) as db:
        ids = {r[0] for r in db.execute(text("SELECT id FROM appointments"))}
        assert a["id"] not in ids and len(ids) == 1
        assert db.scalar(text("SELECT count(*) FROM appointment_services WHERE appointment_id = :a"), {"a": a["id"]}) == 0
        assert db.scalar(text("SELECT count(*) FROM business_clients WHERE user_id = :u"), {"u": uid(c)}) == 0
        # Begona bronni ham, o'z bronini ham API'siz o'zgartirib bo'lmaydi
        assert db.execute(text("UPDATE appointments SET status = 'cancelled' WHERE id = :a"), {"a": a["id"]}).rowcount == 0
        assert db.execute(text("UPDATE appointments SET total_price = 0")).rowcount == 0
        with pytest.raises(DBAPIError) as e:
            db.execute(text("DELETE FROM appointments WHERE id = :a"), {"a": a["id"]})
        assert e.value.orig.sqlstate == "42501"
        db.rollback()

    # Ichki hisob funksiyasi ilovaga yopiq (p_exclude orqali begona bronni aniqlab bo'lmasin)
    with api_session(uid(stranger)) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("SELECT * FROM app.compute_slots(1, 1, current_date, 30, NULL)"))
        assert e.value.orig.sqlstate == "42501"


def test_other_salon_owner_cannot_touch(client, superadmin, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    a = book(client, c, m, s, day, "10:00").json()
    other = create_business(client, superadmin)
    h = auth_header(other["owner"])
    assert client.get(f"{API}/{a['id']}", headers=h).status_code == 404
    assert client.post(f"{API}/{a['id']}/cancel", headers=h, json={}).status_code == 404
    assert client.post(f"{API}/{a['id']}/reschedule", headers=h, json={"starts_at": at(day, "15:00")}).status_code == 404
    assert client.get(url(biz, "appointments"), headers=h, params={"date": str(day)}).status_code == 403
    assert client.patch(url(other, f"appointments/{a['id']}/status"), headers=h,
                        json={"status": "confirmed"}).status_code == 404


def test_business_list_by_role(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    other_master = new_master(client, biz, s)
    day = day_from_today(biz, 7)
    mine = book(client, c, m, s, day, "10:00").json()
    theirs = book(client, c, other_master, s, day, "10:00").json()

    owner = client.get(url(biz, "appointments"), headers=auth_header(biz["owner"]), params={"date": str(day)}).json()
    assert {mine["id"], theirs["id"]} <= {x["id"] for x in owner}
    row = next(x for x in owner if x["id"] == mine["id"])
    assert row["client_name"] == "Mijoz Aliyev" and row["client_phone"].startswith("+998")

    by_master = client.get(url(biz, "appointments"), headers=auth_header(biz["owner"]),
                           params={"date": str(day), "member_id": other_master["member"]["id"]}).json()
    assert [x["id"] for x in by_master] == [theirs["id"]]

    # Usta faqat o'zinikini ko'radi va mijoz telefonini ko'rmaydi
    staff = client.get(url(biz, "appointments"), headers=auth_header(m["tokens"]), params={"date": str(day)}).json()
    assert [x["id"] for x in staff] == [mine["id"]]
    assert staff[0]["client_phone"] is None


def test_status_changes_by_role(client, biz, setup):
    s, m, day, c = setup["service"], setup["master"], setup["day"], setup["client"]
    a = book(client, c, m, s, day, "10:00").json()
    path = url(biz, f"appointments/{a['id']}/status")
    staff = auth_header(m["tokens"])

    assert client.patch(path, headers=staff, json={"status": "confirmed"}).status_code == 403     # tasdiqlash — salon ishi
    assert client.patch(path, headers=staff, json={"status": "cancelled"}).status_code == 422     # bu yo'l bilan emas
    assert client.patch(path, headers=auth_header(biz["owner"]), json={"status": "confirmed"}).status_code == 200
    assert client.patch(path, headers=staff, json={"status": "in_progress"}).status_code == 200
    r = client.patch(path, headers=staff, json={"status": "completed"})
    assert r.status_code == 200 and r.json()["status"] == "completed"
    assert client.patch(path, headers=staff, json={"status": "no_show"}).status_code == 404       # yopilgan bron

    # Boshqa ustaning broniga tegib bo'lmaydi
    other = new_master(client, biz, s)
    b = book(client, c, other, s, day, "14:00").json()
    r = client.patch(url(biz, f"appointments/{b['id']}/status"), headers=staff, json={"status": "in_progress"})
    assert r.status_code == 404
