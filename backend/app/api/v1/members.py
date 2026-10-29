"""Salon egasi: xodimlarni qo'shish va ularga huquq berish.

Ilova tekshiruvi (require_permission) — birinchi qatlam. Ikkinchi qatlam bazada:
RLS siyosatlari va guard_members / guard_member_permissions triggerlari
(o'ziga huquq berish, 'manager'ni egasi bo'lmagan qo'shishi, o'zida yo'q huquqni berish — taqiqlangan).
"""
from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.models import BusinessMember, MemberPermission
from app.schemas import MemberCreate, MemberOut, MemberUpdate, PermissionOverride

router = APIRouter(prefix="/businesses/{business_id}/members", tags=["members"])

_manage = require_permission("staff.manage")


def _get_member(db: Session, business_id: int, member_id: int) -> BusinessMember:
    m = db.scalars(select(BusinessMember).where(BusinessMember.id == member_id,
                                                BusinessMember.business_id == business_id)).first()
    if m is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Xodim topilmadi"})
    return m


@router.get("", response_model=list[MemberOut])
def list_members(business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    return db.scalars(select(BusinessMember).where(BusinessMember.business_id == business_id)
                      .order_by(BusinessMember.id)).all()


@router.post("", response_model=MemberOut, status_code=201)
def add_member(body: MemberCreate, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    user_id = db.scalar(text("SELECT app.ensure_user(:p, :n)"), {"p": body.phone, "n": body.full_name})
    m = BusinessMember(business_id=business_id, user_id=user_id, role=body.role, title=body.title)
    db.add(m)
    db.commit()
    return m


@router.patch("/{member_id}", response_model=MemberOut)
def update_member(body: MemberUpdate, member_id: int = Path(ge=1),
                  business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    m = _get_member(db, business_id, member_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(m, field, value)
    db.commit()
    return m


@router.put("/{member_id}/permissions/{permission_code}", status_code=204)
def override_permission(body: PermissionOverride, member_id: int = Path(ge=1),
                        permission_code: str = Path(max_length=60),
                        business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    _get_member(db, business_id, member_id)
    row = db.get(MemberPermission, (member_id, permission_code))
    if body.granted is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(MemberPermission(member_id=member_id, permission_code=permission_code, granted=body.granted))
    else:
        row.granted = body.granted
    db.commit()
