"""Parol, JWT, refresh token va OTP bilan ishlash."""
import hashlib
import hmac
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

_hasher = PasswordHasher()  # argon2id, kutubxonaning tavsiya etilgan parametrlari
# Foydalanuvchi topilmaganda ham bir xil vaqt sarflash uchun (login orqali raqam mavjudligini bilib bo'lmasin)
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))

PHONE_RE = re.compile(r"^\+998\d{9}$")


# ─── Telefon ────────────────────────────────────────────────────────────────
def normalize_phone(raw: str) -> str:
    """'90 123-45-67', '998901234567', '+998 90 123 45 67' → '+998901234567'."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 9:
        digits = "998" + digits
    phone = "+" + digits
    if not PHONE_RE.match(phone):
        raise ValueError("Telefon raqami noto'g'ri. Namuna: +998901234567")
    return phone


# ─── Parol ──────────────────────────────────────────────────────────────────
def validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise ValueError("Parol kamida 8 belgidan iborat bo'lsin")
    if len(password) > 128:
        raise ValueError("Parol juda uzun")
    if not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
        raise ValueError("Parolda harf va raqam bo'lishi shart")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


# ─── JWT access token ───────────────────────────────────────────────────────
@dataclass(frozen=True)
class AccessClaims:
    user_id: int
    token_version: int


def create_access_token(user_id: int, token_version: int) -> tuple[str, int]:
    s = get_settings()
    now = datetime.now(timezone.utc)
    ttl = timedelta(minutes=s.access_token_minutes)
    payload = {
        "sub": str(user_id),
        "ver": token_version,
        "type": "access",
        "iss": s.jwt_issuer,
        "iat": now,
        "nbf": now,
        "exp": now + ttl,
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, s.jwt_secret.get_secret_value(), algorithm="HS256")
    return token, int(ttl.total_seconds())


def decode_access_token(token: str) -> AccessClaims:
    """Imzo, muddat, issuer va tur tekshiriladi. Xato bo'lsa jwt.PyJWTError."""
    s = get_settings()
    payload = jwt.decode(
        token,
        s.jwt_secret.get_secret_value(),
        algorithms=["HS256"],          # "none" va boshqa algoritmlar qabul qilinmaydi
        issuer=s.jwt_issuer,
        options={"require": ["exp", "iat", "sub", "iss"]},
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return AccessClaims(user_id=int(payload["sub"]), token_version=int(payload["ver"]))


# ─── Refresh token (tasodifiy, bazada faqat xeshi) ──────────────────────────
def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ─── OTP ────────────────────────────────────────────────────────────────────
def new_otp_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(phone: str, code: str) -> str:
    key = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def otp_matches(phone: str, code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(phone, code), code_hash)
