"""Xonalar, kreslolar va apparatlar bandligi (059_resources.sql)."""
import threading

import pytest

from tests.conftest import add_member, auth_header, create_business, new_phone
from tests.test_appointments import at
from tests.test_reception_mode import url
from tests.test_schedule import day_from_today, new_master, new_service


BUSY = ("resource_busy", "time_conflict")


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking",))


@pytest.fixture()
def ctx(client, biz):
    service = new_service(client, biz, duration=60)
    m1, m2 = new_master(client, biz, service), new_master(client, biz, service)
    return {"service": service, "m1": m1, "m2": m2, "day": day_from_today(biz, 2)}


def owner(biz):
    return auth_header(biz["owner"])


def resource(client, biz, **body):
    r = client.post(url(biz, "resources"), headers=owner(biz), json={"name": "Kreslo", **body})
    assert r.status_code == 201, r.text
    return r.json()


def book(client, biz, ctx, member, clock, **extra):
    return client.post(url(biz, "reception/appointments"), headers=owner(biz), json={
        "member_id": ctx[member]["member"]["id"], "service_id": ctx["service"]["id"], "starts_at": at(ctx["day"], clock),
        "client_name": "Resurs Mijoz", "client_phone": new_phone(), **extra})


def slots(client, biz, ctx, member):
    r = client.get(url(biz, "reception/slots"), headers=owner(biz), params={"service_id": ctx["service"]["id"], "date": ctx["day"]})
    assert r.status_code == 200, r.text
    times = client.get(f"/api/v1/catalog/slots", params={"member_id": ctx[member]["member"]["id"],
                                                        "service_id": ctx["service"]["id"], "date": ctx["day"]})
    return [s["time"] for s in times.json()["slots"]]


def test_single_chair_blocks_second_master(client, biz, ctx):
    chair = resource(client, biz, name="1-kreslo", service_ids=[ctx["service"]["id"]])
    a = book(client, biz, ctx, "m1", "10:00")
    assert a.status_code == 201, a.text
    assert a.json()["resource_id"] == chair["id"] and a.json()["resource_name"] == "1-kreslo"
    r = book(client, biz, ctx, "m2", "10:30")
    # Bo'sh vaqt tekshiruvi kresloni ham hisobga oladi ("Bu vaqt band"); poygada esa resurs qulfi ushlaydi
    assert r.status_code == 409 and r.json()["detail"]["code"] in BUSY
    free = slots(client, biz, ctx, "m2")
    assert "10:00" not in free and "10:30" not in free and "11:00" in free      # usta bo'sh, kreslo band
    assert book(client, biz, ctx, "m2", "11:00").status_code == 201


def test_capacity_cleanup_and_maintenance(client, biz, ctx):
    room = resource(client, biz, name="SPA xona", kind="room", capacity=2, cleanup_min=15, service_ids=[ctx["service"]["id"]])
    m3 = new_master(client, biz, ctx["service"])
    ctx["m3"] = m3
    assert book(client, biz, ctx, "m1", "10:00").status_code == 201
    assert book(client, biz, ctx, "m2", "10:00").status_code == 201          # sig'im 2
    assert book(client, biz, ctx, "m3", "10:30").json()["detail"]["code"] in BUSY
    assert book(client, biz, ctx, "m3", "11:00").json()["detail"]["code"] in BUSY   # tozalash 15 daqiqa
    assert book(client, biz, ctx, "m3", "11:15").status_code == 201

    client.put(url(biz, f"resources/{room['id']}"), headers=owner(biz),
               json={**{k: room[k] for k in ("name", "kind", "capacity", "cleanup_min")}, "status": "maintenance",
                     "service_ids": [ctx["service"]["id"]]})
    assert slots(client, biz, ctx, "m1") == []                              # ta'mirda — bron yo'q
    assert book(client, biz, ctx, "m1", "15:00").json()["detail"]["code"] in BUSY


def test_member_default_chair_preferred_and_manual_assign(client, biz, ctx):
    c1 = resource(client, biz, name="1-kreslo", service_ids=[ctx["service"]["id"]])
    c2 = resource(client, biz, name="2-kreslo", service_ids=[ctx["service"]["id"]], member_ids=[ctx["m2"]["member"]["id"]])
    a = book(client, biz, ctx, "m2", "10:00").json()
    assert a["resource_id"] == c2["id"]                                      # ustaning o'z kreslosi
    b = book(client, biz, ctx, "m1", "10:00").json()
    assert b["resource_id"] == c1["id"]
    other = resource(client, biz, name="Lazer", kind="device")
    r = client.put(url(biz, f"appointments/{b['id']}/resource"), headers=owner(biz), json={"resource_id": other["id"]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "resource_not_suitable"
    r = client.put(url(biz, f"appointments/{b['id']}/resource"), headers=owner(biz), json={"resource_id": c2["id"]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "resource_busy"
    # Qo'lda tanlash bron yaratishda
    r = book(client, biz, ctx, "m1", "12:00", resource_id=c2["id"])
    assert r.status_code == 201 and r.json()["resource_id"] == c2["id"]


def test_reschedule_and_cancel_free_the_chair(client, biz, ctx):
    resource(client, biz, name="Yagona", service_ids=[ctx["service"]["id"]])
    a = book(client, biz, ctx, "m1", "10:00").json()
    b = book(client, biz, ctx, "m2", "12:00").json()
    r = client.post(f"/api/v1/appointments/{b['id']}/reschedule", headers=owner(biz), json={"starts_at": at(ctx["day"], "10:30")})
    assert r.status_code in (403, 409)                                       # kreslo band
    assert client.post(f"/api/v1/appointments/{a['id']}/cancel", headers=owner(biz), json={}).status_code in (200, 204)
    assert book(client, biz, ctx, "m2", "10:00").status_code == 201          # bekor qilingan joy bo'shadi


def test_concurrent_bookings_one_chair(client, biz, ctx):
    resource(client, biz, name="Bitta", service_ids=[ctx["service"]["id"]])
    results = []

    def go(member):
        results.append(book(client, biz, ctx, member, "14:00").status_code)

    threads = [threading.Thread(target=go, args=(m,)) for m in ("m1", "m2")]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [201, 409]


def test_calendar_and_permissions(client, biz, ctx, superadmin):
    chair = resource(client, biz, name="VIP kreslo", service_ids=[ctx["service"]["id"]])
    book(client, biz, ctx, "m1", "10:00")
    cal = client.get(url(biz, f"calendar?start={ctx['day']}"), headers=owner(biz)).json()
    assert [r["name"] for r in cal["resources"]] == ["VIP kreslo"]
    assert cal["appointments"][0]["resource_id"] == chair["id"]
    staff = auth_header(ctx["m1"]["tokens"])
    assert client.get(url(biz, "resources"), headers=staff).json()[0]["name"] == "VIP kreslo"
    assert client.post(url(biz, "resources"), headers=staff, json={"name": "X"}).status_code == 403
    other = create_business(client, superadmin, modules=("booking",))
    assert client.get(url(biz, "resources"), headers=auth_header(other["owner"])).json() == []
    r = client.put(url(biz, f"resources/{chair['id']}"), headers=auth_header(other["owner"]), json={"name": "Hack"})
    assert r.status_code == 403
    assert client.delete(url(biz, f"resources/{chair['id']}"), headers=owner(biz)).status_code == 409   # kelgusi bron bor
