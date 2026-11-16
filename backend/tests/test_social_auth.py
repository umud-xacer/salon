"""Telegram/Google orqali kirish, hisobni o'chirish, Google Play tekshiruvchisi raqami (sql/046_social_auth.sql)."""
import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import api_session
from app.services import auth_service, telegram_bot
from tests.conftest import auth_header, create_business, new_phone, otp_login
from tests.test_appointments import book
from tests.test_schedule import day_from_today, new_master, new_service

API = "/api/v1"
SECRET = "webhook-secret-0123456789"
HDR = {"X-Telegram-Bot-Api-Secret-Token": SECRET}


@pytest.fixture()
def bot(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "telegram_bot_token", SecretStr("123:TEST"))
    monkeypatch.setattr(s, "telegram_bot_username", "ChronixTestBot")
    monkeypatch.setattr(s, "telegram_webhook_secret", SecretStr(SECRET))
    sent: list[tuple[int, str]] = []
    monkeypatch.setattr(telegram_bot, "send_message", lambda chat, msg, markup=None: sent.append((chat, msg)))
    return sent


def tg_update(user_id: int, *, text_: str | None = None, contact: dict | None = None) -> dict:
    msg = {"message_id": 1, "chat": {"id": user_id, "type": "private"},
           "from": {"id": user_id, "first_name": "Ali", "is_bot": False}}
    if text_ is not None:
        msg["text"] = text_
    if contact is not None:
        msg["contact"] = contact
    return {"update_id": 1, "message": msg}


def start(client, **body):
    r = client.post(f"{API}/auth/telegram/start", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def poll(client, nonce):
    return client.post(f"{API}/auth/telegram/poll", json={"nonce": nonce})


_tg_ids = iter(range(700_000_001, 800_000_000))


def telegram_login(client, phone: str, **start_body) -> dict:
    s = start(client, **start_body)
    tg_id = next(_tg_ids)
    assert client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg_id, text_=f"/start {s['nonce']}")).status_code == 200
    r = client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg_id, contact={
        "phone_number": phone.lstrip("+"), "user_id": tg_id, "first_name": "Ali", "last_name": "Valiyev"}))
    assert r.status_code == 200
    r = poll(client, s["nonce"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"
    return r.json()["login"]


# ─── Telegram ───────────────────────────────────────────────────────────────
def test_telegram_disabled_without_token(client):
    r = client.post(f"{API}/auth/telegram/start", json={})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "telegram_unavailable"
    info = client.get(f"{API}/catalog/app-info").json()
    assert info["login_methods"] == {"telegram": False, "google": False}


def test_telegram_login_registers_and_logs_in(client, bot):
    s = start(client)
    assert s["url"] == f"https://t.me/ChronixTestBot?start={s['nonce']}"
    assert poll(client, s["nonce"]).json()["status"] == "pending"

    phone = new_phone()
    tg_id = next(_tg_ids)
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg_id, text_=f"/start {s['nonce']}"))
    assert "Raqamni yuborish" in bot[-1][1]
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg_id, contact={
        "phone_number": phone.lstrip("+"), "user_id": tg_id, "first_name": "Ali", "last_name": "Valiyev"}))
    assert bot[-1][1].startswith("✅")

    r = poll(client, s["nonce"])
    assert r.status_code == 200, r.text
    login = r.json()["login"]
    assert login["is_new"] is True and login["user"]["phone"] == phone and login["user"]["full_name"] == "Ali Valiyev"
    assert client.get(f"{API}/auth/me", headers=auth_header(login)).status_code == 200
    # Bir martalik: ikkinchi poll — eskirgan
    assert poll(client, s["nonce"]).status_code == 401

    # Mavjud hisobga Telegram bilan qayta kirish — o'sha foydalanuvchi
    again = telegram_login(client, phone)
    assert again["is_new"] is False and again["user"]["id"] == login["user"]["id"]


def test_telegram_rejects_foreign_contact_wrong_secret_and_foreign_numbers(client, bot):
    s = start(client)
    tg_id = next(_tg_ids)
    assert client.post(f"{API}/telegram/webhook", json=tg_update(tg_id, text_="/start x")).status_code == 403
    assert client.post(f"{API}/telegram/webhook", headers={"X-Telegram-Bot-Api-Secret-Token": "bad"},
                       json=tg_update(tg_id, text_="/start x")).status_code == 403

    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg_id, text_=f"/start {s['nonce']}"))
    # Boshqa odamning kontakti (forward qilingan) — rad
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg_id, contact={
        "phone_number": "998901234567", "user_id": tg_id + 1, "first_name": "Begona"}))
    assert "o'zingizning" in bot[-1][1]
    # Chet el raqami — rad
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg_id, contact={
        "phone_number": "79001234567", "user_id": tg_id, "first_name": "Ali"}))
    assert "+998" in bot[-1][1]
    assert poll(client, s["nonce"]).json()["status"] == "pending"

    # Nonce'ni boshqa Telegram foydalanuvchisi egallay olmaydi
    other = next(_tg_ids)
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(other, text_=f"/start {s['nonce']}"))
    assert "eskirgan" in bot[-1][1]
    # Kontaktsiz kelgan /start — noma'lum nonce
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(other, text_="/start " + "a" * 32))
    assert "eskirgan" in bot[-1][1]


def test_telegram_expired_request(client, bot):
    from sqlalchemy import create_engine

    from app.core import security
    s = start(client)
    owner = create_engine(get_settings().migration_database_url)
    with owner.begin() as c:
        c.execute(text("UPDATE telegram_logins SET expires_at = now() - interval '1 second' WHERE nonce_hash = :h"),
                  {"h": security.hash_token(s["nonce"])})
    owner.dispose()
    assert poll(client, s["nonce"]).status_code == 401


