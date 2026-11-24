"""Direktorning o'zi ro'yxatdan o'tishi, Super Admin tasdig'i va 5 kunlik sinov (sql/070_business_signup.sql)."""
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app import worker
from app.core.config import get_settings
from app.db.session import api_session
from tests.conftest import auth_header, create_business, new_phone, otp_login
from tests.test_social_auth import HDR, _tg_ids, bot, tg_update  # noqa: F401

API = "/api/v1"
PW = "Salon12345"


@pytest.fixture()
def owner_db():
    eng = create_engine(get_settings().migration_database_url)
    yield eng
    eng.dispose()


def verify_phone(client, phone: str) -> dict:
    """Telegram bot raqamni tasdiqlaydi -> signup_token."""
    s = client.post(f"{API}/onboarding/telegram/start")
    assert s.status_code == 200, s.text
    nonce = s.json()["nonce"]
    assert client.post(f"{API}/onboarding/telegram/poll", json={"nonce": nonce}).json()["status"] == "pending"
    tg = next(_tg_ids)
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg, text_=f"/start {nonce}"))
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg, contact={
        "phone_number": phone.lstrip("+"), "user_id": tg, "first_name": "Dilnoza"}))
    r = client.post(f"{API}/onboarding/telegram/poll", json={"nonce": nonce})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok" and body["phone"] == phone and body["signup_token"]
    # Bir martalik
    assert client.post(f"{API}/onboarding/telegram/poll", json={"nonce": nonce}).status_code == 401
    return body | {"tg": tg}


def signup(client, phone: str, **over) -> dict:
    v = verify_phone(client, phone)
    body = {"signup_token": v["signup_token"], "full_name": "Dilnoza Karimova", "password": PW, "category_id": 1,
            "team_size": "2-5", "business_name": "Dilnoza Beauty", "region": "Qashqadaryo viloyati", "city": "Qarshi",
            "address": "Mustaqillik ko'chasi, 5", "contact_phone": "+998901112233"} | over
    r = client.post(f"{API}/onboarding/signup", json=body)
    assert r.status_code == 201, r.text
    return r.json() | {"tg": v["tg"]}


def test_signup_pending_then_approve_starts_trial(client, bot, superadmin):
    phone = new_phone()
    s = signup(client, phone)
    h = auth_header(s)
    bid = s["business_id"]
    assert s["business_slug"].startswith("dilnoza-beauty")
    me = client.get(f"{API}/auth/me", headers=h).json()
    m = me["memberships"][0]
    assert m["business_id"] == bid and m["role"] == "owner" and m["business_status"] == "pending"
    # Kutilayotgan muassasa ilovada yo'q
    assert client.get(f"{API}/catalog/businesses/{s['business_slug']}").status_code == 404
    assert client.get(f"{API}/businesses/{bid}/onboarding", headers=h).json()["status"] == "pending"
    # Parol bilan panelga kira oladi
    assert client.post(f"{API}/auth/login", json={"phone": phone, "password": PW}).status_code == 200

    # Ikkinchi ariza — yo'q (allaqachon a'zo)
    v = client.post(f"{API}/onboarding/telegram/start").json()
    tg = next(_tg_ids)
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg, text_=f"/start {v['nonce']}"))
    client.post(f"{API}/telegram/webhook", headers=HDR, json=tg_update(tg, contact={
        "phone_number": phone.lstrip("+"), "user_id": tg, "first_name": "D"}))
    r = client.post(f"{API}/onboarding/telegram/poll", json={"nonce": v["nonce"]})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "already_member"

    sa = auth_header(superadmin)
    assert client.get(f"{API}/superadmin/signups/count", headers=sa).json()["pending"] >= 1
    rows = client.get(f"{API}/superadmin/signups", headers=sa).json()
    row = next(x for x in rows if x["business_id"] == bid)
    assert row["team_size"] == "2-5" and row["owner_phone"] == phone and row["owner_telegram"] is True
    assert row["city"] == "Qarshi" and row["contact_phone"] == "+998901112233"
    # Oddiy direktor arizalarni ko'rmaydi
    assert client.get(f"{API}/superadmin/signups", headers=h).status_code == 403

    sent = len(bot)
    assert client.post(f"{API}/superadmin/signups/{bid}/approve", headers=sa, json={}).status_code == 204
    assert len(bot) == sent + 1 and bot[-1][0] == s["tg"] and "tasdiqlandi" in bot[-1][1]
    o = client.get(f"{API}/businesses/{bid}/onboarding", headers=h).json()
    assert o["status"] == "trial" and o["days_left"] == 5
    assert o["readiness"]["all_filled"] is False and o["readiness"]["hours"] is True   # tur ish vaqti avtomatik
    assert client.post(f"{API}/superadmin/signups/{bid}/approve", headers=sa, json={}).status_code == 409
    profile = client.get(f"{API}/businesses/{bid}/profile", headers=h).json()
    assert profile["status"] == "active"
    events = client.get(f"{API}/superadmin/signups/events", headers=sa, params={"business_id": bid}).json()
    assert [e["event"] for e in events] == ["approved", "signup"]


