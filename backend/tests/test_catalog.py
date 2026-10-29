"""Ochiq katalog va xarita qidiruvi (PostGIS)."""
import pytest

from tests.conftest import add_member, auth_header, create_business

API = "/api/v1/catalog"
# Samarqand markazi — boshqa testlardagi (Toshkent) bizneslar aralashmasin
LAT, LNG = 39.6542, 66.9597
KM = 0.009                       # ~1 km kenglik bo'yicha


@pytest.fixture(scope="module")
def city(client, superadmin):
    """Markazdan 1, 4, 8 km dagi bizneslar + ko'rinmasligi kerak bo'lganlar."""
    near = create_business(client, superadmin, lat=LAT + 1 * KM, lng=LNG, name="Yaqin Barber", category_id=2)
    mid = create_business(client, superadmin, lat=LAT + 4 * KM, lng=LNG, name="O'rta Salon", category_id=1)
    far = create_business(client, superadmin, lat=LAT + 8 * KM, lng=LNG, name="Uzoq Klinika", category_id=3)
    hidden = create_business(client, superadmin, lat=LAT + 0.5 * KM, lng=LNG, name="Yashirin Salon")
    blocked = create_business(client, superadmin, lat=LAT + 0.5 * KM, lng=LNG, name="Bloklangan Salon")

    # "Yaqin" — har kuni 00:00–23:59 ochiq, xizmat va usta bilan
    h = auth_header(near["owner"])
    client.put(f"/api/v1/businesses/{near['id']}/hours", headers=h,
               json={"days": [{"weekday": d, "opens_at": "00:00", "closes_at": "23:59"} for d in range(1, 8)]})
    cat = client.post(f"/api/v1/businesses/{near['id']}/service-categories", headers=h, json={"name": "Soch"}).json()
    haircut = client.post(f"/api/v1/businesses/{near['id']}/services", headers=h,
                          json={"name": "Erkaklar soch turmagi", "category_id": cat["id"], "duration_min": 30, "price": 60000}).json()
    beard = client.post(f"/api/v1/businesses/{near['id']}/services", headers=h,
                        json={"name": "Soqol olish", "duration_min": 20, "price": 40000}).json()
    old = client.post(f"/api/v1/businesses/{near['id']}/services", headers=h,
                      json={"name": "Eski xizmat", "duration_min": 20, "price": 1000}).json()
    client.delete(f"/api/v1/businesses/{near['id']}/services/{old['id']}", headers=h)

    barber = add_member(client, near, "staff")
    client.put(f"/api/v1/businesses/{near['id']}/members/{barber['member']['id']}/services", headers=h,
               json={"services": [{"service_id": haircut["id"]}, {"service_id": beard["id"], "custom_price": 50000}]})
    reception = add_member(client, near, "receptionist")
    client.patch(f"/api/v1/businesses/{near['id']}/members/{reception['member']['id']}", headers=h,
                 json={"is_bookable": False})

    client.patch(f"/api/v1/businesses/{hidden['id']}/profile", headers=auth_header(hidden["owner"]), json={"is_listed": False})
    client.patch(f"/api/v1/superadmin/businesses/{blocked['id']}/status", headers=auth_header(superadmin),
                 json={"status": "blocked"})
    return {"near": near, "mid": mid, "far": far, "hidden": hidden, "blocked": blocked,
            "haircut": haircut, "beard": beard, "old": old, "barber": barber, "reception": reception}


def nearby(client, **params):
    r = client.get(f"{API}/businesses/nearby", params={"lat": LAT, "lng": LNG, **params})
    assert r.status_code == 200, r.text
    return r.json()


def test_nearby_default_5km_sorted_by_distance(client, city):
    data = nearby(client)
    names = [b["name"] for b in data["items"]]
    assert names == ["Yaqin Barber", "O'rta Salon"]
    assert data["total"] == 2 and data["radius_m"] == 5000
    d = [b["distance_m"] for b in data["items"]]
    assert 950 <= d[0] <= 1050 and 3900 <= d[1] <= 4100


