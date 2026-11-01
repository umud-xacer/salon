"""Super Admin: bizneslarni qo'shish, egasini tayinlash, modullar va bloklash."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_superadmin
from app.models import Business, BusinessMember, BusinessModule, User
from app.schemas import (BusinessAdminOut, BusinessCreate, BusinessOut, BusinessStatusIn, BusinessUpdate, ModuleOut,
                         ModuleToggle, StatusIn, SubscriptionRenew, SubscriptionUpdate)
from app.services import audit

router = APIRouter(prefix="/superadmin", tags=["superadmin"], dependencies=[Depends(require_superadmin)])

_BUSINESS_SELECT = """
    SELECT b.id, b.name, b.slug, b.category_id, b.city, b.address, b.status::text AS status,
           ST_Y(b.location::geometry) AS lat, ST_X(b.location::geometry) AS lng,
           b.is_active, b.subscription_ends_at,
           app.business_operational(b.id) AS operational,
           u.full_name AS owner_name, u.phone AS owner_phone,
           (SELECT count(*) FROM business_members m WHERE m.business_id = b.id AND m.is_active) AS staff_count,
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
                   city=body.city, address=body.address, status="active", created_by=user.id)
    if body.subscription_days is not None:
        biz.subscription_ends_at = datetime.now(timezone.utc) + timedelta(days=body.subscription_days)
    db.add(biz)
    db.flush()
    if body.lat is not None and body.lng is not None:
        db.execute(text("UPDATE businesses SET location = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography "
                        "WHERE id = :id"), {"lng": body.lng, "lat": body.lat, "id": biz.id})

    owner_id = db.scalar(text("SELECT app.ensure_user(:p, :n)"), {"p": body.owner_phone, "n": body.owner_full_name})
    owner = BusinessMember(business_id=biz.id, user_id=owner_id, role="owner", is_bookable=False)
    db.add(owner)
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
