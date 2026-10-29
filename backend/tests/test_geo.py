"""Yandex Geocoder integratsiyasi (tashqi so'rov soxta javob bilan almashtiriladi)."""
from app.services import geocoder
from tests.conftest import auth_header, new_phone, otp_login

SAMPLE = {"response": {"GeoObjectCollection": {"featureMember": [{"GeoObject": {
    "name": "Amir Temur ko'chasi, 1",
    "Point": {"pos": "69.279737 41.311151"},
    "metaDataProperty": {"GeocoderMetaData": {"text": "O'zbekiston, Toshkent, Amir Temur ko'chasi, 1",
                                              "precision": "exact"}}}}]}}}


def test_geocode_requires_login(client):
    assert client.get("/api/v1/geo/geocode", params={"q": "Toshkent"}).status_code == 401


def test_geocode_parses_yandex_response(client, monkeypatch):
    seen = {}

    def fake_fetch(params):
        seen.update(params)
        return SAMPLE
    monkeypatch.setattr(geocoder, "_fetch", fake_fetch)
    t = otp_login(client, new_phone())

    r = client.get("/api/v1/geo/geocode", params={"q": "Amir Temur 1"}, headers=auth_header(t))
    assert r.status_code == 200
    place = r.json()[0]
    assert place["lat"] == 41.311151 and place["lng"] == 69.279737 and place["precision"] == "exact"
    assert seen["bbox"] == "55.9,37.1~73.2,45.6"                    # O'zbekiston bilan cheklangan

    r = client.get("/api/v1/geo/reverse", params={"lat": 41.311151, "lng": 69.279737}, headers=auth_header(t))
    assert r.status_code == 200 and seen["geocode"] == "69.279737,41.311151"     # Yandex: "lng,lat"


def test_geocoder_without_key_returns_503(client):
    t = otp_login(client, new_phone())
    r = client.get("/api/v1/geo/geocode", params={"q": "Toshkent"}, headers=auth_header(t))
    assert r.status_code == 503 and r.json()["detail"]["code"] == "geocoder_unavailable"
