"""Kutish ro'yxati (052_waitlist.sql)."""
import pytest
from sqlalchemy import text

from app.db.session import worker_session
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login
from tests.test_appointments import at
from tests.test_reception_mode import url
from tests.test_schedule import day_from_today, new_master, new_service


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance"))


@pytest.fixture()
def ctx(client, biz):
    service = new_service(client, biz, duration=60)
    master = new_master(client, biz, service)
    return {"service": service, "master": master, "day": day_from_today(biz, 1)}


def book(client, biz, ctx, clock, tokens=None):
    return client.post(url(biz, "reception/appointments"), headers=auth_header(tokens or biz["owner"]), json={
        "member_id": ctx["master"]["member"]["id"], "service_id": ctx["service"]["id"],
        "starts_at": at(ctx["day"], clock), "client_name": "Band Mijoz", "client_phone": new_phone()})


def fill_day(client, biz, ctx):
    """Ustaning ertangi butun kuni band (09:00–19:00, 1 soatlik bronlar); 13:00 — tushlik."""
    ids = {}
    for h in range(9, 19):
        r = book(client, biz, ctx, f"{h:02d}:00")
        if r.status_code == 201:
            ids[f"{h:02d}:00"] = r.json()["id"]
    return ids


def add(client, biz, ctx, tokens=None, **extra):
    body = {"client_name": "Kutuvchi Mijoz", "client_phone": new_phone(), "service_id": ctx["service"]["id"],
            "member_id": ctx["master"]["member"]["id"], "date_from": str(ctx["day"]), "date_to": str(ctx["day"]),
            **extra}
    return client.post(url(biz, "waitlist"), headers=auth_header(tokens or biz["owner"]), json=body)


def test_entry_waits_then_gets_offer_when_booking_cancelled(client, biz, ctx):
    rec = add_member(client, biz, "receptionist")
    booked = fill_day(client, biz, ctx)
    r = add(client, biz, ctx, rec["tokens"], time_from="10:00", time_to="12:00", note="Ertalab bo'lsa yaxshi")
    assert r.status_code == 201, r.text
    entry = r.json()
    assert entry["status"] == "waiting" and entry["position"] == 1

    # 15:00 bekor qilindi — mijoz oralig'iga (10–12) to'g'ri kelmaydi
    client.post(f"/api/v1/appointments/{booked['15:00']}/cancel", headers=auth_header(rec["tokens"]), json={})
    assert client.get(url(biz, "waitlist"), headers=auth_header(rec["tokens"])).json()[0]["status"] == "waiting"

    # 11:00 bekor qilindi — darhol taklif
    client.post(f"/api/v1/appointments/{booked['11:00']}/cancel", headers=auth_header(rec["tokens"]), json={})
    got = client.get(url(biz, "waitlist"), headers=auth_header(rec["tokens"])).json()[0]
    assert got["status"] == "offered" and got["offered_starts_at"].startswith(f"{ctx['day']}T06:00")  # 11:00 Toshkent
    assert client.get(url(biz, "waitlist/summary"), headers=auth_header(rec["tokens"])).json() == {"waiting": 0, "offered": 1}

    # Bir bosishda bron
    r = client.post(url(biz, f"waitlist/{entry['id']}/book"), headers=auth_header(rec["tokens"]), json={})
    assert r.status_code == 200, r.text
    done = r.json()
    assert done["status"] == "booked" and done["appointment_id"]
    appt = client.get(f"/api/v1/appointments/{done['appointment_id']}", headers=auth_header(rec["tokens"])).json()
    assert appt["client_name"] == "Kutuvchi Mijoz" and appt["client_note"] == "Ertalab bo'lsa yaxshi"


def test_queue_order_one_slot_one_offer(client, biz, ctx):
    booked = fill_day(client, biz, ctx)
    first = add(client, biz, ctx).json()
    second = add(client, biz, ctx).json()
    assert second["position"] == 2
    client.post(f"/api/v1/appointments/{booked['16:00']}/cancel", headers=auth_header(biz["owner"]), json={})
    rows = {r["id"]: r for r in client.get(url(biz, "waitlist"), headers=auth_header(biz["owner"])).json()}
    assert rows[first["id"]]["status"] == "offered"            # avval yozilgan — avval oladi
    assert rows[second["id"]]["status"] == "waiting"           # bitta vaqt — bitta taklif

    # Birinchisi voz kechdi — taklif ikkinchisiga o'tadi
    client.post(url(biz, f"waitlist/{first['id']}/cancel"), headers=auth_header(biz["owner"]))
    rows = {r["id"]: r for r in client.get(url(biz, "waitlist?state=all"), headers=auth_header(biz["owner"])).json()}
    assert rows[first["id"]]["status"] == "cancelled" and rows[second["id"]]["status"] == "offered"


