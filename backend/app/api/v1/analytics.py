"""Ilova analitikasi (055_app_analytics.sql).

* POST /events — ilova, chronix.uz va panel foydalanuvchi harakatlarini to'plab yuboradi (mehmon ham).
  Token bo'lsa hodisa shu foydalanuvchiga bog'lanadi (bazada app.uid() dan), bo'lmasa — qurilma anon_id si.
  Analitika ishni buzmasligi kerak: yaroqsiz token xato bermaydi, shunchaki mehmon sifatida yoziladi.
* /admin/analytics/... — faqat Super Admin: umumiy ko'rsatkichlar, qidiruvlar, tugma/ekranlar.
"""
import datetime as dt
import json
from typing import Iterator, Literal

import jwt
from fastapi import APIRouter, Depends, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_superadmin
from app.core.security import decode_access_token
from app.db.session import api_session
from app.models import User

router = APIRouter(tags=["analytics"])
admin_router = APIRouter(prefix="/admin/analytics", tags=["analytics"], dependencies=[Depends(require_superadmin)])

_TZ = "Asia/Tashkent"
_bearer = HTTPBearer(auto_error=False)
Platform = Literal["android", "ios", "web", "market", "panel"]


def _optional_db(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Iterator[Session]:
    user_id = None
    if creds is not None and creds.scheme.lower() == "bearer":
        try:
            claims = decode_access_token(creds.credentials)
            user_id = claims.user_id
        except jwt.PyJWTError:
            user_id = None
    db = api_session(user_id)
    try:
        if user_id is not None:
            user = db.get(User, user_id)
            if user is None or user.status != "active" or user.token_version != claims.token_version:
                db.close()
                db = api_session(None)
        yield db
    finally:
        db.close()


class EventIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    props: dict | None = None
    at: dt.datetime | None = None


class EventsIn(BaseModel):
    anon_id: str | None = Field(default=None, max_length=64)
    platform: Platform
    app_version: str | None = Field(default=None, max_length=20)
    events: list[EventIn] = Field(max_length=50)


class EventsOut(BaseModel):
    accepted: int


@router.post("/events", response_model=EventsOut)
def log_events(body: EventsIn, db: Session = Depends(_optional_db)):
    if not body.events:
        return EventsOut(accepted=0)
    events = [e.model_dump(mode="json", exclude_none=True) for e in body.events]
    n = db.scalar(text("SELECT app.log_events(:a, :p, :v, CAST(:e AS jsonb))"), {
        "a": body.anon_id, "p": body.platform, "v": body.app_version,
        "e": json.dumps(events)})
    db.commit()
    return EventsOut(accepted=n or 0)


# ─── Super Admin ───────────────────────────────────────────────────────────────────────────────
class DayPoint(BaseModel):
    day: dt.date
    new_users: int
    active_users: int
    active_businesses: int
    bookings: int


class PlatformCount(BaseModel):
    platform: str
    users: int
    events: int


class OverviewOut(BaseModel):
    days: int
    users_total: int
    users_new: int
    clients_total: int                                  # bizneslarda ishlamaydigan (mijoz) foydalanuvchilar
    devices_total: int                                  # ilovani ochgan qurilmalar (android/ios, 180 kun)
    devices_new: int
    dau: int
    wau: int
    mau: int
    businesses_active: int                              # davr ichida ish qilgan muassasalar
    daily: list[DayPoint]
    platforms: list[PlatformCount]


class SearchRow(BaseModel):
    query: str
    count: int
    users: int
    zero_results: int


class CategoryRow(BaseModel):
    category: str
    count: int


class SearchesOut(BaseModel):
    total: int
    top: list[SearchRow]
    zero: list[SearchRow]                               # natija bermagan qidiruvlar — talab bor, taklif yo'q
    categories: list[CategoryRow]


class EventRow(BaseModel):
    name: str
    count: int
    users: int


class ScreenRow(BaseModel):
    platform: str
    path: str
    count: int
    users: int


class EventsStatsOut(BaseModel):
    events: list[EventRow]                              # tugmalar va amallar
    screens: list[ScreenRow]                            # ekran/bo'lim ochilishlari (ilova, sayt, panel)


_WHO = "coalesce('u' || e.user_id::text, 'a' || e.anon_id)"


@admin_router.get("/overview", response_model=OverviewOut)
def overview(days: int = Query(default=30, ge=7, le=180), db: Session = Depends(get_db)):
    p = {"tz": _TZ, "d": days}
    users = db.execute(text("""
        SELECT count(*) AS users_total,
               count(*) FILTER (WHERE u.created_at > now() - make_interval(days => :d)) AS users_new,
               count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM business_members m
                                                   WHERE m.user_id = u.id AND m.is_active)) AS clients_total
          FROM users u WHERE NOT u.is_superadmin AND u.status <> 'deleted'
    """), p).mappings().one()
    act = db.execute(text(f"""
        SELECT count(DISTINCT e.anon_id) FILTER (WHERE e.platform IN ('android', 'ios')) AS devices_total,
               count(DISTINCT {_WHO}) FILTER (WHERE e.created_at > now() - INTERVAL '1 day') AS dau,
               count(DISTINCT {_WHO}) FILTER (WHERE e.created_at > now() - INTERVAL '7 days') AS wau,
               count(DISTINCT {_WHO}) FILTER (WHERE e.created_at > now() - INTERVAL '30 days') AS mau
          FROM app_events e
    """)).mappings().one()
    devices_new = db.scalar(text("""
        SELECT count(*) FROM (SELECT anon_id FROM app_events WHERE platform IN ('android', 'ios') AND anon_id IS NOT NULL
                               GROUP BY anon_id HAVING min(created_at) > now() - make_interval(days => :d)) x
    """), p)
    businesses_active = db.scalar(text("""
        SELECT count(DISTINCT business_id) FROM (
            SELECT business_id FROM audit_logs WHERE business_id IS NOT NULL AND created_at > now() - make_interval(days => :d)
            UNION ALL
            SELECT business_id FROM appointments WHERE created_at > now() - make_interval(days => :d)) x
    """), p)
    daily = db.execute(text(f"""
        WITH days AS (
            SELECT generate_series((now() AT TIME ZONE :tz)::date - (:d - 1), (now() AT TIME ZONE :tz)::date, '1 day')::date AS day
        ),
        biz AS (
            SELECT (created_at AT TIME ZONE :tz)::date AS day, business_id FROM audit_logs
             WHERE business_id IS NOT NULL AND created_at > now() - make_interval(days => :d + 1)
            UNION
            SELECT (created_at AT TIME ZONE :tz)::date, business_id FROM appointments
             WHERE created_at > now() - make_interval(days => :d + 1)
        )
        SELECT d.day,
               (SELECT count(*) FROM users u WHERE NOT u.is_superadmin
                   AND (u.created_at AT TIME ZONE :tz)::date = d.day)::int AS new_users,
               (SELECT count(DISTINCT {_WHO}) FROM app_events e
                 WHERE e.created_at >= (d.day::timestamp AT TIME ZONE :tz)
                   AND e.created_at < ((d.day + 1)::timestamp AT TIME ZONE :tz))::int AS active_users,
               (SELECT count(DISTINCT b.business_id) FROM biz b WHERE b.day = d.day)::int AS active_businesses,
               (SELECT count(*) FROM appointments a
                 WHERE a.created_at >= (d.day::timestamp AT TIME ZONE :tz)
                   AND a.created_at < ((d.day + 1)::timestamp AT TIME ZONE :tz))::int AS bookings
          FROM days d ORDER BY d.day
    """), p).mappings().all()
    platforms = db.execute(text(f"""
        SELECT e.platform, count(DISTINCT {_WHO})::int AS users, count(*)::int AS events
          FROM app_events e WHERE e.created_at > now() - make_interval(days => :d)
         GROUP BY e.platform ORDER BY users DESC
    """), p).mappings().all()
    return OverviewOut(days=days, **users, **act, devices_new=devices_new or 0, businesses_active=businesses_active or 0,
                       daily=[DayPoint(**r) for r in daily], platforms=[PlatformCount(**r) for r in platforms])


@admin_router.get("/searches", response_model=SearchesOut)
def searches(days: int = Query(default=30, ge=1, le=180), db: Session = Depends(get_db)):
    p = {"d": days}
    base = f"""
        SELECT lower(e.props ->> 'q') AS query, count(*)::int AS count, count(DISTINCT {_WHO})::int AS users,
               count(*) FILTER (WHERE (e.props ->> 'results') = '0')::int AS zero_results
          FROM app_events e
         WHERE e.name = 'search' AND e.created_at > now() - make_interval(days => :d)
           AND length(e.props ->> 'q') >= 2
         GROUP BY 1
    """
    total = db.scalar(text("SELECT count(*) FROM app_events WHERE name = 'search' "
                           "AND created_at > now() - make_interval(days => :d)"), p)
    top = db.execute(text(f"{base} ORDER BY count DESC, query LIMIT 30"), p).mappings().all()
    zero = db.execute(text(f"{base} HAVING count(*) FILTER (WHERE (e.props ->> 'results') = '0') > 0 "
                           "ORDER BY zero_results DESC, query LIMIT 20"), p).mappings().all()
    cats = db.execute(text("""
        SELECT e.props ->> 'category' AS category, count(*)::int AS count
          FROM app_events e
         WHERE e.name IN ('search', 'category_open') AND e.created_at > now() - make_interval(days => :d)
           AND e.props ->> 'category' IS NOT NULL
         GROUP BY 1 ORDER BY count DESC LIMIT 20
    """), p).mappings().all()
    return SearchesOut(total=total or 0, top=[SearchRow(**r) for r in top], zero=[SearchRow(**r) for r in zero],
                       categories=[CategoryRow(**r) for r in cats])


@admin_router.get("/events", response_model=EventsStatsOut)
def events_stats(days: int = Query(default=30, ge=1, le=180), platform: Platform | None = None,
                 db: Session = Depends(get_db)):
    p = {"d": days, "pl": platform}
    where = "e.created_at > now() - make_interval(days => :d) AND (CAST(:pl AS text) IS NULL OR e.platform = :pl)"
    events = db.execute(text(f"""
        SELECT e.name, count(*)::int AS count, count(DISTINCT {_WHO})::int AS users
          FROM app_events e WHERE {where} AND e.name NOT IN ('screen', 'search')
         GROUP BY e.name ORDER BY count DESC LIMIT 60
    """), p).mappings().all()
    screens = db.execute(text(f"""
        SELECT e.platform, e.props ->> 'path' AS path, count(*)::int AS count, count(DISTINCT {_WHO})::int AS users
          FROM app_events e WHERE {where} AND e.name = 'screen' AND e.props ->> 'path' IS NOT NULL
         GROUP BY 1, 2 ORDER BY count DESC LIMIT 60
    """), p).mappings().all()
    return EventsStatsOut(events=[EventRow(**r) for r in events], screens=[ScreenRow(**r) for r in screens])


# ─── Hududiy analitika (061_geo_analytics.sql) ────────────────────────────────────────────────────
from fastapi import Request  # noqa: E402

from app.api.deps import get_public_db  # noqa: E402
from app.services import geo_analytics  # noqa: E402


class LocationPing(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    platform: Platform
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Kenglik va uzunlik birga yuboriladi")
        return self


class LocationPingOut(BaseModel):
    logged: bool                                        # false — shu qurilmadan 15 daqiqa ichida allaqachon yozilgan


@router.post("/analytics/location-ping", response_model=LocationPingOut)
def location_ping(body: LocationPing, request: Request, db: Session = Depends(get_public_db)):
    """Ilova ochilganda. Koordinata bo'lsa — yaxlitlanib (~110 m) yoziladi, hudud keshdan yoki keyin worker'dan;
    bo'lmasa — IP bo'yicha taxminiy hudud. Shaxsga bog'lanmaydi (faqat qurilmaning anon ID si)."""
    gps = body.latitude is not None and body.longitude is not None
    region = city = None
    if not gps:
        ip = request.client.host if request.client else None
        region, city = geo_analytics.by_ip(None if ip == "testclient" else ip)
    logged = db.scalar(text("SELECT app.log_location(:d, CAST(:lat AS numeric), CAST(:lng AS numeric), :p, :r, :c)"), {
        "d": body.device_id, "lat": body.latitude if gps else None, "lng": body.longitude if gps else None,
        "p": body.platform, "r": region, "c": city})
    db.commit()
    return LocationPingOut(logged=bool(logged))


class GeoRegion(BaseModel):
    region: str
    devices: int
    sessions: int
    share: float                                        # qurilmalar ulushi, %


class GeoDistrict(BaseModel):
    region: str
    city: str | None
    district: str
    devices: int
    sessions: int
    share: float                                        # tanlangan hudud ichidagi ulush, %
    businesses: int                                     # shu tumanga ulangan (ilovada ko'rinadigan) muassasalar
    high_demand: bool                                   # foydalanuvchi ko'p, muassasa kam — sotuv hududi


class GeoPoint(BaseModel):
    lat: float
    lng: float
    weight: int                                         # sessiyalar (kamida 3 ta qurilma bo'lgan katakda)


class GeographyOut(BaseModel):
    days: int
    region: str | None
    devices: int
    sessions: int
    gps_share: float
    pending: int                                        # hali hududi aniqlanmagan yozuvlar (worker to'ldiradi)
    regions: list[GeoRegion]
    districts: list[GeoDistrict]
    points: list[GeoPoint]


MIN_DEVICES_PER_POINT = 3                               # k-anonimlik: bitta odamning uyi xaritada ko'rinmasin
HIGH_DEMAND_DEVICES = 20                                # "sotuv hududi": kamida shuncha qurilma
HIGH_DEMAND_PER_BUSINESS = 50                           # va muassasa yo'q yoki har muassasaga shundan ko'p qurilma


def _geography(db: Session, days: int, region: str | None, source: str) -> GeographyOut:
    p = {"d": days, "r": region, "s": None if source == "all" else source, "k": MIN_DEVICES_PER_POINT}
    where = ("l.created_at > now() - make_interval(days => :d) "
             "AND (CAST(:s AS text) IS NULL OR l.source = :s)")
    tot = db.execute(text(f"""
        SELECT count(DISTINCT l.device_id)::int AS devices, count(*)::int AS sessions,
               coalesce(round(100.0 * count(*) FILTER (WHERE l.source = 'gps') / nullif(count(*), 0), 1), 0)::float AS gps_share,
               count(*) FILTER (WHERE l.region IS NULL AND l.lat_grid IS NOT NULL)::int AS pending
          FROM user_location_logs l WHERE {where}
    """), p).mappings().one()
    regions = db.execute(text(f"""
        SELECT coalesce(l.region, 'Aniqlanmagan') AS region, count(DISTINCT l.device_id)::int AS devices, count(*)::int AS sessions
          FROM user_location_logs l WHERE {where} GROUP BY 1 ORDER BY devices DESC, sessions DESC
    """), p).mappings().all()
    total = tot["devices"] or 1
    districts = db.execute(text(f"""
        WITH d AS (
            SELECT l.region, min(l.city) AS city,
                   coalesce(l.district, coalesce(l.city, l.region) || ' (tuman aniqlanmagan)') AS district,
                   count(DISTINCT l.device_id)::int AS devices, count(*)::int AS sessions
              FROM user_location_logs l
             WHERE {where} AND l.region IS NOT NULL AND l.region NOT IN ('Aniqlanmagan', 'Xorij')
               AND (CAST(:r AS text) IS NULL OR l.region = :r)
             GROUP BY l.region, 3
        ), biz AS (
            SELECT c.region, c.district, count(*)::int AS n
              FROM businesses b
              JOIN geo_cache c ON c.lat_grid = round(ST_Y(b.location::geometry)::numeric, 3)
                              AND c.lng_grid = round(ST_X(b.location::geometry)::numeric, 3)
             WHERE b.location IS NOT NULL AND b.status = 'active' AND b.is_listed
             GROUP BY 1, 2
        )
        SELECT d.*, coalesce(biz.n, 0) AS businesses
          FROM d LEFT JOIN biz ON biz.region = d.region AND biz.district = d.district
         ORDER BY d.devices DESC, d.sessions DESC LIMIT 200
    """), p).mappings().all()
    in_scope = sum(x["devices"] for x in districts) or 1
    points = db.execute(text(f"""
        SELECT round(l.lat_grid, 2)::float AS lat, round(l.lng_grid, 2)::float AS lng, count(*)::int AS weight
          FROM user_location_logs l
         WHERE {where} AND l.lat_grid IS NOT NULL AND (CAST(:r AS text) IS NULL OR l.region = :r)
         GROUP BY 1, 2 HAVING count(DISTINCT l.device_id) >= :k
         ORDER BY weight DESC LIMIT 2000
    """), p).mappings().all()
    return GeographyOut(
        days=days, region=region, **tot,
        regions=[GeoRegion(**r, share=round(100 * r["devices"] / total, 1)) for r in regions],
        districts=[GeoDistrict(**x, share=round(100 * x["devices"] / in_scope, 1),
                               high_demand=x["devices"] >= HIGH_DEMAND_DEVICES
                               and (x["businesses"] == 0 or x["devices"] / x["businesses"] >= HIGH_DEMAND_PER_BUSINESS))
                   for x in districts],
        points=[GeoPoint(**pt) for pt in points])


@admin_router.get("/geography", response_model=GeographyOut)
def geography(days: int = Query(default=30, ge=1, le=180), region: str | None = Query(default=None, max_length=60),
              source: Literal["all", "gps", "ip"] = "all", db: Session = Depends(get_db)):
    return _geography(db, days, region, source)


@admin_router.get("/geography/export")
def geography_export(days: int = Query(default=30, ge=1, le=180), region: str | None = Query(default=None, max_length=60),
                     source: Literal["all", "gps", "ip"] = "all", db: Session = Depends(get_db)):
    """Sotuv bo'limi uchun: tumanlar va viloyatlar jadvali Excel'da."""
    import io

    from fastapi.responses import Response
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    g = _geography(db, days, region, source)
    wb = Workbook()
    ws = wb.active
    ws.title = "Tumanlar"
    ws.append([f"Chronix — hududiy faollik, oxirgi {days} kun" + (f", {region}" if region else "")])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append(["Viloyat / shahar", "Tuman", "Foydalanuvchilar (qurilma)", "Ilova ochilishi", "Ulush, %",
               "Ulangan muassasalar", "Sotuv hududi"])
    for c in ws[2]:
        c.font = Font(bold=True)
    hot = PatternFill("solid", fgColor="DCFCE7")
    for x in g.districts:
        ws.append([x.region, x.district, x.devices, x.sessions, x.share, x.businesses, "Ha" if x.high_demand else ""])
        if x.high_demand:
            for c in ws[ws.max_row]:
                c.fill = hot
    ws2 = wb.create_sheet("Viloyatlar")
    ws2.append(["Viloyat / shahar", "Foydalanuvchilar (qurilma)", "Ilova ochilishi", "Ulush, %"])
    for r in g.regions:
        ws2.append([r.region, r.devices, r.sessions, r.share])
    for sheet, widths in ((ws, [24, 30, 14, 14, 10, 14, 12]), (ws2, [24, 14, 14, 10])):
        for i, w in enumerate(widths):
            sheet.column_dimensions[chr(65 + i)].width = w
    buf = io.BytesIO()
    wb.save(buf)
    return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="hududlar-{days}kun.xlsx"'})
