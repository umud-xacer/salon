"""Eslatma (push) -> 'Boraman' -> ustaga ogohlantirish -> qo'ng'iroq tugmasi."""
import itertools
import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app import worker
from app.db.session import api_session, worker_session
from app.services import push
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login
from tests.test_schedule import new_master, new_service, url

API = "/api/v1/appointments"


@pytest.fixture(scope="module")
def admin():
    engine = create_engine(os.environ["MIGRATION_DATABASE_URL"])
    yield engine
    engine.dispose()


@pytest.fixture(autouse=True)
def outbox(monkeypatch):
    """Expo o'rniga: yuborilgan xabarlar tokenga qarab yig'iladi."""
    sent = {}

    def fake(messages):
        for m in messages:
            sent.setdefault(m["to"], []).append(m)
        return [{"status": "ok"} for _ in messages]
    monkeypatch.setattr(push, "send", fake)
    return sent


_tokens = itertools.count(1)


def device(client, tokens) -> str:
    token = f"ExponentPushToken[t{next(_tokens)}]"
    r = client.post("/api/v1/devices", headers=auth_header(tokens), json={"token": token, "platform": "android"})
    assert r.status_code == 204, r.text
    return token


@pytest.fixture(scope="module")
def biz(client, superadmin):
    return create_business(client, superadmin)


@pytest.fixture()
def visit(client, admin, biz):
    """Mijoz va usta; bron `make(minutes)` bilan yaratiladi (bir kun oldin qilingan bron kabi)."""
    s = new_service(client, biz)
    master = new_master(client, biz, s)
    phone = new_phone()
    customer = otp_login(client, phone, "Mijoz Karimov")
    customer_device, master_device = device(client, customer), device(client, master["tokens"])

    def make(minutes=25, status="confirmed", created="now() - interval '1 day'"):
        with admin.begin() as c:
            client_id = c.execute(text("""
                INSERT INTO business_clients (business_id, user_id, full_name, phone) VALUES (:b, :u, 'Mijoz Karimov', :p)
                ON CONFLICT (business_id, phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id
            """), {"b": biz["id"], "u": customer["user"]["id"], "p": phone}).scalar()
            return c.execute(text(f"""
                INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status, created_at)
                VALUES (:b, :c, :m, now() + make_interval(mins => :x), now() + make_interval(mins => :x + 30),
                        CAST(:st AS appointment_status), {created}) RETURNING id
            """), {"b": biz["id"], "c": client_id, "m": master["member"]["id"], "x": minutes, "st": status}).scalar()

    return {"make": make, "master": master, "customer": customer, "phone": phone, "service": s,
            "device": customer_device, "master_device": master_device}


def elapse(admin, appointment, minutes=16):
    with admin.begin() as c:
        c.execute(text("UPDATE appointment_reminders SET sent_at = sent_at - make_interval(mins => :m) "
                       "WHERE appointment_id = :a"), {"m": minutes, "a": appointment})


def alerts(client, tokens):
    r = client.get("/api/v1/notifications", headers=auth_header(tokens))
    return [n for n in r.json() if n["type"] == "attendance_alert"]


def reminder(admin, appointment):
    with admin.connect() as c:
        return c.execute(text("SELECT * FROM appointment_reminders WHERE appointment_id = :a"),
                         {"a": appointment}).mappings().first()


def test_reminder_is_alarm_push_and_sent_once(client, visit, outbox):
    a = visit["make"](25)
    worker.run_once()
    wake, m = outbox[visit["device"]]
    assert "title" not in wake and wake["_contentAvailable"] is True and wake["priority"] == "high"
    assert wake["data"]["title"] == m["title"] and wake["data"]["notification_id"] == m["data"]["notification_id"]
    assert m["channelId"] == "alarm" and m["sound"] == "alarm.wav" and m["priority"] == "high"
    assert m["interruptionLevel"] == "time-sensitive"
    assert m["data"]["appointment_id"] == a and m["data"]["action"] == "confirm_attendance"

    notes = client.get("/api/v1/notifications", headers=auth_header(visit["customer"])).json()
    assert notes[0]["type"] == "appointment_reminder"

    worker.run_once()
    assert len(outbox[visit["device"]]) == 2