def test_offer_returns_to_waiting_when_slot_taken(client, biz, ctx):
    booked = fill_day(client, biz, ctx)
    entry = add(client, biz, ctx).json()
    client.post(f"/api/v1/appointments/{booked['17:00']}/cancel", headers=auth_header(biz["owner"]), json={})
    assert book(client, biz, ctx, "17:00").status_code == 201    # kimdir boshqa yo'l bilan egalladi
    client.post(url(biz, "waitlist/scan"), headers=auth_header(biz["owner"]))
    row = next(r for r in client.get(url(biz, "waitlist"), headers=auth_header(biz["owner"])).json()
               if r["id"] == entry["id"])
    assert row["status"] == "waiting" and row["offered_starts_at"] is None


def test_immediate_offer_when_free_time_exists(client, biz, ctx):
    r = add(client, biz, ctx)
    assert r.status_code == 201 and r.json()["status"] == "offered"


def test_app_customer_joins_gets_push_and_auto_closes_after_booking(client, biz, ctx):
    booked = fill_day(client, biz, ctx)
    customer = otp_login(client, new_phone(), "Ilova Kutuvchi")
    r = client.post("/api/v1/waitlist", headers=auth_header(customer), json={
        "business_id": biz["id"], "service_id": ctx["service"]["id"], "date_from": str(ctx["day"]),
        "date_to": str(ctx["day"])})
    assert r.status_code == 201, r.text
    entry = r.json()
    assert entry["status"] == "waiting" and entry["source"] == "app"

    client.post(f"/api/v1/appointments/{booked['14:00']}/cancel", headers=auth_header(biz["owner"]), json={})
    mine = client.get("/api/v1/waitlist/mine", headers=auth_header(customer)).json()
    assert mine[0]["status"] == "offered"
    notes = client.get("/api/v1/notifications", headers=auth_header(customer)).json()
    offer = next(n for n in notes if n["type"] == "waitlist_offer")
    assert offer["data"]["waitlist_id"] == entry["id"]

    # Mijoz ilovadan o'zi bron qildi — yozuv avtomatik "booked"
    r = client.post("/api/v1/appointments", headers=auth_header(customer), json={
        "member_id": ctx["master"]["member"]["id"], "service_id": ctx["service"]["id"],
        "starts_at": mine[0]["offered_starts_at"]})
    assert r.status_code == 201, r.text
    with worker_session() as db:
        db.scalar(text("SELECT app.waitlist_scan()"))
        db.commit()
    assert client.get("/api/v1/waitlist/mine", headers=auth_header(customer)).json()[0]["status"] == "booked"


def test_customer_limits_and_privacy(client, superadmin, biz, ctx):
    customer = otp_login(client, new_phone(), "Mijoz")
    body = {"business_id": biz["id"], "service_id": ctx["service"]["id"], "date_from": str(ctx["day"]),
            "date_to": str(ctx["day"])}
    ids = [client.post("/api/v1/waitlist", headers=auth_header(customer), json=body).json()["id"] for _ in range(3)]
    assert client.post("/api/v1/waitlist", headers=auth_header(customer), json=body).status_code == 429
    assert client.post(f"/api/v1/waitlist/{ids[0]}/cancel", headers=auth_header(customer)).json()["status"] == "cancelled"

    other = otp_login(client, new_phone(), "Begona")
    assert client.post(f"/api/v1/waitlist/{ids[1]}/cancel", headers=auth_header(other)).status_code == 404
    assert client.get("/api/v1/waitlist/mine", headers=auth_header(other)).json() == []
    # Usta va boshqa muassasa ro'yxatni ko'rmaydi
    assert client.get(url(biz, "waitlist"), headers=auth_header(ctx["master"]["tokens"])).status_code == 403
    stranger = create_business(client, superadmin)
    r = client.post(f"/api/v1/businesses/{stranger['id']}/waitlist/{ids[1]}/cancel", headers=auth_header(stranger["owner"]))
    assert r.status_code == 404


def test_validation(client, biz, ctx):
    assert add(client, biz, ctx, date_to="2000-01-01").status_code == 422
    assert add(client, biz, ctx, time_from="12:00").status_code == 422
    assert add(client, biz, ctx, time_from="12:00", time_to="11:00").status_code == 422
    other = new_service(client, biz)
    assert add(client, biz, ctx, service_id=other["id"]).status_code == 404     # usta bu xizmatni qilmaydi


def test_expired_entries(client, biz, ctx):
    entry = add(client, biz, ctx).json()
    from app.db.session import api_session
    with api_session(biz["owner"]["user"]["id"]) as db:      # sanani o'tgan kunlarga surish (test uchun)
        db.execute(text("UPDATE waitlist_entries SET date_from = date_from - 3, date_to = date_to - 3 WHERE id = :id"),
                   {"id": entry["id"]})
        db.commit()
    client.post(url(biz, "waitlist/scan"), headers=auth_header(biz["owner"]))
    rows = client.get(url(biz, "waitlist?state=done"), headers=auth_header(biz["owner"])).json()
    assert any(r["id"] == entry["id"] and r["status"] == "expired" for r in rows)
