"""Mijoz profili, ro'yxatdan o'tish, sevimlilar va katalog filtrlari."""
from datetime import date, timedelta

import pytest

from tests.conftest import auth_header, create_business, new_phone, otp_login


def register(client, phone, **extra):
    r = client.post("/api/v1/auth/otp/request", json={"phone": phone})
    assert r.status_code == 200, r.text
    return client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": r.json()["dev_code"], **extra})


def test_register_saves_full_profile_and_password(client):
    phone = new_phone()
    r = register(client, phone, full_name="Dilshod Ergashev", birth_date="1998-05-20", gender="male",
                 password="Kuchli2026parol")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_new"] is True
    assert body["user"]["birth_date"] == "1998-05-20" and body["user"]["gender"] == "male"

    r = client.post("/api/v1/auth/login", json={"phone": phone, "password": "Kuchli2026parol"})
    assert r.status_code == 200, r.text


def test_register_does_not_touch_existing_account(client):
    phone = new_phone()
    register(client, phone, full_name="Asl Ism", gender="female", password="Kuchli2026parol")
    r = register(client, phone, full_name="Boshqa", gender="male", birth_date="2000-01-01", password="Boshqa2026parol")
    assert r.status_code == 200
    u = r.json()["user"]
    assert r.json()["is_new"] is False and u["full_name"] == "Asl Ism" and u["gender"] == "female"
    assert client.post("/api/v1/auth/login", json={"phone": phone, "password": "Boshqa2026parol"}).status_code == 401


def test_weak_password_does_not_burn_code(client):
    phone = new_phone()
    code = client.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_code"]
    r = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "password": "123"})
    assert r.status_code in (400, 422)
    r = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "full_name": "Ism Familiya"})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("field, value", [
    ("gender", "other"),
    ("birth_date", "1800-01-01"),
    ("birth_date", (date.today() + timedelta(days=2)).isoformat()),
])
def test_invalid_profile_rejected(client, field, value):
    phone = new_phone()
    assert register(client, phone, **{field: value}).status_code == 422
    h = auth_header(otp_login(client, phone))
    assert client.patch("/api/v1/auth/me", headers=h, json={field: value}).status_code == 422


def test_update_profile(client):
    h = auth_header(otp_login(client, new_phone()))
    r = client.patch("/api/v1/auth/me", headers=h,
                     json={"full_name": "  Yangi Ism ", "birth_date": "1995-02-03", "gender": "female"})
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["full_name"] == "Yangi Ism" and u["birth_date"] == "1995-02-03" and u["gender"] == "female"
    me = client.get("/api/v1/auth/me", headers=h).json()["user"]
    assert me["gender"] == "female"
    assert client.patch("/api/v1/auth/me", json={"gender": "male"}).status_code == 401


def test_profile_cannot_change_phone_or_role(client):
    phone = new_phone()
    h = auth_header(otp_login(client, phone))
    r = client.patch("/api/v1/auth/me", headers=h, json={"phone": new_phone(), "is_superadmin": True})
    assert r.status_code == 200
    me = client.get("/api/v1/auth/me", headers=h).json()["user"]
    assert me["phone"] == phone and me["is_superadmin"] is False


@pytest.fixture()
def biz(client, superadmin):
    b = create_business(client, superadmin)
    # Xizmatsiz salon ilovada (va sevimlilar ro'yxatida) ko'rinmaydi
    client.post(f"/api/v1/businesses/{b['id']}/services", headers=auth_header(b["owner"]),
                json={"name": "Soch olish", "duration_min": 30, "price": 50000})
    return b


def test_favorites_flow_and_isolation(client, biz):
    a = auth_header(otp_login(client, new_phone()))
    b = auth_header(otp_login(client, new_phone()))
    url = f"/api/v1/me/favorites/{biz['id']}"
    assert client.put(url).status_code == 401
    assert client.put(url, headers=a).status_code == 204
    assert client.put(url, headers=a).status_code == 204                   # takror xato emas
    assert client.get("/api/v1/me/favorites/ids", headers=a).json() == [biz["id"]]
    assert [x["id"] for x in client.get("/api/v1/me/favorites", headers=a).json()] == [biz["id"]]
    assert client.get("/api/v1/me/favorites/ids", headers=b).json() == []

    assert client.delete(url, headers=b).status_code == 204               # boshqa odam o'chira olmaydi
    assert client.get("/api/v1/me/favorites/ids", headers=a).json() == [biz["id"]]
    assert client.delete(url, headers=a).status_code == 204
    assert client.get("/api/v1/me/favorites/ids", headers=a).json() == []


def test_favorite_unknown_business_404(client):
    h = auth_header(otp_login(client, new_phone()))
    assert client.put("/api/v1/me/favorites/999999", headers=h).status_code == 404


def test_blocked_salon_hidden_from_favorites(client, superadmin, biz):
    h = auth_header(otp_login(client, new_phone()))
    client.put(f"/api/v1/me/favorites/{biz['id']}", headers=h)
    r = client.patch(f"/api/v1/superadmin/businesses/{biz['id']}/status", headers=auth_header(superadmin),
                     json={"status": "blocked"})
    assert r.status_code == 204
    assert client.get("/api/v1/me/favorites", headers=h).json() == []


def test_catalog_sort_filter_and_rich_card(client, superadmin):
    lat, lng = 40.1234, 65.4321
    cheap = create_business(client, superadmin, lat=lat, lng=lng, name="Arzon Salon")
    dear = create_business(client, superadmin, lat=lat + 0.01, lng=lng, name="Qimmat Salon")
    for b, price in ((cheap, 50_000), (dear, 300_000)):
        r = client.post(f"/api/v1/businesses/{b['id']}/services", headers=auth_header(b["owner"]),
                        json={"name": "Soch kesish", "duration_min": 30, "price": price})
        assert r.status_code == 201, r.text
    url = "/api/v1/catalog/businesses/nearby"
    base = {"lat": lat, "lng": lng, "radius_m": 5000}

    rows = client.get(url, params={**base, "sort": "price"}).json()["items"]
    assert [r["id"] for r in rows][:2] == [cheap["id"], dear["id"]]
    assert rows[0]["top_service"] and rows[0]["photos"] == []

    rows = client.get(url, params={**base, "max_price": 100_000}).json()["items"]
    assert [r["id"] for r in rows] == [cheap["id"]]

    assert client.get(url, params={**base, "sort": "rating"}).status_code == 200
    assert client.get(url, params={**base, "sort": "boshqa"}).status_code == 422