def test_reject_deletes_business_keeps_user(client, bot, superadmin):
    phone = new_phone()
    s = signup(client, phone, team_size="1", business_name="Yakka Usta")
    bid, sa = s["business_id"], auth_header(superadmin)
    r = client.post(f"{API}/superadmin/signups/{bid}/reject", headers=sa, json={"reason": "Ma'lumot to'liq emas"})
    assert r.status_code == 204
    assert "rad etildi" in bot[-1][1] and "Ma'lumot to'liq emas" in bot[-1][1]
    assert client.get(f"{API}/auth/me", headers=auth_header(s)).json()["memberships"] == []
    ev = client.get(f"{API}/superadmin/signups/events", headers=sa, params={"business_id": bid}).json()
    assert ev[0]["event"] == "rejected" and ev[0]["business_name"] == "Yakka Usta" and ev[0]["owner_phone"] == phone
    # Rad etilgandan keyin qayta ro'yxatdan o'ta oladi
    s2 = signup(client, phone, business_name="Yakka Usta 2")
    assert s2["business_id"] != bid


def test_existing_client_needs_own_password_and_superadmin_blocked(client, bot, superadmin):
    phone = new_phone()
    otp_login(client, phone)                                   # mobil ilova mijozi (paroli yo'q)
    s = signup(client, phone)                                  # parol o'rnatiladi
    assert client.post(f"{API}/auth/login", json={"phone": phone, "password": PW}).status_code == 200
    assert s["is_new"] is False

    # O'z paroli bor mavjud hisob — boshqa parol bilan bo'lmaydi
    other = new_phone()
    tokens = otp_login(client, other)
    client.post(f"{API}/auth/password", headers=auth_header(tokens), json={"new_password": "OwnPass9876"})
    v = verify_phone(client, other)
    assert v["exists"] is True and v["has_password"] is True
    body = {"signup_token": v["signup_token"], "full_name": "X Y", "password": PW, "category_id": 2,
            "team_size": "1", "business_name": "Boshqa"}
    r = client.post(f"{API}/onboarding/signup", json=body)
    assert r.status_code == 401 and r.json()["detail"]["code"] == "invalid_credentials"
    assert client.post(f"{API}/onboarding/signup", json=body | {"password": "OwnPass9876"}).status_code == 201

    # Yaroqsiz token va yo'nalish
    assert client.post(f"{API}/onboarding/signup", json=body | {"signup_token": "x" * 40}).status_code == 401
    v2 = verify_phone(client, new_phone())
    r = client.post(f"{API}/onboarding/signup", json=body | {"signup_token": v2["signup_token"], "category_id": 999})
    assert r.status_code == 422


def test_readiness_is_private(client, bot, superadmin):
    s = signup(client, new_phone())
    stranger = create_business(client, superadmin)
    with api_session(stranger["owner"]["user"]["id"]) as db, pytest.raises(DBAPIError):
        db.execute(text("SELECT app.trial_readiness(:b)"), {"b": s["business_id"]}).scalar()
    # Begona direktor arizani ko'rmaydi (RLS) — "none"
    r = client.get(f"{API}/businesses/{s['business_id']}/onboarding", headers=auth_header(stranger["owner"]))
    assert r.json()["status"] == "none"


def _approve(client, superadmin, bid):
    assert client.post(f"{API}/superadmin/signups/{bid}/approve", headers=auth_header(superadmin), json={}).status_code == 204


def _age(owner_db, bid, days: float, ended: bool = False):
    with owner_db.begin() as c:
        c.execute(text("UPDATE business_signups SET trial_started_at = now() - make_interval(secs => :s), "
                       "trial_ends_at = CASE WHEN :e THEN now() - interval '1 minute' ELSE trial_ends_at END "
                       "WHERE business_id = :b"), {"s": days * 86400, "e": ended, "b": bid})


def _events(client, superadmin, bid):
    return client.get(f"{API}/superadmin/signups/events", headers=auth_header(superadmin),
                      params={"business_id": bid}).json()


def test_trial_watch_dry_run_only_logs(client, bot, superadmin, owner_db, monkeypatch):
    monkeypatch.setattr(get_settings(), "trial_dry_run", True)
    s = signup(client, new_phone())
    bid = s["business_id"]
    _approve(client, superadmin, bid)
    with owner_db.begin() as c:                                # direktor hali kirmagan
        c.execute(text("UPDATE users SET last_login_at = NULL WHERE phone = :p"), {"p": s["user"]["phone"]})
        c.execute(text("UPDATE refresh_tokens SET created_at = now() - interval '10 days' "
                       "WHERE user_id = (SELECT id FROM users WHERE phone = :p)"), {"p": s["user"]["phone"]})
    sent = len(bot)
    _age(owner_db, bid, 3.5, ended=True)
    worker.trial_watch()
    worker.trial_watch()                                       # takror yozilmaydi
    ev = [(e["event"], e["dry_run"]) for e in _events(client, superadmin, bid)]
    assert ("sms_day3", True) in ev and ("tg_day4", True) in ev and ("deleted", True) in ev
    assert sum(1 for e in ev if e[0] == "deleted") == 1 and len(bot) == sent      # hech narsa yuborilmagan
    sms_ev = next(e for e in _events(client, superadmin, bid) if e["event"] == "sms_day3")
    assert sms_ev["details"]["skipped"] == "TRIAL_SMS_ENABLED=false"
    # Muassasa o'chmagan
    assert client.get(f"{API}/businesses/{bid}/onboarding", headers=auth_header(s)).json()["status"] == "trial"


