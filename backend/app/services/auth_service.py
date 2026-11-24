"""Kirish jarayoni. Faqat AuthSession (app_auth roli) bilan ishlaydi."""
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select, text, update
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
def _create_otp(db: Session, phone: str, ip: str | None, code: str | None = None) -> str:
    s = get_settings()
    code = code or security.new_otp_code()
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


_TG_CODE = {
    "otp": "🔐 Chronix'ga kirish kodi: {code}\n\n"
           "Kodni hech kimga bermang. / Код для входа в Chronix. Никому его не сообщайте.",
    "reset": "🔐 Chronix parolini tiklash kodi: {code}\n\n"
             "Kodni hech kimga bermang. / Код для сброса пароля Chronix. Никому его не сообщайте.",
}


def _telegram_chat(db: Session, phone: str) -> int | None:
    """Raqam egasi avval Telegram orqali kirgan bo'lsa — bot chat_id si (kontakt bilan tasdiqlangan)."""
    if not get_settings().telegram_login_enabled:
        return None
    return db.execute(text("""
        SELECT i.chat_id FROM user_identities i JOIN users u ON u.id = i.user_id
         WHERE u.phone = :p AND u.status = 'active' AND i.provider = 'telegram' AND i.chat_id IS NOT NULL
    """), {"p": phone}).scalar()


def _deliver(db: Session, send, phone: str, code: str, purpose: str = "otp") -> str:
    """Kodni yetkazadi: Telegram (bog'langan bo'lsa), aks holda SMS. Qaytaradi: 'telegram' | 'sms'."""
    from app.services import telegram_bot
    chat = _telegram_chat(db, phone)
    if chat is not None and telegram_bot.send_message(chat, _TG_CODE[purpose].format(code=code)):
        return "telegram"
    try:
        send(phone, code)
    except sms.SmsForeign:
        # Xorijiy raqam: kod faqat Telegram orqali (bot raqamni kontakt bilan tasdiqlaydi)
        raise SmsUnavailable("sms_foreign", "Xorijiy raqamlarga SMS yuborilmaydi. «Telegram orqali kirish» ni bosing — "
                                            "kod va kirish Telegram orqali bo'ladi") from None
    except sms.SmsError as e:
        log.error("SMS yuborilmadi: %s", e)
        if get_settings().telegram_login_enabled:
            raise SmsUnavailable("sms_unavailable", "SMS xizmati vaqtincha band. Kodni olish uchun quyidagi "
                                                    "«Telegram orqali kirish» tugmasini bosing")
        raise SmsUnavailable("sms_unavailable", "SMS yuborib bo'lmadi. Birozdan keyin qayta urinib ko'ring")
    return "sms"


def _is_review_phone(phone: str) -> bool:
    s = get_settings()
    return bool(s.review_phone and s.review_code and phone == s.review_phone)


def request_otp(db: Session, phone: str, ip: str | None) -> tuple[str, str]:
    """Qaytaradi: (kod, kanal) — kanal 'sms' yoki 'telegram'."""
    if _is_review_phone(phone):
        # Google Play tekshiruvchisi: SMS yuborilmaydi, kod o'zgarmas (qolgan tekshiruvlar odatdagidek)
        return _create_otp(db, phone, ip, code=get_settings().review_code.get_secret_value()), "sms"
    code = _create_otp(db, phone, ip)
    return code, _deliver(db, sms.send_otp, phone, code)


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
               user_agent: str | None, ip: str | None, *, birth_date=None, gender: str | None = None,
               password: str | None = None, link_token: str | None = None) -> tuple[User, TokenPair, bool]:
    _consume_otp(db, phone, code)
    return _login_verified_phone(db, phone, full_name, user_agent, ip, birth_date=birth_date, gender=gender,
                                 password=password, link_token=link_token)


