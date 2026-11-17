"""Ilova analitikasi (055_app_analytics.sql): hodisa yozish, Super Admin hisobotlari, maxfiylik."""
import uuid

from tests.conftest import auth_header, new_phone, otp_login

URL = "/api/v1/events"


def send(client, events, tokens=None, platform="android", anon=None):
    r = client.post(URL, headers=auth_header(tokens) if tokens else {}, json={
        "anon_id": anon or uuid.uuid4().hex, "platform": platform, "app_version": "1.0.1", "events": events})
    assert r.status_code == 200, r.text
    return r.json()["accepted"]


def test_guest_and_user_events_and_bad_ones_skipped(client, superadmin):
    q = f"manikyur{uuid.uuid4().hex[:6]}"
    assert send(client, [{"name": "search", "props": {"q": f"  {q.upper()} ", "results": 0}},
                         {"name": "Bad Name!"},                                  # noto'g'ri nom — tashlanadi
                         {"name": "booking_open", "props": {"slug": "x"}}]) == 2
    user = otp_login(client, new_phone(), "Analitika Mijoz")
    assert send(client, [{"name": "search", "props": {"q": q, "results": 3}},
                         {"name": "screen", "props": {"path": "/bookings"}}], tokens=user) == 2
    # Yaroqsiz token — xato emas, mehmon sifatida yoziladi
    r = client.post(URL, headers={"Authorization": "Bearer yaroqsiz"}, json={
        "platform": "market", "events": [{"name": "page_open"}]})
    assert r.status_code == 200 and r.json()["accepted"] == 1

    s = client.get("/api/v1/admin/analytics/searches", headers=auth_header(superadmin)).json()
    row = next(x for x in s["top"] if x["query"] == q)
    assert row == {"query": q, "count": 2, "users": 2, "zero_results": 1}
    assert any(x["query"] == q for x in s["zero"])

    ev = client.get("/api/v1/admin/analytics/events?platform=android", headers=auth_header(superadmin)).json()
    assert any(x["name"] == "booking_open" for x in ev["events"])
    assert all(x["name"] not in ("search", "screen") for x in ev["events"])
    assert any(x["path"] == "/bookings" and x["platform"] == "android" for x in ev["screens"])


def test_phone_numbers_stripped_from_search(client, superadmin):
    tag = uuid.uuid4().hex[:6]
    send(client, [{"name": "search", "props": {"q": f"salon{tag} +998 90 123 45 67", "results": 1}}])
    s = client.get("/api/v1/admin/analytics/searches", headers=auth_header(superadmin)).json()
    assert any(x["query"] == f"salon{tag}" for x in s["top"])
    assert not any("123 45" in x["query"] for x in s["top"])


def test_limits(client):
    r = client.post(URL, json={"platform": "android", "events": [{"name": "tap"}] * 51})
    assert r.status_code == 422
    r = client.post(URL, json={"platform": "desktop", "events": [{"name": "tap"}]})
    assert r.status_code == 422
    assert send(client, [{"name": "big", "props": {"x": "a" * 2000}}]) == 0     # props juda katta


def test_overview_counts_and_access(client, superadmin):
    anon = uuid.uuid4().hex
    send(client, [{"name": "app_open"}], anon=anon)
    o = client.get("/api/v1/admin/analytics/overview?days=7", headers=auth_header(superadmin))
    assert o.status_code == 200, o.text
    o = o.json()
    assert len(o["daily"]) == 7 and o["devices_total"] >= 1 and o["devices_new"] >= 1 and o["dau"] >= 1
    assert o["users_total"] >= 1 and any(p["platform"] == "android" for p in o["platforms"])
    assert sum(d["active_users"] for d in o["daily"]) >= 1

    user = otp_login(client, new_phone(), "Oddiy")
    for path in ("overview", "searches", "events"):
        assert client.get(f"/api/v1/admin/analytics/{path}", headers=auth_header(user)).status_code == 403
        assert client.get(f"/api/v1/admin/analytics/{path}").status_code == 401


def test_rls_and_account_deletion_unlinks(client, superadmin):
    import os
    from sqlalchemy import create_engine, text
    from app.db.session import api_session
    user = otp_login(client, new_phone(), "O'chiriladigan")
    anon = uuid.uuid4().hex
    send(client, [{"name": "profile_open"}], tokens=user, anon=anon)
    # Oddiy foydalanuvchi hatto o'z hodisalarini o'qiy olmaydi, to'g'ridan yoza olmaydi
    with api_session(user["user"]["id"]) as db:
        assert db.execute(text("SELECT count(*) FROM app_events")).scalar() == 0
        try:
            db.execute(text("INSERT INTO app_events (platform, name) VALUES ('android', 'hack')"))
            raise AssertionError("yozish mumkin bo'lmasligi kerak")
        except Exception as e:
            assert "permission denied" in str(e)
    r = client.request("DELETE", "/api/v1/me", headers=auth_header(user))
    if r.status_code == 404:                                       # yo'l boshqacha bo'lsa — to'g'ridan funksiya
        with api_session(user["user"]["id"]) as db:
            db.execute(text("SELECT app.delete_my_account()"))
            db.commit()
    admin = create_engine(os.environ["MIGRATION_DATABASE_URL"])
    with admin.connect() as c:
        assert c.execute(text("SELECT count(*) FROM app_events WHERE user_id = :u OR anon_id = :a"),
                         {"u": user["user"]["id"], "a": anon}).scalar() == 0


def test_phone_rule_keeps_ordinary_numbers(client, superadmin):
    """Faqat telefon (kamida 9 raqam) o'chadi; "2024", "1234567" kabi oddiy sonlar qoladi."""
    tag = "zz" + uuid.uuid4().hex[:4].replace("0", "a")
    send(client, [{"name": "search", "props": {"q": f"{tag} salon 1234567", "results": 1}},
                  {"name": "search", "props": {"q": f"{tag}b 901234567", "results": 1}},
                  {"name": "search", "props": {"q": f"{tag}c +998 (90) 123-45-67", "results": 1}}])
    top = {x["query"] for x in client.get("/api/v1/admin/analytics/searches", headers=auth_header(superadmin)).json()["top"]}
    assert f"{tag} salon 1234567" in top and f"{tag}b" in top and f"{tag}c" in top
