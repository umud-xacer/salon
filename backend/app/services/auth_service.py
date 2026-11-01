"""Kirish jarayoni. Faqat AuthSession (app_auth roli) bilan ishlaydi."""
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import get_settings
from app.models import OtpCode, RefreshToken, User
from app.services import sms

log = logging.getLogger("auth")


class AuthError(Exception):
    """Mijozga ko'rsatiladigan xato. code — mobil ilova tarjima qilishi uchun."""
    status_code = 401

    def __init__(self, code: str, message: str):
        self.code, self.message = code, message


class RateLimited(AuthError):
    status_code = 429


class Forbidden(AuthError):
    status_code = 403


class SmsUnavailable(AuthError):
    status_code = 503


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ─── OTP ────────────────────────────────────────────────────────────────────
def _create_otp(db: Session, phone: str, ip: str | None) -> str:
    s = get_settings()
    code = security.new_otp_code()
    db.add(OtpCode(
        phone=phone,
        code_hash=security.hash_otp(phone, code),
        ip=ip,
        expires_at=_now() + timedelta(seconds=s.otp_ttl_seconds),
    ))
    try:
        db.commit()
    except DBAPIError as e:
        db.rollback()
        if getattr(e.orig, "sqlstate", None) == "P0429":       # bazadagi otp_rate_limit triggeri
            raise RateLimited("otp_rate_limited", "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring")
        raise
    return code


def _deliver(send, phone: str, code: str) -> None:
    try:
        send(phone, code)
    except sms.SmsError as e:
        log.error("SMS yuborilmadi: %s", e)
        raise SmsUnavailable("sms_unavailable", "SMS yuborib bo'lmadi. Birozdan keyin qayta urinib ko'ring")


def request_otp(db: Session, phone: str, ip: str | None) -> str:
    code = _create_otp(db, phone, ip)
    _deliver(sms.send_otp, phone, code)
    return code


def _consume_otp(db: Session, phone: str, code: str) -> None:
    """Kodni tekshiradi va ishlatilgan deb belgilaydi. Commit chaqiruvchida."""
    s = get_settings()
    otp = db.scalars(
        select(OtpCode)
        .where(OtpCode.phone == phone, OtpCode.used_at.is_(None), OtpCode.expires_at > _now())
        .order_by(OtpCode.created_at.desc())
        .limit(1)
        .with_for_update()
    ).first()
    invalid = AuthError("otp_invalid", "Kod noto'g'ri yoki muddati o'tgan")
    if otp is None or otp.attempts >= s.otp_max_attempts:
        raise invalid
    if not security.otp_matches(phone, code, otp.code_hash):
        otp.attempts += 1
        if otp.attempts >= s.otp_max_attempts:
            otp.used_at = _now()                               # kod yaroqsiz bo'ladi
        db.commit()
        raise invalid
    otp.used_at = _now()


def verify_otp(db: Session, phone: str, code: str, full_name: str | None,
               user_agent: str | None, ip: str | None) -> tuple[User, TokenPair, bool]:
    _consume_otp(db, phone, code)
    user = db.scalars(select(User).where(User.phone == phone).with_for_update()).first()
    is_new = user is None
    if is_new:
        user = User(phone=phone, full_name=(full_name or "").strip()[:120])
        db.add(user)
        db.flush()
    _ensure_can_login(user)
    # Telefon egasi kirdi: boshqa odam bilgan vaqtinchalik parol endi yaroqsiz
    if user.must_change_password:
        user.password_hash = None
        user.must_change_password = False
    user.last_login_at = _now()
    tokens = _issue_tokens(db, user, user_agent=user_agent, ip=ip)
    db.commit()
    return user, tokens, is_new