def _login_verified_phone(db: Session, phone: str, full_name: str | None, user_agent: str | None, ip: str | None,
                          *, birth_date=None, gender: str | None = None, password: str | None = None,
                          link_token: str | None = None,
                          telegram: tuple[int, int] | None = None) -> tuple[User, TokenPair, bool]:
    """Raqam egasi tasdiqlangan (SMS kod yoki Telegram kontakti): kirish yoki yangi mijozni ro'yxatdan o'tkazish."""
    user = db.scalars(select(User).where(User.phone == phone).with_for_update()).first()
    is_new = user is None
    if is_new:
        user = User(phone=phone, full_name=(full_name or "").strip()[:120], birth_date=birth_date, gender=gender)
        if password is not None:
            user.password_hash = security.hash_password(password)
            user.password_changed_at = _now()
        db.add(user)
        db.flush()
    _ensure_can_login(user)
    if user.is_superadmin and get_settings().superadmin_2fa:
        # Super Admin faqat parol + Telegram kodi bilan kiradi. Telegram orqali kelgan bo'lsa — bog'lab qo'yiladi
        # (keyingi kodlar shu chatga boradi), lekin token berilmaydi
        linked = bool(telegram and telegram[0] is not None)
        if linked:
            _link_telegram(db, user, *telegram)
        db.commit()
        raise Forbidden("use_password_2fa", ("Telegram bog'landi. " if linked else "")
                        + "Super Admin telefon, parol va Telegramga keladigan kod bilan kiradi")
    # Telefon egasi kirdi: boshqa odam bilgan vaqtinchalik parol endi yaroqsiz
    if user.must_change_password:
        user.password_hash = None
        user.must_change_password = False
    if link_token:
        _link_identity(db, user, link_token)
    if telegram and telegram[0] is not None:
        _link_telegram(db, user, *telegram)
    user.last_login_at = _now()
    tokens = _issue_tokens(db, user, user_agent=user_agent, ip=ip)
    db.commit()
    return user, tokens, is_new


# ─── Telegram orqali kirish ─────────────────────────────────────────────────
# Ilova nonce oladi va t.me/<bot>?start=<nonce> ni ochadi; bot foydalanuvchining O'Z kontaktini olgach
# so'rov "ready" bo'ladi, ilova poll qilib tokenlarni oladi. Raqamni Telegram tasdiqlaydi — SMS kerak emas.
def telegram_start(db: Session, ip: str | None, link_token: str | None = None) -> tuple[str, int]:
    s = get_settings()
    if not s.telegram_login_enabled:
        raise SmsUnavailable("telegram_unavailable", "Telegram orqali kirish hozircha o'chiq")
    if link_token:
        _decode_link_token(link_token)                       # yaroqsiz bo'lsa — darhol xato
    nonce = secrets.token_urlsafe(24)
    db.execute(text("""
        INSERT INTO telegram_logins (nonce_hash, ip, link_token, expires_at)
        VALUES (:h, CAST(:ip AS inet), :lt, now() + make_interval(secs => :ttl))
    """), {"h": security.hash_token(nonce), "ip": ip, "lt": link_token, "ttl": s.telegram_login_ttl_seconds})
    try:
        db.commit()
    except DBAPIError as e:
        db.rollback()
        if getattr(e.orig, "sqlstate", None) == "P0429":
            raise RateLimited("otp_rate_limited", "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring")
        raise
    return nonce, s.telegram_login_ttl_seconds


def telegram_bind_chat(db: Session, nonce: str, tg_user_id: int, chat_id: int) -> bool:
    """Bot /start <nonce> oldi: so'rov shu Telegram foydalanuvchisiga biriktiriladi (birinchi bosgan egallaydi)."""
    row = db.execute(text("""
        UPDATE telegram_logins SET tg_user_id = :u, tg_chat_id = :c
         WHERE nonce_hash = :h AND status = 'pending' AND expires_at > now()
           AND (tg_user_id IS NULL OR tg_user_id = :u)
        RETURNING id
    """), {"h": security.hash_token(nonce), "u": tg_user_id, "c": chat_id}).first()
    db.commit()
    return row is not None


def telegram_contact(db: Session, tg_user_id: int, contact_user_id: int | None, raw_phone: str,
                     full_name: str) -> str:
    """Bot kontakt oldi. Natija: ok | not_own | bad_phone | no_request."""
    if contact_user_id != tg_user_id:
        return "not_own"                                     # boshqa odamning kontakti — rad
    try:
        phone = security.normalize_phone(raw_phone)
    except ValueError:
        return "bad_phone"
    row = db.execute(text("""
        UPDATE telegram_logins SET status = 'ready', phone = :p, full_name = :n
         WHERE id = (SELECT id FROM telegram_logins
                      WHERE tg_user_id = :u AND status = 'pending' AND expires_at > now()
                      ORDER BY created_at DESC LIMIT 1 FOR UPDATE)
        RETURNING id
    """), {"p": phone, "n": full_name.strip()[:120], "u": tg_user_id}).first()
    db.commit()
    return "ok" if row else "no_request"


