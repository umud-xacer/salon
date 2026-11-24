"""Direktorning o'zi ro'yxatdan o'tishi (Fresha uslubi), Super Admin tasdig'i va 5 kunlik sinov (sql/070).

Ochiq:      POST /onboarding/telegram/start, /onboarding/telegram/poll, /onboarding/signup
Direktor:   GET  /businesses/{id}/onboarding — ariza holati, sinov muddati, ilovaga chiqish uchun qadamlar
Super Admin: GET /superadmin/signups, POST .../approve, .../reject, GET /superadmin/signups/events
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import client_meta, get_auth_db, get_db, require_superadmin
from app.api.v1.auth import _login_out
from app.core.config import get_settings
from app.db.session import api_session
from app.api.v1.geo import regions as _regions
from app.schemas import LoginOut, TelegramStartOut
from app.schemas.catalog import CategoryOut, RegionOut
from app.schemas.onboarding import (OnboardingOut, Readiness, SignupAdminOut, SignupApproveIn, SignupIn, SignupPollIn,
                                    SignupPollOut, SignupRejectIn, TrialEventOut)
from app.services import auth_service, media

router = APIRouter(prefix="/onboarding", tags=["onboarding"])
member_router = APIRouter(prefix="/businesses/{business_id}", tags=["onboarding"])
admin_router = APIRouter(prefix="/superadmin/signups", tags=["onboarding"], dependencies=[Depends(require_superadmin)])


class SignupOut(LoginOut):
    business_id: int
    business_slug: str


# ─── Ochiq: ro'yxatdan o'tish ───────────────────────────────────────────────
@router.get("/regions", response_model=list[RegionOut])
def signup_regions():
    """Viloyat va tumanlar (statik ro'yxat) — ro'yxatdan o'tayotgan hali kirmagan. Geokoder bu yerda yo'q."""
    return _regions()


@router.get("/categories", response_model=list[CategoryOut])
def signup_categories():
    """Tanlash mumkin bo'lgan yo'nalishlar (faol turlar). Mobil ilovadagi yashirish bu yerga ta'sir qilmaydi."""
    with api_session(None) as db:
        rows = db.execute(text("SELECT id, slug, name_uz, name_ru, icon, kind FROM business_categories "
                               "WHERE is_active ORDER BY sort_order, id")).mappings()
        return [CategoryOut(**r) for r in rows]


@router.post("/telegram/start", response_model=TelegramStartOut)
def signup_telegram_start(request: Request, db: Session = Depends(get_auth_db)):
    """Telefonni Telegram bot orqali tasdiqlash (SMS kerak emas): bot "Raqamni yuborish" ni so'raydi."""
    _, ip = client_meta(request)
    nonce, ttl = auth_service.telegram_start(db, ip)
    bot = get_settings().telegram_bot_username
    return TelegramStartOut(nonce=nonce, url=f"https://t.me/{bot}?start={nonce}", expires_in=ttl)


@router.post("/telegram/poll", response_model=SignupPollOut)
def signup_telegram_poll(body: SignupPollIn, db: Session = Depends(get_auth_db)):
    res = auth_service.signup_poll(db, body.nonce)
    if res is None:
        return SignupPollOut(status="pending")
    return SignupPollOut(status="ok", signup_token=res.token, phone=res.phone, full_name=res.full_name,
                         exists=res.exists, has_password=res.has_password)


@router.post("/signup", response_model=SignupOut, status_code=201)
def signup(body: SignupIn, request: Request, db: Session = Depends(get_auth_db)):
    """Hisob (yangi yoki mavjud) + muassasa 'pending' holatida. Super Admin tasdiqlagach sinov boshlanadi."""
    ua, ip = client_meta(request)
    with api_session(None) as pub:                             # yo'nalish avval tekshiriladi (hisob ochilmasdan)
        ok = pub.scalar(text("SELECT 1 FROM business_categories WHERE id = :c AND is_active"), {"c": body.category_id})
    if not ok:
        raise HTTPException(422, detail={"code": "invalid_category", "message": "Yo'nalishni tanlang"})
    user, tokens, is_new = auth_service.signup_account(db, body.signup_token, body.full_name, body.password, ua, ip)
    with api_session(user.id) as adb:
        bid = adb.scalar(text("""
            SELECT app.self_signup(:n, :c, :t, :r, :city, :a, :p, :lat, :lng)
        """), {"n": body.business_name, "c": body.category_id, "t": body.team_size, "r": body.region,
               "city": body.city, "a": body.address, "p": body.contact_phone, "lat": body.lat, "lng": body.lng})
        slug = adb.scalar(text("SELECT slug FROM businesses WHERE id = :b"), {"b": bid})
        adb.commit()
    out = _login_out(user, tokens, is_new)
    return SignupOut(**out.model_dump(), business_id=bid, business_slug=slug)


# ─── Direktor: sinov holati ─────────────────────────────────────────────────
def _days_left(ends: datetime | None) -> int | None:
    if ends is None:
        return None
    return max(0, -(-int((ends - datetime.now(timezone.utc)).total_seconds()) // 86400))


@member_router.get("/onboarding", response_model=OnboardingOut)
def business_onboarding(business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    row = db.execute(text("SELECT status, trial_ends_at FROM business_signups WHERE business_id = :b"),
                     {"b": business_id}).mappings().first()
    if row is None:                                            # Super Admin ochgan muassasa — sinov oqimi yo'q
        return OnboardingOut(status="none")
    ready = db.scalar(text("SELECT app.trial_readiness(:b)"), {"b": business_id})
    return OnboardingOut(status=row["status"], trial_ends_at=row["trial_ends_at"],
                         days_left=_days_left(row["trial_ends_at"]) if row["status"] == "trial" else None,
                         readiness=Readiness(**ready) if ready else None)


# ─── Super Admin: arizalar ──────────────────────────────────────────────────
def _owner_chat(user_id: int) -> int | None:
    """Direktorning Telegram chati (kirish bazasi orqali — app_api boshqalarning identifikatorini ko'rmaydi)."""
    from app.db.session import auth_session
    with auth_session() as adb:
        return adb.scalar(text("SELECT chat_id FROM user_identities WHERE user_id = :u AND provider = 'telegram' "
                               "AND chat_id IS NOT NULL ORDER BY id LIMIT 1"), {"u": user_id})


def _notify(user_id: int, message: str) -> bool:
    from app.services import telegram_bot
    chat = _owner_chat(user_id)
    return bool(chat) and telegram_bot.send_message(chat, message)


@admin_router.get("", response_model=list[SignupAdminOut])
def list_signups(status: str = Query("pending", pattern="^(pending|trial|converted|all)$"),
                 db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT s.business_id, b.name AS business_name, b.slug, c.name_uz AS category_name, b.region, b.city,
               b.address, s.contact_phone, s.team_size, u.full_name AS owner_name, u.phone AS owner_phone,
               s.status, s.created_at, s.reviewed_at, s.trial_started_at, s.trial_ends_at, s.sms_day3_at,
               s.tg_day4_at, s.owner_user_id, app.trial_readiness(s.business_id) AS readiness
          FROM business_signups s
          JOIN businesses b ON b.id = s.business_id
          JOIN business_categories c ON c.id = b.category_id
          JOIN users u ON u.id = s.owner_user_id
         WHERE :st = 'all' OR s.status = :st
         ORDER BY s.created_at DESC
         LIMIT 300
    """), {"st": status}).mappings().all()
    owners = {r["owner_user_id"] for r in rows}
    linked: set[int] = set()
    if owners:
        from app.db.session import auth_session
        with auth_session() as adb:
            linked = set(adb.scalars(text("SELECT DISTINCT user_id FROM user_identities WHERE provider = 'telegram' "
                                          "AND chat_id IS NOT NULL AND user_id = ANY(:u)"), {"u": list(owners)}))
    out = []
    for r in rows:
        d = dict(r)
        d["owner_telegram"] = d.pop("owner_user_id") in linked
        d["readiness"] = Readiness(**d["readiness"]) if d["readiness"] else None
        out.append(SignupAdminOut(**d))
    return out


@admin_router.get("/count")
def pending_count(db: Session = Depends(get_db)) -> dict:
    return {"pending": db.scalar(text("SELECT count(*) FROM business_signups WHERE status = 'pending'"))}


@admin_router.post("/{business_id}/approve", status_code=204)
def approve_signup(body: SignupApproveIn, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    days = body.days or get_settings().trial_days
    owner = db.scalar(text("SELECT owner_user_id FROM business_signups WHERE business_id = :b"), {"b": business_id})
    db.execute(text("SELECT app.signup_approve(:b, :d)"), {"b": business_id, "d": days})
    name = db.scalar(text("SELECT name FROM businesses WHERE id = :b"), {"b": business_id})
    db.commit()
    if owner:
        _notify(owner, f"✅ «{name}» arizangiz tasdiqlandi! {days} kunlik bepul sinov boshlandi.\n\n"
                       f"Panelga kiring va xizmatlar, xodimlar, ish vaqti hamda xaritadagi manzilni qo'shing — "
                       f"shunda muassasangiz Chronix ilovasida mijozlarga ko'rinadi.\n{get_settings().business_panel_url}")


@admin_router.post("/{business_id}/reject", status_code=204)
def reject_signup(body: SignupRejectIn, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    row = db.execute(text("SELECT s.owner_user_id, b.name FROM business_signups s JOIN businesses b ON b.id = s.business_id "
                          "WHERE s.business_id = :b"), {"b": business_id}).mappings().first()
    db.execute(text("SELECT app.signup_reject(:b, :r)"), {"b": business_id, "r": body.reason})
    db.commit()
    media.delete_business_folder(business_id)
    if row:
        reason = f"\nSabab: {body.reason.strip()}" if body.reason and body.reason.strip() else ""
        _notify(row["owner_user_id"], f"«{row['name']}» arizangiz rad etildi.{reason}\n\n"
                                      "Savollar bo'lsa, qo'llab-quvvatlash xizmatiga yozing.")


@admin_router.get("/events", response_model=list[TrialEventOut])
def trial_events(business_id: int | None = Query(None, ge=1), limit: int = Query(200, ge=1, le=1000),
                 db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT id, business_id, business_name, owner_phone, event, dry_run, details, created_at
          FROM trial_events WHERE CAST(:b AS BIGINT) IS NULL OR business_id = :b
         ORDER BY created_at DESC, id DESC LIMIT :n
    """), {"b": business_id, "n": limit}).mappings()
    return [TrialEventOut(**r) for r in rows]
