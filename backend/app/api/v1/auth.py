from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.panels import check_panel
from app.api.deps import client_meta, current_user, get_auth_db, get_db
from app.core.config import get_settings
from app.models import User
from app.schemas import (GoogleLoginIn, GoogleLoginOut, LoginOut, MembershipOut, MeOut, OtpRequest, OtpRequestOut,
                         OtpVerify, PasswordForgot, PasswordLogin, PasswordReset, PhoneConfirm, ProfileUpdate, RefreshIn,
                         SetPasswordIn, TelegramPollIn, TelegramPollOut, TelegramStartIn, TelegramStartOut,
                         TokenOut, UserOut)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _login_out(user: User, tokens: auth_service.TokenPair, is_new: bool = False) -> LoginOut:
    return LoginOut(access_token=tokens.access_token, refresh_token=tokens.refresh_token,
                    expires_in=tokens.expires_in, user=UserOut.model_validate(user), is_new=is_new)


@router.post("/otp/request", response_model=OtpRequestOut)
def otp_request(body: OtpRequest, request: Request, db: Session = Depends(get_auth_db)):
    """SMS kod yuborish. Raqam ro'yxatda bormi-yo'qmi — javob bir xil (raqamlarni aniqlab bo'lmasin)."""
    _, ip = client_meta(request)
    code, channel = auth_service.request_otp(db, body.phone, ip)
    s = get_settings()
    return OtpRequestOut(expires_in=s.otp_ttl_seconds, channel=channel, dev_code=code if s.expose_dev_otp else None)


@router.post("/otp/verify", response_model=LoginOut)
def otp_verify(body: OtpVerify, request: Request, db: Session = Depends(get_auth_db)):
    """Kodni tekshirish. Yangi raqam bo'lsa — mijoz sifatida ro'yxatdan o'tkaziladi."""
    ua, ip = client_meta(request)
    user, tokens, is_new = auth_service.verify_otp(db, body.phone, body.code, body.full_name, ua, ip,
                                                   birth_date=body.birth_date, gender=body.gender,
                                                   password=body.password, link_token=body.link_token)
    check_panel(request, user.is_superadmin)
    return _login_out(user, tokens, is_new)


@router.post("/telegram/start", response_model=TelegramStartOut)
def telegram_start(body: TelegramStartIn, request: Request, db: Session = Depends(get_auth_db)):
    """Telegram orqali kirish: ilova qaytgan havolani ochadi, bot raqamni tasdiqlaydi, so'ng /telegram/poll."""
    _, ip = client_meta(request)
    nonce, ttl = auth_service.telegram_start(db, ip, body.link_token)
    bot = get_settings().telegram_bot_username
    return TelegramStartOut(nonce=nonce, url=f"https://t.me/{bot}?start={nonce}", expires_in=ttl)


@router.post("/telegram/poll", response_model=TelegramPollOut)
def telegram_poll(body: TelegramPollIn, request: Request, db: Session = Depends(get_auth_db)):
    ua, ip = client_meta(request)
    res = auth_service.telegram_poll(db, body.nonce, ua, ip, panel=body.panel)
    if res is None:
        return TelegramPollOut(status="pending")
    user, tokens, is_new = res
    check_panel(request, user.is_superadmin)
    return TelegramPollOut(status="ok", login=_login_out(user, tokens, is_new))


@router.post("/google", response_model=GoogleLoginOut)
def google_login(body: GoogleLoginIn, request: Request, db: Session = Depends(get_auth_db)):
    """Google ID token. Hisob bog'lanmagan bo'lsa — need_phone + link_token (raqam bir marta tasdiqlanadi)."""
    ua, ip = client_meta(request)
    res = auth_service.google_login(db, body.id_token, ua, ip, panel=body.panel)
    if isinstance(res, str):
        return GoogleLoginOut(need_phone=True, link_token=res)
    user, tokens = res
    check_panel(request, user.is_superadmin)
    return GoogleLoginOut(login=_login_out(user, tokens))


@router.delete("/me", status_code=204)
def delete_me(db: Session = Depends(get_db)):
    """Hisobni o'chirish (Google Play talabi): shaxsiy ma'lumot tozalanadi, kelgusi bronlar bekor qilinadi.
    Salon xodimi/direktori hisobi bu yerdan o'chirilmaydi (P0450)."""
    db.execute(text("SELECT app.delete_my_account()"))
    db.commit()


