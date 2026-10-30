"""Ish jadvali, ta'tillar va bo'sh vaqtlar: hisob to'g'riligi, huquqlar, ma'lumot sizib chiqmasligi."""
from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business, new_phone

TZ = "+05:00"                 # Asia/Tashkent
ALL_WEEK = [{"weekday": d, "start_time": "09:00", "end_time": "18:00",
             "breaks": [{"start": "13:00", "end": "14:00"}]} for d in range(1, 8)]


def url(biz, path):
    return f"/api/v1/businesses/{biz['id']}/{path}"


def day_from_today(biz, days: int):
    with api_session(biz["owner"]["user"]["id"]) as db:
        return db.scalar(text("SELECT (now() AT TIME ZONE 'Asia/Tashkent')::date + CAST(:d AS int)"), {"d": days})


def new_service(client, biz, duration=60):
    r = client.post(url(biz, "services"), headers=auth_header(biz["owner"]),
                    json={"name": f"Xizmat {new_phone()}", "duration_min": duration, "price": 50000})
    assert r.status_code == 201, r.text
    return r.json()


def new_master(client, biz, service, schedule=ALL_WEEK, custom_duration=None):
    m = add_member(client, biz, "staff")
    h, mid = auth_header(biz["owner"]), m["member"]["id"]
    r = client.put(url(biz, f"members/{mid}/services"), headers=h,
                   json={"services": [{"service_id": service["id"], "custom_duration": custom_duration}]})
    assert r.status_code == 200, r.text
    if schedule is not None:
        r = client.put(url(biz, f"members/{mid}/schedule"), headers=h, json={"days": schedule})
        assert r.status_code == 200, r.text
    return m


def book(biz, member_id, day, start, end, status="confirmed"):
    with api_session(biz["owner"]["user"]["id"]) as db:
        client_id = db.scalar(text("""
            INSERT INTO business_clients (business_id, full_name, phone) VALUES (:b, 'Mijoz', :p) RETURNING id
        """), {"b": biz["id"], "p": new_phone()})
        appointment = db.scalar(text("""
            INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status)
            VALUES (:b, :c, :m, CAST(:s AS timestamptz), CAST(:e AS timestamptz), CAST(:st AS appointment_status))
            RETURNING id
        """), {"b": biz["id"], "c": client_id, "m": member_id, "s": f"{day} {start}{TZ}", "e": f"{day} {end}{TZ}",
               "st": status})
        db.commit()
    return appointment


def slots(client, member, service, day, **params):
    r = client.get("/api/v1/catalog/slots", params={"member_id": member["member"]["id"], "service_id": service["id"],
                                                    "date": str(day), **params})
    assert r.status_code == 200, r.text
    return [s["time"] for s in r.json()["slots"]]


@pytest.fixture(scope="module")
def biz(client, superadmin):
    return create_business(client, superadmin)


def test_schedule_round_trip_with_breaks(client, biz):
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    mid, h = m["member"]["id"], auth_header(biz["owner"])
    body = client.get(url(biz, f"members/{mid}/schedule"), headers=h).json()
    assert len(body) == 7
    assert body[0] == {"weekday": 1, "start_time": "09:00:00", "end_time": "18:00:00",
                       "breaks": [{"start": "13:00:00", "end": "14:00:00"}]}

    # Ikki tanaffus, bitta dam olish kuni yo'q
    r = client.put(url(biz, f"members/{mid}/schedule"), headers=h, json={"days": [
        {"weekday": 1, "start_time": "08:00", "end_time": "20:00",
         "breaks": [{"start": "15:00", "end": "15:30"}, {"start": "11:00", "end": "11:30"}]}]})
    assert r.status_code == 200, r.text
    assert r.json() == [{"weekday": 1, "start_time": "08:00:00", "end_time": "20:00:00",
                         "breaks": [{"start": "11:00:00", "end": "11:30:00"}, {"start": "15:00:00", "end": "15:30:00"}]}]