# ─── Google ─────────────────────────────────────────────────────────────────
def test_google_disabled_and_invalid_token(client, monkeypatch):
    r = client.post(f"{API}/auth/google", json={"id_token": "x" * 40})
    assert r.status_code == 503
    monkeypatch.setattr(get_settings(), "google_web_client_id", "web-client.apps.googleusercontent.com")
    r = client.post(f"{API}/auth/google", json={"id_token": "x" * 40})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "google_invalid"


def test_google_links_once_via_phone_then_one_tap(client, monkeypatch, bot):
    sub = f"g-{new_phone()}"
    monkeypatch.setattr(auth_service, "_google_claims",
                        lambda token: {"sub": sub, "email": "ali@example.com", "email_verified": True})
    first = client.post(f"{API}/auth/google", json={"id_token": "t" * 40}).json()
    assert first["need_phone"] is True and first["link_token"] and first["login"] is None

    # SMS orqali raqam tasdiqlanadi va Google hisobi bog'lanadi
    phone = new_phone()
    code = client.post(f"{API}/auth/otp/request", json={"phone": phone}).json()["dev_code"]
    r = client.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code, "full_name": "Ali",
                                                     "link_token": first["link_token"]})
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["id"]

    second = client.post(f"{API}/auth/google", json={"id_token": "t" * 40}).json()
    assert second["need_phone"] is False and second["login"]["user"]["id"] == uid

    # Telegram orqali ham bog'lash mumkin (boshqa Google hisobi)
    sub2 = f"g2-{new_phone()}"
    monkeypatch.setattr(auth_service, "_google_claims",
                        lambda token: {"sub": sub2, "email": "b@example.com", "email_verified": True})
    link = client.post(f"{API}/auth/google", json={"id_token": "t" * 40}).json()["link_token"]
    phone2 = new_phone()
    tg = telegram_login(client, phone2, link_token=link)
    assert client.post(f"{API}/auth/google", json={"id_token": "t" * 40}).json()["login"]["user"]["id"] == tg["user"]["id"]

    # Soxta link_token
    r = client.post(f"{API}/auth/otp/verify", json={"phone": new_phone(), "code": "123456", "link_token": "bad"})
    assert r.status_code == 401


# ─── Hisobni o'chirish ──────────────────────────────────────────────────────
def test_delete_account_frees_phone_and_cancels_future_bookings(client, superadmin):
    biz = create_business(client, superadmin)
    s = new_service(client, biz, duration=60)
    m = new_master(client, biz, s)
    phone = new_phone()
    me = otp_login(client, phone, "O'chiriladigan Mijoz")
    booked = book(client, me, m, s, day_from_today(biz, 1), "11:00")
    assert booked.status_code == 201, booked.text
    assert client.put(f"{API}/me/favorites/{biz['id']}", headers=auth_header(me)).status_code == 204

    assert client.delete(f"{API}/auth/me", headers=auth_header(me)).status_code == 204
    # Eski tokenlar ishlamaydi
    assert client.get(f"{API}/auth/me", headers=auth_header(me)).status_code == 401
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": me["refresh_token"]}).status_code == 401

    with api_session(biz["owner"]["user"]["id"]) as db:
        row = db.execute(text("SELECT status, cancel_reason FROM appointments WHERE id = :a"),
                         {"a": booked.json()["id"]}).one()
        assert row.status == "cancelled"
    from sqlalchemy import create_engine
    owner = create_engine(get_settings().migration_database_url)
    with owner.connect() as c:
        u = c.execute(text("SELECT phone, full_name, status FROM users WHERE id = :u"), {"u": me["user"]["id"]}).one()
        assert u.status == "deleted" and u.full_name == "" and u.phone.startswith("+9980")
        assert c.execute(text("SELECT count(*) FROM favorites WHERE user_id = :u"), {"u": me["user"]["id"]}).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM favorite_businesses WHERE user_id = :u"),
                         {"u": me["user"]["id"]}).scalar() == 0
    owner.dispose()

    # Raqam bo'shadi: shu raqam bilan yangi hisob
    fresh = otp_login(client, phone, "Yangi")
    assert fresh["is_new"] is True and fresh["user"]["id"] != me["user"]["id"]


def test_business_member_cannot_delete_from_app(client, superadmin):
    biz = create_business(client, superadmin)
    r = client.delete(f"{API}/auth/me", headers=auth_header(biz["owner"]))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "business_account"
    assert client.get(f"{API}/auth/me", headers=auth_header(biz["owner"])).status_code == 200
    assert client.delete(f"{API}/auth/me").status_code == 401


# ─── Google Play tekshiruvchisi ─────────────────────────────────────────────
def test_review_phone_fixed_code_without_sms(client, monkeypatch):
    from app.services import sms
    phone = new_phone()
    monkeypatch.setattr(get_settings(), "review_phone", phone)
    monkeypatch.setattr(get_settings(), "review_code", SecretStr("246810"))
    calls = []
    monkeypatch.setattr(sms, "send_otp", lambda p, c: calls.append(p))
    assert client.post(f"{API}/auth/otp/request", json={"phone": phone}).status_code == 200
    assert calls == []
    r = client.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": "246810", "full_name": "Google Review"})
    assert r.status_code == 200, r.text
    # Boshqa raqamlar uchun SMS odatdagidek
    other = new_phone()
    client.post(f"{API}/auth/otp/request", json={"phone": other})
    assert calls == [other]
