from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import client_meta, current_user, get_auth_db, get_db
from app.core.config import get_settings
from app.models import User
from app.schemas import (LoginOut, MembershipOut, MeOut, OtpRequest, OtpRequestOut, OtpVerify,
                         PasswordLogin, RefreshIn, SetPasswordIn, TokenOut, UserOut)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _login_out(user: User, tokens: auth_service.TokenPair, is_new: bool = False) -> LoginOut:
    return LoginOut(access_token=tokens.access_token, refresh_token=tokens.refresh_token,
                    expires_in=tokens.expires_in, user=UserOut.model_validate(user), is_new=is_new)


@router.post("/otp/request", response_model=OtpRequestOut)
def otp_request(body: OtpRequest, request: Request, db: Session = Depends(get_auth_db)):
    """SMS kod yuborish. Raqam ro'yxatda bormi-yo'qmi — javob bir xil (raqamlarni aniqlab bo'lmasin)."""
    _, ip = client_meta(request)
    code = auth_service.request_otp(db, body.phone, ip)
    s = get_settings()
    return OtpRequestOut(expires_in=s.otp_ttl_seconds, dev_code=code if s.expose_dev_otp else None)


@router.post("/otp/verify", response_model=LoginOut)
def otp_verify(body: OtpVerify, request: Request, db: Session = Depends(get_auth_db)):
    """Kodni tekshirish. Yangi raqam bo'lsa — mijoz sifatida ro'yxatdan o'tkaziladi."""
    ua, ip = client_meta(request)
    user, tokens, is_new = auth_service.verify_otp(db, body.phone, body.code, body.full_name, ua, ip)
    return _login_out(user, tokens, is_new)


@router.post("/login", response_model=LoginOut)
def login(body: PasswordLogin, request: Request, db: Session = Depends(get_auth_db)):
    """Telefon + parol (veb-admin panel uchun)."""
    ua, ip = client_meta(request)
    user, tokens = auth_service.login_password(db, body.phone, body.password, ua, ip)
    return _login_out(user, tokens)


@router.post("/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_auth_db)):
    ua, ip = client_meta(request)
    t = auth_service.refresh(db, body.refresh_token, ua, ip)
    return TokenOut(access_token=t.access_token, refresh_token=t.refresh_token, expires_in=t.expires_in)


@router.post("/logout", status_code=204)
def logout(body: RefreshIn, db: Session = Depends(get_auth_db)):
    auth_service.logout(db, body.refresh_token)


@router.post("/logout-all", status_code=204)
def logout_all(user: User = Depends(current_user), db: Session = Depends(get_auth_db)):
    auth_service.logout_all(db, user.id)


@router.post("/password", status_code=204)
def set_password(body: SetPasswordIn, user: User = Depends(current_user), db: Session = Depends(get_auth_db)):
    auth_service.set_password(db, user.id, body.old_password, body.new_password)


@router.get("/me", response_model=MeOut)
def me(db: Session = Depends(get_db)):
    """Foydalanuvchi va uning bizneslardagi rollari. Mobil ilova shunga qarab ishchi oynani ochadi."""
    user: User = db.info["user"]
    rows = db.execute(text("""
        SELECT m.id AS member_id, b.id AS business_id, b.name AS business_name,
               b.status::text AS business_status, m.role::text AS role, m.title,
               coalesce((SELECT array_agg(p.code ORDER BY p.code) FROM permissions p
                          WHERE app.has_perm(b.id, p.code)), '{}') AS permissions
          FROM business_members m
          JOIN businesses b ON b.id = m.business_id
         WHERE m.user_id = :uid AND m.is_active
         ORDER BY b.name
    """), {"uid": user.id}).mappings().all()
    memberships = [MembershipOut(**r) for r in rows]
    workspace = "superadmin" if user.is_superadmin else ("business" if memberships else "client")
    return MeOut(user=UserOut.model_validate(user), workspace=workspace, memberships=memberships)