def test_no_sms_for_reminders(monkeypatch, visit):
    from app.services import sms
    monkeypatch.setattr(sms, "_send", lambda *a: pytest.fail("eslatma uchun SMS ketmasligi kerak"))
    visit["make"](25)
    worker.run_once()


@pytest.mark.parametrize("minutes,status,created", [
    (45, "confirmed", "now() - interval '1 day'"),        # hali erta
    (25, "cancelled", "now() - interval '1 day'"),        # bekor qilingan
    (25, "completed", "now() - interval '1 day'"),
    (25, "confirmed", "now()"),                           # hozirgina yozildi
    (-5, "confirmed", "now() - interval '1 day'"),        # boshlanib bo'lgan
])
def test_no_reminder_when_not_due(visit, outbox, minutes, status, created):
    visit["make"](minutes, status=status, created=created)
    worker.run_once()
    assert not [m for m in outbox.get(visit["device"], []) if m["data"]["type"] == "appointment_reminder"]


def test_attending_in_app_prevents_alert(client, admin, visit):
    a = visit["make"](25)
    worker.run_once()
    h = auth_header(visit["customer"])
    assert client.get(f"{API}/{a}", headers=h).json()["attendance"] == "reminded"
    assert client.post(f"{API}/{a}/attend", headers=h).status_code == 204
    assert client.post(f"{API}/{a}/attend", headers=h).status_code == 204        # ikkinchi bosish ham xato emas

    elapse(admin, a)
    worker.raise_alerts()
    assert alerts(client, visit["master"]["tokens"]) == []
    body = client.get(f"{API}/{a}", headers=auth_header(visit["master"]["tokens"])).json()
    assert body["attendance"] == "confirmed" and body["needs_contact"] is False


def test_no_answer_alerts_master_once(client, admin, visit):
    a = visit["make"](25)
    worker.run_once()
    master = visit["master"]["tokens"]

    elapse(admin, a, minutes=5)
    worker.raise_alerts()
    assert alerts(client, master) == []                           # javob muddati hali tugamagan

    elapse(admin, a, minutes=11)
    worker.raise_alerts()
    worker.raise_alerts()
    found = alerts(client, master)
    assert len(found) == 1
    assert "iltimos bog'laning" in found[0]["body"] and "Mijoz Karimov" in found[0]["body"]
    assert found[0]["data"] == {"appointment_id": a, "action": "call_client"}
    assert visit["phone"] not in str(found[0])                    # telefon xabarda saqlanmaydi

    body = client.get(f"{API}/{a}", headers=auth_header(master)).json()
    assert body["attendance"] == "no_response" and body["needs_contact"] is True and body["client_phone"] is None


@pytest.mark.parametrize("failure", ["no_device", "expo_error", "expo_down", "dead_token"])
def test_undelivered_reminder_alerts_immediately(client, admin, visit, monkeypatch, failure):
    if failure == "no_device":
        r = client.request("DELETE", "/api/v1/devices", headers=auth_header(visit["customer"]),
                           json={"token": visit["device"], "platform": "android"})
        assert r.status_code == 204
    elif failure == "expo_error":
        monkeypatch.setattr(push, "send", lambda ms: [{"status": "error", "details": {"error": "MessageRateExceeded"}}] * len(ms))
    elif failure == "dead_token":
        monkeypatch.setattr(push, "send", lambda ms: [{"status": "error", "details": {"error": "DeviceNotRegistered"}}] * len(ms))
    else:
        def boom(messages):
            raise RuntimeError("Expo javob bermadi")
        monkeypatch.setattr(push, "send", boom)
    a = visit["make"](25)
    worker.run_once()
    assert reminder(admin, a)["delivered"] is False
    assert len(alerts(client, visit["master"]["tokens"])) == 1
    if failure == "dead_token":
        with admin.connect() as c:
            assert c.scalar(text("SELECT count(*) FROM device_tokens WHERE token = :t"), {"t": visit["device"]}) == 0


