"""Super Admin 2FA: parol + Telegram kodi (sql/065_superadmin_2fa.sql)."""
import re

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core.config import get_settings
from app.db.session import api_session
from app.services import auth_service
from tests.conftest import auth_header
from tests.test_social_auth import HDR, _tg_ids, bot, start, tg_update  # noqa: F401

API = "/api/v1"
PHONE, PASSWORD = "+998900000001", "SuperPass123"


@pytest.fixture()
def owner_db():
    eng = create_engine(get_settings().migration_database_url)
    yield eng
    eng.dispose()


@pytest.fixture()
def twofa(monkeypatch, owner_db, superadmin):
    monkeypatch.setattr(get_settings(), "superadmin_2fa", True)
    uid = superadmin["user"]["id"]
    yield uid
    with owner_db.begin() as c:                              # boshqa testlar uchun asl holat
        c.execute(text("DELETE FROM user_identities WHERE user_id = :u"), {"u": uid})
        c.execute(text("UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE id = :u"), {"u": uid})


def login(client, **headers):
    return client.post(f"{API}/auth/login", json={"phone": PHONE, "password": PASSWORD}, headers=headers or None)


def code_from(bot):
    return re.search(r"\b(\d{6})\b", bot[-1][1]).group(1)


def link_telegram(client):
    s = start(client)
    tg = next(_tg_ids)
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg, text_=f"/start {s['nonce']}"))
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg, contact={
        "phone_number": PHONE.lstrip("+"), "user_id": tg, "first_name": "Super"}))
    return client.post(f"{API}/auth/telegram/poll", json={"nonce": s["nonce"], "panel": True}), tg


def test_password_then_telegram_code(client, twofa, bot, owner_db):
    r = login(client)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "telegram_not_linked"

    # Telegram tugmasi faqat bog'laydi — token bermaydi
    r, tg = link_telegram(client)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "use_password_2fa"
    assert "bog'landi" in r.json()["detail"]["message"]

    r = login(client)
    assert r.status_code == 200, r.text
    ch = r.json()
    assert ch["need_2fa"] is True and "access_token" not in ch and ch["expires_in"] == 180
    assert bot[-1][0] == tg and "Super Admin" in bot[-1][1]
    code = code_from(bot)

    wrong = "000000" if code != "000000" else "111111"
    r = client.post(f"{API}/auth/2fa/verify", json={"challenge": ch["challenge"], "code": wrong})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "2fa_invalid" and "2 ta" in r.json()["detail"]["message"]
    r = client.post(f"{API}/auth/2fa/verify", json={"challenge": ch["challenge"], "code": code})
    assert r.status_code == 200, r.text
    tokens = r.json()
    assert tokens["user"]["is_superadmin"] is True
    assert client.get(f"{API}/superadmin/businesses", headers=auth_header(tokens)).status_code == 200
    # Bir martalik
    again = client.post(f"{API}/auth/2fa/verify", json={"challenge": ch["challenge"], "code": code})
    assert again.status_code == 401 and again.json()["detail"]["code"] == "2fa_expired"

    # Muddati o'tgan kod
    ch2 = login(client).json()
    with owner_db.begin() as c:
        c.execute(text("UPDATE login_challenges SET expires_at = now() - interval '1 second' "
                       "WHERE id = (SELECT max(id) FROM login_challenges)"))
    r = client.post(f"{API}/auth/2fa/verify", json={"challenge": ch2["challenge"], "code": code_from(bot)})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "2fa_code_expired"


def test_three_wrong_codes_lock_and_resend_rules(client, twofa, bot, monkeypatch):
    assert link_telegram(client)[0].status_code == 403
    ch = login(client).json()["challenge"]
    first = code_from(bot)

    # Qayta yuborish: 30 s kutish; keyin yangi kod, eskisi yaroqsiz
    r = client.post(f"{API}/auth/2fa/resend", json={"challenge": ch})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "2fa_resend_wait"
    monkeypatch.setattr(get_settings(), "twofa_resend_seconds", 0)
    assert client.post(f"{API}/auth/2fa/resend", json={"challenge": ch}).status_code == 200
    second = code_from(bot)
    if first != second:
        r = client.post(f"{API}/auth/2fa/verify", json={"challenge": ch, "code": first})
        assert r.json()["detail"]["code"] == "2fa_invalid"
    else:
        client.post(f"{API}/auth/2fa/verify", json={"challenge": ch, "code": "999999" if first != "999999" else "888888"})

    bad = "123456" if second != "123456" else "654321"
    assert client.post(f"{API}/auth/2fa/verify", json={"challenge": ch, "code": bad}).status_code == 401
    r = client.post(f"{API}/auth/2fa/verify", json={"challenge": ch, "code": bad})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "2fa_locked"
    # To'g'ri kod ham, yangi parol kirishi ham — blok tugaguncha yo'q
    assert client.post(f"{API}/auth/2fa/verify", json={"challenge": ch, "code": second}).status_code == 401
    r = login(client)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "account_locked"


def test_other_ways_closed_for_superadmin(client, twofa, bot, monkeypatch, owner_db):
    # SMS/Telegram kodi bilan kirish
    code = client.post(f"{API}/auth/otp/request", json={"phone": PHONE}).json()["dev_code"]
    r = client.post(f"{API}/auth/otp/verify", json={"phone": PHONE, "code": code})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "use_password_2fa"
    # Google
    with owner_db.begin() as c:
        c.execute(text("INSERT INTO user_identities (user_id, provider, subject, email) VALUES (:u, 'google', :s, 'a@b.c')"),
                  {"u": twofa, "s": f"sa-{twofa}"})
    monkeypatch.setattr(auth_service, "_google_claims", lambda t: {"sub": f"sa-{twofa}", "email": "a@b.c", "email_verified": True})
    r = client.post(f"{API}/auth/google", json={"id_token": "t" * 40})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "use_password_2fa"
    # Salon paneli domenida — kod yuborilmaydi
    assert link_telegram(client)[0].status_code == 403
    sent = len(bot)
    r = login(client, Host="www.test.chronix.local")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "wrong_panel" and len(bot) == sent


def test_challenges_hidden_from_app_role(client, twofa):
    with api_session(twofa) as db, pytest.raises(DBAPIError):
        db.execute(text("SELECT count(*) FROM login_challenges")).scalar()
