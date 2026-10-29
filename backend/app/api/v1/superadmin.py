"""Super Admin: bizneslarni qo'shish, egasini tayinlash, modullar va bloklash."""
from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_superadmin
from app.models import Business, BusinessMember, BusinessModule, User
from app.schemas import BusinessCreate, BusinessOut, BusinessStatusIn, ModuleToggle, StatusIn

router = APIRouter(prefix="/superadmin", tags=["superadmin"], dependencies=[Depends(require_superadmin)])


@router.post("/businesses", response_model=BusinessOut, status_code=201)
def create_business(body: BusinessCreate, db: Session = Depends(get_db)):
    user: User = db.info["user"]
    biz = Business(name=body.name.strip(), slug=body.slug, category_id=body.category_id,
                   city=body.city, address=body.address, status="active", created_by=user.id)
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


@router.patch("/businesses/{business_id}/status", status_code=204)
def set_business_status(body: BusinessStatusIn, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    biz = db.get(Business, business_id)
    if biz is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Biznes topilmadi"})
    biz.status = body.status
    db.commit()


@router.put("/businesses/{business_id}/modules/{module_code}", status_code=204)
def toggle_module(body: ModuleToggle, business_id: int = Path(ge=1), module_code: str = Path(max_length=40),
                  db: Session = Depends(get_db)):
    row = db.get(BusinessModule, (business_id, module_code))
    if row is None:
        db.add(BusinessModule(business_id=business_id, module_code=module_code,
                              enabled=body.enabled, expires_at=body.expires_at))
    else:
        row.enabled, row.expires_at = body.enabled, body.expires_at
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