@pytest.mark.parametrize("day", [
    {"weekday": 1, "start_time": "18:00", "end_time": "09:00"},
    {"weekday": 8, "start_time": "09:00", "end_time": "18:00"},
    {"weekday": 1, "start_time": "09:00", "end_time": "18:00", "breaks": [{"start": "08:00", "end": "10:00"}]},
    {"weekday": 1, "start_time": "09:00", "end_time": "18:00", "breaks": [{"start": "17:00", "end": "19:00"}]},
    {"weekday": 1, "start_time": "09:00", "end_time": "18:00", "breaks": [{"start": "14:00", "end": "13:00"}]},
    {"weekday": 1, "start_time": "09:00", "end_time": "18:00",
     "breaks": [{"start": "12:00", "end": "13:00"}, {"start": "12:30", "end": "14:00"}]},
])
def test_schedule_validation(client, biz, day):
    mid = biz["owner_member_id"]
    r = client.put(url(biz, f"members/{mid}/schedule"), headers=auth_header(biz["owner"]), json={"days": [day]})
    assert r.status_code == 422


def test_schedule_duplicate_day_rejected(client, biz):
    d = {"weekday": 1, "start_time": "09:00", "end_time": "18:00"}
    r = client.put(url(biz, f"members/{biz['owner_member_id']}/schedule"), headers=auth_header(biz["owner"]),
                   json={"days": [d, d]})
    assert r.status_code == 422


def test_schedule_permissions(client, superadmin, biz):
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    other_master = new_master(client, biz, s)
    outsider = create_business(client, superadmin)
    mid = m["member"]["id"]
    path = url(biz, f"members/{mid}/schedule")

    assert client.get(path).status_code == 401
    assert client.get(path, headers=auth_header(m["tokens"])).status_code == 200                 # o'zini
    assert client.get(path, headers=auth_header(other_master["tokens"])).status_code == 403      # hamkasbini
    assert client.get(path, headers=auth_header(outsider["owner"])).status_code == 403           # boshqa salon
    # Xodim jadvalini o'zi o'zgartira olmaydi
    assert client.put(path, headers=auth_header(m["tokens"]), json={"days": []}).status_code == 403
    assert client.put(path, headers=auth_header(outsider["owner"]), json={"days": []}).status_code == 403
    # Boshqa salonning xodimi — o'z biznesi yo'lida ham topilmaydi
    assert client.put(url(outsider, f"members/{mid}/schedule"), headers=auth_header(outsider["owner"]),
                      json={"days": []}).status_code == 404


def test_schedule_rls_blocks_direct_write(client, biz):
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    with api_session(m["tokens"]["user"]["id"]) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("INSERT INTO staff_schedules (business_id, member_id, weekday, start_time, end_time) "
                            "VALUES (:b, :m, 1, '06:00', '07:00')"), {"b": biz["id"], "m": m["member"]["id"]})
        assert e.value.orig.sqlstate == "42501"


def test_overlapping_intervals_rejected_by_database(biz):
    with api_session(biz["owner"]["user"]["id"]) as db:
        ins = text("INSERT INTO staff_schedules (business_id, member_id, weekday, start_time, end_time) "
                   "VALUES (:b, :m, 3, :s, :e)")
        args = {"b": biz["id"], "m": biz["owner_member_id"]}
        db.execute(ins, {**args, "s": "09:00", "e": "12:00"})
        with pytest.raises(DBAPIError) as e:
            db.execute(ins, {**args, "s": "11:00", "e": "13:00"})
        assert e.value.orig.sqlstate == "23P01"
        db.rollback()


def test_slots_respect_hours_breaks_bookings_and_time_off(client, biz):
    s = new_service(client, biz, duration=60)
    m = new_master(client, biz, s)
    mid = m["member"]["id"]
    day = day_from_today(biz, 1)

    assert slots(client, m, s, day) == ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00",
                                        "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00"]

    book(biz, mid, day, "10:00", "11:00")
    r = client.post(url(biz, f"members/{mid}/time-off"), headers=auth_header(m["tokens"]), json={
        "starts_at": f"{day}T16:00:00{TZ}", "ends_at": f"{day}T18:00:00{TZ}", "reason": "Shifokorga"})
    assert r.status_code == 201, r.text
    assert slots(client, m, s, day) == ["09:00", "11:00", "11:30", "12:00", "14:00", "14:30", "15:00"]

    # Ta'til o'chirilsa, vaqt qaytadi
    r = client.delete(url(biz, f"members/{mid}/time-off/{r.json()['id']}"), headers=auth_header(m["tokens"]))
    assert r.status_code == 204
    assert "16:30" in slots(client, m, s, day)