def test_alert_reaches_master_as_alarm(client, admin, visit, outbox):
    a = visit["make"](25)
    worker.run_once()
    elapse(admin, a)
    worker.run_once()
    m = [x for x in outbox[visit["master_device"]] if x["data"]["type"] == "attendance_alert" and "title" in x]
    assert len(m) == 1 and m[0]["channelId"] == "alarm" and m[0]["data"]["action"] == "call_client"
    assert visit["phone"] not in str(m[0])


def test_no_alert_after_cancellation(client, admin, visit):
    a = visit["make"](25)
    worker.run_once()
    r = client.post(f"{API}/{a}/cancel", headers=auth_header(visit["customer"]), json={})
    assert r.status_code == 200
    elapse(admin, a)
    worker.raise_alerts()
    assert alerts(client, visit["master"]["tokens"]) == []


def test_call_button_only_while_alert_is_open(client, biz, admin, visit):
    a = visit["make"](25)
    master, other = visit["master"], add_member(client, biz, "staff")
    path = f"{API}/{a}/client-contact"

    worker.run_once()
    assert client.get(path, headers=auth_header(master["tokens"])).status_code == 403      # ogohlantirish yo'q

    elapse(admin, a)
    worker.raise_alerts()
    r = client.get(path, headers=auth_header(master["tokens"]))
    assert r.status_code == 200, r.text
    assert r.json() == {"phone": visit["phone"], "tel_url": f"tel:{visit['phone']}"}
    assert client.get(path, headers=auth_header(biz["owner"])).status_code == 200

    # Boshqa usta, boshqa mijoz, kirmagan foydalanuvchi
    assert client.get(path, headers=auth_header(other["tokens"])).status_code == 404
    assert client.get(path, headers=auth_header(otp_login(client, new_phone()))).status_code == 404
    assert client.get(path).status_code == 401

    with admin.connect() as c:
        assert c.scalar(text("SELECT count(*) FROM audit_logs WHERE action = 'view_phone' AND entity_id = :a"), {"a": a}) == 2


def test_late_confirmation_closes_alert(client, admin, visit):
    a = visit["make"](25)
    worker.run_once()
    elapse(admin, a)
    worker.raise_alerts()
    master = visit["master"]["tokens"]

    assert client.post(f"{API}/{a}/attend", headers=auth_header(visit["customer"])).status_code == 204
    types = [n["type"] for n in client.get("/api/v1/notifications", headers=auth_header(master)).json()]
    assert "attendance_confirmed" in types
    assert client.get(f"{API}/{a}/client-contact", headers=auth_header(master)).status_code == 403
    assert client.get(f"{API}/{a}", headers=auth_header(master)).json()["needs_contact"] is False


def test_reschedule_restarts_reminder(client, admin, visit):
    a = visit["make"](25)
    worker.run_once()
    with admin.begin() as c:
        c.execute(text("UPDATE appointments SET starts_at = starts_at + interval '3 hours', "
                       "ends_at = ends_at + interval '3 hours' WHERE id = :a"), {"a": a})
    assert reminder(admin, a) is None


def test_booking_events_notify_the_other_side(client, biz, visit, outbox):
    from tests.test_schedule import day_from_today
    s, m, c = visit["service"], visit["master"], visit["customer"]
    day = day_from_today(biz, 1)
    r = client.post(API, headers=auth_header(c), json={"member_id": m["member"]["id"], "service_id": s["id"],
                                                       "starts_at": f"{day}T10:00:00+05:00"})
    assert r.status_code == 201, r.text
    a = r.json()["id"]
    worker.send_pushes()
    assert [x["data"]["type"] for x in outbox[visit["master_device"]]] == ["booking_new"]
    assert outbox[visit["master_device"]][0]["channelId"] == "default"
    assert visit["device"] not in outbox                       # o'zi qilgan ishi haqida xabar kelmaydi

    assert client.post(f"{API}/{a}/cancel", headers=auth_header(biz["owner"]), json={}).status_code == 200
    worker.send_pushes()
    assert [x["data"]["type"] for x in outbox[visit["device"]]] == ["booking_cancelled"]