# ─── Parol bilan kirish (veb-admin) ─────────────────────────────────────────
def login_password(db: Session, phone: str, password: str,
                   user_agent: str | None, ip: str | None) -> tuple[User, TokenPair]:
    s = get_settings()
    invalid = AuthError("invalid_credentials", "Telefon yoki parol noto'g'ri")
    user = db.scalars(select(User).where(User.phone == phone).with_for_update()).first()
    if user is None or user.password_hash is None:
        security.verify_password(password, None)               # vaqt bo'yicha farq qilmasin
        raise invalid
    if user.locked_until and user.locked_until > _now():
        raise RateLimited("account_locked", "Ko'p noto'g'ri urinish. Hisob vaqtincha bloklangan")
    if not security.verify_password(password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= s.login_max_attempts:
            user.locked_until = _now() + timedelta(minutes=s.login_lock_minutes)
            user.failed_login_attempts = 0
        db.commit()
        raise invalid
    _ensure_can_login(user)
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = _now()
    if security.password_needs_rehash(user.password_hash):
        user.password_hash = security.hash_password(password)
    tokens = _issue_tokens(db, user, user_agent=user_agent, ip=ip)
    db.commit()
    return user, tokens


# ─── Refresh token aylanishi (rotation) ─────────────────────────────────────
def refresh(db: Session, raw_token: str, user_agent: str | None, ip: str | None) -> TokenPair:
    invalid = AuthError("refresh_invalid", "Sessiya tugagan, qayta kiring")
    row = db.scalars(
        select(RefreshToken).where(RefreshToken.token_hash == security.hash_token(raw_token)).with_for_update()
    ).first()
    if row is None:
        raise invalid
    if row.revoked_at is not None:
        # Ishlatilgan token qayta keldi — o'g'irlangan bo'lishi mumkin. Butun sessiya zanjiri bekor.
        _revoke_family(db, row.family_id)
        db.commit()
        raise invalid
    if row.expires_at <= _now():
        raise invalid
    user = db.get(User, row.user_id, with_for_update=True)
    _ensure_can_login(user)
    tokens = _issue_tokens(db, user, family_id=row.family_id, user_agent=user_agent, ip=ip, replaces=row)
    db.commit()
    return tokens


def logout(db: Session, raw_token: str) -> None:
    row = db.scalars(select(RefreshToken).where(RefreshToken.token_hash == security.hash_token(raw_token))).first()
    if row is not None:
        _revoke_family(db, row.family_id)
        db.commit()


def logout_all(db: Session, user_id: int) -> None:
    """Barcha qurilmalardan chiqish: access tokenlar ham darhol yaroqsiz (token_version)."""
    db.execute(update(User).where(User.id == user_id).values(token_version=User.token_version + 1))
    db.execute(update(RefreshToken)
               .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now()))
    db.commit()


def set_password(db: Session, user_id: int, old_password: str | None, new_password: str) -> None:
    security.validate_password_strength(new_password)
    user = db.get(User, user_id, with_for_update=True)
    if user.password_hash is not None and not security.verify_password(old_password or "", user.password_hash):
        raise AuthError("invalid_credentials", "Joriy parol noto'g'ri")
    user.password_hash = security.hash_password(new_password)
    user.must_change_password = False
    user.password_changed_at = _now()
    # Parol o'zgardi — boshqa qurilmalardagi sessiyalar bekor
    user.token_version += 1
    db.execute(update(RefreshToken)
               .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now()))
    db.commit()


# ─── Parolni tiklash ────────────────────────────────────────────────────────
def request_password_reset(db: Session, phone: str, ip: str | None) -> str | None:
    """SMS faqat paroli bor foydalanuvchiga ketadi. Super Admin paroli SMS bilan tiklanmaydi (faqat CLI)."""
    user = db.scalars(select(User).where(User.phone == phone)).first()
    if user is None or user.password_hash is None or user.is_superadmin or user.status != "active":
        return None
    code = _create_otp(db, phone, ip)
    _deliver(sms.send_password_reset, phone, code)
    return code


def reset_password(db: Session, phone: str, code: str, new_password: str) -> None:
    _consume_otp(db, phone, code)
    user = db.scalars(select(User).where(User.phone == phone).with_for_update()).first()
    if user is None or user.password_hash is None or user.is_superadmin:
        raise AuthError("otp_invalid", "Kod noto'g'ri yoki muddati o'tgan")
    _ensure_can_login(user)
    user.password_hash = security.hash_password(new_password)
    user.must_change_password = False
    user.password_changed_at = _now()
    user.failed_login_attempts = 0
    user.locked_until = None
    user.token_version += 1
    db.execute(update(RefreshToken)
               .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now()))
    db.commit()


# ─── Ichki yordamchilar ─────────────────────────────────────────────────────
def _ensure_can_login(user: User) -> None:
    if user.status != "active":
        raise Forbidden("user_blocked", "Hisobingiz bloklangan")


def _issue_tokens(db: Session, user: User, *, user_agent: str | None, ip: str | None,
                  family_id: uuid.UUID | None = None, replaces: RefreshToken | None = None) -> TokenPair:
    raw = security.new_refresh_token()
    row = RefreshToken(
        user_id=user.id,
        family_id=family_id or uuid.uuid4(),
        token_hash=security.hash_token(raw),
        user_agent=(user_agent or "")[:200] or None,
        ip=ip,
        expires_at=_now() + timedelta(days=get_settings().refresh_token_days),
    )
    db.add(row)
    db.flush()
    if replaces is not None:
        replaces.revoked_at = _now()
        replaces.replaced_by = row.id
    access, ttl = security.create_access_token(user.id, user.token_version)
    return TokenPair(access_token=access, refresh_token=raw, expires_in=ttl)


def _revoke_family(db: Session, family_id: uuid.UUID) -> None:
    db.execute(update(RefreshToken)
               .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now()))