def test_cancelled_booking_frees_the_slot(client, biz):
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    day = day_from_today(biz, 2)
    for status in ("cancelled", "no_show", "completed"):
        book(biz, m["member"]["id"], day, "09:00", "10:00", status=status)
    assert slots(client, m, s, day)[0] == "09:00"


def test_slot_starts_right_after_booking(client, biz):
    s = new_service(client, biz, duration=60)
    m = new_master(client, biz, s)
    day = day_from_today(biz, 3)
    book(biz, m["member"]["id"], day, "09:00", "09:45")
    assert slots(client, m, s, day)[:2] == ["09:45", "10:00"]


def test_custom_duration_and_step(client, biz):
    s = new_service(client, biz, duration=60)
    m = new_master(client, biz, s, custom_duration=120)
    day = day_from_today(biz, 4)
    assert slots(client, m, s, day)[-1] == "16:00"                 # 16:00 + 2 soat = 18:00
    assert "11:00" in slots(client, m, s, day) and "11:30" not in slots(client, m, s, day)   # tanaffusga kirib ketadi
    assert slots(client, m, s, day, step=60)[:2] == ["09:00", "10:00"]

    r = client.get("/api/v1/catalog/slots", params={"member_id": m["member"]["id"], "service_id": s["id"],
                                                    "date": str(day), "step": 7})
    assert r.status_code == 422


def test_day_off_has_no_slots(client, biz):
    s = new_service(client, biz)
    m = new_master(client, biz, s, schedule=[])
    # Bo'sh jadval = jadval kiritilmagan; biznes soatlari ham yo'q bo'lsa — bo'sh vaqt yo'q
    assert slots(client, m, s, day_from_today(biz, 1)) == []


def test_falls_back_to_business_hours(client, superadmin):
    b = create_business(client, superadmin)
    s = new_service(client, b, duration=30)
    days = [{"weekday": d, "opens_at": "10:00", "closes_at": "11:00"} for d in range(1, 8)]
    assert client.put(url(b, "hours"), headers=auth_header(b["owner"]), json={"days": days}).status_code == 200
    m = new_master(client, b, s, schedule=None)
    assert slots(client, m, s, day_from_today(b, 1)) == ["10:00", "10:30"]


def test_today_has_no_past_slots(client, biz):
    s = new_service(client, biz, duration=5)
    m = new_master(client, biz, s, schedule=[{"weekday": d, "start_time": "00:00", "end_time": "23:55"}
                                             for d in range(1, 8)])
    r = client.get("/api/v1/catalog/slots", params={"member_id": m["member"]["id"], "service_id": s["id"],
                                                    "date": str(day_from_today(biz, 0))})
    assert r.status_code == 200, r.text
    with api_session(biz["owner"]["user"]["id"]) as db:
        now = db.scalar(text("SELECT now()"))
    assert all(_parse(x["starts_at"]) >= now - timedelta(seconds=5) for x in r.json()["slots"])


def _parse(value):
    from datetime import datetime
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@pytest.mark.parametrize("offset", [-1, 61])
def test_date_out_of_range(client, biz, offset):
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    r = client.get("/api/v1/catalog/slots", params={"member_id": m["member"]["id"], "service_id": s["id"],
                                                    "date": str(day_from_today(biz, offset))})
    assert r.status_code == 422


