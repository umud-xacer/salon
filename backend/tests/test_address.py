"""Salon manzili: viloyatlar ro'yxati, xarita nuqtasidan manzil. Javoblar haqiqiy OSM namunalaridan olingan."""
import pytest

from app.services import nominatim
from app.services.nominatim import parse
from app.services.uz_regions import REGIONS, normalize
from tests.conftest import auth_header, create_business, new_phone, otp_login

TASHKENT_CENTER = {"display_name": "Yunusabad district, Kashgar mahalla, 100000, Oʻzbekiston",
                   "address": {"city": "Kashgar mahalla"}}
CHILONZOR = {"display_name": "Kichik Halqa, Chilanzar, Toshkent, 100000, Oʻzbekiston",
             "address": {"road": "Kichik Halqa Ring Road", "suburb": "Chilanzar", "city": "Toshkent",
                         "ISO3166-2-lvl4": "UZ-TK"}}
NUKUS = {"display_name": "27, S. Kamalova Street, Nukus, Qoraqalpogʻiston Respublikasi, Oʻzbekiston",
         "address": {"road": "S. Kamalova Street", "house_number": "27", "city": "Nukus",
                     "county": "Nukus shahri hokimiyati", "state": "Qoraqalpogʻiston Respublikasi"}}
CHIRCHIQ = {"display_name": "Alisher Navoiy Avenue, Chirchik, Toshkent viloyati, Oʻzbekiston",
            "address": {"road": "Alisher Navoiy Avenue", "house_number": "299", "suburb": "Kuyi-chirchik",
                        "city": "Chirchik", "state": "Toshkent viloyati", "ISO3166-2-lvl4": "UZ-TO"}}
BEKOBOD_RURAL = {"display_name": "Dala, Bekobod, Toshkent viloyati, Oʻzbekiston",
                 "address": {"county": "Bekobod tumani", "state": "Toshkent viloyati", "ISO3166-2-lvl4": "UZ-TO"}}
BEKOBOD_CITY = {"display_name": "Uzoqov, Bekobod, Toshkent viloyati, Oʻzbekiston",
                "address": {"road": "M. Uzoqov koʻchasi", "city": "Bekobod", "county": "Bekobod",
                            "state": "Toshkent viloyati", "ISO3166-2-lvl4": "UZ-TO"}}


@pytest.mark.parametrize("raw, region, district, address", [
    (TASHKENT_CENTER, "Toshkent shahri", "Yunusobod tumani", "Yunusabad district"),
    (CHILONZOR, "Toshkent shahri", "Chilonzor tumani", "Kichik Halqa Ring Road"),
    (NUKUS, "Qoraqalpog'iston Respublikasi", "Nukus shahri", "S. Kamalova Street, 27"),
    (CHIRCHIQ, "Toshkent viloyati", "Chirchiq shahri", "Alisher Navoiy Avenue, 299"),
    (BEKOBOD_RURAL, "Toshkent viloyati", "Bekobod tumani", "Dala"),
    (BEKOBOD_CITY, "Toshkent viloyati", "Bekobod shahri", "M. Uzoqov koʻchasi"),
])
def test_parse_real_osm_shapes(raw, region, district, address):
    r = parse(raw)
    assert (r.region, r.district, r.address) == (region, district, address)


def test_unknown_place_leaves_fields_empty():
    r = parse({"display_name": "", "address": {}})
    assert r.region is None and r.district is None and r.address == ""


def test_normalize_spelling_variants():
    assert normalize("Chilanzar") == normalize("Chilonzor tumani") == normalize("Чиланзар")
    assert normalize("Qoʻqon shahri") == normalize("Qo'qon")
    assert normalize("Chirchik") == normalize("Chirchiq")


def test_regions_list(client):
    t = otp_login(client, new_phone())
    assert client.get("/api/v1/geo/regions").status_code == 401
    rows = client.get("/api/v1/geo/regions", headers=auth_header(t)).json()
    assert len(rows) == 14 and rows[0]["name"] == "Toshkent shahri" and "Chilonzor tumani" in rows[0]["districts"]


def test_every_district_list_has_no_duplicates():
    for name, items in REGIONS.values():
        assert len(items) == len(set(items)), name


def test_address_endpoint_caches_and_handles_outage(client, monkeypatch):
    t = otp_login(client, new_phone())
    calls = []

    def fake(lat, lng):
        calls.append((lat, lng))
        return CHILONZOR
    monkeypatch.setattr(nominatim, "_fetch", fake)
    nominatim._cache.clear()

    params = {"lat": 41.27561, "lng": 69.20361}
    r = client.get("/api/v1/geo/address", params=params, headers=auth_header(t))
    assert r.status_code == 200 and r.json()["district"] == "Chilonzor tumani"
    client.get("/api/v1/geo/address", params={"lat": 41.27562, "lng": 69.20362}, headers=auth_header(t))
    assert len(calls) == 1                                                # yaqin nuqta keshdan

    def down(lat, lng):
        raise nominatim.AddressUnavailable("x")
    monkeypatch.setattr(nominatim, "_fetch", down)
    r = client.get("/api/v1/geo/address", params={"lat": 40.1, "lng": 67.1}, headers=auth_header(t))
    assert r.status_code == 503 and r.json()["detail"]["code"] == "geocoder_unavailable"


def test_address_rejects_outside_uzbekistan_and_anonymous(client):
    t = otp_login(client, new_phone())
    assert client.get("/api/v1/geo/address", params={"lat": 51.5, "lng": 0.1}, headers=auth_header(t)).status_code == 422
    assert client.get("/api/v1/geo/address", params={"lat": 41.3, "lng": 69.2}).status_code == 401


def test_business_saves_region(client, superadmin):
    biz = create_business(client, superadmin)
    h = auth_header(superadmin)
    url = f"/api/v1/superadmin/businesses/{biz['id']}"
    r = client.patch(url, headers=h, json={"region": "Toshkent shahri", "city": "Chilonzor tumani"})
    assert r.status_code == 200 and r.json()["region"] == "Toshkent shahri" and r.json()["city"] == "Chilonzor tumani"
    assert client.patch(url, headers=h, json={"region": "Soxta viloyat"}).status_code == 422
    assert client.patch(url, headers=h, json={"region": None}).json()["region"] is None