def test_ios_gets_single_alarm_message():
    row = {"id": 1, "type": "appointment_reminder", "title": "t", "body": "b", "data": {}}
    messages = push.build_messages({"token": "ExponentPushToken[i]", "platform": "ios"}, row)
    assert len(messages) == 1 and messages[0]["interruptionLevel"] == "time-sensitive"


def test_device_moves_to_new_account(client, admin, visit):
    other = otp_login(client, new_phone())
    r = client.post("/api/v1/devices", headers=auth_header(other), json={"token": visit["device"], "platform": "android"})
    assert r.status_code == 204
    with admin.connect() as c:
        owner = c.scalar(text("SELECT user_id FROM device_tokens WHERE token = :t"), {"t": visit["device"]})
    assert owner == other["user"]["id"]


def test_device_token_validation(client, visit):
    h = auth_header(visit["customer"])
    for token in ("abc", "ExponentPushToken[]", "ExponentPushToken[a b]"):
        assert client.post("/api/v1/devices", headers=h, json={"token": token, "platform": "ios"}).status_code == 422
    assert client.post("/api/v1/devices", json={"token": "ExponentPushToken[a]", "platform": "ios"}).status_code == 401


def test_only_own_customer_can_attend(client, admin, biz, visit):
    a = visit["make"](25)
    assert client.post(f"{API}/{a}/attend", headers=auth_header(otp_login(client, new_phone()))).status_code == 404
    assert client.post(f"{API}/{a}/attend", headers=auth_header(visit["master"]["tokens"])).status_code == 404
    assert client.post(f"{API}/{a}/attend", headers=auth_header(biz["owner"])).status_code == 404
    assert client.post(f"{API}/{a}/attend").status_code == 401

    past = visit["make"](-40)
    assert client.post(f"{API}/{past}/attend", headers=auth_header(visit["customer"])).status_code == 409


def test_notifications_are_private(client, visit):
    visit["make"](25)
    worker.run_once()
    mine = client.get("/api/v1/notifications", headers=auth_header(visit["customer"])).json()
    note = mine[0]["id"]
    stranger = auth_header(otp_login(client, new_phone()))
    assert client.get("/api/v1/notifications", headers=stranger).json() == []
    assert client.post(f"/api/v1/notifications/{note}/read", headers=stranger).status_code == 404

    h = auth_header(visit["customer"])
    assert client.post(f"/api/v1/notifications/{note}/read", headers=h).status_code == 204
    assert note not in [n["id"] for n in client.get("/api/v1/notifications", headers=h, params={"unread": True}).json()]


def test_database_roles_are_separated(visit):
    uid = visit["customer"]["user"]["id"]
    # Ilova foydalanuvchisi ishchi funksiyalarini chaqira olmaydi va token xeshini o'qiy olmaydi
    for sql in ("SELECT app.create_due_reminders(30)", "SELECT app.raise_attendance_alerts(15)",
                "SELECT * FROM app.next_push()", "SELECT app.mark_pushed(1, true, '{}')", "SELECT app.mark_attending(1)",
                "UPDATE appointment_reminders SET confirmed_at = now()"):
        with api_session(uid) as db:
            with pytest.raises(DBAPIError) as e:
                db.execute(text(sql))
            assert e.value.orig.sqlstate == "42501", sql

    # Worker jadvallarni to'g'ridan-to'g'ri o'qiy olmaydi
    for sql in ("SELECT * FROM users", "SELECT * FROM appointments", "SELECT * FROM business_clients",
                "SELECT * FROM device_tokens", "SELECT app.client_contact(1)"):
        with worker_session() as db:
            with pytest.raises(DBAPIError) as e:
                db.execute(text(sql))
            assert e.value.orig.sqlstate == "42501", sql
