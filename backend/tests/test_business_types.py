"""Muassasa turlari: dorixona, Super Admin boshqaruvi, tavsiya xizmatlar, ilovada ko'rinish qoidalari."""
import pytest

from tests.conftest import add_member, auth_header, create_business, new_phone

SA = "/api/v1/superadmin/business-types"
# Buxoro — boshqa testlardagi bizneslar aralashmasin
LAT, LNG = 39.7747, 64.4286


def nearby_ids(client, **params):
    r = client.get("/api/v1/catalog/businesses/nearby", params={"lat": LAT, "lng": LNG, "radius_m": 3000, **params})
    assert r.status_code == 200, r.text
    return {b["id"] for b in r.json()["items"]}


def type_by_slug(client, superadmin, slug):
    return next(t for t in client.get(SA, headers=auth_header(superadmin)).json() if t["slug"] == slug)


def test_public_categories_include_pharmacy_in_order(client):
    slugs = [c["slug"] for c in client.get("/api/v1/catalog/categories").json()]
    assert slugs[:6] == ["beauty_salon", "barbershop", "pharmacy", "clinic", "dental", "spa"]


def test_superadmin_lists_presets_and_hours(client, superadmin):
    pharmacy = type_by_slug(client, superadmin, "pharmacy")
    assert pharmacy["name_uz"] == "Dorixona" and pharmacy["opens_at"] == "08:00:00"
    assert any(p["name"] == "Farmatsevt maslahati" for p in pharmacy["service_presets"])


def test_only_superadmin_manages_types(client, superadmin):
    biz = create_business(client, superadmin)
    h = auth_header(biz["owner"])
    assert client.get(SA, headers=h).status_code == 403
    assert client.post(SA, headers=h, json={"slug": "x", "name_uz": "Xx", "name_ru": "Xx"}).status_code == 403
    assert client.get(SA).status_code == 401


def test_type_crud_and_validation(client, superadmin):
    h = auth_header(superadmin)
    slug = f"vet_{new_phone()[-6:]}"
    body = {"slug": slug, "name_uz": "Veterinariya", "name_ru": "Ветеринария", "icon": "paw",
            "opens_at": "08:00", "closes_at": "19:00",
            "service_presets": [{"name": "Ko'rik", "duration_min": 30, "price": 100000}]}
    r = client.post(SA, headers=h, json=body)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["business_count"] == 0 and t["service_presets"][0]["name"] == "Ko'rik"
    assert client.post(SA, headers=h, json=body).status_code == 409

    r = client.patch(f"{SA}/{t['id']}", headers=h, json={"closes_at": "07:00"})          # ochilishdan oldin
    assert r.status_code == 422
    dup = [{"name": "A tur", "duration_min": 30, "price": 0}, {"name": "a TUR", "duration_min": 30, "price": 0}]
    assert client.patch(f"{SA}/{t['id']}", headers=h, json={"service_presets": dup}).status_code == 422
    assert client.post(SA, headers=h, json={**body, "slug": "Yomon Kod"}).status_code == 422

    r = client.patch(f"{SA}/{t['id']}", headers=h, json={"is_active": False, "name_uz": "Veterinar"})
    assert r.status_code == 200 and r.json()["name_uz"] == "Veterinar" and r.json()["opens_at"] == "08:00:00"
    assert slug not in [c["slug"] for c in client.get("/api/v1/catalog/categories").json()]
    assert client.patch(f"{SA}/999999", headers=h, json={"is_active": True}).status_code == 404


def test_create_requires_location_and_sets_default_hours(client, superadmin):
    h = auth_header(superadmin)
    pharmacy = type_by_slug(client, superadmin, "pharmacy")
    phone = new_phone()
    body = {"name": "Dorixona 1", "slug": f"dori-{phone[-7:]}", "category_id": pharmacy["id"],
            "owner_phone": phone, "owner_full_name": "Dori Egasi"}
    r = client.post("/api/v1/superadmin/businesses", headers=h, json=body)
    assert r.status_code == 422                                                   # lokatsiyasiz bo'lmaydi

    biz = create_business(client, superadmin, category_id=pharmacy["id"], lat=LAT, lng=LNG)
    hours = client.get(f"/api/v1/businesses/{biz['id']}/hours", headers=auth_header(biz["owner"])).json()
    assert [d["weekday"] for d in hours] == [1, 2, 3, 4, 5, 6]
    assert hours[0]["opens_at"].startswith("08:00") and hours[0]["closes_at"].startswith("22:00")


