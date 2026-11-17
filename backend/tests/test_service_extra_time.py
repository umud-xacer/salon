"""Xizmatga qo'shimcha vaqt: kutish (usta bo'sh) va bufer (usta band) — 051_service_extra_time.sql."""
import pytest

from tests.conftest import auth_header, create_business, new_phone
from tests.test_appointments import at
from tests.test_reception_mode import url
from tests.test_schedule import day_from_today, new_master


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance"))


def service(client, biz, name, duration, **extra):
    r = client.post(url(biz, "services"), headers=auth_header(biz["owner"]),
                    json={"name": name, "duration_min": duration, "price": 100000, **extra})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture()
def ctx(client, biz):
    # Bo'yoq: 90 daq, 30-daqiqadan 30 daqiqa kutish (usta bo'sh), keyin 15 daq tozalash
    color = service(client, biz, "Soch bo'yash", 90, processing_offset_min=30, processing_min=30, buffer_min=15)
    cut = service(client, biz, "Soch olish", 30)
    master = new_master(client, biz, color)
    r = client.put(url(biz, f"members/{master['member']['id']}/services"), headers=auth_header(biz["owner"]),
                   json={"services": [{"service_id": color["id"]}, {"service_id": cut["id"]}]})
    assert r.status_code == 200, r.text
    return {"color": color, "cut": cut, "master": master, "day": day_from_today(biz, 1)}


def book(client, biz, ctx, svc, clock):
    return client.post(url(biz, "reception/appointments"), headers=auth_header(biz["owner"]), json={
        "member_id": ctx["master"]["member"]["id"], "service_id": svc["id"], "starts_at": at(ctx["day"], clock),
        "client_name": "Mijoz Sinov", "client_phone": new_phone()})


def free_times(client, biz, ctx, svc):
    r = client.get(url(biz, "slots"), headers=auth_header(biz["owner"]), params={
        "member_id": ctx["master"]["member"]["id"], "service_id": svc["id"], "date": str(ctx["day"]), "step": 15})
    assert r.status_code == 200, r.text
    return {s["time"] for s in r.json()["slots"]}


def test_service_stores_extra_time(client, biz, ctx):
    c = ctx["color"]
    assert (c["processing_offset_min"], c["processing_min"], c["buffer_min"]) == (30, 30, 15)
    r = client.patch(url(biz, f"services/{c['id']}"), headers=auth_header(biz["owner"]), json={"buffer_min": 10})
    assert r.status_code == 200 and r.json()["buffer_min"] == 10


def test_processing_must_be_inside_service(client, biz):
    h = auth_header(biz["owner"])
    for extra in ({"processing_offset_min": 0, "processing_min": 20},      # boshida bo'lmaydi
                  {"processing_offset_min": 20, "processing_min": 40},     # oxirigacha cho'zilmaydi
                  {"buffer_min": 200}):
        r = client.post(url(biz, "services"), headers=h, json={"name": f"X {new_phone()}", "duration_min": 60,
                                                                  "price": 1, **extra})
        assert r.status_code == 422, (extra, r.text)


def test_master_is_free_during_processing(client, biz, ctx):
    r = book(client, biz, ctx, ctx["color"], "10:00")
    assert r.status_code == 201, r.text
    appt = r.json()
    assert (appt["processing_offset_min"], appt["processing_min"], appt["buffer_min"]) == (30, 30, 15)

    times = free_times(client, biz, ctx, ctx["cut"])
    assert "10:30" in times                         # bo'yoq kutish oynasi (10:30–11:00) bo'sh
    assert "10:15" not in times and "10:45" not in times   # oynaga sig'maydi
    assert "11:00" not in times and "11:15" not in times   # 11:00–11:30 usta bo'yoqni yakunlaydi, 11:30–11:45 tozalash
    assert "11:45" in times

    assert book(client, biz, ctx, ctx["cut"], "10:30").status_code == 201
    assert book(client, biz, ctx, ctx["cut"], "11:30").status_code == 409   # bufer vaqti


def test_buffer_blocks_next_booking_right_after(client, biz, ctx):
    assert book(client, biz, ctx, ctx["cut"], "12:00").status_code == 201
    # Bo'yoq 10:30–12:00 + 15 daq bufer → 12:00 dagi bron bilan to'qnashadi; 10:15 dan bo'lsa sig'adi
    times = free_times(client, biz, ctx, ctx["color"])
    assert "10:30" not in times and "10:15" in times
    assert book(client, biz, ctx, ctx["color"], "10:30").status_code == 409
    assert book(client, biz, ctx, ctx["color"], "10:15").status_code == 201


def test_reschedule_keeps_processing_window(client, biz, ctx):
    appt = book(client, biz, ctx, ctx["color"], "10:00").json()
    r = client.post(f"/api/v1/appointments/{appt['id']}/reschedule", headers=auth_header(biz["owner"]),
                    json={"starts_at": at(ctx["day"], "14:00")})
    assert r.status_code == 200, r.text
    times = free_times(client, biz, ctx, ctx["cut"])
    assert "14:30" in times and "10:00" in times and "15:00" not in times


def test_changing_service_later_does_not_change_existing_booking(client, biz, ctx):
    appt = book(client, biz, ctx, ctx["color"], "10:00").json()
    client.patch(url(biz, f"services/{ctx['color']['id']}"), headers=auth_header(biz["owner"]),
                 json={"processing_min": 0, "processing_offset_min": 0, "buffer_min": 0})
    cal = client.get(url(biz, f"calendar?start={ctx['day']}"), headers=auth_header(biz["owner"])).json()
    got = next(a for a in cal["appointments"] if a["id"] == appt["id"])
    assert (got["processing_min"], got["buffer_min"]) == (30, 15)
    assert "10:30" in free_times(client, biz, ctx, ctx["cut"])
