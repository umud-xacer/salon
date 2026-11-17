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
from pydantic import BaseModel, Field
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
