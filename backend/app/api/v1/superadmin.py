"""Super Admin: bizneslarni qo'shish, egasini tayinlash, modullar va bloklash."""
from datetime import datetime, timedelta, timezone

import json

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_superadmin
from app.models import Business, BusinessMember, BusinessModule, User
from app.schemas import (BusinessAdminOut, BusinessCreate, BusinessDeleteIn, BusinessOut, BusinessStatusIn, BusinessUpdate, ModuleOut,
                         ModuleToggle, StatusIn, SubscriptionRenew, SubscriptionUpdate)
from app.schemas.catalog import BusinessTypeCreate, BusinessTypeIn, BusinessTypeOut, BusinessTypeUpdate
from app.api.v1.members import assign_password
from app.services import audit, media

router = APIRouter(prefix="/superadmin", tags=["superadmin"], dependencies=[Depends(require_superadmin)])

_BUSINESS_SELECT = """
    SELECT b.id, b.name, b.slug, b.category_id, b.region, b.city, b.address, b.status::text AS status,
           ST_Y(b.location::geometry) AS lat, ST_X(b.location::geometry) AS lng,
           b.is_active, b.subscription_ends_at,
           app.business_operational(b.id) AS operational,
           u.full_name AS owner_name, u.phone AS owner_phone, o.id AS owner_member_id,
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
    audit.log(db, business_id, "renew", "subscription", business_id,
              {"days": body.days, "ends_at": biz.subscription_ends_at})
    db.commit()
    return _read_business(db, business_id)


@router.patch("/businesses/{business_id}/subscription", response_model=BusinessAdminOut)
def update_subscription(body: SubscriptionUpdate, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Qo'lda to'xtatish/yoqish yoki muddatni aniq belgilash. Ma'lumotlarga tegilmaydi."""
    biz = _business_or_404(db, business_id)
    changes = body.model_dump(exclude_unset=True)
    if "is_active" in changes and changes["is_active"] is None:
        raise HTTPException(422, detail={"code": "invalid_value", "message": "is_active bo'sh bo'lishi mumkin emas"})
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
           c.service_presets, (SELECT count(*) FROM businesses b WHERE b.category_id = c.id) AS business_count
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
    db.execute(text("""
        UPDATE business_categories SET kind = :kind, name_uz = :name_uz, name_ru = :name_ru, icon = :icon,
               sort_order = :sort_order, is_active = :is_active, opens_at = :opens_at, closes_at = :closes_at,
               service_presets = CAST(:service_presets AS jsonb)
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
    target.status = body.status
    db.commit()
