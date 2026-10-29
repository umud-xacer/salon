"""
SuperAdmin Router — Barcha salonlarni boshqarish
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date
from database import get_db
from auth import require_superadmin, hash_password, create_token
import models
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/superadmin", tags=["superadmin"])


class SalonCreate(BaseModel):
    name: str
    owner_name: str
    phone: str
    address: str = ""
    plan: str = "basic"
    admin_username: str
    admin_password: str
    expires_at: Optional[str] = None
    parent_id: Optional[int] = None


class SalonUpdate(BaseModel):
    name: Optional[str] = None
    owner_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    plan: Optional[str] = None
    is_active: Optional[bool] = None
    expires_at: Optional[str] = None
    work_hours: Optional[str] = None
    bot_token: Optional[str] = None
    admin_chat_id: Optional[str] = None
    parent_id: Optional[int] = None


class ResetPasswordRequest(BaseModel):
    user_id: int
    new_password: str


# ─── Statistika ────────────────────────────────────────────────────────────────
@router.get("/stats")
def get_stats(user=Depends(require_superadmin), db: Session = Depends(get_db)):
    total_salons  = db.query(models.Salon).count()
    active_salons = db.query(models.Salon).filter(models.Salon.is_active == True).count()
    total_masters = db.query(models.Staff).count()
    total_clients = db.query(models.Client).count()
    total_appts   = db.query(models.Appointment).count()
    total_users   = db.query(models.User).count()
    return {
        "total_salons":  total_salons,
        "active_salons": active_salons,
        "blocked_salons": total_salons - active_salons,
        "total_masters": total_masters,
        "total_clients": total_clients,
        "total_appointments": total_appts,
        "total_users": total_users,
    }


# ─── Barcha Salonlar ───────────────────────────────────────────────────────────
@router.get("/salons")
def get_salons(
    status: Optional[str] = None,    # active | blocked | expiring
    plan: Optional[str] = None,      # basic | pro | enterprise
    search: Optional[str] = None,    # salon nomi yoki telefon
    user=Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    from datetime import date, timedelta
    q = db.query(models.Salon)
    if status == "active": q = q.filter(models.Salon.is_active == True)
    elif status == "blocked": q = q.filter(models.Salon.is_active == False)
    elif status == "expiring":
        warn3 = str(date.today() + timedelta(days=3))
        q = q.filter(models.Salon.is_active == True, models.Salon.expires_at != None, models.Salon.expires_at <= warn3)
    if plan: q = q.filter(models.Salon.plan == plan)
    if search:
        q = q.filter((models.Salon.name.ilike(f"%{search}%")) | (models.Salon.phone.ilike(f"%{search}%")))
    salons = q.order_by(models.Salon.id.desc()).all()
    today = date.today()
    result = []
    for s in salons:
        parent = db.query(models.Salon).filter(models.Salon.id == s.parent_id).first() if s.parent_id else None
        branch_count = db.query(models.Salon).filter(models.Salon.parent_id == s.id).count()
        master_count = db.query(models.Staff).filter(models.Staff.salon_id == s.id).count()
        client_count = db.query(models.Client).filter(models.Client.salon_id == s.id).count()
        appt_count   = db.query(models.Appointment).filter(models.Appointment.salon_id == s.id).count()
        admin_user   = db.query(models.User).filter(
            models.User.salon_id == s.id, models.User.role == "admin"
        ).first()
        days_left = None
        if s.expires_at:
            try: days_left = (date.fromisoformat(s.expires_at) - today).days
            except: pass
        result.append({
            "id": s.id, "name": s.name, "slug": s.slug,
            "parent_id": s.parent_id,
            "is_branch": bool(s.parent_id),
            "parent_name": parent.name if parent else "",
            "branch_count": branch_count,
            "owner_name": s.owner_name, "phone": s.phone,
            "address": s.address or "", "plan": s.plan,
            "work_hours": s.work_hours or "09:00-20:00",
            "bot_token": s.bot_token or "",
            "admin_chat_id": s.admin_chat_id or "",
            "is_active": s.is_active,
            "block_reason": s.block_reason or "",
            "expires_at": s.expires_at or "",
            "days_left": days_left,
            "created_at": str(s.created_at)[:10] if s.created_at else "",
            "master_count": master_count,
            "client_count": client_count,
            "appointment_count": appt_count,
            "admin_username": admin_user.username if admin_user else "—",
            "admin_user_id": admin_user.id if admin_user else None,
        })
    return result


# ─── Yangi Salon Yaratish ──────────────────────────────────────────────────────
@router.post("/salons")
def create_salon(data: SalonCreate, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    slug = data.name.lower().replace(" ", "-").replace("'", "")
    if db.query(models.Salon).filter(models.Salon.slug == slug).first():
        slug = f"{slug}-{db.query(models.Salon).count() + 1}"
    if db.query(models.User).filter(models.User.username == data.admin_username).first():
        raise HTTPException(400, f"'{data.admin_username}' username band")
    salon = models.Salon(
        name=data.name, slug=slug,
        owner_name=data.owner_name, phone=data.phone,
        address=data.address, plan=data.plan,
        is_active=True, expires_at=data.expires_at, parent_id=data.parent_id,
    )
    db.add(salon); db.flush()
    admin = models.User(
        salon_id=salon.id,
        username=data.admin_username,
        password_hash=hash_password(data.admin_password),
        full_name=data.owner_name,
        role="admin", is_active=True,
    )
    db.add(admin)
    db.commit(); db.refresh(salon)
    return {
        "ok": True, "salon_id": salon.id, "salon_name": salon.name,
        "admin_login": data.admin_username,
        "message": f"✅ '{salon.name}' saloni muvaffaqiyatli yaratildi!",
    }


# ─── Salonni Yangilash (Kengaytirilgan) ──────────────────────────────────────
@router.patch("/salons/{salon_id}")
def update_salon(salon_id: int, data: SalonUpdate, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    salon = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
    if not salon:
        raise HTTPException(404, "Salon topilmadi")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(salon, k, v)
    db.commit()
    return {"ok": True, "message": f"'{salon.name}' saloni yangilandi ✅"}


# ─── Bloklash / Faollashtirish ────────────────────────────────────────────────
@router.patch("/salons/{salon_id}/toggle")
def toggle_salon(salon_id: int, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    salon = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
    if not salon:
        raise HTTPException(404, "Salon topilmadi")
    salon.is_active = not salon.is_active
    db.commit()
    status = "faollashtirildi" if salon.is_active else "bloklandi"
    return {"ok": True, "is_active": salon.is_active, "message": f"Salon {status}"}


# ─── Salon Foydalanuvchilari ──────────────────────────────────────────────────
@router.get("/salons/{salon_id}/users")
def get_salon_users(salon_id: int, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    users = db.query(models.User).filter(models.User.salon_id == salon_id).all()
    return [{
        "id": u.id, "username": u.username, "role": u.role,
        "full_name": u.full_name, "is_active": u.is_active,
        "staff_id": u.staff_id,
    } for u in users]


# ─── SuperAdmin: Parolni Yangilash ────────────────────────────────────────────
@router.post("/reset-password")
def reset_password(data: ResetPasswordRequest, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    """SuperAdmin istalgan foydalanuvchi parolini o'zgartira oladi."""
    target = db.query(models.User).filter(models.User.id == data.user_id).first()
    if not target:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    if target.role == "superadmin":
        raise HTTPException(403, "SuperAdmin parolini bu yerda o'zgartira olmaysiz")
    if len(data.new_password) < 6:
        raise HTTPException(400, "Parol kamida 6 belgi bo'lishi kerak")
    target.password_hash = hash_password(data.new_password)
    db.commit()
    log = models.ActivityLog(
        salon_id=target.salon_id,
        user_id=user.get("user_id"),
        username=user.get("username", "superadmin"),
        full_name=user.get("full_name", "SuperAdmin"),
        role="superadmin",
        action="update",
        entity_type="user_password",
        entity_id=target.id,
        description=f"SuperAdmin '{target.username}' ({target.role}) parolini yangiladi",
    )
    db.add(log); db.commit()
    return {"ok": True, "message": f"✅ {target.full_name or target.username} paroli yangilandi"}