@router.post("/login", response_model=LoginOut)
def login(body: PasswordLogin, request: Request, db: Session = Depends(get_auth_db)):
    """Telefon + parol (veb-admin panel uchun)."""
    ua, ip = client_meta(request)
    user, tokens = auth_service.login_password(db, body.phone, body.password, ua, ip, link_token=body.link_token)
    check_panel(request, user.is_superadmin)        # noto'g'ri panel — tokenlar berilmaydi
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


@router.post("/password/forgot", response_model=OtpRequestOut)
def password_forgot(body: PasswordForgot, request: Request, db: Session = Depends(get_auth_db)):
    """Tiklash kodi SMS bilan. Raqam ro'yxatda bormi-yo'qmi — javob bir xil."""
    _, ip = client_meta(request)
    code = auth_service.request_password_reset(db, body.phone, ip)
    s = get_settings()
    return OtpRequestOut(expires_in=s.otp_ttl_seconds, dev_code=code if s.expose_dev_otp else None)


@router.post("/password/reset", status_code=204)
def password_reset(body: PasswordReset, db: Session = Depends(get_auth_db)):
    """Yangi parol. Barcha qurilmalardagi sessiyalar bekor qilinadi."""
    auth_service.reset_password(db, body.phone, body.code, body.new_password)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, db: Session = Depends(get_db)):
    """O'z profilini tahrirlash. Telefon bu yerda o'zgarmaydi: u kirish uchun tasdiqlangan."""
    user: User = db.info["user"]
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "full_name":
            value = (value or "").strip()
            if len(value) < 2:
                raise HTTPException(422, detail={"code": "invalid_name", "message": "Ismni kiriting"})
        if field == "language" and value is None:
            continue
        if field == "backup_phone" and value == user.phone:
            raise _SAME_PHONE
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


_SAME_PHONE = HTTPException(422, detail={"code": "backup_same_as_phone",
                                         "message": "Zaxira raqam asosiy raqamdan farq qilishi kerak"})


@router.post("/me/confirm-phone", response_model=UserOut)
def confirm_phone(body: PhoneConfirm, db: Session = Depends(get_db)):
    """Bron oldidan: "raqamim hamon shu" (053). Ilova oxirgi tasdiqdan 7 kun o'tsa so'raydi.
    Xohlasa zaxira raqamni ham shu yerda qo'shadi/yangilaydi (bo'sh yuborilsa — o'zgarmaydi)."""
    user: User = db.info["user"]
    if body.backup_phone is not None:
        if body.backup_phone == user.phone:
            raise _SAME_PHONE
        user.backup_phone = body.backup_phone
    user.phone_confirmed_at = db.scalar(text("SELECT now()"))
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/me", response_model=MeOut)
def me(db: Session = Depends(get_db)):
    """Foydalanuvchi va uning bizneslardagi rollari. Mobil ilova shunga qarab ishchi oynani ochadi."""
    user: User = db.info["user"]
    rows = db.execute(text("""
        SELECT m.id AS member_id, b.id AS business_id, b.name AS business_name, b.slug AS business_slug,
               (SELECT c.kind FROM business_categories c WHERE c.id = b.category_id) AS business_kind,
               (SELECT c.staff_titles FROM business_categories c WHERE c.id = b.category_id) AS staff_titles,
               (SELECT c.name_uz FROM business_categories c WHERE c.id = b.category_id) AS business_type_name,
               (SELECT c.name_ru FROM business_categories c WHERE c.id = b.category_id) AS business_type_name_ru,
               (SELECT c.staff_word FROM business_categories c WHERE c.id = b.category_id) AS staff_word,
               b.status::text AS business_status, b.is_active AS business_active, b.subscription_ends_at,
               b.parent_id, app.chain_id(b.parent_id, b.id) AS chain_id, b.branch_name,
               app.has_reception(b.id) AS has_reception,
               (SELECT ch.name FROM businesses ch WHERE ch.id = app.chain_id(b.parent_id, b.id)) AS chain_name,
               app.business_operational(b.id) AS operational, m.role::text AS role,
               CASE WHEN m.role = 'staff' THEN 'staff' ELSE 'admin' END AS panel, m.title,
               coalesce((SELECT array_agg(x.code ORDER BY x.code) FROM modules x
                          WHERE app.module_enabled(b.id, x.code)), '{}') AS modules,
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
