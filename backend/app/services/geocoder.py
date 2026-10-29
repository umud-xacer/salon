"""Yandex HTTP Geocoder: manzil → koordinata va koordinata → manzil.
https://yandex.ru/dev/geocode/doc/ru/
"""
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

_URL = "https://geocode-maps.yandex.ru/1.x/"
# Qidiruvni O'zbekiston hududi bilan cheklash (lng,lat ~ lng,lat)
_UZ_BBOX = "55.9,37.1~73.2,45.6"


class GeocoderUnavailable(Exception):
    pass


@dataclass
class Place:
    address: str
    name: str
    lat: float
    lng: float
    precision: str          # exact | number | street | other ...


def _fetch(params: dict) -> dict:
    s = get_settings()
    if s.yandex_geocoder_api_key is None:
        raise GeocoderUnavailable("YANDEX_GEOCODER_API_KEY o'rnatilmagan")
    params = {**params, "apikey": s.yandex_geocoder_api_key.get_secret_value(),
              "format": "json", "lang": s.yandex_geocoder_lang}
    try:
        r = httpx.get(_URL, params=params, timeout=5)
        r.raise_for_status()
        return r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise GeocoderUnavailable(f"Yandex Geocoder javob bermadi: {type(e).__name__}") from e


def _parse(data: dict) -> list[Place]:
    members = (data.get("response", {}).get("GeoObjectCollection", {}).get("featureMember", []))
    places = []
    for m in members:
        obj = m.get("GeoObject", {})
        meta = obj.get("metaDataProperty", {}).get("GeocoderMetaData", {})
        try:
            lng, lat = (float(x) for x in obj["Point"]["pos"].split())
        except (KeyError, ValueError):
            continue
        places.append(Place(address=meta.get("text", ""), name=obj.get("name", ""),
                            lat=lat, lng=lng, precision=meta.get("precision", "other")))
    return places


def geocode(query: str, limit: int = 5) -> list[Place]:
    return _parse(_fetch({"geocode": query, "results": limit, "bbox": _UZ_BBOX, "rspn": 1}))


def reverse(lat: float, lng: float) -> list[Place]:
    return _parse(_fetch({"geocode": f"{lng},{lat}", "kind": "house", "results": 1}))
