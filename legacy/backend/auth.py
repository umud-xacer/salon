"""
JWT Authentication va Role-based access control
"""
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
from pathlib import Path
import os

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

SECRET_KEY         = os.getenv("SECRET_KEY", "dev-only-change-me")
ALGORITHM          = "HS256"
TOKEN_EXPIRE_HOURS = 8

# bcrypt versiya muammosini hal qilish
try:
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    pwd_context.hash("test_check")
except Exception:
    pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token yaroqsiz yoki muddati o'tgan")


# ─── Dependency: Joriy foydalanuvchi ───────────────────────────────────────────
def get_current_user(token: str = Depends(oauth2_scheme)):
    if not token:
        raise HTTPException(status_code=401, detail="Kirish uchun login qiling")
    return decode_token(token)


# ─── Dependency: salon_id filtri ───────────────────────────────────────────────
def get_salon_id(user: dict = Depends(get_current_user)):
    if user.get("role") == "superadmin":
        return None
    return user.get("salon_id")


# ─── Role tekshiruvlari ────────────────────────────────────────────────────────
def require_superadmin(user: dict = Depends(get_current_user)):
    if user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Faqat SuperAdmin uchun")
    return user


def require_admin(user: dict = Depends(get_current_user)):
    if user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin huquqi kerak")
    return user


def require_reception_or_above(user: dict = Depends(get_current_user)):
    if user.get("role") not in ("reception", "admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Ruxsat yo'q")
    return user


def require_master(user: dict = Depends(get_current_user)):
    if user.get("role") not in ("master", "admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Usta huquqi kerak")
    return user


def is_admin(user: dict) -> bool:
    return user.get("role") in ("admin", "superadmin")


def check_same_salon(user: dict, salon_id):
    """Obyekt foydalanuvchining saloniga tegishli bo'lmasa — 404 (boshqa salon ma'lumoti ko'rinmasin)."""
    if user.get("role") == "superadmin":
        return
    if salon_id != user.get("salon_id"):
        raise HTTPException(status_code=404, detail="Topilmadi")


# ─── Redirect manzillari ──────────────────────────────────────────────────────
ROLE_REDIRECTS = {
    "superadmin": "/superadmin/",
    "admin":      "/",
    "reception":  "/reception/",
    "master":     "/ustalar/",
}


# ─── Obuna tekshiruvi (admin panellar uchun) ─────────────────────────────────
def check_salon_active(user: dict = Depends(get_current_user)):
    """Salon obunasi faolligini tekshiradi. SuperAdmin cheklanmaydi."""
    if user.get("role") == "superadmin":
        return user
    salon_id = user.get("salon_id")
    if not salon_id:
        return user
    from database import SessionLocal
    import models
    from datetime import date
    db = SessionLocal()
    try:
        salon = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
        if salon and not salon.is_active:
            raise HTTPException(
                status_code=403,
                detail="subscription_expired"
            )
        if salon and salon.expires_at:
            try:
                if date.fromisoformat(salon.expires_at) < date.today():
                    salon.is_active = False
                    salon.block_reason = "Obuna muddati tugagan"
                    db.commit()
                    raise HTTPException(status_code=403, detail="subscription_expired")
            except ValueError:
                pass
    finally:
        db.close()
    return user
