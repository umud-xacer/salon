"""
Auth Router: Login, token yangilash, parol o'zgartirish
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from database import get_db
from auth import hash_password, verify_password, create_token, get_current_user, ROLE_REDIRECTS
import models

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Tizimga kirish — JWT token qaytaradi."""
    user = db.query(models.User).filter(models.User.username == form.username).first()

    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Login yoki parol noto'g'ri")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Akkaunt bloklangan")

    # Salon aktiv ekanligini tekshirish (superadmin uchun shart emas)
    if user.salon_id and user.role != "superadmin":
        salon = db.query(models.Salon).filter(models.Salon.id == user.salon_id).first()
        if not salon:
            raise HTTPException(status_code=404, detail="Salon topilmadi")
        if not salon.is_active:
            raise HTTPException(status_code=403, detail="Saloningiz vaqtincha bloklangan. Admin bilan bog'laning.")

    token = create_token({
        "user_id":  user.id,
        "salon_id": user.salon_id,
        "role":     user.role,
        "staff_id": user.staff_id,
        "username": user.username,
        "full_name": user.full_name,
    })

    # Aktivlik logiga yozish
    try:
        log = models.ActivityLog(
            salon_id=user.salon_id,
            user_id=user.id,
            username=user.username,
            full_name=user.full_name or "",
            role=user.role,
            action="login",
            entity_type="session",
            description=f"{user.full_name or user.username} tizimga kirdi ({user.role})",
        )
        db.add(log)
        db.commit()
    except Exception:
        pass

    return {
        "access_token": token,
        "token_type":   "bearer",
        "role":         user.role,
        "salon_id":     user.salon_id,
        "staff_id":     user.staff_id,
        "full_name":    user.full_name,
        "redirect":     ROLE_REDIRECTS.get(user.role, "/"),
    }


@router.post("/logout")
def logout(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Tizimdan chiqish — aktivlik logiga yozadi."""
    try:
        log = models.ActivityLog(
            salon_id=user.get("salon_id"),
            user_id=user.get("user_id"),
            username=user.get("username", ""),
            full_name=user.get("full_name", ""),
            role=user.get("role", ""),
            action="logout",
            entity_type="session",
            description=f"{user.get('full_name', user.get('username', ''))} tizimdan chiqdi ({user.get('role', '')})",
        )
        db.add(log)
        db.commit()
    except Exception:
        pass
    return {"ok": True, "message": "Tizimdan muvaffaqiyatli chiqdingiz"}


@router.get("/verify")
def verify_token(user: dict = Depends(get_current_user)):
    """Token yaroqliligini tekshirish — Protected Routes uchun."""
    return {
        "valid": True,
        "user_id": user.get("user_id"),
        "role": user.get("role"),
        "salon_id": user.get("salon_id"),
    }


@router.get("/me")
def me(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """Joriy foydalanuvchi ma'lumotlari."""
    return {
        "user_id":  user["user_id"],
        "salon_id": user.get("salon_id"),
        "role":     user["role"],
        "staff_id": user.get("staff_id"),
        "username": user.get("username"),
        "full_name": user.get("full_name"),
    }


@router.post("/change-password")
def change_password(
    old_password: str,
    new_password: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db_user = db.query(models.User).filter(models.User.id == user["user_id"]).first()
    if not db_user or not verify_password(old_password, db_user.password_hash):
        raise HTTPException(status_code=400, detail="Eski parol noto'g'ri")
    db_user.password_hash = hash_password(new_password)
    db.commit()
    return {"ok": True, "message": "Parol muvaffaqiyatli o'zgartirildi"}