@pytest.fixture()
def pharmacy_biz(client, superadmin):
    pharmacy = type_by_slug(client, superadmin, "pharmacy")
    return create_business(client, superadmin, category_id=pharmacy["id"], lat=LAT + 0.001, lng=LNG)


def test_salon_without_services_hidden_until_presets_applied(client, superadmin, pharmacy_biz):
    b, h = pharmacy_biz, auth_header(pharmacy_biz["owner"])
    assert b["id"] not in nearby_ids(client)
    assert client.get(f"/api/v1/catalog/businesses/{b['slug']}").status_code == 404

    presets = client.get(f"/api/v1/businesses/{b['id']}/service-presets", headers=h).json()
    assert presets["category_name"] == "Dorixona" and not any(p["exists"] for p in presets["presets"])

    names = ["Farmatsevt maslahati", "qon bosimini o'lchash", "Bunday xizmat yo'q"]
    r = client.post(f"/api/v1/businesses/{b['id']}/service-presets", headers=h, json={"names": names})
    assert r.status_code == 201, r.text
    assert sorted(s["name"] for s in r.json()) == ["Farmatsevt maslahati", "Qon bosimini o'lchash"]
    # Takror bosilsa — ikki marta qo'shilmaydi
    assert client.post(f"/api/v1/businesses/{b['id']}/service-presets", headers=h, json={"names": names}).json() == []
    presets = client.get(f"/api/v1/businesses/{b['id']}/service-presets", headers=h).json()["presets"]
    assert sum(p["exists"] for p in presets) == 2

    assert b["id"] in nearby_ids(client)
    assert b["id"] in nearby_ids(client, category="pharmacy")
    assert b["id"] not in nearby_ids(client, category="clinic")


def test_presets_need_services_permission(client, pharmacy_biz):
    staff = add_member(client, pharmacy_biz, "staff")
    url = f"/api/v1/businesses/{pharmacy_biz['id']}/service-presets"
    assert client.get(url, headers=auth_header(staff["tokens"])).status_code == 403
    assert client.post(url, headers=auth_header(staff["tokens"]), json={"names": ["Sauna"]}).status_code == 403


def test_inactive_type_hides_its_businesses(client, superadmin):
    h = auth_header(superadmin)
    slug = f"tmp_{new_phone()[-6:]}"
    t = client.post(SA, headers=h, json={"slug": slug, "name_uz": "Vaqtinchalik", "name_ru": "Временный",
                                         "service_presets": [{"name": "Xizmat", "duration_min": 30, "price": 1000}]}).json()
    biz = create_business(client, superadmin, category_id=t["id"], lat=LAT - 0.001, lng=LNG)
    client.post(f"/api/v1/businesses/{biz['id']}/service-presets", headers=auth_header(biz["owner"]),
                json={"names": ["Xizmat"]})
    assert biz["id"] in nearby_ids(client)
    client.patch(f"{SA}/{t['id']}", headers=h, json={"is_active": False})
    assert biz["id"] not in nearby_ids(client)


def test_profile_has_type_defaults(client, pharmacy_biz):
    p = client.get(f"/api/v1/businesses/{pharmacy_biz['id']}/profile", headers=auth_header(pharmacy_biz["owner"])).json()
    assert p["category_name"] == "Dorixona" and p["default_opens_at"].startswith("08:00")


def test_migration_hides_pharmacy_and_clinic_and_renames_spa(database):
    """sql/031: hozirgi bosqichda dorixona va klinika yashirin, stomatologiya qoladi, SPA — "Wellness & Spa"."""
    m = database
    assert m["pharmacy"][0] is False and m["clinic"][0] is False
    assert m["dental"][0] is True and m["beauty_salon"][0] is True and m["barbershop"][0] is True
    assert m["spa"] == (True, "Wellness & Spa")
