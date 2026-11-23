"""Avtomatik xabarlar: tug'ilgan kun, kechiktirilgan sharh so'rovi, qaytarish (054), sinab ko'rish va SMS (069)."""
import os

import pytest
from sqlalchemy import create_engine, text

from app.db.session import worker_session
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login
from tests.test_reception_mode import url

ADMIN = create_engine(os.environ["MIGRATION_DATABASE_URL"])
NOON = "2026-11-17 12:00+05"           # muassasa vaqti bilan kunduzi (Asia/Tashkent)
NIGHT = "2026-11-17 23:00+05"


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking",))


@pytest.fixture()
def setup(client, biz):
    """Ilova hisobi bor mijoz + muassasa ustasi (to'g'ridan bazaga — o'tgan sanadagi tashriflar uchun)."""
    customer = otp_login(client, new_phone(), "Avto Mijoz")
    usta = add_member(client, biz, "staff")
    with ADMIN.begin() as db:
        client_id = db.execute(text("""
            INSERT INTO business_clients (business_id, user_id, full_name, phone)
            VALUES (:b, :u, 'Avto Mijoz', :p) RETURNING id"""),
            {"b": biz["id"], "u": customer["user"]["id"], "p": customer["user"]["phone"]}).scalar()
    return {"customer": customer, "client_id": client_id, "member_id": usta["member"]["id"]}


def visit(biz, setup, start, status="completed"):
    with ADMIN.begin() as db:
        return db.execute(text("""
            INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status)
            VALUES (:b, :c, :m, CAST(:s AS timestamptz), CAST(:s AS timestamptz) + INTERVAL '1 hour', :st) RETURNING id"""),
            {"b": biz["id"], "c": setup["client_id"], "m": setup["member_id"], "s": start, "st": status}).scalar()


def scan(biz, now, sms=False):
    with worker_session() as db:
        rows = db.execute(text("SELECT * FROM app.auto_messages_scan(:b, CAST(:n AS timestamptz), :s)"),
                          {"b": biz["id"], "n": now, "s": sms}).all()
        db.commit()
    return rows


def inbox(client, setup, type_):
    items = client.get("/api/v1/notifications", headers=auth_header(setup["customer"])).json()
    return [n for n in items if n["type"] == type_]


def save(client, biz, **values):
    current = client.get(url(biz, "auto-messages"), headers=auth_header(biz["owner"])).json()["settings"]
    r = client.put(url(biz, "auto-messages"), headers=auth_header(biz["owner"]), json={**current, **values})
    assert r.status_code == 200, r.text
    return r.json()


def test_settings_defaults_and_permissions(client, biz):
    r = client.get(url(biz, "auto-messages"), headers=auth_header(biz["owner"]))
    assert r.status_code == 200
    assert r.json()["settings"] == {"birthday_enabled": False, "birthday_text": None, "review_enabled": True,
                                    "review_delay_hours": 0, "winback_enabled": False, "winback_days": 45,
                                    "winback_text": None, "sms_enabled": False}
    assert r.json()["sms_available"] is False                        # test/dev: AUTO_SMS_ENABLED o'chiq
    saved = save(client, biz, birthday_enabled=True, birthday_text="  Sizga 20% chegirma!  ", winback_days=30)
    assert saved["birthday_text"] == "Sizga 20% chegirma!" and saved["winback_days"] == 30
    staff = add_member(client, biz, "staff")
    assert client.get(url(biz, "auto-messages"), headers=auth_header(staff["tokens"])).status_code == 403
    assert client.put(url(biz, "auto-messages"), headers=auth_header(biz["owner"]),
                      json={**saved, "winback_days": 5}).status_code == 422


def test_birthday_once_per_year_daytime_only(client, biz, setup):
    with ADMIN.begin() as db:
        db.execute(text("UPDATE business_clients SET birth_date = '1995-11-17' WHERE id = :c"), {"c": setup["client_id"]})
    assert scan(biz, NOON) == []                                     # sozlama o'chiq
    save(client, biz, birthday_enabled=True, birthday_text="Bugun 20% chegirma!")
    assert scan(biz, NIGHT) == []                                    # kechasi bezovta qilinmaydi
    scan(biz, NOON)
    scan(biz, NOON)                                                  # qayta — yuborilmaydi
    got = inbox(client, setup, "promo_birthday")
    assert len(got) == 1 and got[0]["body"] == "Bugun 20% chegirma!"
    sent = client.get(url(biz, "auto-messages/sent"), headers=auth_header(biz["owner"])).json()
    assert [s["kind"] for s in sent] == ["birthday"] and sent[0]["client_name"] == "Avto Mijoz"
    assert client.get(url(biz, "auto-messages"), headers=auth_header(biz["owner"])).json()["sent_30d"]["birthday"] == 1


def test_review_request_delayed(client, biz, setup):
    save(client, biz, review_delay_hours=3)
    appt = visit(biz, setup, "2026-11-17 08:00+05", status="in_progress")
    with ADMIN.begin() as db:                                        # yakunlandi: trigger darhol yubormaydi
        db.execute(text("UPDATE appointments SET status = 'completed' WHERE id = :id"), {"id": appt})
    assert inbox(client, setup, "review_request") == []
    scan(biz, "2026-11-17 11:00+05")                                 # tugaganiga 2 soat — hali erta
    assert inbox(client, setup, "review_request") == []
    scan(biz, "2026-11-17 12:30+05")
    scan(biz, "2026-11-17 13:00+05")
    got = inbox(client, setup, "review_request")
    assert len(got) == 1 and got[0]["data"]["appointment_id"] == appt


