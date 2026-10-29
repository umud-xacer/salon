from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, get_salon_id, require_admin
import models, schemas

router = APIRouter(prefix="/api/staff", tags=["staff"])


@router.get("/", response_model=list[schemas.StaffOut])
def get_all(salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    q = db.query(models.Staff)
    if salon_id:
        q = q.filter(models.Staff.salon_id == salon_id)
    return q.all()


@router.post("/", response_model=schemas.StaffOut)
def create(item: schemas.StaffCreate, user=Depends(require_admin), db: Session = Depends(get_db)):
    data = item.model_dump()
    data["salon_id"] = user.get("salon_id") or 1
    obj = models.Staff(**data)
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


@router.put("/{id}", response_model=schemas.StaffOut)
def update(id: int, item: schemas.StaffCreate, user=Depends(require_admin), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id")
    q = db.query(models.Staff).filter(models.Staff.id == id)
    if salon_id:
        q = q.filter(models.Staff.salon_id == salon_id)
    obj = q.first()
    if not obj:
        raise HTTPException(404, "Topilmadi")
    for k, v in item.model_dump().items():
        setattr(obj, k, v)
    db.commit(); db.refresh(obj)
    return obj


@router.delete("/{id}")
def delete(id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id")
    q = db.query(models.Staff).filter(models.Staff.id == id)
    if salon_id:
        q = q.filter(models.Staff.salon_id == salon_id)
    obj = q.first()
    if not obj:
        raise HTTPException(404, "Topilmadi")

    db.delete(obj); db.commit()
    return {"ok": True}


# ─── Xodimni o'chirganda uning logini bloklash ─────────────────────────────────
@router.patch("/{id}/block")
def block_staff(id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    """Xodimni arxivlash — login bloklanadi, ma'lumotlar saqlanadi"""
    salon_id = user.get("salon_id")
    obj = db.query(models.Staff).filter(models.Staff.id == id).first()
    if not obj or (salon_id and obj.salon_id != salon_id):
        raise HTTPException(404, "Topilmadi")

    # Users jadvalida bloklash
    u = db.query(models.User).filter(models.User.staff_id == id).first()
    if u:
        u.is_active = False
        db.commit()
        return {"ok": True, "message": f"{obj.name} ning kirish huquqi bloklandi"}
    return {"ok": True, "message": "Xodim bloklandi (login topilmadi)"}


@router.patch("/{id}/unblock")
def unblock_staff(id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    """Xodimni faollashtirish"""
    salon_id = user.get("salon_id")
    obj = db.query(models.Staff).filter(models.Staff.id == id).first()
    if not obj or (salon_id and obj.salon_id != salon_id):
        raise HTTPException(404, "Topilmadi")
    u = db.query(models.User).filter(models.User.staff_id == id).first()
    if u:
        u.is_active = True
        db.commit()
    return {"ok": True, "message": f"{obj.name} ning kirish huquqi tiklandi"}


# ─── Xodim + User bir vaqtda yaratish ─────────────────────────────────────────
from pydantic import BaseModel
from auth import hash_password
import random, string

def _gen_password(length=8):
    chars = string.ascii_letters + string.digits
    return ''.join(random.choices(chars, k=length))

class StaffWithUserCreate(BaseModel):
    # Staff fields
    name:       str
    phone:      str = ""
    role:       str = "Usta"
    percent:    float = 30
    salary:     float = 0
    experience: int = 0
    bio:        str = ""
    skills:     str = ""
    kpi:        float = 80
    start_date: str = ""
    # User fields
    username:   str = ""        # bo'sh bo'lsa avtomatik generatsiya
    password:   str = ""        # bo'sh bo'lsa avtomatik generatsiya
    user_role:  str = "master"  # master | reception

@router.post("/create-with-user")
def create_with_user(
    item: StaffWithUserCreate,
    user=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Xodim + Login bir vaqtda yaratish"""
    salon_id = user.get("salon_id") or 1

    # Username generatsiya
    username = item.username.strip()
    if not username:
        first = item.name.split()[0].lower()
        username = first + str(random.randint(10, 99))

    # Mavjudligini tekshirish
    if db.query(models.User).filter(models.User.username == username).first():
        raise HTTPException(400, f"'{username}' logini allaqachon mavjud. Boshqa nom tanlang.")

    # Parol
    plain_password = item.password.strip() or _gen_password()

    # 1) Staff yaratish
    staff = models.Staff(
        salon_id=salon_id,
        name=item.name,
        phone=item.phone,
        role=item.role,
        percent=item.percent,
        salary=item.salary,
        experience=item.experience,
        bio=item.bio,
        skills=item.skills,
        kpi=item.kpi,
        start_date=item.start_date,
    )
    db.add(staff)
    db.flush()  # ID olish uchun

    # 2) User yaratish
    new_user = models.User(
        salon_id=salon_id,
        username=username,
        password_hash=hash_password(plain_password),
        full_name=item.name,
        role=item.user_role,
        staff_id=staff.id,
        is_active=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(staff)

    return {
        "ok":       True,
        "staff_id": staff.id,
        "staff":    {"id": staff.id, "name": staff.name, "role": staff.role},
        "credentials": {
            "username":  username,
            "password":  plain_password,
            "role":      item.user_role,
            "login_url": "http://localhost:8000/login/",
        },
        "message": f"✅ {item.name} qo'shildi! Login: {username} | Parol: {plain_password}",
    }


@router.get("/{id}/user-info")
def get_staff_user(id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    """Xodimning login ma'lumotlari"""
    u = db.query(models.User).filter(models.User.staff_id == id).first()
    if not u:
        return {"has_account": False}
    return {
        "has_account": True,
        "username":    u.username,
        "role":        u.role,
        "is_active":   u.is_active,
        "user_id":     u.id,
    }