def test_slots_not_found_cases(client, superadmin, biz):
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    mid, h = m["member"]["id"], auth_header(biz["owner"])
    day = str(day_from_today(biz, 1))

    def status(member_id, service_id):
        return client.get("/api/v1/catalog/slots", params={"member_id": member_id, "service_id": service_id,
                                                           "date": day}).status_code

    assert status(mid, s["id"]) == 200
    assert status(mid, new_service(client, biz)["id"]) == 404        # usta bu xizmatni qilmaydi
    assert status(10 ** 9, s["id"]) == 404

    hidden = new_service(client, biz)
    h_master = new_master(client, biz, hidden)
    client.delete(url(biz, f"services/{hidden['id']}"), headers=h)
    assert status(h_master["member"]["id"], hidden["id"]) == 404     # xizmat yashirilgan

    assert client.patch(url(biz, f"members/{mid}"), headers=h, json={"is_bookable": False}).status_code == 200
    assert status(mid, s["id"]) == 404

    # Katalogda yo'q biznes: ochiq so'rovga yopiq, qabulxonaga ochiq
    other = create_business(client, superadmin)
    s2 = new_service(client, other)
    m2 = new_master(client, other, s2)
    assert client.patch(url(other, "profile"), headers=auth_header(other["owner"]), json={"is_listed": False}).status_code == 200
    assert status(m2["member"]["id"], s2["id"]) == 404
    rec = add_member(client, other, "receptionist")
    r = client.get(url(other, "slots"), headers=auth_header(rec["tokens"]),
                   params={"member_id": m2["member"]["id"], "service_id": s2["id"], "date": day})
    assert r.status_code == 200 and r.json()["slots"]


def test_business_slots_permissions(client, superadmin, biz):
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    params = {"member_id": m["member"]["id"], "service_id": s["id"], "date": str(day_from_today(biz, 1))}
    assert client.get(url(biz, "slots"), params=params).status_code == 401
    assert client.get(url(biz, "slots"), params=params, headers=auth_header(m["tokens"])).status_code == 403
    outsider = create_business(client, superadmin)
    assert client.get(url(outsider, "slots"), params=params, headers=auth_header(outsider["owner"])).status_code == 404


def test_time_off_permissions_and_validation(client, superadmin, biz):
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    colleague = new_master(client, biz, s)
    mid = m["member"]["id"]
    good = {"starts_at": "2030-01-01T10:00:00+05:00", "ends_at": "2030-01-02T10:00:00+05:00", "reason": "Ta'til"}

    path = url(biz, f"members/{mid}/time-off")
    assert client.post(path, headers=auth_header(colleague["tokens"]), json=good).status_code == 403
    assert client.post(path, headers=auth_header(m["tokens"]),
                       json={**good, "ends_at": "2029-01-01T10:00:00+05:00"}).status_code == 422
    assert client.post(path, headers=auth_header(m["tokens"]),
                       json={**good, "starts_at": "2030-01-01T10:00:00"}).status_code == 422       # vaqt mintaqasiz

    created = client.post(path, headers=auth_header(biz["owner"]), json=good)
    assert created.status_code == 201, created.text
    assert [t["id"] for t in client.get(path, headers=auth_header(m["tokens"])).json()] == [created.json()["id"]]
    assert client.delete(f"{path}/{created.json()['id']}", headers=auth_header(colleague["tokens"])).status_code == 403
    assert client.delete(f"{path}/999999999", headers=auth_header(m["tokens"])).status_code == 404


def test_anonymous_cannot_read_bookings_or_time_off(client, biz):
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    mid = m["member"]["id"]
    day = day_from_today(biz, 5)
    book(biz, mid, day, "09:00", "10:00")
    client.post(url(biz, f"members/{mid}/time-off"), headers=auth_header(m["tokens"]), json={
        "starts_at": f"{day}T15:00:00{TZ}", "ends_at": f"{day}T16:00:00{TZ}", "reason": "Maxfiy sabab"})

    with api_session(None) as db:
        assert db.scalar(text("SELECT count(*) FROM appointments WHERE member_id = :m"), {"m": mid}) == 0
        assert db.scalar(text("SELECT count(*) FROM staff_time_off WHERE member_id = :m"), {"m": mid}) == 0
        # Funksiya ishlaydi va faqat bo'sh vaqt qaytaradi
        assert db.scalar(text("SELECT count(*) FROM app.available_slots(:m, :s, CAST(:d AS date))"),
                         {"m": mid, "s": s["id"], "d": day}) > 0
    r = client.get("/api/v1/catalog/slots", params={"member_id": mid, "service_id": s["id"], "date": str(day)})
    assert "Maxfiy" not in r.text
