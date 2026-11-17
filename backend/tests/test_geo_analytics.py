"""Hududiy analitika (061_geo_analytics.sql): joylashuv yozish, kesh, worker geokodlash, tumanlar statistikasi."""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from app.db.session import api_session
from tests.conftest import auth_header, create_business, new_phone, otp_login

ADMIN = create_engine(os.environ["MIGRATION_DATABASE_URL"])
PING = "/api/v1/analytics/location-ping"
GEO = "/api/v1/admin/analytics/geography"


def dev() -> str:
    return uuid.uuid4().hex


def cache(lat, lng, region, city, district):
    with ADMIN.begin() as db:
        db.execute(text("""INSERT INTO geo_cache (lat_grid, lng_grid, region, city, district) VALUES (:a, :b, :r, :c, :d)
                           ON CONFLICT (lat_grid, lng_grid) DO UPDATE SET region = EXCLUDED.region, city = EXCLUDED.city,
                           district = EXCLUDED.district"""), {"a": lat, "b": lng, "r": region, "c": city, "d": district})


def logs(device):
    with ADMIN.connect() as db:
        return db.execute(text("SELECT * FROM user_location_logs WHERE device_id = :d ORDER BY id"), {"d": device}).mappings().all()


def test_ping_cache_rounding_and_throttle(client):
    cache(41.366, 69.287, "Toshkent shahri", "Toshkent", "Yunusobod tumani")
    d = dev()
    r = client.post(PING, json={"device_id": d, "platform": "android", "latitude": 41.36612345, "longitude": 69.28698765})
    assert r.status_code == 200 and r.json() == {"logged": True}
    row = logs(d)[0]
    assert float(row["lat_grid"]) == 41.366 and float(row["lng_grid"]) == 69.287           # ~110 m gacha yaxlitlangan
    assert row["district"] == "Yunusobod tumani" and row["source"] == "gps"
    assert "user_id" not in row                                                              # shaxsga bog'lanmaydi
    # 15 daqiqa ichida qayta — yozilmaydi
    assert client.post(PING, json={"device_id": d, "platform": "android", "latitude": 41.0, "longitude": 69.0}).json() == {"logged": False}
    assert len(logs(d)) == 1
    assert client.post(PING, json={"device_id": "short", "platform": "android"}).status_code == 422
    assert client.post(PING, json={"device_id": d + "x", "platform": "android", "latitude": 41.0}).status_code == 422


def test_ip_fallback(client, monkeypatch):
    from app.services import geo_analytics
    monkeypatch.setattr(geo_analytics, "by_ip", lambda ip: ("Qashqadaryo viloyati", "Qarshi"))
    d = dev()
    assert client.post(PING, json={"device_id": d, "platform": "market"}).json()["logged"]
    row = logs(d)[0]
    assert row["source"] == "ip" and row["region"] == "Qashqadaryo viloyati" and row["lat_grid"] is None


def test_worker_resolves_pending_points(client, monkeypatch):
    from app import worker
    from app.services import geo_analytics, nominatim
    d1, d2 = dev(), dev()
    client.post(PING, json={"device_id": d1, "platform": "ios", "latitude": 38.861, "longitude": 65.789})
    client.post(PING, json={"device_id": d2, "platform": "ios", "latitude": 10.001, "longitude": 10.001})   # chet el
    assert logs(d1)[0]["region"] is None
    calls = []

    def fake(lat, lng):
        calls.append((lat, lng))
        if round(lat, 3) == 38.861:
            return "Qashqadaryo viloyati", "Qarshi", "Qarshi shahri"
        return None, None, None

    monkeypatch.setattr(geo_analytics, "resolve", fake)
    monkeypatch.setattr(worker, "GEO_PER_CYCLE", 500)
    worker.resolve_locations(force=True)
    assert logs(d1)[0]["district"] == "Qarshi shahri" and logs(d1)[0]["city"] == "Qarshi"
    assert logs(d2)[0]["region"] == "Aniqlanmagan"
    n = len(calls)
    worker.resolve_locations(force=True)                                          # keshda — qayta so'ralmaydi
    assert len(calls) == n

    # Tarmoq xatosi: yozilmaydi, keyingi safar qayta uriniladi
    d3 = dev()
    client.post(PING, json={"device_id": d3, "platform": "ios", "latitude": 39.654, "longitude": 66.959})

    def down(lat, lng):
        raise nominatim.AddressUnavailable("offline")

    monkeypatch.setattr(geo_analytics, "resolve", down)
    worker.resolve_locations(force=True)
    assert logs(d3)[0]["region"] is None
    with ADMIN.connect() as db:
        assert db.execute(text("SELECT count(*) FROM geo_cache WHERE lat_grid = 39.654")).scalar() == 0