def test_nearby_custom_radius(client, city):
    assert [b["name"] for b in nearby(client, radius_m=10000)["items"]] == ["Yaqin Barber", "O'rta Salon", "Uzoq Klinika"]
    assert nearby(client, radius_m=500)["items"] == []


def test_hidden_and_blocked_not_shown(client, city):
    names = {b["name"] for b in nearby(client, radius_m=2000)["items"]}
    assert "Yashirin Salon" not in names and "Bloklangan Salon" not in names


def test_filters(client, city):
    assert [b["name"] for b in nearby(client, radius_m=10000, category="clinic")["items"]] == ["Uzoq Klinika"]
    assert [b["name"] for b in nearby(client, radius_m=10000, q="soqol")["items"]] == ["Yaqin Barber"]   # xizmat nomi bo'yicha
    assert [b["name"] for b in nearby(client, radius_m=10000, open_now=True)["items"]] == ["Yaqin Barber"]
    # '%' butun bazani qaytarmaydi
    assert nearby(client, radius_m=10000, q="%%")["items"] == []


def test_card_fields(client, city):
    card = nearby(client)["items"][0]
    assert card["is_open_now"] is True and card["min_price"] == 40000       # yashirilgan 1000 so'mlik hisobga olinmaydi
    assert abs(card["lat"] - (LAT + KM)) < 1e-6 and abs(card["lng"] - LNG) < 1e-6
    assert card["category"] == "barbershop"


def test_nearby_validation(client):
    assert client.get(f"{API}/businesses/nearby", params={"lat": 100, "lng": LNG}).status_code == 422
    assert client.get(f"{API}/businesses/nearby", params={"lat": LAT, "lng": LNG, "radius_m": 999999}).status_code == 422
    assert client.get(f"{API}/businesses/nearby", params={"lat": LAT, "lng": LNG, "limit": 1000}).status_code == 422


def test_in_bounds(client, city):
    r = client.get(f"{API}/businesses/in-bounds", params={
        "sw_lat": LAT, "sw_lng": LNG - 0.01, "ne_lat": LAT + 5 * KM, "ne_lng": LNG + 0.01})
    assert r.status_code == 200
    assert {b["name"] for b in r.json()} == {"Yaqin Barber", "O'rta Salon"}
    # Juda katta oyna — rad (butun bazani yuklab olishga qarshi)
    r = client.get(f"{API}/businesses/in-bounds", params={"sw_lat": 37, "sw_lng": 56, "ne_lat": 45, "ne_lng": 73})
    assert r.status_code == 422


def test_business_detail(client, city):
    r = client.get(f"{API}/businesses/{city['near']['slug']}")
    assert r.status_code == 200
    d = r.json()
    assert d["name"] == "Yaqin Barber" and d["is_open_now"] is True and len(d["hours"]) == 7

    groups = {g["category_name"]: [s["name"] for s in g["services"]] for g in d["service_groups"]}
    assert groups == {"Soch": ["Erkaklar soch turmagi"], "Boshqa": ["Soqol olish"]}   # yashirilgan xizmat yo'q

    assert len(d["staff"]) == 1                                         # qabulxona (bron qilinmaydi) ko'rinmaydi
    st = d["staff"][0]
    assert st["member_id"] == city["barber"]["member"]["id"]
    assert st["service_ids"] == sorted([city["haircut"]["id"], city["beard"]["id"]])
    # Shaxsiy ma'lumot chiqmaydi
    assert "phone" not in st and "user_id" not in st and "salary" not in str(d)


def test_detail_of_hidden_or_blocked_is_404(client, city):
    for key in ("hidden", "blocked"):
        assert client.get(f"{API}/businesses/{city[key]['slug']}").status_code == 404
    assert client.get(f"{API}/businesses/yoq-bunday").status_code == 404


def test_catalog_needs_no_login_and_ignores_token(client, city, superadmin):
    """Super Admin tokeni bilan ham katalog yashirin biznesni ko'rsatmaydi."""
    r = client.get(f"{API}/businesses/{city['hidden']['slug']}", headers=auth_header(superadmin))
    assert r.status_code == 404
    assert client.get(f"{API}/categories").status_code == 200
