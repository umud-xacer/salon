"""Ochiq katalog keshi (app/core/cache.py) va Hot Slots salon keshi."""
import threading
import time

import pytest

from app.core import cache as cache_mod
from app.core.cache import TTLCache, grid, public_cache
from app.core.config import get_settings
from tests.conftest import auth_header, create_business
from tests.test_promotions import ALL_DAYS, rule
from tests.test_schedule import new_master, new_service, url


@pytest.fixture()
def cache_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "public_cache_ttl", 30)
    public_cache.clear()
    yield
    public_cache.clear()


def test_ttl_cache_expiry_size_and_single_flight():
    c = TTLCache(maxsize=2)
    calls = []
    assert c.get_or_set("a", 0.2, lambda: calls.append(1) or "A") == "A"
    assert c.get_or_set("a", 0.2, lambda: calls.append(1) or "B") == "A" and len(calls) == 1
    time.sleep(0.25)
    assert c.get_or_set("a", 0.2, lambda: "C") == "C"                     # muddat o'tdi
    c.get_or_set("b", 5, lambda: 1)
    c.get_or_set("c", 5, lambda: 2)
    assert len(c._data) == 2 and "a" not in c._data                       # eng eskisi chiqdi
    assert c.get_or_set("x", 0, lambda: "fresh") == "fresh" and "x" not in c._data   # ttl=0 — keshsiz

    # Bir kalitga parallel 20 ta so'rov — hisob bir marta
    n = []
    def slow():
        n.append(1)
        time.sleep(0.2)
        return "v"
    res = []
    threads = [threading.Thread(target=lambda: res.append(c.get_or_set("k", 5, slow))) for _ in range(20)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert res == ["v"] * 20 and len(n) == 1
    assert grid(41.31149) == 41.311 and grid(69.28051) == 69.281


def test_catalog_responses_cached_and_refresh_after_ttl(client, superadmin, cache_on, monkeypatch):
    biz = create_business(client, superadmin, lat=40.51, lng=64.51)
    new_service(client, biz)
    params = {"lat": 40.5101, "lng": 64.5102, "radius_m": 3000}
    first = client.get("/api/v1/catalog/businesses/nearby", params=params).json()
    assert [x["id"] for x in first["items"]] == [biz["id"]]
    hits = public_cache.hits
    # ~110 m ichidagi boshqa nuqta — o'sha kesh
    again = client.get("/api/v1/catalog/businesses/nearby", params={**params, "lat": 40.51012}).json()
    assert again == first and public_cache.hits == hits + 1

    # Salon nomi o'zgardi — kesh muddati ichida eski nom, muddat tugagach yangisi
    r = client.patch(url(biz, "profile"), headers=auth_header(biz["owner"]), json={"name": "Yangi Nom Salon"})
    assert r.status_code == 200, r.text
    assert client.get(f"/api/v1/catalog/businesses/nearby", params=params).json()["items"][0]["name"] != "Yangi Nom Salon"
    monkeypatch.setattr(cache_mod.time, "monotonic", lambda: time.perf_counter() + 10_000)
    assert client.get(f"/api/v1/catalog/businesses/nearby", params=params).json()["items"][0]["name"] == "Yangi Nom Salon"


def test_hot_slots_same_result_with_cache(client, superadmin, cache_on, monkeypatch):
    biz = create_business(client, superadmin, lat=40.61, lng=64.61)
    s = new_service(client, biz, duration=30)
    new_master(client, biz, s)
    rule(client, biz, percent=25, weekdays=ALL_DAYS, time_from="00:00", time_to="23:59")
    p = {"lat": 40.61, "lng": 64.61, "radius_m": 2000}
    monkeypatch.setattr(get_settings(), "public_cache_ttl", 0)
    plain = client.get("/api/v1/catalog/hot-slots", params=p).json()
    monkeypatch.setattr(get_settings(), "public_cache_ttl", 30)
    cached = client.get("/api/v1/catalog/hot-slots", params=p).json()
    assert cached == plain
    assert client.get("/api/v1/catalog/hot-slots", params=p).json() == plain       # endi keshdan
    assert ("hot-business", biz["id"]) in public_cache._data
