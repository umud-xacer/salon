"""API himoyasi: shubhali IP/qurilmani vaqtincha bloklash (app/core/ip_guard.py, sql/066)."""
import time

import pytest
from sqlalchemy import create_engine, text

from app.core import ip_guard as g
from app.core.config import get_settings
from tests.conftest import auth_header, new_phone, otp_login

API = "/api/v1"


@pytest.fixture()
def guard_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ip_guard_enabled", True)
    monkeypatch.setattr(s, "ip_anon_rpm", 5)
    monkeypatch.setattr(s, "ip_user_rpm", 8)
    monkeypatch.setattr(s, "ip_errors_per_min", 1000)
    monkeypatch.setattr(s, "ip_auth_failures", 1000)
    g.guard.reset()
    yield s
    g.guard.reset()


def audit_rows(action="ip_block"):
    eng = create_engine(get_settings().migration_database_url)
    try:
        for _ in range(30):                                  # audit alohida oqimda yoziladi
            with eng.connect() as c:
                rows = c.execute(text("SELECT ip::text, user_id, changes FROM audit_logs WHERE entity_type = 'security' "
                                      "AND action = :a ORDER BY id DESC LIMIT 5"), {"a": action}).mappings().all()
            if rows:
                return rows
            time.sleep(0.1)
        return []
    finally:
        eng.dispose()


def test_anonymous_flood_blocks_ip_but_not_logged_in_users(client, guard_on, superadmin):
    # Foydalanuvchi tokeni blokdan oldin olinadi (kirish ham anonim so'rov)
    me = otp_login(client, new_phone(), "Mijoz Himoya")
    g.guard.reset()
    for _ in range(6):
        assert client.get(f"{API}/catalog/categories").status_code == 200
    r = client.get(f"{API}/catalog/categories")
    assert r.status_code == 429 and r.json()["detail"]["code"] == "ip_blocked"
    assert 590 <= int(r.headers["retry-after"]) <= 600
    rows = audit_rows()
    assert rows and rows[0]["changes"]["reason"] == "rate" and rows[0]["changes"]["scope"] == "ip"
    assert any("/catalog/categories" in x for x in rows[0]["changes"]["recent"])

    # O'sha IP'dagi kirgan foydalanuvchi — o'z kaliti bilan, ishlayveradi
    assert client.get(f"{API}/auth/me", headers=auth_header(me)).status_code == 200

    # 10 daqiqa o'tdi — o'zi ochiladi
    real = time.monotonic
    g.time.monotonic = lambda: real() + 601
    try:
        assert client.get(f"{API}/catalog/categories").status_code == 200
    finally:
        g.time.monotonic = real


def test_user_limit_blocks_only_that_user(client, guard_on):
    a = otp_login(client, new_phone(), "Birinchi")
    b = otp_login(client, new_phone(), "Ikkinchi")
    g.guard.reset()
    for _ in range(9):
        client.get(f"{API}/auth/me", headers=auth_header(a))
    assert client.get(f"{API}/auth/me", headers=auth_header(a)).status_code == 429
    assert client.get(f"{API}/auth/me", headers=auth_header(b)).status_code == 200     # boshqa foydalanuvchi
    assert client.get(f"{API}/catalog/categories").status_code == 200               # anonim — o'z hisobi
    assert audit_rows()[0]["changes"]["scope"] == "user"


def test_password_guessing_and_errors_and_exempt_paths(client, guard_on, monkeypatch):
    monkeypatch.setattr(guard_on, "ip_anon_rpm", 1000)
    monkeypatch.setattr(guard_on, "ip_auth_failures", 3)
    stranger = new_phone()                                   # mavjud bo'lmagan raqam — hech kimning hisobi bloklanmasin
    for _ in range(4):
        r = client.post(f"{API}/auth/login", json={"phone": stranger, "password": "notogri-parol"})
    assert r.status_code == 401
    r = client.post(f"{API}/auth/login", json={"phone": "+998900000001", "password": "SuperPass123"})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "ip_blocked"        # to'g'ri parol ham — blok
    assert audit_rows()[0]["changes"]["reason"] == "auth"

    # 4xx skanerlash
    g.guard.reset()
    monkeypatch.setattr(guard_on, "ip_errors_per_min", 3)
    for _ in range(4):
        client.get(f"{API}/catalog/businesses/yoq-salon-{_}")
    assert client.get(f"{API}/catalog/categories").status_code == 429

    # Telegram webhook va oq ro'yxat bloklanmaydi
    assert client.post(f"{API}/telegram/webhook", json={}).status_code != 429
    monkeypatch.setattr(guard_on, "ip_allowlist", ["testclient"])
    assert client.get(f"{API}/catalog/categories").status_code == 200


def test_superadmin_sees_and_unblocks(client, guard_on, superadmin):
    g.guard.reset()
    for _ in range(7):
        client.get(f"{API}/catalog/categories")
    r = client.get(f"{API}/superadmin/security/blocked", headers=auth_header(superadmin))
    assert r.status_code == 200, r.text
    assert [x["ip"] for x in r.json()] == ["testclient"] and r.json()[0]["reason"] == "rate"
    assert client.delete(f"{API}/superadmin/security/blocked", params={"ip": "testclient"},
                         headers=auth_header(superadmin)).status_code == 204
    assert client.get(f"{API}/catalog/categories").status_code == 200
    assert client.get(f"{API}/superadmin/security/blocked", headers=auth_header(superadmin)).json() == []
    assert audit_rows("ip_unblock")
