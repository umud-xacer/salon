"""Qabulxona: mijoz nomidan bron, istalgan usta, kalendar, huquqlar."""
import threading

import pytest

from tests.conftest import add_member, auth_header, create_business, new_phone
from tests.test_appointments import at
from tests.test_schedule import day_from_today, new_master, new_service


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin)


@pytest.fixture()
def ctx(client, biz):
    service = new_service(client, biz, duration=60)
    return {"service": service, "a": new_master(client, biz, service), "b": new_master(client, biz, service),
            "day": day_from_today(biz, 1), "rec": add_member(client, biz, "receptionist")}


def post(client, biz, ctx, clock="10:00", member=None, tokens=None, **extra):
    body = {"service_id": ctx["service"]["id"], "starts_at": at(ctx["day"], clock),
            "client_name": "Dilshod Ergashev", "client_phone": new_phone(), **extra}
    if member:
        body["member_id"] = member["member"]["id"]
    return client.post(f"/api/v1/businesses/{biz['id']}/reception/appointments",
                       headers=auth_header(tokens or ctx["rec"]["tokens"]), json=body)


def test_receptionist_books_for_client(client, biz, ctx):
    phone = new_phone()
    r = post(client, biz, ctx, member=ctx["a"], client_phone=phone)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["member_id"] == ctx["a"]["member"]["id"] and a["status"] == "confirmed"
    assert a["client_name"] == "Dilshod Ergashev" and a["client_phone"] == phone
    assert a["total_price"] == ctx["service"]["price"]

    # Shu vaqt shu ustada endi band
    assert post(client, biz, ctx, member=ctx["a"]).status_code == 409


def test_existing_client_name_is_not_overwritten(client, biz, ctx):
    phone = new_phone()
    post(client, biz, ctx, "10:00", ctx["a"], client_phone=phone, client_name="Asl Ism")
    r = post(client, biz, ctx, "12:00", ctx["a"], client_phone=phone, client_name="Boshqa Ism")
    assert r.json()["client_name"] == "Asl Ism"


def test_any_staff_picks_least_busy_then_fills_up(client, biz, ctx):
    assert post(client, biz, ctx, "09:00", ctx["a"]).status_code == 201   # a da 1 ta bron

    first = post(client, biz, ctx, "11:00").json()
    assert first["member_id"] == ctx["b"]["member"]["id"]                 # kam band usta

    second = post(client, biz, ctx, "11:00").json()
    assert second["member_id"] == ctx["a"]["member"]["id"]                # shu vaqtda faqat a qoldi

    r = post(client, biz, ctx, "11:00")
    assert r.status_code == 409                                           # hamma band


def test_any_staff_only_masters_of_this_service(client, biz, ctx):
    other = new_service(client, biz, duration=30)
    only = new_master(client, biz, other)
    r = post(client, biz, ctx, service_id=other["id"])
    assert r.status_code == 201 and r.json()["member_id"] == only["member"]["id"]


def test_any_staff_simultaneous_requests_do_not_double_book(client, biz, ctx):
    results = []
    barrier = threading.Barrier(4)

    def attempt():
        barrier.wait()
        results.append(post(client, biz, ctx, "14:00").status_code)

    threads = [threading.Thread(target=attempt) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [201, 201, 409, 409]                        # 2 usta, 2 bron


def test_slots_count_free_staff(client, biz, ctx):
    url = f"/api/v1/businesses/{biz['id']}/reception/slots"
    h = auth_header(ctx["rec"]["tokens"])
    params = {"service_id": ctx["service"]["id"], "date": str(ctx["day"])}
    before = {s["time"]: s["free_staff"] for s in client.get(url, headers=h, params=params).json()}
    assert before["10:00"] == 2

    post(client, biz, ctx, "10:00", ctx["a"])
    after = {s["time"]: s["free_staff"] for s in client.get(url, headers=h, params=params).json()}
    assert after["10:00"] == 1


def test_outside_hours_and_past_are_rejected(client, biz, ctx):
    assert post(client, biz, ctx, "03:00").status_code == 409
    past = day_from_today(biz, -1)
    assert post(client, biz, ctx, starts_at=at(past, "10:00")).status_code in (409, 422)


def test_validation(client, biz, ctx):
    assert post(client, biz, ctx, client_phone="123").status_code == 422
    assert post(client, biz, ctx, client_name="  ").status_code == 422
    assert post(client, biz, ctx, service_id=999999).status_code == 404
    other = new_service(client, biz, duration=30)
    assert post(client, biz, ctx, service_id=other["id"], member=ctx["a"]).status_code == 404


def test_staff_and_other_salon_cannot_book_or_read(client, superadmin, biz, ctx):
    assert post(client, biz, ctx, tokens=ctx["a"]["tokens"]).status_code == 403
    h = auth_header(ctx["a"]["tokens"])
    b = f"/api/v1/businesses/{biz['id']}"
    assert client.get(f"{b}/calendar", headers=h, params={"start": str(ctx["day"])}).status_code == 403
    assert client.get(f"{b}/reception/options", headers=h).status_code == 403
    assert client.get(f"{b}/clients", headers=h, params={"q": "99"}).status_code == 403

    stranger = create_business(client, superadmin)
    assert post(client, biz, ctx, tokens=stranger["owner"]).status_code == 403
    assert post(client, stranger, ctx, tokens=ctx["rec"]["tokens"]).status_code == 403


def test_suspended_business_cannot_book(client, superadmin, biz, ctx):
    r = client.patch(f"/api/v1/superadmin/businesses/{biz['id']}/subscription",
                     headers=auth_header(superadmin), json={"is_active": False})
    assert r.status_code == 200
    assert post(client, biz, ctx).status_code == 403


def test_calendar_returns_week_and_hides_cancelled(client, biz, ctx):
    kept = post(client, biz, ctx, "10:00", ctx["a"]).json()
    gone = post(client, biz, ctx, "12:00", ctx["a"]).json()
    h = auth_header(ctx["rec"]["tokens"])
    assert client.post(f"/api/v1/appointments/{gone['id']}/cancel", headers=h, json={}).status_code == 200

    r = client.get(f"/api/v1/businesses/{biz['id']}/calendar", headers=h,
                   params={"start": str(ctx["day"]), "days": 7})
    assert r.status_code == 200, r.text
    data = r.json()
    assert [a["id"] for a in data["appointments"]] == [kept["id"]]
    ids = {s["id"] for s in data["staff"]}
    assert {ctx["a"]["member"]["id"], ctx["b"]["member"]["id"]} <= ids and data["hour_to"] > data["hour_from"]
    assert ctx["rec"]["member"]["id"] not in ids and biz["owner_member_id"] not in ids     # kassir usta emas

    # Boshqa kun oralig'ida ko'rinmaydi
    next_week = client.get(f"/api/v1/businesses/{biz['id']}/calendar", headers=h,
                           params={"start": str(day_from_today(biz, 20))}).json()
    assert next_week["appointments"] == []


def test_client_search(client, biz, ctx):
    phone = new_phone()
    post(client, biz, ctx, member=ctx["a"], client_phone=phone, client_name="Zarnigor Toshpulatova")
    h = auth_header(ctx["rec"]["tokens"])
    url = f"/api/v1/businesses/{biz['id']}/clients"
    assert [c["phone"] for c in client.get(url, headers=h, params={"q": "zarnigor"}).json()] == [phone]
    assert [c["phone"] for c in client.get(url, headers=h, params={"q": phone[-7:]}).json()] == [phone]
    assert client.get(url, headers=h, params={"q": "%%"}).json() == []
