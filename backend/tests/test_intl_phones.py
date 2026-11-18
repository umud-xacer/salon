"""Xalqaro telefon raqamlar (sql/067_intl_phones.sql): Rossiya, Qozog'iston va boshqalar."""
import random

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from tests.conftest import add_member, auth_header, create_business
from tests.test_social_auth import HDR, _tg_ids, bot, start, tg_update  # noqa: F401
from tests.test_schedule import url

API = "/api/v1"


def ru_phone() -> str:
    return f"+7916{random.randint(1000000, 9999999)}"


def telegram_contact_login(client, phone_digits: str):
    s = start(client)
    tg = next(_tg_ids)
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg, text_=f"/start {s['nonce']}"))
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg, contact={
        "phone_number": phone_digits, "user_id": tg, "first_name": "Ivan", "last_name": "Petrov"}))
    return client.post(f"{API}/auth/telegram/poll", json={"nonce": s["nonce"]})


def test_foreign_user_logs_in_via_telegram_and_gets_codes_there(client, bot):
    phone = ru_phone()
    r = telegram_contact_login(client, phone.lstrip("+"))           # Telegram kontaktni "+" siz beradi
    assert r.status_code == 200, r.text
    login = r.json()["login"]
    assert login["user"]["phone"] == phone and login["is_new"] is True
    # Keyingi kirish kodi — Telegramga (SMS emas)
    r = client.post(f"{API}/auth/otp/request", json={"phone": phone.replace("+7", "+7 ")})
    assert r.status_code == 200 and r.json()["channel"] == "telegram"
    assert client.get(f"{API}/auth/me", headers=auth_header(login)).json()["user"]["phone"] == phone

    # Qozog'iston (+7 7xx) va boshqa davlat ham
    kz = f"+7701{random.randint(1000000, 9999999)}"
    assert telegram_contact_login(client, kz.lstrip("+")).json()["login"]["user"]["phone"] == kz


def test_foreign_phones_in_panel(client, superadmin):
    biz = create_business(client, superadmin)
    h = auth_header(biz["owner"])
    # Xodim — xorijiy raqam bilan
    phone = ru_phone()
    r = client.post(f"/api/v1/businesses/{biz['id']}/members", headers=h,
                    json={"phone": phone, "full_name": "Ivan Petrov", "role": "staff", "title": "Usta"})
    assert r.status_code == 201, r.text
    # Salonning o'z telefoni
    r = client.patch(url(biz, "profile"), headers=h, json={"phone": "+90 532 123 45 67"})
    assert r.status_code == 200 and r.json()["phone"] == "+905321234567"
    # Noto'g'ri raqam — tushunarli xato
    r = client.post(f"/api/v1/businesses/{biz['id']}/members", headers=h,
                    json={"phone": "9161234567", "full_name": "X Y", "role": "staff", "title": "Usta"})
    assert r.status_code == 422


def test_database_rejects_bad_phones():
    eng = create_engine(get_settings().migration_database_url)
    try:
        for bad in ("+79", "+0912345678901", "+99890123", "79161234567"):
            with pytest.raises(IntegrityError), eng.begin() as c:
                c.execute(text("INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES (:p, 'x', now())"), {"p": bad})
        with eng.begin() as c:
            assert c.execute(text("SELECT app.phone_ok('+79161234567') AND app.phone_ok('+998901234567') "
                                  "AND NOT app.phone_ok('+9989012345')")).scalar()
    finally:
        eng.dispose()