def _require_panel(db: Session, user: User | None, provider: str) -> None:
    """Biznes paneli: faqat muassasada faol a'zo yoki Super Admin. Aks holda tushunarli rad."""
    if user is None or not db.execute(text("SELECT app.panel_access(:u)"), {"u": user.id}).scalar():
        raise Forbidden("not_linked", f"Bu {provider} akkaunt biror biznes profilga ulanmagan. "
                        "Direktor yoki xodim sifatida qo'shilgan telefon raqamingiz bilan kiring")


def telegram_poll(db: Session, nonce: str, user_agent: str | None,
                  ip: str | None, panel: bool = False) -> tuple[User, TokenPair, bool] | None:
    """None — hali kutilmoqda. Tayyor bo'lsa bir martalik: kirish tokenlari."""
    row = db.execute(text("""
        SELECT id, status, phone, full_name, link_token, tg_user_id, tg_chat_id, expires_at > now() AS alive
          FROM telegram_logins WHERE nonce_hash = :h FOR UPDATE
    """), {"h": security.hash_token(nonce)}).mappings().first()
    if row is None or row["status"] == "used" or (row["status"] == "pending" and not row["alive"]):
        db.rollback()
        raise AuthError("login_expired", "Kirish so'rovi eskirgan. Qaytadan urinib ko'ring")
    if row["status"] == "pending":
        db.rollback()
        return None
    db.execute(text("UPDATE telegram_logins SET status = 'used' WHERE id = :i"), {"i": row["id"]})
    if panel:
        user = db.scalars(select(User).where(User.phone == row["phone"])).first()
        try:
            _require_panel(db, user, "Telegram")
        except Forbidden:
            db.commit()                                      # so'rov ishlatildi — qayta ishlatib bo'lmaydi
            raise
    return _login_verified_phone(db, row["phone"], row["full_name"], user_agent, ip, link_token=row["link_token"],
                                 telegram=(row["tg_user_id"], row["tg_chat_id"]))


# ─── Google orqali kirish ───────────────────────────────────────────────────
_GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
_google_jwks: jwt.PyJWKClient | None = None


def _google_claims(id_token: str) -> dict:
    global _google_jwks
    s = get_settings()
    if not s.google_audiences:
        raise SmsUnavailable("google_unavailable", "Google orqali kirish hozircha o'chiq")
    invalid = AuthError("google_invalid", "Google hisobini tasdiqlab bo'lmadi")
    try:
        if _google_jwks is None:
            _google_jwks = jwt.PyJWKClient("https://www.googleapis.com/oauth2/v3/certs", cache_keys=True, timeout=10)
        key = _google_jwks.get_signing_key_from_jwt(id_token).key
        claims = jwt.decode(id_token, key, algorithms=["RS256"], audience=s.google_audiences,
                            options={"require": ["exp", "iat", "iss", "sub", "aud"]})
    except jwt.PyJWTError:
        raise invalid from None
    if claims.get("iss") not in _GOOGLE_ISSUERS or not claims.get("email_verified"):
        raise invalid
    return claims


def _make_link_token(provider: str, subject: str, email: str | None) -> str:
    s = get_settings()
    now = _now()
    return jwt.encode({"typ": "link", "prv": provider, "sub": subject, "email": email, "iss": s.jwt_issuer,
                       "iat": now, "exp": now + timedelta(minutes=15)},
                      s.jwt_secret.get_secret_value(), algorithm="HS256")


def _decode_link_token(token: str) -> dict:
    s = get_settings()
    try:
        c = jwt.decode(token, s.jwt_secret.get_secret_value(), algorithms=["HS256"], issuer=s.jwt_issuer)
    except jwt.PyJWTError:
        raise AuthError("link_expired", "Google bilan bog'lash muddati o'tdi. Qaytadan urinib ko'ring") from None
    if c.get("typ") != "link" or c.get("prv") != "google":
        raise AuthError("link_expired", "Google bilan bog'lash muddati o'tdi. Qaytadan urinib ko'ring")
    return c


def _link_telegram(db: Session, user: User, tg_user_id: int, chat_id: int | None) -> None:
    """Telegram hisobi shu foydalanuvchiga: keyingi kirish kodlari bot orqali keladi. Telegram hisobi
    boshqa raqamga o'tsa (boshqa foydalanuvchi) — eski bog'lanish olib tashlanadi."""
    db.execute(text("DELETE FROM user_identities WHERE provider = 'telegram' AND (user_id = :u OR subject = :s)"),
               {"u": user.id, "s": str(tg_user_id)})
    db.execute(text("INSERT INTO user_identities (user_id, provider, subject, chat_id) VALUES (:u, 'telegram', :s, :c)"),
               {"u": user.id, "s": str(tg_user_id), "c": chat_id})


