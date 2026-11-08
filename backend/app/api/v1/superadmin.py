"""Super Admin: bizneslarni qo'shish, egasini tayinlash, modullar va bloklash."""
from datetime import datetime, timedelta, timezone

import json

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_superadmin
from app.core.security import normalize_phone
from app.models import Business, BusinessMember, BusinessModule, User
from app.schemas import (AuditOut, UserAdminOut, UserAdminPage, BusinessAdminOut, BusinessCreate, BusinessDeleteIn, BusinessExpiry, BusinessOut, BusinessStatusIn,
                         BusinessUpdate, CountRow, OwnerChange, PhoneLookupOut, PhoneMembership, DailyPoint, ModuleOut, ModuleToggle, MonthlyRevenue, PlatformStats, RatingRow,
                         StatusIn, SubscriptionPaymentOut, SubscriptionRenew, SubscriptionUpdate)
from app.schemas.catalog import BusinessTypeCreate, BusinessTypeIn, BusinessTypeOut, BusinessTypeUpdate
from app.api.v1.members import assign_password
from app.services import audit, media

router = APIRouter(prefix="/superadmin", tags=["superadmin"], dependencies=[Depends(require_superadmin)])

_BUSINESS_SELECT = """
    SELECT b.id, b.name, b.slug, b.category_id, b.region, b.city, b.address, b.status::text AS status,
           ST_Y(b.location::geometry) AS lat, ST_X(b.location::geometry) AS lng,
           b.is_active, b.subscription_ends_at, b.monthly_fee, b.rating_avg::float AS rating_avg, b.rating_count,
           app.business_operational(b.id) AS operational,
           u.full_name AS owner_name, u.phone AS owner_phone, o.id AS owner_member_id,
           u.id AS owner_user_id, u.status::text AS owner_status, u.last_login_at AS owner_last_login_at,
           (SELECT c.name_uz FROM business_categories c WHERE c.id = b.category_id) AS type_name,
           CASE WHEN u.id IS NULL THEN NULL ELSE app.password_state(u.id) END AS owner_password_status,
           u.password_changed_at AS owner_password_changed_at,
           (SELECT count(*) FROM business_members m WHERE m.business_id = b.id AND m.is_active) AS staff_count,
           (SELECT count(*) FROM services s WHERE s.business_id = b.id AND s.is_active) AS service_count,
           (SELECT count(*) FROM business_hours h WHERE h.business_id = b.id) AS hours_count,
           (SELECT count(*) FROM business_photos p WHERE p.business_id = b.id) AS photo_count,
           coalesce((SELECT array_agg(x.code ORDER BY x.code) FROM modules x
                      WHERE app.module_enabled(b.id, x.code)), '{}') AS modules
      FROM businesses b
      LEFT JOIN business_members o ON o.business_id = b.id AND o.role = 'owner' AND o.is_active
      LEFT JOIN users u ON u.id = o.user_id
"""


def _business_or_404(db: Session, business_id: int) -> Business:
    biz = db.get(Business, business_id)
    if biz is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Biznes topilmadi"})
    return biz


def _read_business(db: Session, business_id: int) -> BusinessAdminOut:
    return BusinessAdminOut(**db.execute(text(f"{_BUSINESS_SELECT} WHERE b.id = :id"), {"id": business_id})
                            .mappings().one())


@router.get("/modules", response_model=list[ModuleOut])
def list_modules(db: Session = Depends(get_db)):
    return [ModuleOut(**r) for r in db.execute(text("SELECT code, name FROM modules ORDER BY name")).mappings()]


@router.get("/businesses", response_model=list[BusinessAdminOut])
def list_businesses(db: Session = Depends(get_db)):
    rows = db.execute(text(f"{_BUSINESS_SELECT} ORDER BY b.created_at DESC")).mappings()
    return [BusinessAdminOut(**r) for r in rows]


