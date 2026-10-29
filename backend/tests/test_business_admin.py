"""Salon egasi: profil, ish soatlari, xizmatlar va narxlar — huquqlar va himoya."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business


@pytest.fixture(scope="module")
def two(client, superadmin):
    a = create_business(client, superadmin)
    b = create_business(client, superadmin)
    return {"a": a, "b": b, "staff": add_member(client, a, "staff"),
            "rec": add_member(client, a, "receptionist"), "manager": add_member(client, a, "manager")}


def url(biz, path):
    return f"/api/v1/businesses/{biz['id']}/{path}"


def test_owner_edits_profile(client, two):
    a = two["a"]
    r = client.patch(url(a, "profile"), headers=auth_header(a["owner"]), json={
        "name": "Go'zallik Markazi", "description": "Eng yaxshi salon", "phone": "90 123 45 67",
        "address": "Amir Temur ko'chasi 1", "lat": 41.31, "lng": 69.28, "logo_url": "https://cdn.example.uz/logo.png"})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["name"] == "Go'zallik Markazi" and p["phone"] == "+998901234567"
    assert abs(p["lat"] - 41.31) < 1e-9 and p["status"] == "active"

    # Katalogda darhol yangilangan
    detail = client.get(f"/api/v1/catalog/businesses/{a['slug']}").json()
    assert detail["name"] == "Go'zallik Markazi" and detail["logo_url"] == "https://cdn.example.uz/logo.png"


def test_profile_validation(client, two):
    a, h = two["a"], auth_header(two["a"]["owner"])
    assert client.patch(url(a, "profile"), headers=h, json={"logo_url": "javascript:alert(1)"}).status_code == 422
    assert client.patch(url(a, "profile"), headers=h, json={"logo_url": "http://insecure.uz/x.png"}).status_code == 422
    assert client.patch(url(a, "profile"), headers=h, json={"lat": 41.3}).status_code == 422          # lng siz
    assert client.patch(url(a, "profile"), headers=h, json={"phone": "12345"}).status_code == 422
    # Holat va slug'ni profil orqali o'zgartirib bo'lmaydi — maydonlar e'tiborsiz qoldiriladi
    client.patch(url(a, "profile"), headers=h, json={"status": "blocked", "slug": "boshqa"})
    p = client.get(url(a, "profile"), headers=h).json()
    assert p["status"] == "active" and p["slug"] == a["slug"]


def test_https_enforced_in_database_too(two):
    with api_session(two["a"]["owner"]["user"]["id"]) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("UPDATE businesses SET logo_url = 'javascript:alert(1)' WHERE id = :b"), {"b": two["a"]["id"]})
        assert e.value.orig.sqlstate == "23514"


def test_hours(client, two):
    a, h = two["a"], auth_header(two["a"]["owner"])
    days = [{"weekday": d, "opens_at": "09:00", "closes_at": "20:00"} for d in range(1, 7)]   # yakshanba dam
    r = client.put(url(a, "hours"), headers=h, json={"days": days})
    assert r.status_code == 200 and len(r.json()) == 6
    assert client.put(url(a, "hours"), headers=h,
                      json={"days": [{"weekday": 1, "opens_at": "20:00", "closes_at": "09:00"}]}).status_code == 422
    assert client.put(url(a, "hours"), headers=h, json={"days": [days[0], days[0]]}).status_code == 422
    assert client.put(url(a, "hours"), headers=h,
                      json={"days": [{"weekday": 8, "opens_at": "09:00", "closes_at": "18:00"}]}).status_code == 422


def test_services_crud_and_price_audit(client, two):
    a, h = two["a"], auth_header(two["a"]["owner"])
    cat = client.post(url(a, "service-categories"), headers=h, json={"name": "Manikyur"}).json()
    assert client.post(url(a, "service-categories"), headers=h, json={"name": "Manikyur"}).status_code == 409

    s = client.post(url(a, "services"), headers=h, json={
        "name": "Klassik manikyur", "category_id": cat["id"], "duration_min": 60, "price": 80000}).json()
    r = client.patch(url(a, f"services/{s['id']}"), headers=h, json={"price": 90000})
    assert r.status_code == 200 and r.json()["price"] == 90000

    with api_session(a["owner"]["user"]["id"]) as db:
        changes = db.execute(text("SELECT changes FROM audit_logs WHERE business_id = :b AND entity_type = 'service' "
                                  "AND entity_id = :s AND action = 'update'"), {"b": a["id"], "s": s["id"]}).scalar()
        assert changes["price"] == [80000, 90000]

    # O'chirish = yashirish
    assert client.delete(url(a, f"services/{s['id']}"), headers=h).status_code == 204
    listed = {x["id"]: x["is_active"] for x in client.get(url(a, "services"), headers=h).json()}
    assert listed[s["id"]] is False

    # Kategoriya o'chsa xizmat qoladi
    s2 = client.post(url(a, "services"), headers=h, json={"name": "Pedikyur", "category_id": cat["id"],
                                                           "duration_min": 60, "price": 100000}).json()
    assert client.delete(url(a, f"service-categories/{cat['id']}"), headers=h).status_code == 204
    assert {x["id"]: x["category_id"] for x in client.get(url(a, "services"), headers=h).json()}[s2["id"]] is None


def test_service_validation(client, two):
    a, h = two["a"], auth_header(two["a"]["owner"])
    for bad in ({"name": "X", "duration_min": 30, "price": 1000},                  # nom juda qisqa
                {"name": "Test", "duration_min": 2, "price": 1000},                # 5 daqiqadan kam
                {"name": "Test", "duration_min": 30, "price": -5},                 # manfiy narx
                {"name": "Test", "duration_min": 30, "price": 10**12}):            # haddan katta
        assert client.post(url(a, "services"), headers=h, json=bad).status_code == 422


def test_role_permissions(client, two):
    a = two["a"]
    staff_h, rec_h, man_h = (auth_header(two[k]["tokens"]) for k in ("staff", "rec", "manager"))
    new = {"name": "Yangi xizmat", "duration_min": 30, "price": 50000}

    for h in (staff_h, rec_h):
        assert client.post(url(a, "services"), headers=h, json=new).status_code == 403
        assert client.patch(url(a, "profile"), headers=h, json={"name": "Buzildi"}).status_code == 403
    # Menejer xizmat va narxlarni boshqaradi, lekin salon profilini emas
    assert client.post(url(a, "services"), headers=man_h, json=new).status_code == 201
    assert client.patch(url(a, "profile"), headers=man_h, json={"name": "Buzildi"}).status_code == 403


def test_cross_business_attacks(client, two):
    a, b = two["a"], two["b"]
    ha, hb = auth_header(a["owner"]), auth_header(b["owner"])
    b_cat = client.post(url(b, "service-categories"), headers=hb, json={"name": "B kategoriya"}).json()
    b_srv = client.post(url(b, "services"), headers=hb, json={"name": "B xizmat", "duration_min": 30, "price": 1}).json()

    # A egasi B ning yo'liga kira olmaydi
    assert client.patch(url(b, "profile"), headers=ha, json={"name": "Hack"}).status_code == 403
    assert client.get(url(b, "services"), headers=ha).status_code == 403
    # O'z yo'lidan turib B ning xizmati ID sini o'zgartirish — topilmaydi
    assert client.patch(url(a, f"services/{b_srv['id']}"), headers=ha, json={"price": 0}).status_code == 404
    assert client.delete(url(a, f"services/{b_srv['id']}"), headers=ha).status_code == 404
    # B ning kategoriyasiga xizmat qo'shish — kompozit FK rad etadi
    r = client.post(url(a, "services"), headers=ha, json={"name": "Aralash", "category_id": b_cat["id"],
                                                          "duration_min": 30, "price": 1})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_reference"
    # A ustasiga B xizmatini biriktirish
    r = client.put(url(a, f"members/{two['staff']['member']['id']}/services"), headers=ha,
                   json={"services": [{"service_id": b_srv["id"]}]})
    assert r.status_code == 422
    # B narxi o'zgarmagan
    assert client.get(url(b, "services"), headers=hb).json()[0]["price"] == 1


def test_services_need_booking_module(client, superadmin):
    biz = create_business(client, superadmin, modules=())
    h = auth_header(biz["owner"])
    assert client.get(url(biz, "services"), headers=h).status_code == 403
    assert client.patch(url(biz, "profile"), headers=h, json={"description": "ok"}).status_code == 200


def test_photos(client, two):
    a, h = two["a"], auth_header(two["a"]["owner"])
    p = client.post(url(a, "photos"), headers=h, json={"url": "https://cdn.example.uz/1.jpg"})
    assert p.status_code == 201
    assert client.post(url(a, "photos"), headers=h, json={"url": "data:image/png;base64,AAA"}).status_code == 422
    assert client.get(f"/api/v1/catalog/businesses/{a['slug']}").json()["photos"] == ["https://cdn.example.uz/1.jpg"]
    assert client.delete(url(a, f"photos/{p.json()['id']}"), headers=h).status_code == 204
    assert client.delete(url(a, f"photos/{p.json()['id']}"), headers=h).status_code == 404