def _link_identity(db: Session, user: User, link_token: str) -> None:
    c = _decode_link_token(link_token)
    db.execute(text("""
        INSERT INTO user_identities (user_id, provider, subject, email) VALUES (:u, :p, :s, :e)
        ON CONFLICT DO NOTHING
    """), {"u": user.id, "p": c["prv"], "s": c["sub"], "e": c.get("email")})


def google_login(db: Session, id_token: str, user_agent: str | None,
                 ip: str | None, panel: bool = False) -> tuple[User, TokenPair] | str:
    """Bog'langan hisob bo'lsa — kirish. Aks holda link_token (raqam bir marta tasdiqlanadi va bog'lanadi)."""
    c = _google_claims(id_token)
    uid = db.execute(text("SELECT user_id FROM user_identities WHERE provider = 'google' AND subject = :s"),
                     {"s": c["sub"]}).scalar()
    if uid is None:
        db.rollback()
        return _make_link_token("google", c["sub"], c.get("email"))
    user = db.get(User, uid, with_for_update=True)
    _ensure_can_login(user)
    if user.is_superadmin and get_settings().superadmin_2fa:
        db.rollback()
        raise Forbidden("use_password_2fa", "Super Admin telefon, parol va Telegramga keladigan kod bilan kiradi")
    if panel:
        try:
            _require_panel(db, user, "Google")
        except Forbidden:
            db.rollback()
            raise
    user.last_login_at = _now()
    tokens = _issue_tokens(db, user, user_agent=user_agent, ip=ip)
    db.commit()
    return user, tokens


# ─── Parol bilan kirish (veb-admin) ─────────────────────────────────────────
def login_password(db: Session, phone: str, password: str, user_agent: str | None, ip: str | None,
                   link_token: str | None = None, panel_check=None) -> tuple[User, TokenPair] | tuple[str, None]:
    """Oddiy hisob — (user, tokenlar). Super Admin (2FA yoqiq) — (chaqiruv tokeni, None): kod Telegramga ketdi."""
    s = get_settings()
    if link_token:
        _decode_link_token(link_token)                       # yaroqsiz bo'lsa — parol tekshirilmasdan rad
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
    if link_token:
        _link_identity(db, user, link_token)
    if user.is_superadmin and s.superadmin_2fa:
        if panel_check is not None:
            panel_check(True)                                # boshqa panelda — kod yuborilmaydi
        challenge = _start_2fa(db, user, ip)
        db.commit()
        return challenge, None
    tokens = _issue_tokens(db, user, user_agent=user_agent, ip=ip)
    db.commit()
    return user, tokens


# ─── Super Admin 2FA: Telegram kodi (sql/065_superadmin_2fa.sql) ─────────────────
_TG_2FA = ("🛡 Chronix Super Admin — kirish kodi: {code}\n\nKod {m} daqiqa amal qiladi. Kodni hech kimga bermang.\n"
           "Agar siz kirmayotgan bo'lsangiz — parolni darhol almashtiring.")


def _challenge_code_hash(token: str, code: str) -> str:
    return security.hash_token(f"2fa:{token}:{code}")


def _mask_phone(phone: str) -> str:
    """+998200035599 -> +998 ** *** 55 99 (kirish oynasida raqam to'liq ko'rinmaydi)"""
    d = phone.lstrip("+")
    return f"+{d[:3]} ** *** {d[-4:-2]} {d[-2:]}" if len(d) >= 7 else "***"


def _user_telegram_chat(db: Session, user_id: int) -> int | None:
    return db.execute(text("SELECT chat_id FROM user_identities WHERE user_id = :u AND provider = 'telegram' "
                           "AND chat_id IS NOT NULL ORDER BY id LIMIT 1"), {"u": user_id}).scalar()


@dataclass
class TwoFactorTarget:
    label: str
    chat: int


