"""Yandex Geocoder orqali manzil ↔ koordinata. Faqat kirgan foydalanuvchilar uchun
(ochiq bo'lsa, begonalar API kalitimiz limitini sarflab yuboradi)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import current_user
from app.schemas.catalog import PlaceOut
from app.services import geocoder

router = APIRouter(prefix="/geo", tags=["geo"], dependencies=[Depends(current_user)])


def _unavailable(e: Exception):
    return HTTPException(503, detail={"code": "geocoder_unavailable", "message": "Manzil xizmati vaqtincha ishlamayapti"})


@router.get("/geocode", response_model=list[PlaceOut])
def geocode(q: str = Query(min_length=3, max_length=200)):
    """Manzil matni → koordinatalar (O'zbekiston hududida). Salon egasi manzil kiritganda."""
    try:
        return [PlaceOut(**p.__dict__) for p in geocoder.geocode(q)]
    except geocoder.GeocoderUnavailable as e:
        raise _unavailable(e)


@router.get("/reverse", response_model=list[PlaceOut])
def reverse(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180)):
    """Xaritada bosilgan nuqta → manzil."""
    try:
        return [PlaceOut(**p.__dict__) for p in geocoder.reverse(lat, lng)]
    except geocoder.GeocoderUnavailable as e:
        raise _unavailable(e)