@router.post("/businesses", response_model=BusinessOut, status_code=201)
def create_business(body: BusinessCreate, db: Session = Depends(get_db)):
    user: User = db.info["user"]
    biz = Business(name=body.name.strip(), slug=body.slug, category_id=body.category_id,
                   region=body.region, city=body.city, address=body.address, status="active", created_by=user.id)
    if body.subscription_days is not None:
        biz.subscription_ends_at = datetime.now(timezone.utc) + timedelta(days=body.subscription_days)
    db.add(biz)
    db.flush()
    db.execute(text("UPDATE businesses SET location = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography "
                    "WHERE id = :id"), {"lng": body.lng, "lat": body.lat, "id": biz.id})
    # Turning standart ish vaqti: dushanba-shanba. Direktor keyin o'zgartiradi
    db.execute(text("""
        INSERT INTO business_hours (business_id, weekday, opens_at, closes_at)
        SELECT :id, d, c.opens_at, c.closes_at FROM business_categories c, generate_series(1, 6) d
         WHERE c.id = :c"""), {"id": biz.id, "c": body.category_id})

    owner_id = db.scalar(text("SELECT app.ensure_user(:p, :n)"), {"p": body.owner_phone, "n": body.owner_full_name})
    owner = BusinessMember(business_id=biz.id, user_id=owner_id, role="owner", is_bookable=False)
    db.add(owner)
    if body.owner_password:
        # Odamning o'z paroli bo'lsa, ustidan yozilmaydi (u boshqa salon yoki mijoz hisobi bo'lishi mumkin)
        own = db.scalar(text("SELECT app.password_state(:u) = 'own'"), {"u": owner_id})
        if own:
            raise HTTPException(409, detail={"code": "has_own_password",
                                             "message": "Bu raqam egasining o'z paroli bor. Parol maydonini bo'sh qoldiring"})
        db.flush()
        assign_password(db, biz.id, owner.id, body.owner_password)
    for code in set(body.modules):
        db.add(BusinessModule(business_id=biz.id, module_code=code, enabled=True))
    db.commit()
    return BusinessOut(id=biz.id, name=biz.name, slug=biz.slug, status=biz.status, owner_member_id=owner.id)


