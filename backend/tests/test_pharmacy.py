"""Dorixona: ish tartibi, ilovadagi katalog (narx, holat), shtrix-kod, ko'rinish qoidalari."""
import pytest

from tests.conftest import auth_header, create_business

LAT, LNG = 40.1033, 65.3734            # Navoiy — boshqa testlar aralashmasin
SA = "/api/v1/superadmin/business-types"


def type_id(client, superadmin, slug):
    return next(t["id"] for t in client.get(SA, headers=auth_header(superadmin)).json() if t["slug"] == slug)


def url(biz, tail):
    return f"/api/v1/businesses/{biz['id']}/{tail}"


def add_product(client, biz, name, qty, **extra):
    h = auth_header(biz["owner"])
    r = client.post(url(biz, "products"), headers=h, json={"name": name, "unit": "dona", "cost_price": 1000,
                                                            "sale_price": 5000, "min_qty": 5, **extra})
    assert r.status_code == 201, r.text
    p = r.json()
    if qty:
        mv = client.post(url(biz, f"products/{p['id']}/movements"), headers=h, json={"type": "purchase", "qty": qty})
        assert mv.status_code == 201, mv.text
    return p


@pytest.fixture()
def pharmacy(client, superadmin):
    biz = create_business(client, superadmin, modules=("booking", "inventory"), lat=LAT, lng=LNG,
                          category_id=type_id(client, superadmin, "pharmacy"))
    add_product(client, biz, "Paratsetamol 500 mg", 50, category="Og'riq qoldiruvchi", barcode="4780000000017")
    add_product(client, biz, "Ibuprofen 200 mg", 3, category="Og'riq qoldiruvchi")          # kam qoldi
    add_product(client, biz, "Vitamin C", 0, category="Vitaminlar")                          # tugagan
    return biz


def products(client, biz, **params):
    r = client.get(f"/api/v1/catalog/businesses/{biz['slug']}/products", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_public_catalog_shows_safe_fields(client, pharmacy):
    d = products(client, pharmacy)
    assert [(p["name"], p["stock"]) for p in d["items"]] == [
        ("Ibuprofen 200 mg", "low"), ("Paratsetamol 500 mg", "in"), ("Vitamin C", "out")]
    first = d["items"][0]
    assert set(first) == {"id", "name", "category", "unit", "price", "stock"}        # tannarx va qoldiq yo'q
    assert first["price"] == 5000
    assert d["categories"] == [{"category": "Og'riq qoldiruvchi", "count": 2}, {"category": "Vitaminlar", "count": 1}]


def test_search_and_filter(client, pharmacy):
    assert [p["name"] for p in products(client, pharmacy, q="parats")["items"]] == ["Paratsetamol 500 mg"]
    assert [p["name"] for p in products(client, pharmacy, q="4780000000017")["items"]] == ["Paratsetamol 500 mg"]
    assert [p["name"] for p in products(client, pharmacy, category="Vitaminlar")["items"]] == ["Vitamin C"]
    assert products(client, pharmacy, q="%")["items"] == []                       # maxsus belgi butun ro'yxatni ochmaydi


def test_pharmacy_visible_without_services(client, pharmacy):
    r = client.get("/api/v1/catalog/businesses/nearby", params={"lat": LAT, "lng": LNG, "radius_m": 2000})
    assert pharmacy["id"] in {b["id"] for b in r.json()["items"]}
    d = client.get(f"/api/v1/catalog/businesses/{pharmacy['slug']}").json()
    assert d["kind"] == "pharmacy"


def test_salon_products_are_not_public(client, superadmin):
    salon = create_business(client, superadmin, modules=("booking", "inventory"))
    client.post(url(salon, "services"), headers=auth_header(salon["owner"]),
                json={"name": "Soch olish", "duration_min": 30, "price": 50000})
    add_product(client, salon, "Shampun", 10)
    assert products(client, salon)["items"] == []


def test_inventory_module_off_hides_catalog(client, superadmin, pharmacy):
    r = client.put(f"/api/v1/superadmin/businesses/{pharmacy['id']}/modules/inventory",
                   headers=auth_header(superadmin), json={"enabled": False})
    assert r.status_code == 204, r.text
    assert products(client, pharmacy)["items"] == []


def test_barcode_unique_and_valid(client, pharmacy):
    h = auth_header(pharmacy["owner"])
    dup = client.post(url(pharmacy, "products"), headers=h, json={"name": "Nusxa", "barcode": "4780000000017"})
    assert dup.status_code in (409, 422)
    assert client.post(url(pharmacy, "products"), headers=h, json={"name": "Yomon", "barcode": "1 2"}).status_code == 422
    found = client.get(url(pharmacy, "products"), headers=h, params={"q": "4780000000017"}).json()
    assert [p["name"] for p in found] == ["Paratsetamol 500 mg"] and found[0]["category"] == "Og'riq qoldiruvchi"


def test_membership_and_types_have_kind(client, superadmin, pharmacy):
    me = client.get("/api/v1/auth/me", headers=auth_header(pharmacy["owner"])).json()
    assert me["memberships"][0]["business_kind"] == "pharmacy"
    kinds = {t["slug"]: t["kind"] for t in client.get(SA, headers=auth_header(superadmin)).json()}
    assert kinds["pharmacy"] == "pharmacy" and kinds["dental"] == "clinic" and kinds["barbershop"] == "salon"
    cats = {c["slug"]: c["kind"] for c in client.get("/api/v1/catalog/categories").json()}
    assert cats["clinic"] == "clinic"