def test_review_disabled_sends_nothing(client, biz, setup):
    save(client, biz, review_enabled=False)
    appt = visit(biz, setup, "2026-11-17 08:00+05", status="in_progress")
    with ADMIN.begin() as db:
        db.execute(text("UPDATE appointments SET status = 'completed' WHERE id = :id"), {"id": appt})
    scan(biz, NOON)
    assert inbox(client, setup, "review_request") == []


def test_winback_after_n_days_without_future_booking(client, biz, setup):
    visit(biz, setup, "2026-09-20 10:00+05")                         # 58 kun oldin
    save(client, biz, winback_enabled=True, winback_days=60)
    scan(biz, NOON)
    assert inbox(client, setup, "promo_winback") == []               # hali 60 kun bo'lmagan
    save(client, biz, winback_enabled=True, winback_days=45)
    future = visit(biz, setup, "2026-11-25 10:00+05", status="confirmed")
    scan(biz, NOON)
    assert inbox(client, setup, "promo_winback") == []               # kelgusi broni bor
    with ADMIN.begin() as db:
        db.execute(text("UPDATE appointments SET status = 'cancelled' WHERE id = :id"), {"id": future})
    scan(biz, NOON)
    scan(biz, NOON)
    got = inbox(client, setup, "promo_winback")
    assert len(got) == 1 and got[0]["data"]["slug"] == biz["slug"]


def test_auto_messages_rls(client, biz, setup, superadmin):
    save(client, biz, birthday_enabled=True)
    other = create_business(client, superadmin, modules=("booking",))
    assert client.get(url(other, "auto-messages"), headers=auth_header(biz["owner"])).status_code == 403
    from app.db.session import api_session
    with api_session(other["owner"]["user"]["id"]) as db:
        assert db.execute(text("SELECT count(*) FROM auto_message_settings WHERE business_id = :b"),
                          {"b": biz["id"]}).scalar() == 0
        assert db.execute(text("SELECT count(*) FROM auto_messages_sent WHERE business_id = :b"),
                          {"b": biz["id"]}).scalar() == 0
    with api_session(biz["owner"]["user"]["id"]) as db:
        with pytest.raises(Exception):
            db.execute(text("SELECT * FROM app.auto_messages_scan()"))   # ilovaga yopiq — faqat worker


def test_test_message_goes_only_to_director(client, biz, setup):
    save(client, biz, winback_text="Qaytib keling, 15% chegirma!")
    owner = auth_header(biz["owner"])
    r = client.post(url(biz, "auto-messages/test"), headers=owner, json={"kind": "winback"})
    assert r.status_code == 200, r.text
    assert r.json() == {"title": "[Sinov] Sizni sog'indik!", "body": "Qaytib keling, 15% chegirma!", "telegram": False}
    mine = [n for n in client.get("/api/v1/notifications", headers=owner).json() if n["type"] == "auto_message_test"]
    assert len(mine) == 1 and mine[0]["data"]["kind"] == "winback"
    assert inbox(client, setup, "promo_winback") == []               # mijozga hech narsa ketmadi
    assert client.get(url(biz, "auto-messages/sent"), headers=owner).json() == []   # jurnalga yozilmaydi
    r = client.post(url(biz, "auto-messages/test"), headers=owner, json={"kind": "birthday"})
    assert "jamoasi sizni tabriklaydi" in r.json()["body"]           # matn bo'sh — standart tabrik
    assert client.post(url(biz, "auto-messages/test"), headers=owner, json={"kind": "spam"}).status_code == 422
    staff = add_member(client, biz, "staff")
    assert client.post(url(biz, "auto-messages/test"), headers=auth_header(staff["tokens"]),
                       json={"kind": "review"}).status_code == 403
    for _ in range(8):
        assert client.post(url(biz, "auto-messages/test"), headers=owner, json={"kind": "review"}).status_code == 200
    assert client.post(url(biz, "auto-messages/test"), headers=owner, json={"kind": "review"}).status_code == 429


def test_sms_only_for_clients_without_app_and_only_when_enabled(client, biz, setup):
    phone = new_phone()
    with ADMIN.begin() as db:
        offline = db.execute(text("""
            INSERT INTO business_clients (business_id, full_name, phone, birth_date)
            VALUES (:b, 'Ilovasiz Mijoz', :p, '1990-11-17') RETURNING id"""), {"b": biz["id"], "p": phone}).scalar()
        db.execute(text("UPDATE business_clients SET birth_date = '1995-11-17' WHERE id = :c"), {"c": setup["client_id"]})
    save(client, biz, birthday_enabled=True)
    assert scan(biz, NOON, sms=True) == []                           # muassasa SMS ni yoqmagan
    assert len(inbox(client, setup, "promo_birthday")) == 1          # ilovali mijoz baribir oladi
    save(client, biz, sms_enabled=True)
    assert scan(biz, NOON, sms=False) == []                          # server AUTO_SMS_ENABLED o'chiq
    rows = scan(biz, NOON, sms=True)
    assert [(r.chat_id, r.phone) for r in rows] == [(None, phone)] and "tabriklaydi" in rows[0].body
    assert scan(biz, NOON, sms=True) == []                           # yiliga bir marta
    sent = {s["client_id"]: s for s in client.get(url(biz, "auto-messages/sent"), headers=auth_header(biz["owner"])).json()}
    assert sent[offline]["sms"] is True and sent[setup["client_id"]]["sms"] is False
