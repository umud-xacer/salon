"""OpenStreetMap Nominatim: xaritadagi nuqta -> manzil. Kalit talab qilmaydi.

So'rov server orqali ketadi: foydalanuvchi IP'si tashqariga chiqmaydi va xizmat qoidasi (sekundiga 1 ta so'rov,
aniq User-Agent) bitta joyda bajariladi. Bir xil nuqta keshdan beriladi."""
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass

import httpx

from app.services.uz_regions import REGIONS, match_district, match_region, region_by_district

_URL = "https://nominatim.openstreetmap.org/reverse"
_MIN_INTERVAL = 1.1
_CACHE_SIZE = 500

_lock = threading.Lock()
_last_call = 0.0
_cache: OrderedDict[tuple[float, float], "ReverseAddress"] = OrderedDict()


class AddressUnavailable(Exception):
    pass


@dataclass
class ReverseAddress:
    address: str             # ko'cha va uy, bo'lmasa mahalla yoki hudud
    region: str | None       # ro'yxatdagi viloyat nomi
    district: str | None     # ro'yxatdagi tuman yoki shahar nomi
    display: str             # OSM to'liq manzili


def _fetch(lat: float, lng: float) -> dict:
    global _last_call
    headers = {"User-Agent": "Chronix/1.0 (+https://github.com/umud-xacer/salon)", "Accept-Language": "uz-Latn,uz,en"}
    with _lock:
        wait = _MIN_INTERVAL - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        try:
            r = httpx.get(_URL, params={"lat": lat, "lon": lng, "format": "jsonv2", "addressdetails": 1, "zoom": 18},
                          headers=headers, timeout=6)
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise AddressUnavailable(f"Nominatim javob bermadi: {type(e).__name__}") from e


def _street(a: dict) -> str:
    road = a.get("road") or a.get("pedestrian") or a.get("residential")
    if road:
        return f"{road}, {a['house_number']}" if a.get("house_number") else road
    return a.get("neighbourhood") or a.get("quarter") or a.get("suburb") or a.get("hamlet") or a.get("village") or ""


def parse(data: dict) -> ReverseAddress:
    a = data.get("address") or {}
    display = data.get("display_name", "")
    parts = [p.strip() for p in display.split(",") if p.strip()]

    # Avval shahar: nuqta shahar ichida bo'lsa, shu nomdagi tuman emas, shahar kerak
    names = [(a[k], True) for k in ("city", "town", "municipality") if a.get(k)]
    names += [(a[k], False) for k in ("county", "city_district", "suburb", "district") if a.get(k)]
    names += [(p, False) for p in parts]

    code = a.get("ISO3166-2-lvl4")
    if code not in REGIONS:
        # OSM kodni har doim bermaydi: Toshkent markazida faqat tuman, Nukusda faqat nom keladi
        code = (match_region([v for v in (a.get("state"), a.get("region"), a.get("city")) if v] + parts)
                or region_by_district([value for value, _ in names]))

    return ReverseAddress(address=_street(a) or (parts[0] if parts else ""),
                          region=REGIONS[code][0] if code else None,
                          district=match_district(code, names) if code else None, display=display)


def reverse(lat: float, lng: float) -> ReverseAddress:
    # Taxminan 11 metr aniqlik: yonma-yon bosishlar xizmatga qayta so'rov yubormaydi
    key = (round(lat, 4), round(lng, 4))
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    result = parse(_fetch(*key))
    _cache[key] = result
    while len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return result
