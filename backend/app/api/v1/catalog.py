"""Ochiq katalog: mijoz ilovasi (kirmasdan ham) ishlatadi.

Hamma so'rov foydalanuvchisiz RLS sessiyasida — baza faqat faol va ochiq bizneslarni,
faol xizmatlarni va xodimlarning ochiq profilini (public_staff) beradi.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_public_db
from app.schemas.catalog import (BusinessCard, BusinessDetail, CategoryOut, HoursOut, NearbyOut,
                                 ServiceGroupOut, ServiceOut, StaffOut)
from app.schemas.schedule import SlotsOut
from app.services.slots import available_slots

router = APIRouter(prefix="/catalog", tags=["catalog"])

MAX_RADIUS_M = 50_000
MAX_BBOX_DEG = 1.0          # xarita oynasi ~100 km dan katta bo'lsa — rad (butun bazani yuklab olishga qarshi)

# Biznes hozir ochiqmi — biznesning o'z vaqt mintaqasida
_IS_OPEN = """
    EXISTS (SELECT 1 FROM business_hours h
             WHERE h.business_id = b.id
               AND h.weekday = extract(isodow FROM now() AT TIME ZONE b.timezone)
               AND (now() AT TIME ZONE b.timezone)::time >= h.opens_at
               AND (now() AT TIME ZONE b.timezone)::time <  h.closes_at)
"""

_CARD_COLUMNS = f"""
    b.id, b.slug, b.name, c.slug AS category, c.name_uz AS category_name, b.city, b.address,
    ST_Y(b.location::geometry) AS lat, ST_X(b.location::geometry) AS lng,
    b.rating_avg::float AS rating_avg, b.rating_count, b.logo_url,
    (SELECT min(s.price) FROM services s WHERE s.business_id = b.id AND s.is_active) AS min_price,
    {_IS_OPEN} AS is_open_now
"""

_PUBLIC_WHERE = "b.status = 'active' AND b.is_listed AND b.location IS NOT NULL"


def _filters(category: str | None, q: str | None, params: dict) -> str:
    sql = ""
    if category:
        sql += " AND c.slug = :category"
        params["category"] = category
    if q:
        # ILIKE maxsus belgilari ekranlanadi — '%' yoki '_' bilan butun bazani olib bo'lmasin
        params["q"] = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        sql += " AND (b.name ILIKE :q OR EXISTS (SELECT 1 FROM services s WHERE s.business_id = b.id"
        sql += " AND s.is_active AND s.name ILIKE :q))"
    return sql


@router.get("/categories", response_model=list[CategoryOut])
def categories(db: Session = Depends(get_public_db)):
    rows = db.execute(text("SELECT id, slug, name_uz, name_ru, icon FROM business_categories ORDER BY sort_order"))
    return [CategoryOut(**r) for r in rows.mappings()]


@router.get("/businesses/nearby", response_model=NearbyOut)
def nearby(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius_m: int = Query(5000, ge=100, le=MAX_RADIUS_M),
    category: str | None = Query(None, max_length=40),
    q: str | None = Query(None, min_length=2, max_length=60),
    open_now: bool = False,
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0, le=1000),
    db: Session = Depends(get_public_db),
):
    """Joriy joylashuvga yaqin bizneslar, masofa bo'yicha tartiblangan (PostGIS, GIST indeks)."""
    params = {"lat": lat, "lng": lng, "r": radius_m, "limit": limit, "offset": offset}
    where = f"""
        FROM businesses b
        JOIN business_categories c ON c.id = b.category_id
        CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS pt) p
        WHERE {_PUBLIC_WHERE} AND ST_DWithin(b.location, p.pt, :r)
        {_filters(category, q, params)}
        {"AND " + _IS_OPEN if open_now else ""}
    """
    total = db.scalar(text(f"SELECT count(*) {where}"), params)
    rows = db.execute(text(f"""
        SELECT {_CARD_COLUMNS}, round(ST_Distance(b.location, p.pt))::int AS distance_m
        {where}
        ORDER BY b.location <-> p.pt
        LIMIT :limit OFFSET :offset
    """), params).mappings()
    return NearbyOut(items=[BusinessCard(**r) for r in rows], total=total, radius_m=radius_m)