def _2fa_targets(db: Session, user: User) -> list[TwoFactorTarget]:
    """Kod yuborilishi mumkin bo'lgan Telegram chatlari: Super Admin'ning o'zi (0-variant) va sozlamadagi qo'shimcha
    raqamlar (SUPERADMIN_2FA_PHONES). Telegram bog'lanmagan raqam ro'yxatga kirmaydi."""
    s = get_settings()
    out: list[TwoFactorTarget] = []
    if not s.telegram_login_enabled:
        return out
    own = _user_telegram_chat(db, user.id)
    if own is not None:
        out.append(TwoFactorTarget(_mask_phone(user.phone), own))
    for raw in s.superadmin_2fa_phones:
        try:
            phone = security.normalize_phone(raw)
        except ValueError:
            continue
        if phone == user.phone:
            continue
        uid = db.execute(text("SELECT id FROM users WHERE phone = :p AND status = 'active'"), {"p": phone}).scalar()
        chat = _user_telegram_chat(db, uid) if uid is not None else None
        if chat is not None and all(t.chat != chat for t in out):
            out.append(TwoFactorTarget(_mask_phone(phone), chat))
    return out


def _admin_chats(db: Session, user: User) -> list[TwoFactorTarget]:
    targets = _2fa_targets(db, user)
    if not targets:
        db.commit()                                          # muvaffaqiyatli parol tekshiruvi (hisoblagich) saqlansin
        raise Forbidden("telegram_not_linked",
                        "Super Admin uchun Telegram bog'lanmagan. Kirish oynasida «Telegram orqali kirish» ni bir marta "
                        "bosing — bot raqamingizni tasdiqlab Telegramni bog'laydi. Keyin parol bilan qayta kiring")
    return targets