def test_trial_watch_real_delete_and_convert(client, bot, superadmin, owner_db, monkeypatch):
    monkeypatch.setattr(get_settings(), "trial_dry_run", False)
    # 1) Hech narsa qilmagan — 4-kunda Telegram, oxirida o'chiriladi
    lazy = signup(client, new_phone(), business_name="Dangasa Salon")
    _approve(client, superadmin, lazy["business_id"])
    _age(owner_db, lazy["business_id"], 3.2)
    worker.trial_watch()
    assert bot[-1][0] == lazy["tg"] and "qo'shing" in bot[-1][1] and "xizmatlar" in bot[-1][1]
    _age(owner_db, lazy["business_id"], 5.1, ended=True)
    worker.trial_watch()
    assert "o'chirildi" in bot[-1][1]
    assert client.get(f"{API}/auth/me", headers=auth_header(lazy)).json()["memberships"] == []
    assert _events(client, superadmin, lazy["business_id"])[0]["event"] == "deleted"

    # 2) Hammasini to'ldirgan — oylik obunaga o'tadi
    good = signup(client, new_phone(), business_name="Faol Salon")
    bid, h = good["business_id"], auth_header(good)
    _approve(client, superadmin, bid)
    svc = client.post(f"{API}/businesses/{bid}/services", headers=h,
                      json={"name": "Soch turmagi", "duration_min": 30, "price": 80000}).json()
    m = client.post(f"{API}/businesses/{bid}/members", headers=h,
                    json={"phone": new_phone(), "full_name": "Usta Ali", "role": "staff"}).json()
    client.put(f"{API}/businesses/{bid}/members/{m['id']}/services", headers=h, json={"services": [{"service_id": svc["id"]}]})
    client.patch(f"{API}/businesses/{bid}/profile", headers=h, json={"lat": 38.86, "lng": 65.79})
    o = client.get(f"{API}/businesses/{bid}/onboarding", headers=h).json()["readiness"]
    assert o["all_filled"] and o["visible"] and o["logged_in"]
    _age(owner_db, bid, 5.1, ended=True)
    worker.trial_watch()
    assert client.get(f"{API}/businesses/{bid}/onboarding", headers=h).json()["status"] == "converted"
    assert "muvaffaqiyatli" in bot[-1][1]
    assert _events(client, superadmin, bid)[0]["event"] == "converted"


def test_trial_delete_never_touches_admin_created(owner_db, superadmin, client):
    """Xavfsizlik: Super Admin ochgan muassasa (arizasiz) worker funksiyasi bilan o'chmaydi."""
    biz = create_business(client, superadmin)
    from app.db.session import worker_session
    with worker_session() as db:
        assert db.scalar(text("SELECT app.trial_delete(:b, '{}'::jsonb)"), {"b": biz["id"]}) is False
        db.commit()
    assert client.get(f"{API}/businesses/{biz['id']}/profile", headers=auth_header(biz["owner"])).status_code == 200


def test_public_lists_for_signup(client):
    regs = client.get(f"{API}/onboarding/regions")
    assert regs.status_code == 200 and regs.json()[0]["name"] == "Toshkent shahri"
    cats = client.get(f"{API}/onboarding/categories", headers={"X-Chronix-Client": "mobile"})
    assert cats.status_code == 200 and {"beauty_salon", "barbershop"} <= {c["slug"] for c in cats.json()}
    assert client.get(f"{API}/geo/regions").status_code == 401             # geokoder himoyasi o'zgarmadi


def test_session_refresh_counts_as_activity(client, bot, superadmin, owner_db):
    s = signup(client, new_phone())
    bid = s["business_id"]
    _approve(client, superadmin, bid)
    with owner_db.begin() as c:
        c.execute(text("UPDATE users SET last_login_at = now() - interval '10 days' WHERE phone = :p"), {"p": s["user"]["phone"]})
        c.execute(text("UPDATE refresh_tokens SET created_at = now() - interval '10 days' "
                       "WHERE user_id = (SELECT id FROM users WHERE phone = :p)"), {"p": s["user"]["phone"]})
    h = auth_header(s)
    assert client.get(f"{API}/businesses/{bid}/onboarding", headers=h).json()["readiness"]["logged_in"] is False
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": s["refresh_token"]}).status_code == 200
    assert client.get(f"{API}/businesses/{bid}/onboarding", headers=h).json()["readiness"]["logged_in"] is True
