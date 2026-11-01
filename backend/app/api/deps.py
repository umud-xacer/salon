"""So'rov darajasidagi himoya: token → foydalanuvchi → RLS sessiya → huquq tekshiruvi."""
from collections.abc import Iterator

import jwt
from fastapi import Depends, HTTPException, Path, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import api_session, auth_session
from app.models import User

_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=401,
    detail={"code": "unauthorized", "message": "Kirish talab qilinadi"},
    headers={"WWW-Authenticate": "Bearer"},
)


def get_auth_db() -> Iterator[Session]:
    db = auth_session()
    try:
        yield db
    finally:
        db.close()


def get_public_db() -> Iterator[Session]:
    """Ochiq katalog uchun: foydalanuvchisiz sessiya. Kim so'rasa ham (hatto Super Admin)
    RLS faqat ochiq ma'lumotni beradi — katalog orqali yopiq ma'lumot chiqib ketmaydi."""
    db = api_session(None)
    try:
        yield db
    finally:
        db.close()


# Vaqtinchalik parol bilan kirgan odam faqat shularni ishlata oladi
_PASSWORD_CHANGE_PATHS = ("/api/v1/auth/me", "/api/v1/auth/password", "/api/v1/auth/logout-all")


def get_db(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Iterator[Session]:
    """Tokenni tekshiradi va shu foydalanuvchi nomidan RLS ostidagi sessiya ochadi."""
    if creds is None or creds.scheme.lower() != "bearer":
        raise _UNAUTHORIZED
    try:
        claims = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise _UNAUTHORIZED

    db = api_session(claims.user_id)
    try:
        user = db.get(User, claims.user_id)       # RLS: faqat o'z qatorini ko'radi
        # Bloklangan, o'chirilgan yoki "hamma joydan chiqish" qilgan foydalanuvchi tokeni darhol yaroqsiz
        if user is None or user.status != "active" or user.token_version != claims.token_version:
            raise _UNAUTHORIZED
        if user.must_change_password and request.url.path not in _PASSWORD_CHANGE_PATHS:
            raise HTTPException(403, detail={"code": "password_change_required",
                                             "message": "Avval vaqtinchalik parolni almashtiring"})
        db.info["user"] = user
        yield db
    finally:
        db.close()


def current_user(db: Session = Depends(get_db)) -> User:
    return db.info["user"]


def require_superadmin(user: User = Depends(current_user)) -> User:
    if not user.is_superadmin:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Faqat Super Admin uchun"})
    return user


def require_permission(permission: str):
    """Biznes ichidagi huquq. Yo'lda {business_id} bo'lishi shart.

    Tekshiruv bazadagi app.has_perm() orqali — RLS siyosatlari bilan aynan bir xil qoida:
    rol huquqlari + shaxsiy istisnolar + modul yoqilganligi + biznes/foydalanuvchi holati.
    """
    def dependency(business_id: int = Path(..., ge=1), db: Session = Depends(get_db)) -> int:
        allowed = db.scalar(text("SELECT app.has_perm(:b, :p)"), {"b": business_id, "p": permission})
        if not allowed:
            raise HTTPException(403, detail={"code": "forbidden", "message": "Bu amal uchun huquq yo'q"})
        return business_id
    return dependency


def client_meta(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    if ip == "testclient":
        ip = None
    return request.headers.get("user-agent"), ip