def _send_2fa(chat: int, code: str) -> None:
    from app.services import telegram_bot
    s = get_settings()
    if not telegram_bot.send_message(chat, _TG_2FA.format(code=code, m=max(1, s.twofa_ttl_seconds // 60))):
        raise SmsUnavailable("telegram_send_failed", "Telegramga kod yuborib bo'lmadi. Birozdan keyin qayta urinib ko'ring")


@dataclass
class TwoFactorStart:
    token: str
    targets: list[str]          # kirish oynasida tanlash uchun (yashirilgan raqamlar)
    sent: bool                  # bitta variant — kod darhol ketdi; bir nechta — avval tanlanadi


def _start_2fa(db: Session, user: User, ip: str | None) -> TwoFactorStart:
    s = get_settings()
    targets = _admin_chats(db, user)
    token = secrets.token_urlsafe(24)
    single = len(targets) == 1
    code = f"{secrets.randbelow(10 ** 6):06d}"
    if single:
        db.execute(text("""
            INSERT INTO login_challenges (token_hash, user_id, code_hash, expires_at, ip)
            VALUES (:t, :u, :c, now() + make_interval(secs => :ttl), CAST(:ip AS inet))
        """), {"t": security.hash_token(token), "u": user.id, "c": _challenge_code_hash(token, code),
              "ttl": s.twofa_ttl_seconds, "ip": ip})
        _send_2fa(targets[0].chat, code)
    else:
        # Raqam tanlanmaguncha kod yo'q: muddati o'tgan tasodifiy xesh, yuborishlar 0 (birinchi tanlovda kutish yo'q)
        db.execute(text("""
            INSERT INTO login_challenges (token_hash, user_id, code_hash, expires_at, ip, sends, last_sent_at)
            VALUES (:t, :u, :c, now(), CAST(:ip AS inet), 0, now() - interval '1 day')
        """), {"t": security.hash_token(token), "u": user.id, "c": security.hash_token(secrets.token_urlsafe(24)),
              "ip": ip})
    return TwoFactorStart(token, [t.label for t in targets], single)


def verify_2fa(db: Session, token: str, code: str, user_agent: str | None, ip: str | None) -> tuple[User, TokenPair]:
    s = get_settings()
    row = db.execute(text("""
        SELECT id, user_id, code_hash, attempts, status, expires_at > now() AS alive
          FROM login_challenges WHERE token_hash = :t FOR UPDATE
    """), {"t": security.hash_token(token)}).mappings().first()
    if row is None or row["status"] != "pending":
        db.rollback()
        raise AuthError("2fa_expired", "Kirish so'rovi eskirgan. Telefon va parol bilan qaytadan kiring")
    if not row["alive"]:
        db.rollback()
        raise AuthError("2fa_code_expired", "Kod muddati o'tdi. «Kodni qaytadan yuborish» ni bosing")
    if not secrets.compare_digest(row["code_hash"], _challenge_code_hash(token, code)):
        attempts = row["attempts"] + 1
        if attempts >= s.twofa_max_attempts:
            db.execute(text("UPDATE login_challenges SET attempts = :a, status = 'locked' WHERE id = :i"),
                       {"a": attempts, "i": row["id"]})
            db.execute(update(User).where(User.id == row["user_id"])
                       .values(locked_until=_now() + timedelta(minutes=s.twofa_lock_minutes)))
            db.commit()
            raise RateLimited("2fa_locked", f"{s.twofa_max_attempts} marta noto'g'ri kod. Kirish "
                              f"{s.twofa_lock_minutes} daqiqaga bloklandi")
        db.execute(text("UPDATE login_challenges SET attempts = :a WHERE id = :i"), {"a": attempts, "i": row["id"]})
        db.commit()
        raise AuthError("2fa_invalid", f"Kod noto'g'ri. Yana {s.twofa_max_attempts - attempts} ta urinish qoldi")
    db.execute(text("UPDATE login_challenges SET status = 'used' WHERE id = :i"), {"i": row["id"]})
    user = db.get(User, row["user_id"], with_for_update=True)
    _ensure_can_login(user)
    user.last_login_at = _now()
    tokens = _issue_tokens(db, user, user_agent=user_agent, ip=ip)
    db.commit()
    return user, tokens


def resend_2fa(db: Session, token: str, target: int | None = None) -> None:
    """Yangi kod (eski kod bekor) — tanlangan raqam Telegramiga (target: _2fa_targets tartibidagi indeks, standart 0).
    Noto'g'ri urinishlar hisobi saqlanadi — qayta yuborish bilan taxmin qilib bo'lmaydi."""
    s = get_settings()
    row = db.execute(text("""
        SELECT id, user_id, status, sends, last_sent_at > now() - make_interval(secs => :gap) AS too_soon,
               created_at < now() - interval '15 minutes' AS stale
          FROM login_challenges WHERE token_hash = :t FOR UPDATE
    """), {"t": security.hash_token(token), "gap": s.twofa_resend_seconds}).mappings().first()
    if row is None or row["status"] != "pending" or row["stale"]:
        db.rollback()
        raise AuthError("2fa_expired", "Kirish so'rovi eskirgan. Telefon va parol bilan qaytadan kiring")
    if row["too_soon"]:
        db.rollback()
        raise RateLimited("2fa_resend_wait", f"Yangi kodni {s.twofa_resend_seconds} soniyadan keyin so'rang")
    if row["sends"] >= s.twofa_max_sends:
        db.rollback()
        raise RateLimited("2fa_too_many", "Juda ko'p kod so'raldi. Telefon va parol bilan qaytadan kiring")
    user = db.get(User, row["user_id"])
    targets = _admin_chats(db, user)
    idx = target or 0
    if idx >= len(targets):
        db.rollback()
        raise AuthError("2fa_bad_target", "Bunday raqam yo'q. Ro'yxatdan tanlang")
    chat = targets[idx].chat
    code = f"{secrets.randbelow(10 ** 6):06d}"
    db.execute(text("""
        UPDATE login_challenges SET code_hash = :c, sends = sends + 1, last_sent_at = now(),
               expires_at = now() + make_interval(secs => :ttl) WHERE id = :i
    """), {"c": _challenge_code_hash(token, code), "ttl": s.twofa_ttl_seconds, "i": row["id"]})
    _send_2fa(chat, code)
    db.commit()


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


_MANAGED = "Parolni faqat rahbaringiz o'zgartira oladi. Unga murojaat qiling"


def _managed(db: Session, user_id: int) -> bool:
    """Salon xodimi yoki direktori: paroli rahbar tomonidan beriladi (sql/022_managed_passwords.sql)."""
    return bool(db.scalar(text("SELECT app.password_managed(:u)"), {"u": user_id}))


def set_password(db: Session, user_id: int, old_password: str | None, new_password: str) -> None:
    security.validate_password_strength(new_password)
    if _managed(db, user_id):
        raise Forbidden("password_managed", _MANAGED)
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
    if _managed(db, user.id):
        raise Forbidden("password_managed", _MANAGED)
    code = _create_otp(db, phone, ip)
    _deliver(db, sms.send_password_reset, phone, code, "reset")
    return code


def reset_password(db: Session, phone: str, code: str, new_password: str) -> None:
    _consume_otp(db, phone, code)
    user = db.scalars(select(User).where(User.phone == phone).with_for_update()).first()
    if user is None or user.password_hash is None or user.is_superadmin:
        raise AuthError("otp_invalid", "Kod noto'g'ri yoki muddati o'tgan")
    if _managed(db, user.id):
        raise Forbidden("password_managed", _MANAGED)
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