@router.patch("/businesses/{business_id}", response_model=BusinessAdminOut)
def update_business(body: BusinessUpdate, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Asosiy ma'lumot va xaritadagi lokatsiya. lat/lng null bo'lsa, lokatsiya olib tashlanadi."""
    biz = _business_or_404(db, business_id)
    data = body.model_dump(exclude_unset=True)
    lat, lng = data.pop("lat", ...), data.pop("lng", ...)
    for field, value in data.items():
        setattr(biz, field, value.strip() if isinstance(value, str) else value)
    db.flush()
    if lat is not ...:
        db.execute(text("""UPDATE businesses SET location = CASE WHEN CAST(:lat AS float8) IS NULL THEN NULL
                           ELSE ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography END WHERE id = :id"""),
                   {"lat": lat, "lng": lng, "id": business_id})
    audit.log(db, business_id, "update", "business", business_id, body.model_dump(exclude_unset=True))
    db.commit()
    return _read_business(db, business_id)


@router.delete("/businesses/{business_id}", status_code=204)
def delete_business(body: BusinessDeleteIn, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Muassasani butunlay o'chiradi: bronlar, to'lovlar, xodim a'zoliklari, ombor, rasmlar.

    Odamlarning hisoblari (direktor, xodim, mijoz) o'chmaydi — ular boshqa joyda ham bo'lishi mumkin.
    Ortga qaytarib bo'lmaydi (faqat server zaxira nusxasidan).
    """
    biz = _business_or_404(db, business_id)
    if body.confirm_name.strip() != biz.name.strip():
        raise HTTPException(422, detail={"code": "confirm_mismatch", "message": "Nom mos kelmadi — o'chirilmadi"})
    info = {"name": biz.name, "slug": biz.slug, "category_id": biz.category_id}
    db.execute(text("SELECT app.delete_business(:id)"), {"id": business_id})
    # Jurnal biznesga bog'lanmaydi (u yo'q), Super Admin yozuvi sifatida qoladi
    audit.log(db, None, "delete", "business", business_id, info)
    db.commit()
    media.delete_business_folder(business_id)


@router.get("/phone-lookup", response_model=PhoneLookupOut)
def phone_lookup(phone: str = Query(min_length=9, max_length=20), db: Session = Depends(get_db)):
    """Telefon kimniki: bitta telefon = bitta odam (login). Forma oldindan ogohlantirishi uchun."""
    try:
        normalized = normalize_phone(phone)
    except ValueError:
        raise HTTPException(422, detail={"code": "invalid_phone", "message": "Telefon raqami noto'g'ri"})
    user = db.execute(text("SELECT id, full_name FROM users WHERE phone = :p"), {"p": normalized}).mappings().first()
    if user is None:
        return PhoneLookupOut(phone=normalized, exists=False)
    rows = db.execute(text("""
        SELECT b.id AS business_id, b.name AS business_name, m.role::text AS role
          FROM business_members m JOIN businesses b ON b.id = m.business_id
         WHERE m.user_id = :u AND m.is_active ORDER BY b.name"""), {"u": user["id"]}).mappings()
    return PhoneLookupOut(phone=normalized, exists=True, full_name=user["full_name"] or None,
                          memberships=[PhoneMembership(**r) for r in rows])


@router.put("/businesses/{business_id}/owner", response_model=BusinessAdminOut)
def change_owner(body: OwnerChange, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Direktorni almashtirish. Telefon o'sha odamniki bo'lsa — faqat ismi yangilanadi.

    Eski direktor: 'manager' — menejer bo'lib qoladi, 'remove' — muassasadan chiqariladi (hisobi o'chmaydi).
    Yangi odam shu muassasada xodim bo'lsa, o'sha a'zolik direktorga ko'tariladi, aks holda yangisi qo'shiladi.
    Bazada bitta faol direktor (one_owner_per_business) va faqat Super Admin o'zgartiradi (guard_members).
    """
    _business_or_404(db, business_id)
    old = db.scalars(select(BusinessMember).where(BusinessMember.business_id == business_id,
                                                  BusinessMember.role == "owner", BusinessMember.is_active)).first()
    user_id = db.scalar(text("SELECT app.ensure_user(:p, :n)"), {"p": body.phone, "n": body.full_name})
    target = db.get(User, user_id)

    if old is not None and old.user_id == user_id:
        # O'sha odam: ism tuzatiladi, parol berilsa — yangilanadi
        old_name = target.full_name
        target.full_name = body.full_name
        db.flush()
        if body.password:
            assign_password(db, business_id, old.id, body.password)
        audit.log(db, business_id, "update", "owner", old.id, {"full_name": [old_name, body.full_name]})
        db.commit()
        return _read_business(db, business_id)

    if body.password and db.scalar(text("SELECT app.password_state(:u) = 'own'"), {"u": user_id}):
        raise HTTPException(409, detail={"code": "has_own_password",
                                         "message": "Bu raqam egasining o'z paroli bor. Parol maydonini bo'sh qoldiring"})
    if not target.full_name.strip():
        target.full_name = body.full_name

    # Avval eskisi bo'shatiladi: bazada bir vaqtda ikkita faol direktor bo'lolmaydi
    if old is not None:
        if body.previous == "manager":
            old.role = "manager"
        else:
            old.is_active = False
        db.flush()

    member = db.scalars(select(BusinessMember).where(BusinessMember.business_id == business_id,
                                                     BusinessMember.user_id == user_id)).first()
    if member is None:
        member = BusinessMember(business_id=business_id, user_id=user_id, role="owner", is_bookable=False)
        db.add(member)
    else:
        member.role, member.is_active = "owner", True
    db.flush()
    if body.password:
        assign_password(db, business_id, member.id, body.password)
    audit.log(db, business_id, "change", "owner", member.id, {
        "from": None if old is None else old.user_id, "to": user_id, "previous": body.previous,
        "phone": body.phone, "full_name": body.full_name})
    db.commit()
    return _read_business(db, business_id)


@router.patch("/businesses/{business_id}/status", status_code=204)
def set_business_status(body: BusinessStatusIn, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    _business_or_404(db, business_id).status = body.status
    db.commit()


@router.post("/businesses/{business_id}/subscription/renew", response_model=BusinessAdminOut)
def renew_subscription(body: SubscriptionRenew, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """To'lovdan keyin: qolgan kunlar kuymaydi, salon darhol shu joyidan davom etadi."""
    biz = _business_or_404(db, business_id)
    now = datetime.now(timezone.utc)
    biz.subscription_ends_at = max(biz.subscription_ends_at or now, now) + timedelta(days=body.days)
    biz.is_active = True
    db.execute(text("""
        INSERT INTO subscription_payments (business_id, business_name, days, amount, method, note, ends_at)
        VALUES (:b, :n, :d, :a, :m, :note, :e)"""),
        {"b": business_id, "n": biz.name, "d": body.days, "a": body.amount, "m": body.method,
         "note": (body.note or "").strip() or None, "e": biz.subscription_ends_at})
    audit.log(db, business_id, "renew", "subscription", business_id,
              {"days": body.days, "amount": body.amount, "method": body.method, "ends_at": biz.subscription_ends_at})
    db.commit()
    return _read_business(db, business_id)


_PAYMENT_SELECT = """
    SELECT p.id, p.business_id, p.business_name, p.days, p.amount, p.method, p.note, p.ends_at, p.created_at,
           u.full_name AS created_by_name
      FROM subscription_payments p
      LEFT JOIN users u ON u.id = p.created_by
"""


@router.get("/businesses/{business_id}/subscription/payments", response_model=list[SubscriptionPaymentOut])
def subscription_payments(business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    _business_or_404(db, business_id)
    rows = db.execute(text(f"{_PAYMENT_SELECT} WHERE p.business_id = :b ORDER BY p.created_at DESC, p.id DESC LIMIT 200"),
                      {"b": business_id}).mappings()
    return [SubscriptionPaymentOut(**r) for r in rows]


# ─── Onlayn to'lov paketlari ────────────────────────────────────────────────
class BillingPackageAdmin(BaseModel):
    months: int
    discount_pct: int = Field(ge=0, le=90)
    is_active: bool


@router.get("/billing/packages", response_model=list[BillingPackageAdmin])
def billing_packages(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT months, discount_pct, is_active FROM billing_packages ORDER BY months")).mappings()
    return [BillingPackageAdmin(**r) for r in rows]


@router.put("/billing/packages/{months}", response_model=BillingPackageAdmin)
def update_billing_package(body: BillingPackageAdmin, months: int = Path(ge=1, le=24), db: Session = Depends(get_db)):
    row = db.execute(text("""UPDATE billing_packages SET discount_pct = :d, is_active = :a WHERE months = :m
                             RETURNING months, discount_pct, is_active"""),
                     {"d": body.discount_pct, "a": body.is_active, "m": months}).mappings().first()
    if row is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paket topilmadi"})
    audit.log(db, None, "update", "billing_package", months, {"discount_pct": body.discount_pct, "is_active": body.is_active})
    db.commit()
    return BillingPackageAdmin(**row)


# ─── Platforma statistikasi ─────────────────────────────────────────────────
_TZ = "Asia/Tashkent"


@router.get("/stats", response_model=PlatformStats)
def platform_stats(db: Session = Depends(get_db)):
    """Bosh sahifa: muassasalar holati, foydalanuvchilar, bronlar faolligi va obuna daromadi (Toshkent vaqti)."""
    q = lambda sql, **p: db.execute(text(sql), {"tz": _TZ, **p})     # noqa: E731

    biz = q("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE app.business_operational(b.id)) AS operational,
               count(*) FILTER (WHERE b.status <> 'blocked' AND NOT app.business_operational(b.id)) AS suspended,
               count(*) FILTER (WHERE b.status = 'blocked') AS blocked,
               count(*) FILTER (WHERE b.status = 'active' AND b.is_listed AND c.is_active AND b.location IS NOT NULL
                                  AND app.subscription_ok(b.is_active, b.subscription_ends_at)
                                  AND app.has_public_offer(b.id)) AS listed
          FROM businesses b JOIN business_categories c ON c.id = b.category_id""").mappings().one()

    expiring = q("""
        SELECT b.id, b.name, b.subscription_ends_at, u.phone AS owner_phone
          FROM businesses b
          LEFT JOIN business_members o ON o.business_id = b.id AND o.role = 'owner' AND o.is_active
          LEFT JOIN users u ON u.id = o.user_id
         WHERE b.status <> 'blocked' AND b.is_active
           AND b.subscription_ends_at > now() AND b.subscription_ends_at <= now() + interval '7 days'
         ORDER BY b.subscription_ends_at LIMIT 20""").mappings().all()

    by_type = q("""
        SELECT c.slug AS key, c.name_uz AS label, c.name_ru AS label_ru, count(b.id) AS count
          FROM business_categories c LEFT JOIN businesses b ON b.category_id = c.id
         GROUP BY c.id HAVING c.is_active OR count(b.id) > 0
         ORDER BY c.sort_order, c.id""").mappings().all()

    people = q("""
        SELECT count(u.id) AS users_total,
               count(u.id) FILTER (WHERE EXISTS (SELECT 1 FROM business_members m
                                                  WHERE m.user_id = u.id AND m.is_active)) AS staff_total
          FROM users u WHERE NOT u.is_superadmin""").mappings().one()

    # Bronlar yaratilgan kun bo'yicha (faollik); bekor qilinganlar ham — bu talab ko'rsatkichi
    bookings = q("""
        SELECT count(*) FILTER (WHERE (a.created_at AT TIME ZONE :tz)::date = (now() AT TIME ZONE :tz)::date) AS today,
               count(*) FILTER (WHERE a.created_at > now() - interval '30 days') AS d30,
               count(*) FILTER (WHERE a.created_at <= now() - interval '30 days') AS d30_prev
          FROM appointments a WHERE a.created_at > now() - interval '60 days'""").mappings().one()

    daily = q("""
        WITH days AS (
            SELECT generate_series((now() AT TIME ZONE :tz)::date - 29, (now() AT TIME ZONE :tz)::date, '1 day')::date AS day
        )
        SELECT d.day,
               (SELECT count(*) FROM appointments a
                 WHERE (a.created_at AT TIME ZONE :tz)::date = d.day) AS bookings,
               (SELECT count(u.id) FROM users u
                 WHERE NOT u.is_superadmin AND (u.created_at AT TIME ZONE :tz)::date = d.day) AS new_clients
          FROM days d ORDER BY d.day""").mappings().all()

    monthly = q("""
        WITH months AS (
            SELECT generate_series(date_trunc('month', now() AT TIME ZONE :tz) - interval '11 months',
                                   date_trunc('month', now() AT TIME ZONE :tz), '1 month') AS m
        )
        SELECT to_char(m.m, 'YYYY-MM') AS month,
               coalesce(sum(p.amount), 0) AS amount, count(p.id) AS count
          FROM months m
          LEFT JOIN subscription_payments p
                 ON date_trunc('month', p.created_at AT TIME ZONE :tz) = m.m AND p.method <> 'free'
         GROUP BY m.m ORDER BY m.m""").mappings().all()

    recent = q(f"{_PAYMENT_SELECT} ORDER BY p.created_at DESC, p.id DESC LIMIT 10").mappings().all()

    reviews = q("""
        SELECT count(*) AS total, count(*) FILTER (WHERE created_at > now() - interval '30 days') AS d30,
               round(avg(rating), 2)::float AS avg
          FROM reviews WHERE NOT is_hidden""").mappings().one()
    rated = """
        SELECT b.id, b.name, c.name_uz AS category, c.name_ru AS category_ru, b.rating_avg::float AS rating_avg, b.rating_count
          FROM businesses b JOIN business_categories c ON c.id = b.category_id
         WHERE b.rating_count > 0"""
    top = q(f"{rated} ORDER BY b.rating_avg DESC, b.rating_count DESC, b.id LIMIT 5").mappings().all()
    low = q(f"{rated} ORDER BY b.rating_avg, b.rating_count DESC, b.id LIMIT 5").mappings().all()

    return PlatformStats(
        businesses_total=biz["total"], businesses_operational=biz["operational"],
        businesses_suspended=biz["suspended"], businesses_blocked=biz["blocked"], businesses_listed=biz["listed"],
        expiring_soon=[BusinessExpiry(**r) for r in expiring],
        by_type=[CountRow(**r) for r in by_type],
        users_total=people["users_total"], staff_total=people["staff_total"],
        clients_total=people["users_total"] - people["staff_total"],
        bookings_today=bookings["today"], bookings_30d=bookings["d30"], bookings_30d_prev=bookings["d30_prev"],
        daily=[DailyPoint(**r) for r in daily],
        revenue_this_month=monthly[-1]["amount"], revenue_prev_month=monthly[-2]["amount"],
        revenue_monthly=[MonthlyRevenue(**r) for r in monthly],
        recent_payments=[SubscriptionPaymentOut(**r) for r in recent],
        reviews_total=reviews["total"], reviews_30d=reviews["d30"], rating_avg=reviews["avg"],
        rating_top=[RatingRow(**r) for r in top], rating_low=[RatingRow(**r) for r in low],
    )


@router.patch("/businesses/{business_id}/subscription", response_model=BusinessAdminOut)
def update_subscription(body: SubscriptionUpdate, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Qo'lda to'xtatish/yoqish yoki muddatni aniq belgilash. Ma'lumotlarga tegilmaydi."""
    biz = _business_or_404(db, business_id)
    changes = body.model_dump(exclude_unset=True)
    for required in ("is_active", "monthly_fee"):
        if required in changes and changes[required] is None:
            raise HTTPException(422, detail={"code": "invalid_value", "message": f"{required} bo'sh bo'lishi mumkin emas"})
    for field, value in changes.items():
        setattr(biz, field, value)
    audit.log(db, business_id, "update", "subscription", business_id, changes)
    db.commit()
    return _read_business(db, business_id)


@router.put("/businesses/{business_id}/modules/{module_code}", status_code=204)
def toggle_module(body: ModuleToggle, business_id: int = Path(ge=1), module_code: str = Path(max_length=40),
                  db: Session = Depends(get_db)):
    row = db.get(BusinessModule, (business_id, module_code))
    if row is None:
        db.add(BusinessModule(business_id=business_id, module_code=module_code,
                              enabled=body.enabled, expires_at=body.expires_at))
    else:
        row.enabled, row.expires_at = body.enabled, body.expires_at
    audit.log(db, business_id, "toggle", "module", None, {"module": module_code, "enabled": body.enabled})
    db.commit()


# ─── Muassasa turlari ───────────────────────────────────────────────────────
_TYPE_SELECT = """
    SELECT c.id, c.slug, c.kind, c.name_uz, c.name_ru, c.icon, c.sort_order, c.is_active, c.opens_at, c.closes_at,
           c.service_presets, c.staff_titles, c.staff_word,
           (SELECT count(*) FROM businesses b WHERE b.category_id = c.id) AS business_count
      FROM business_categories c
"""
_TYPE_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Muassasa turi topilmadi"})


def _read_type(db: Session, type_id: int) -> BusinessTypeOut:
    row = db.execute(text(f"{_TYPE_SELECT} WHERE c.id = :id"), {"id": type_id}).mappings().first()
    if row is None:
        raise _TYPE_NOT_FOUND
    return BusinessTypeOut(**row)


def _save_type(db: Session, type_id: int, body: BusinessTypeIn) -> None:
    data = body.model_dump(exclude={"slug"})
    data["service_presets"] = json.dumps(data["service_presets"], ensure_ascii=False)
    data["staff_titles"] = json.dumps(data["staff_titles"], ensure_ascii=False)
    db.execute(text("""
        UPDATE business_categories SET kind = :kind, name_uz = :name_uz, name_ru = :name_ru, icon = :icon,
               sort_order = :sort_order, is_active = :is_active, opens_at = :opens_at, closes_at = :closes_at,
               service_presets = CAST(:service_presets AS jsonb), staff_titles = CAST(:staff_titles AS jsonb),
               staff_word = :staff_word
         WHERE id = :id"""), {**data, "id": type_id})


@router.get("/business-types", response_model=list[BusinessTypeOut])
def list_types(db: Session = Depends(get_db)):
    return [BusinessTypeOut(**r) for r in db.execute(text(f"{_TYPE_SELECT} ORDER BY c.sort_order, c.id")).mappings()]


@router.post("/business-types", response_model=BusinessTypeOut, status_code=201)
def create_type(body: BusinessTypeCreate, db: Session = Depends(get_db)):
    try:
        type_id = db.scalar(text("INSERT INTO business_categories (slug, name_uz, name_ru) "
                                 "VALUES (:s, :u, :r) RETURNING id"), {"s": body.slug, "u": body.name_uz, "r": body.name_ru})
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail={"code": "slug_taken", "message": "Bu kod bilan tur allaqachon bor"})
    _save_type(db, type_id, body)
    db.commit()
    return _read_type(db, type_id)


@router.patch("/business-types/{type_id}", response_model=BusinessTypeOut)
def update_type(body: BusinessTypeUpdate, type_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Qisman yangilash. Natija to'liq qayta tekshiriladi (masalan, ish vaqti tartibi)."""
    current = _read_type(db, type_id).model_dump(exclude={"id", "business_count", "slug"})
    try:
        merged = BusinessTypeIn(**{**current, **body.model_dump(exclude_unset=True)})
    except ValidationError as e:
        raise RequestValidationError(e.errors(include_url=False, include_context=False))
    _save_type(db, type_id, merged)
    db.commit()
    return _read_type(db, type_id)


@router.patch("/users/{user_id}/status", status_code=204)
def set_user_status(body: StatusIn, user_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Bloklangan foydalanuvchining tokenlari keyingi so'rovdayoq rad etiladi."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Foydalanuvchi topilmadi"})
    if target.is_superadmin:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Super Adminni bloklab bo'lmaydi"})
    if target.status != body.status:
        target.status = body.status
        audit.log(db, None, "block" if body.status == "blocked" else "unblock", "user", user_id,
                  {"phone": target.phone, "name": target.full_name})
    db.commit()


# ─── Foydalanuvchilar ───────────────────────────────────────────────────────
@router.get("/users", response_model=UserAdminPage)
def list_users(q: str | None = Query(default=None, max_length=60),
               status: Literal["active", "blocked"] | None = None,
               kind: Literal["client", "staff", "superadmin"] | None = None,
               limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0, le=100_000),
               db: Session = Depends(get_db)):
    """Qidiruv: ism yoki telefon (raqamlarning bir qismi ham). Xodim — biror muassasada faol a'zo."""
    where, params = ["u.status <> 'deleted'"], {"limit": limit, "offset": offset}
    if q and q.strip():
        term = q.strip()
        digits = "".join(ch for ch in term if ch.isdigit())
        cond = ["u.full_name ILIKE :name"]
        params["name"] = f"%{term.replace('%', '').replace('_', '')}%"
        if len(digits) >= 3:
            cond.append("u.phone LIKE :digits")
            params["digits"] = f"%{digits}%"
        where.append(f"({' OR '.join(cond)})")
    if status:
        where.append("u.status = :status")
        params["status"] = status
    staff_cond = "EXISTS (SELECT 1 FROM business_members m WHERE m.user_id = u.id AND m.is_active)"
    if kind == "superadmin":
        where.append("u.is_superadmin")
    elif kind == "staff":
        where.append(f"NOT u.is_superadmin AND {staff_cond}")
    elif kind == "client":
        where.append(f"NOT u.is_superadmin AND NOT {staff_cond}")
    sql_where = " AND ".join(where)
    total = db.scalar(text(f"SELECT count(u.id) FROM users u WHERE {sql_where}"), params)
    rows = db.execute(text(f"""
        SELECT u.id, u.phone, u.full_name, u.status::text AS status, u.is_superadmin, u.created_at, u.last_login_at,
               coalesce((SELECT jsonb_agg(jsonb_build_object('business_id', b.id, 'business_name', b.name,
                                                             'role', m.role::text) ORDER BY b.name)
                           FROM business_members m JOIN businesses b ON b.id = m.business_id
                          WHERE m.user_id = u.id AND m.is_active), '[]') AS memberships,
               (SELECT count(*) FROM business_clients c WHERE c.user_id = u.id) AS client_of
          FROM users u WHERE {sql_where}
         ORDER BY u.created_at DESC, u.id DESC LIMIT :limit OFFSET :offset"""), params).mappings()
    return UserAdminPage(total=total, items=[UserAdminOut(**r) for r in rows])


# ─── Audit jurnali ──────────────────────────────────────────────────────────
@router.get("/audit", response_model=list[AuditOut])
def audit_log(business_id: int | None = Query(default=None, ge=1),
              entity_type: str | None = Query(default=None, max_length=40),
              user_id: int | None = Query(default=None, ge=1),
              platform_only: bool = False,
              before_id: int | None = Query(default=None, ge=1),
              limit: int = Query(default=50, ge=1, le=200),
              db: Session = Depends(get_db)):
    """Kim, qachon, nimani o'zgartirdi. Sahifalash: oxirgi qatorning id si before_id ga beriladi."""
    where, params = ["true"], {"limit": limit}
    if business_id:
        where.append("a.business_id = :b")
        params["b"] = business_id
    if platform_only:
        where.append("a.business_id IS NULL")
    if entity_type:
        where.append("a.entity_type = :t")
        params["t"] = entity_type
    if user_id:
        where.append("a.user_id = :u")
        params["u"] = user_id
    if before_id:
        where.append("a.id < :before")
        params["before"] = before_id
    rows = db.execute(text(f"""
        SELECT a.id, a.business_id, b.name AS business_name, a.user_id, u.full_name AS user_name, u.phone AS user_phone,
               a.action, a.entity_type, a.entity_id, a.changes, a.created_at
          FROM audit_logs a
          LEFT JOIN businesses b ON b.id = a.business_id
          LEFT JOIN users u ON u.id = a.user_id
         WHERE {' AND '.join(where)}
         ORDER BY a.id DESC LIMIT :limit"""), params).mappings()
    return [AuditOut(**r) for r in rows]


@router.get("/audit/entity-types", response_model=list[str])
def audit_entity_types(db: Session = Depends(get_db)):
    return list(db.scalars(text("SELECT DISTINCT entity_type FROM audit_logs ORDER BY 1")))