def test_geography_districts_demand_points_and_export(client, superadmin):
    # Yunusobodda 1 ta muassasa, 25 ta qurilma — sotuv hududi; Chilonzorda 2 qurilma — xaritada yashirin (k-anonimlik)
    region = "Toshkent shahri"
    biz = create_business(client, superadmin, modules=("booking",), lat=41.3611, lng=69.2899)
    with ADMIN.begin() as db:
        db.execute(text("UPDATE businesses SET is_listed = true WHERE id = :b"), {"b": biz["id"]})
    cache(41.361, 69.290, region, "Toshkent", "Yunusobod tumani")
    cache(41.285, 69.204, region, "Toshkent", "Chilonzor tumani")
    cache(41.296, 69.271, region, "Toshkent", "Mirobod tumani")
    for _ in range(20):                                                           # muassasa yo'q, 20 qurilma
        client.post(PING, json={"device_id": dev(), "platform": "ios", "latitude": 41.2961, "longitude": 69.2711})
    for _ in range(25):
        client.post(PING, json={"device_id": dev(), "platform": "android", "latitude": 41.3612, "longitude": 69.2901})
    for _ in range(2):
        client.post(PING, json={"device_id": dev(), "platform": "web", "latitude": 41.2851, "longitude": 69.2041})

    h = auth_header(superadmin)
    g = client.get(GEO, headers=h, params={"days": 7, "region": region}).json()
    yun = next(x for x in g["districts"] if x["district"] == "Yunusobod tumani")
    chi = next(x for x in g["districts"] if x["district"] == "Chilonzor tumani")
    mir = next(x for x in g["districts"] if x["district"] == "Mirobod tumani")
    assert yun["devices"] >= 25 and yun["businesses"] >= 1 and yun["high_demand"] is False   # 26 / 1 < 50
    assert mir["devices"] >= 20 and mir["businesses"] == 0 and mir["high_demand"] is True
    assert chi["devices"] >= 2 and chi["high_demand"] is False
    assert yun["share"] > chi["share"]
    pts = {(p["lat"], p["lng"]) for p in g["points"]}
    assert (41.36, 69.29) in pts and (41.29, 69.2) not in pts                      # 2 qurilma — ko'rsatilmaydi
    assert any(r["region"] == region for r in g["regions"])
    ip_only = client.get(GEO, headers=h, params={"days": 7, "source": "ip", "region": region}).json()
    assert all(x["district"] not in ("Yunusobod tumani", "Mirobod tumani") for x in ip_only["districts"])   # GPS yozuvlari chiqmaydi
    x = client.get(GEO + "/export", headers=h, params={"days": 7, "region": region})
    assert x.status_code == 200 and x.content[:2] == b"PK"

    user = otp_login(client, new_phone(), "Oddiy")
    assert client.get(GEO, headers=auth_header(user)).status_code == 403
    assert client.get(GEO).status_code == 401


def test_location_rls(client):
    user = otp_login(client, new_phone(), "RLS")
    client.post(PING, json={"device_id": dev(), "platform": "android", "latitude": 41.1, "longitude": 69.1})
    with api_session(user["user"]["id"]) as db:
        assert db.execute(text("SELECT count(*) FROM user_location_logs")).scalar() == 0     # faqat Super Admin ko'radi
        with pytest.raises(Exception):
            db.execute(text("INSERT INTO user_location_logs (device_id, source, platform) VALUES ('xxxxxxxxxx', 'ip', 'web')"))
    with api_session(user["user"]["id"]) as db:
        with pytest.raises(Exception):
            db.execute(text("SELECT * FROM app.geo_pending(5)"))                                  # faqat worker


def test_ip_lookup_normalizes_names(monkeypatch):
    from app.services import geo_analytics as g

    class Reader:
        def __init__(self, rec):
            self.rec = rec

        def get(self, ip):
            return self.rec

    cases = [
        ({"country": {"iso_code": "UZ"}, "city": {"names": {"en": "Tashkent"}}}, ("Toshkent shahri", "Toshkent")),
        ({"country": {"iso_code": "UZ"}, "city": {"names": {"en": "Karshi"}},
          "subdivisions": [{"names": {"en": "Qashqadaryo Region"}}]}, ("Qashqadaryo viloyati", "Qarshi")),
        ({"country": {"iso_code": "KZ"}, "city": {"names": {"en": "Almaty"}}}, ("Xorij", None)),
    ]
    for rec, expected in cases:
        monkeypatch.setattr(g, "_reader", lambda r=Reader(rec): r)
        assert g.by_ip("84.54.70.1") == expected
    assert g.by_ip("192.168.1.5") == (None, None)                                 # ichki tarmoq
    monkeypatch.setattr(g, "_reader", lambda: None)
    assert g.by_ip("84.54.70.1") == (None, None)                                  # baza yo'q — buzilmaydi