# ─── Login As Salon ───────────────────────────────────────────────────────────
@router.post("/login-as/{salon_id}")
def login_as_salon(salon_id: int, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    """SuperAdmin sifatida salon admin tokeni olish."""
    salon = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
    if not salon:
        raise HTTPException(404, "Salon topilmadi")
    admin_user = db.query(models.User).filter(
        models.User.salon_id == salon_id, models.User.role == "admin"
    ).first()
    if not admin_user:
        raise HTTPException(404, "Bu salonda admin topilmadi")
    token = create_token({
        "user_id": admin_user.id,
        "salon_id": salon_id,
        "role": "admin",
        "username": admin_user.username,
        "full_name": admin_user.full_name,
        "staff_id": None,
    })
    log = models.ActivityLog(
        salon_id=salon_id,
        user_id=user.get("user_id"),
        username="superadmin",
        full_name=user.get("full_name", "SuperAdmin"),
        role="superadmin",
        action="login",
        entity_type="login_as_salon",
        description=f"SuperAdmin '{salon.name}' saloniga kirdi (admin: {admin_user.username})",
    )
    db.add(log); db.commit()
    return {
        "ok": True,
        "access_token": token,
        "salon_name": salon.name,
        "admin_username": admin_user.username,
        "full_name": admin_user.full_name,
        "message": f"✅ '{salon.name}' saloniga kirildi",
    }


# ─── Yangi User Yaratish ─────────────────────────────────────────────────────
@router.post("/salons/{salon_id}/users")
def create_user(salon_id: int, username: str, password: str, role: str, full_name: str = "",
                staff_id: int = None, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == username).first():
        raise HTTPException(400, f"'{username}' allaqachon mavjud")
    new_user = models.User(
        salon_id=salon_id, username=username,
        password_hash=hash_password(password),
        full_name=full_name, role=role,
        staff_id=staff_id, is_active=True,
    )
    db.add(new_user); db.commit()
    return {"ok": True, "message": f"'{username}' ({role}) muvaffaqiyatli yaratildi"}


@router.get("/transactions/report")
def get_transactions_report(
    months: int = 6,
    parent_id: Optional[int] = None,
    plan: Optional[str] = None,
    active_only: bool = False,
    search: Optional[str] = None,
    user=Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """
    SuperAdmin uchun barcha salonlar bo'yicha oyma-oy tushum va obuna holati.
    parent_id bo'lsa filial, parent salon bilan birga ko'rsatiladi.
    """
    if months < 1:
        months = 1
    if months > 24:
        months = 24

    now = date.today()
    month_keys = []
    y, m = now.year, now.month
    for _ in range(months):
        month_keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    month_keys.reverse()

    q = db.query(models.Salon)
    if parent_id is not None:
        if parent_id == 0:
            q = q.filter(models.Salon.parent_id == None)
        else:
            q = q.filter(models.Salon.parent_id == parent_id)
    if plan:
        q = q.filter(models.Salon.plan == plan)
    if active_only:
        q = q.filter(models.Salon.is_active == True)
    if search:
        q = q.filter(
            (models.Salon.name.ilike(f"%{search}%"))
            | (models.Salon.phone.ilike(f"%{search}%"))
            | (models.Salon.owner_name.ilike(f"%{search}%"))
        )
    salons = q.order_by(models.Salon.id.asc()).all()
    report = []
    for salon in salons:
        parent = db.query(models.Salon).filter(models.Salon.id == salon.parent_id).first() if salon.parent_id else None
        txns = db.query(models.Transaction).filter(
            models.Transaction.salon_id == salon.id,
            models.Transaction.status == "completed",
        ).all()

        monthly_map = {k: 0.0 for k in month_keys}
        for t in txns:
            created = str(t.created_at)[:7] if t.created_at else ""
            if created in monthly_map:
                monthly_map[created] += float(t.amount or 0)

        report.append({
            "salon_id": salon.id,
            "salon_name": salon.name,
            "owner_name": salon.owner_name,
            "is_branch": bool(salon.parent_id),
            "parent_id": salon.parent_id,
            "parent_name": parent.name if parent else "",
            "plan": salon.plan,
            "is_active": salon.is_active,
            "expires_at": salon.expires_at or "",
            "monthly_revenue": [{"month": k, "amount": round(v, 2)} for k, v in monthly_map.items()],
            "total_revenue": round(sum(monthly_map.values()), 2),
        })

    return {
        "months": month_keys,
        "count": len(report),
        "rows": report,
    }
