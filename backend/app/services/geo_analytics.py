"""Hududiy analitika uchun joylashuvni viloyat / shahar / tumanga o'girish (061_geo_analytics.sql).

* Koordinata → Nominatim (OSM) orqali, nomlar uz_regions ro'yxatidagi standart ko'rinishda
  ("Toshkent shahri" → "Yunusobod tumani", "Qashqadaryo viloyati" → "Qarshi shahri"). Bu worker'da, keshga yoziladi.
* IP → ixtiyoriy offline baza (DB-IP Lite / MaxMind mmdb, GEOIP_DB_PATH). Fayl bo'lmasa — hudud aniqlanmaydi,
  lekin sessiya baribir hisobga olinadi. IP tashqi xizmatga yuborilmaydi.
"""
import ipaddress
import logging
import threading
from functools import lru_cache

from app.core.config import get_settings
from app.services import nominatim
from app.services.uz_regions import REGIONS, match_region, normalize

log = logging.getLogger(__name__)
_reader_lock = threading.Lock()


def city_of(region: str | None, district: str | None) -> str | None:
    """Toshkent shahri tumanlari → "Toshkent"; "Qarshi shahri" → "Qarshi"; viloyat tumani → shahar yo'q."""
    if region == "Toshkent shahri":
        return "Toshkent"
    if district and district.endswith(" shahri"):
        return district[: -len(" shahri")]
    return None


def resolve(lat: float, lng: float) -> tuple[str | None, str | None, str | None]:
    """(viloyat, shahar, tuman). Aniqlab bo'lmasa — (None, None, None)."""
    r = nominatim.reverse(lat, lng)          # tarmoq xatosi — AddressUnavailable (chaqiruvchi qayta urinadi)
    return r.region, city_of(r.region, r.district), r.district


# Ochiq baza va uning fayl vaqti: oylik yangilangan faylni (deploy/update-geoip.sh) server qayta
# ishga tushirilmasdan o'qiydi — har 10 daqiqada fayl o'zgarganmi tekshiriladi.
_db: dict = {"reader": None, "mtime": None, "checked": 0.0}
_RECHECK_SECONDS = 600


def _reader():
    import os
    import time

    path = get_settings().geoip_db_path
    if not path:
        return None
    now = time.monotonic()
    if _db["reader"] is not None and now - _db["checked"] < _RECHECK_SECONDS:
        return _db["reader"]
    with _reader_lock:
        _db["checked"] = now
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            if _db["reader"] is None:
                log.warning("GeoIP bazasi topilmadi: %s", path)
            return _db["reader"]
        if mtime != _db["mtime"]:
            try:
                import maxminddb
                fresh = maxminddb.open_database(path)
            except Exception:
                log.warning("GeoIP bazasi ochilmadi: %s", path)
                return _db["reader"]
            old, _db["reader"], _db["mtime"] = _db["reader"], fresh, mtime
            _lookup.cache_clear()
            if old is not None:
                old.close()
            log.info("GeoIP bazasi yuklandi: %s", path)
        return _db["reader"]


def _subnet(ip: str) -> str | None:
    """Kesh kaliti: IPv4 /24, IPv6 /48 — bir provayder tarmog'idagi qo'shni manzillar bitta joyda."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
        return None
    return str(ipaddress.ip_network(f"{ip}/{24 if addr.version == 4 else 48}", strict=False).network_address)


def by_ip(ip: str | None) -> tuple[str | None, str | None]:
    """IP → (viloyat, shahar). O'zbekistondan tashqari — ("Xorij", None). Baza yo'q bo'lsa — (None, None)."""
    key = _subnet(ip) if ip else None
    if key is None:
        return None, None
    reader = _reader()
    if reader is None:
        return None, None
    return _lookup(key, id(reader))


@lru_cache(maxsize=20000)
def _lookup(subnet: str, _reader_id: int) -> tuple[str | None, str | None]:
    reader = _db["reader"] or _reader()
    if reader is None:
        return None, None
    with _reader_lock:
        rec = reader.get(subnet) or {}
    country = (rec.get("country") or {}).get("iso_code")
    if country and country != "UZ":
        return "Xorij", None
    names = [((rec.get("city") or {}).get("names") or {}).get("en", "")]
    names += [((s.get("names") or {}).get("en", "")) for s in rec.get("subdivisions") or []]
    code = match_region([n for n in names if n])
    region = REGIONS[code][0] if code else None
    # Inglizcha "Tashkent", "Karshi" → ro'yxatdagi standart nom ("Toshkent", "Qarshi")
    city = city_of(region, None) if region == "Toshkent shahri" else None
    if city is None and code and names[0]:
        key = normalize(names[0])
        city = next((d[: -len(" shahri")] for d in REGIONS[code][1] if d.endswith(" shahri") and normalize(d) == key), None)
    return region, city
