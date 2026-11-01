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
from app.core.security import hash_password
from app.schemas import (MemberCreate, MemberOut, MemberPasswordIn, MemberPermissionOut, MemberUpdate,
                         PermissionOverride)
from app.schemas.catalog import MemberServiceIn, MemberServicesReplace
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}/members", tags=["members"])

_manage = require_permission("staff.manage")


def _get_member(db: Session, business_id: int, member_id: int) -> BusinessMember:
    m = db.scalars(select(BusinessMember).where(BusinessMember.id == member_id,
                                                BusinessMember.business_id == business_id)).first()
    if m is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Xodim topilmadi"})
    return m


_MEMBER_SELECT = """
    SELECT m.id, m.user_id, m.role::text AS role, u.full_name, u.phone, m.title, m.is_active, m.is_bookable,
           app.password_block_reason(m.business_id, m.id) AS password_block,
           CASE WHEN u.password_hash IS NULL THEN 'none' WHEN u.must_change_password THEN 'temporary' ELSE 'own' END AS password_status,
           u.password_changed_at
      FROM business_members m JOIN users u ON u.id = m.user_id
"""


def _member_out(db: Session, member_id: int) -> MemberOut:
    return MemberOut(**db.execute(text(f"{_MEMBER_SELECT} WHERE m.id = :id"), {"id": member_id}).mappings().one())


@router.get("", response_model=list[MemberOut])
def list_members(business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    rows = db.execute(text(f"{_MEMBER_SELECT} WHERE m.business_id = :b ORDER BY m.is_active DESC, u.full_name"),
                      {"b": business_id}).mappings()
    return [MemberOut(**r) for r in rows]


@router.post("", response_model=MemberOut, status_code=201)
def add_member(body: MemberCreate, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    user_id = db.scalar(text("SELECT app.ensure_user(:p, :n)"), {"p": body.phone, "n": body.full_name})
    # Kassir va menejer mijoz qabul qilmaydi: kerak bo'lsa, keyin yoqiladi
    m = BusinessMember(business_id=business_id, user_id=user_id, role=body.role, title=body.title,
                       is_bookable=body.role == "staff")
    db.add(m)
    db.flush()
    audit.log(db, business_id, "create", "member", m.id, {"role": body.role})
    db.commit()
    return _member_out(db, m.id)


@router.patch("/{member_id}", response_model=MemberOut)
def update_member(body: MemberUpdate, member_id: int = Path(ge=1),
                  business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    m = _get_member(db, business_id, member_id)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(m, field, value)
    audit.log(db, business_id, "update", "member", member_id, changes)
    db.commit()
    return _member_out(db, member_id)


@router.post("/{member_id}/password", status_code=204)
def set_member_password(body: MemberPasswordIn, business_id: int = Path(ge=1), member_id: int = Path(ge=1),
                        db: Session = Depends(get_db)):
    """Direktor o'z xodimiga, Super Admin istalgan direktor va xodimga. Kim kimga mumkinligini baza hal qiladi."""
    db.execute(text("SELECT app.set_member_password(:b, :m, :h)"),
               {"b": business_id, "m": member_id, "h": hash_password(body.new_password)})
    db.commit()


@router.get("/{member_id}/services", response_model=list[MemberServiceIn])
def get_member_services(member_id: int = Path(ge=1), business_id: int = Depends(_manage),
                        db: Session = Depends(get_db)):
    _get_member(db, business_id, member_id)
    rows = db.execute(text("SELECT service_id, custom_price, custom_duration FROM member_services "
                           "WHERE member_id = :m ORDER BY service_id"), {"m": member_id}).mappings()
    return [MemberServiceIn(**r) for r in rows]


@router.put("/{member_id}/services", response_model=list[MemberServiceIn])
def replace_member_services(body: MemberServicesReplace, member_id: int = Path(ge=1),
                            business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    """Usta bajaradigan xizmatlar (va unga xos narx/davomiylik). Boshqa salon xizmatini
    biriktirib bo'lmaydi — kompozit FK (business_id, service_id) rad etadi."""
    _get_member(db, business_id, member_id)
    db.execute(text("DELETE FROM member_services WHERE member_id = :m AND business_id = :b"),
               {"m": member_id, "b": business_id})
    for s in body.services:
        db.execute(text("INSERT INTO member_services (business_id, member_id, service_id, custom_price, custom_duration) "
                        "VALUES (:b, :m, :s, :p, :d)"),
                   {"b": business_id, "m": member_id, "s": s.service_id, "p": s.custom_price, "d": s.custom_duration})
    audit.log(db, business_id, "update", "member_services", member_id, {"services": [s.model_dump() for s in body.services]})
    db.commit()
    return body.services


@router.get("/{member_id}/permissions", response_model=list[MemberPermissionOut])
def member_permissions(member_id: int = Path(ge=1), business_id: int = Depends(_manage),
                       db: Session = Depends(get_db)):
    """Barcha huquqlar: rol standarti, shaxsiy istisno va amaldagi natija."""
    m = _get_member(db, business_id, member_id)
    rows = db.execute(text("""
        SELECT p.code, p.description, p.module_code,
               app.module_enabled(:b, p.module_code) AS module_enabled,
               rp.role IS NOT NULL AS role_default,
               mp.granted AS override
          FROM permissions p
          LEFT JOIN role_permissions rp ON rp.permission_code = p.code AND rp.role = :role
          LEFT JOIN member_permissions mp ON mp.permission_code = p.code AND mp.member_id = :m
         ORDER BY p.module_code NULLS FIRST, p.code
    """), {"b": business_id, "m": member_id, "role": m.role}).mappings()
    return [MemberPermissionOut(**r, effective=r["module_enabled"] and
                                (r["role_default"] if r["override"] is None else r["override"])) for r in rows]


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
    audit.log(db, business_id, "permission", "member", member_id,
              {"permission": permission_code, "granted": body.granted})
    db.commit()