@router.get("/businesses/in-bounds", response_model=list[BusinessCard])
def in_bounds(
    sw_lat: float = Query(ge=-90, le=90), sw_lng: float = Query(ge=-180, le=180),
    ne_lat: float = Query(ge=-90, le=90), ne_lng: float = Query(ge=-180, le=180),
    category: str | None = Query(None, max_length=40),
    limit: int = Query(200, ge=1, le=300),
    db: Session = Depends(get_public_db),
):
    """Yandex xarita ko'rinib turgan oyna (janubi-g'arbiy va shimoli-sharqiy burchak) ichidagi belgilar."""
    if not (sw_lat < ne_lat and sw_lng < ne_lng):
        raise HTTPException(422, detail={"code": "invalid_bounds", "message": "Xarita chegaralari noto'g'ri"})
    if ne_lat - sw_lat > MAX_BBOX_DEG or ne_lng - sw_lng > MAX_BBOX_DEG:
        raise HTTPException(422, detail={"code": "bounds_too_large", "message": "Xaritani kattalashtiring"})
    params = {"w": sw_lng, "s": sw_lat, "e": ne_lng, "n": ne_lat, "limit": limit}
    rows = db.execute(text(f"""
        SELECT {_CARD_COLUMNS}
          FROM businesses b JOIN business_categories c ON c.id = b.category_id
         WHERE {_PUBLIC_WHERE}
           AND b.location && ST_MakeEnvelope(:w, :s, :e, :n, 4326)::geography
           {_filters(category, None, params)}
         ORDER BY b.rating_avg DESC, b.id
         LIMIT :limit
    """), params).mappings()
    return [BusinessCard(**r) for r in rows]


@router.get("/slots", response_model=SlotsOut)
def slots(member_id: int = Query(ge=1), service_id: int = Query(ge=1), day: date = Query(alias="date"),
          step: int = Query(default=30), db: Session = Depends(get_public_db)):
    """Tanlangan usta va xizmat uchun shu kundagi bo'sh vaqtlar."""
    return available_slots(db, member_id, service_id, day, step)


@router.get("/businesses/{slug}", response_model=BusinessDetail)
def business_detail(slug: str, db: Session = Depends(get_public_db)):
    """Biznes sahifasi: ma'lumot, ish soatlari, rasmlar, xizmatlar (kategoriya bo'yicha), ustalar."""
    b = db.execute(text(f"""
        SELECT b.id, b.slug, b.name, b.description, c.slug AS category, c.name_uz AS category_name,
               b.phone, b.city, b.address, b.logo_url, b.cover_url,
               ST_Y(b.location::geometry) AS lat, ST_X(b.location::geometry) AS lng,
               b.rating_avg::float AS rating_avg, b.rating_count, {_IS_OPEN} AS is_open_now
          FROM businesses b JOIN business_categories c ON c.id = b.category_id
         WHERE b.slug = :slug AND b.status = 'active' AND b.is_listed
    """), {"slug": slug}).mappings().first()
    if b is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Biznes topilmadi"})
    bid = b["id"]

    hours = db.execute(text("SELECT weekday, opens_at, closes_at FROM business_hours "
                            "WHERE business_id = :b ORDER BY weekday"), {"b": bid}).mappings()
    photos = db.scalars(text("SELECT url FROM business_photos WHERE business_id = :b ORDER BY sort_order, id"),
                        {"b": bid}).all()

    services = db.execute(text("""
        SELECT s.id, s.name, s.description, s.duration_min, s.price,
               sc.id AS category_id, coalesce(sc.name, 'Boshqa') AS category_name, coalesce(sc.sort_order, 32767) AS cat_order
          FROM services s LEFT JOIN service_categories sc ON sc.id = s.category_id
         WHERE s.business_id = :b AND s.is_active
         ORDER BY cat_order, category_name, s.name
    """), {"b": bid}).mappings().all()
    groups: dict[int | None, ServiceGroupOut] = {}
    for s in services:
        g = groups.setdefault(s["category_id"], ServiceGroupOut(category_id=s["category_id"],
                                                                category_name=s["category_name"], services=[]))
        g.services.append(ServiceOut(**{k: s[k] for k in ("id", "name", "description", "duration_min", "price")}))

    staff = db.execute(text("""
        SELECT ps.member_id, ps.full_name, ps.title, ps.bio, ps.photo_url, ps.rating_avg::float AS rating_avg,
               ps.rating_count,
               coalesce((SELECT array_agg(ms.service_id ORDER BY ms.service_id) FROM member_services ms
                          JOIN services s ON s.id = ms.service_id AND s.is_active
                         WHERE ms.member_id = ps.member_id), '{}') AS service_ids
          FROM public_staff ps
         WHERE ps.business_id = :b
         ORDER BY ps.rating_avg DESC, ps.full_name
    """), {"b": bid}).mappings()

    return BusinessDetail(**b, hours=[HoursOut(**h) for h in hours], photos=list(photos),
                          service_groups=list(groups.values()), staff=[StaffOut(**s) for s in staff])
