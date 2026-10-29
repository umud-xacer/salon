"""
Billing Router: Tariflar, To'lovlar, Click/Payme integratsiyasi, Obuna boshqaruvi
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from database import get_db
from auth import require_superadmin, require_admin, get_current_user, get_salon_id
from datetime import date, timedelta, datetime
from pydantic import BaseModel
from typing import Optional
import models
import hashlib
import json
import hmac

router = APIRouter(prefix="/api/billing", tags=["billing"])


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


def _enforce_ip_allowlist(request: Request, allowlist_raw: str):
    allowlist = [x.strip() for x in (allowlist_raw or "").split(",") if x.strip()]
    if not allowlist:
        return
    ip = _client_ip(request)
    if ip not in allowlist:
        raise HTTPException(403, f"IP ruxsat etilmagan: {ip}")


def _mark_transaction_completed(db: Session, txn, provider_txn_id: str = "", callback_payload: str = ""):
    """Provayder callback tasdiqlagandan keyin tranzaksiyani yakunlash."""
    if txn.status == "completed":
        return txn, db.query(models.Salon).filter(models.Salon.id == txn.salon_id).first(), None

    salon = db.query(models.Salon).filter(models.Salon.id == txn.salon_id).first()
    if not salon:
        raise HTTPException(404, "Salon topilmadi")

    today = date.today()
    current_exp = today
    if salon.expires_at:
        try:
            current_exp = max(today, date.fromisoformat(salon.expires_at))
        except Exception:
            pass
    new_exp = current_exp + timedelta(days=txn.duration_days)

    salon.expires_at = str(new_exp)
    salon.is_active = True
    salon.block_reason = ""
    if txn.tariff_id:
        tariff = db.query(models.Tariff).filter(models.Tariff.id == txn.tariff_id).first()
        if tariff:
            salon.plan = tariff.plan

    txn.status = "completed"
    if provider_txn_id:
        txn.provider_txn_id = provider_txn_id
    txn.verified_at = datetime.utcnow()
    if callback_payload:
        txn.callback_payload = callback_payload
    if txn.note:
        txn.note = f"{txn.note} | provider callback tasdiqladi"
    else:
        txn.note = "Provider callback tasdiqladi"

    db.commit()
    return txn, salon, new_exp


# ═══════════════════════════════════════════════════════════════════════════════
# 1. TARIFLAR CRUD (SuperAdmin)
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/tariffs")
def get_tariffs(db: Session = Depends(get_db)):
    """Barcha faol tariflar ro'yxati."""
    tariffs = db.query(models.Tariff).filter(models.Tariff.is_active == True).order_by(models.Tariff.price).all()
    return [{
        "id": t.id, "name": t.name, "plan": t.plan,
        "price": t.price, "duration_days": t.duration_days,
    } for t in tariffs]


@router.get("/tariffs/all")
def get_all_tariffs(user=Depends(require_superadmin), db: Session = Depends(get_db)):
    """SuperAdmin uchun barcha tariflar."""
    return [{
        "id": t.id, "name": t.name, "plan": t.plan,
        "price": t.price, "duration_days": t.duration_days,
        "is_active": t.is_active,
    } for t in db.query(models.Tariff).order_by(models.Tariff.price).all()]


class TariffCreate(BaseModel):
    name: str
    plan: str = "pro"
    price: float
    duration_days: int = 30

@router.post("/tariffs")
def create_tariff(data: TariffCreate, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    t = models.Tariff(name=data.name, plan=data.plan, price=data.price, duration_days=data.duration_days)
    db.add(t); db.commit()
    return {"ok": True, "message": f"✅ '{data.name}' tarifi yaratildi"}


class TariffUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    duration_days: Optional[int] = None
    is_active: Optional[bool] = None

@router.patch("/tariffs/{tariff_id}")
def update_tariff(tariff_id: int, data: TariffUpdate, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    t = db.query(models.Tariff).filter(models.Tariff.id == tariff_id).first()
    if not t: raise HTTPException(404, "Tarif topilmadi")
    if data.name is not None: t.name = data.name
    if data.price is not None: t.price = data.price
    if data.duration_days is not None: t.duration_days = data.duration_days
    if data.is_active is not None: t.is_active = data.is_active
    db.commit()
    return {"ok": True, "message": f"✅ '{t.name}' yangilandi"}


# ═══════════════════════════════════════════════════════════════════════════════
# 2. TO'LOV YARATISH VA TARIXI
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/transactions")
def get_transactions(
    salon_id: Optional[int] = None,
    user=Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    """SuperAdmin: barcha to'lovlar tarixi."""
    q = db.query(models.Transaction).order_by(desc(models.Transaction.created_at))
    if salon_id:
        q = q.filter(models.Transaction.salon_id == salon_id)
    txns = q.limit(200).all()
    result = []
    for t in txns:
        salon = db.query(models.Salon).filter(models.Salon.id == t.salon_id).first()
        result.append({
            "id": t.id, "salon_id": t.salon_id,
            "salon_name": salon.name if salon else "—",
            "amount": t.amount, "provider": t.provider,
            "status": t.status, "tariff_name": t.tariff_name,
            "duration_days": t.duration_days, "note": t.note,
            "created_at": str(t.created_at)[:19] if t.created_at else "",
        })
    return result


@router.get("/my-transactions")
def my_transactions(user=Depends(require_admin), db: Session = Depends(get_db)):
    """Salon admin: o'z to'lovlari."""
    salon_id = user.get("salon_id")
    if not salon_id: return []
    txns = db.query(models.Transaction).filter(
        models.Transaction.salon_id == salon_id
    ).order_by(desc(models.Transaction.created_at)).limit(50).all()
    return [{
        "id": t.id, "amount": t.amount, "provider": t.provider,
        "status": t.status, "tariff_name": t.tariff_name,
        "created_at": str(t.created_at)[:19] if t.created_at else "",
    } for t in txns]


# ═══════════════════════════════════════════════════════════════════════════════
# 3. CLICK / PAYME SANDBOX ENDPOINTLAR
# ═══════════════════════════════════════════════════════════════════════════════
class PaymentRequest(BaseModel):
    tariff_id: int
    provider: str = "click"   # click | payme

@router.post("/create-payment")
def create_payment(data: PaymentRequest, user=Depends(require_admin), db: Session = Depends(get_db)):
    """Salon admin to'lov boshlaydi."""
    salon_id = user.get("salon_id")
    if not salon_id: raise HTTPException(403, "Faqat salon adminlar uchun")
    tariff = db.query(models.Tariff).filter(models.Tariff.id == data.tariff_id, models.Tariff.is_active == True).first()
    if not tariff: raise HTTPException(404, "Tarif topilmadi")
    txn = models.Transaction(
        salon_id=salon_id, tariff_id=tariff.id,
        amount=tariff.price, provider=data.provider,
        status="pending", tariff_name=tariff.name,
        duration_days=tariff.duration_days,
    )
    db.add(txn); db.commit(); db.refresh(txn)
    # Sandbox rejim — to'lovni darhol tasdiqlash
    return {
        "ok": True, "transaction_id": txn.id,
        "amount": tariff.price, "tariff": tariff.name,
        "message": f"To'lov yaratildi: {tariff.name} ({tariff.price:,.0f} so'm)",
        "confirm_url": f"/api/billing/confirm/{txn.id}",
    }


@router.post("/confirm/{txn_id}")
def confirm_payment(txn_id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    """To'lov holatini tekshirish: faqat callback tasdiqlagan bo'lsa yakunlangan bo'ladi."""
    txn = db.query(models.Transaction).filter(models.Transaction.id == txn_id).first()
    if not txn: raise HTTPException(404, "Tranzaksiya topilmadi")
    role = user.get("role")
    if role != "superadmin" and txn.salon_id != user.get("salon_id"):
        raise HTTPException(403, "Bu tranzaksiyani ko'rishga ruxsat yo'q")
    if txn.status != "completed":
        return {
            "ok": False,
            "status": txn.status,
            "message": "To'lov hali provayder callbacki bilan tasdiqlanmagan",
        }
    return {
        "ok": True,
        "status": txn.status,
        "message": "Bu to'lov provayder callbacki orqali tasdiqlangan",
        "new_expires_at": "",
    }


@router.post("/callbacks/click")
async def click_callback(request: Request, db: Session = Depends(get_db)):
    """
    Click callback endpoint.
    Imzo tekshiruvi: md5(click_trans_id + service_id + secret_key + merchant_trans_id + amount + action + sign_time)
    """
    form = await request.form()
    payload = {k: str(v) for k, v in form.items()}
    _enforce_ip_allowlist(request, get_setting(db, "click_allowed_ips"))

    click_trans_id = payload.get("click_trans_id", "")
    service_id = payload.get("service_id", "")
    merchant_trans_id = payload.get("merchant_trans_id", "")
    amount = payload.get("amount", "")
    action = payload.get("action", "")
    sign_time = payload.get("sign_time", "")
    sign_string = payload.get("sign_string", "")
    error = payload.get("error", "0")

    secret_key = get_setting(db, "click_secret_key")
    expected = hashlib.md5(
        f"{click_trans_id}{service_id}{secret_key}{merchant_trans_id}{amount}{action}{sign_time}".encode("utf-8")
    ).hexdigest()
    if not secret_key or not hmac.compare_digest(sign_string.lower(), expected.lower()):
        raise HTTPException(403, "Click imzosi noto'g'ri")

    try:
        internal_txn_id = int(merchant_trans_id or 0)
    except ValueError:
        raise HTTPException(400, "merchant_trans_id noto'g'ri")

    txn = db.query(models.Transaction).filter(models.Transaction.id == internal_txn_id).first()
    if not txn:
        raise HTTPException(404, "Tranzaksiya topilmadi")
    if txn.provider != "click":
        raise HTTPException(400, "Provider mos emas")

    if error not in ("0", "", None):
        txn.status = "failed"
        txn.note = f"Click xatosi: {error}"
        txn.callback_payload = json.dumps(payload, ensure_ascii=False)
        db.commit()
        return {"error": -9, "error_note": "payment failed"}

    txn, salon, new_exp = _mark_transaction_completed(
        db,
        txn,
        provider_txn_id=click_trans_id,
        callback_payload=json.dumps(payload, ensure_ascii=False),
    )
    if new_exp:
        send_billing_notification(
            db,
            f"💰 <b>Yangi to'lov!</b>\n🏪 Salon: {salon.name}\n📋 Tarif: {txn.tariff_name}\n"
            f"💵 Summa: {txn.amount:,.0f} so'm\n📅 Yangi muddat: {new_exp}\n🔄 Provider: {txn.provider}",
        )
    return {"error": 0, "error_note": "Success"}


@router.post("/callbacks/payme")
async def payme_callback(request: Request, db: Session = Depends(get_db)):
    """Payme (Paycom) JSON-RPC callback endpoint."""
    _enforce_ip_allowlist(request, get_setting(db, "payme_allowed_ips"))
    data = await request.json()
    method = data.get("method")
    params = data.get("params", {}) or {}
    req_id = data.get("id")
    auth_header = request.headers.get("authorization", "")
    expected_auth = get_setting(db, "payme_secret_key")
    if expected_auth and auth_header not in (expected_auth, f"Basic {expected_auth}"):
        raise HTTPException(403, "Payme auth xato")

    account = params.get("account", {}) or {}
    order_id = account.get("order_id")
    txn = db.query(models.Transaction).filter(models.Transaction.id == int(order_id or 0)).first() if order_id else None
    if txn and txn.provider != "payme":
        txn = None

    if method == "CheckPerformTransaction":
        ok = bool(txn and txn.status in ("pending", "completed"))
        return {"jsonrpc": "2.0", "id": req_id, "result": {"allow": ok}}

    if method == "CreateTransaction":
        if not txn:
            return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -31050, "message": "Order not found"}}
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "create_time": int(datetime.utcnow().timestamp() * 1000),
                "transaction": str(txn.id),
                "state": 1,
            },
        }

    if method == "PerformTransaction":
        if not txn:
            return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -31050, "message": "Order not found"}}
        payme_txn_id = str(params.get("id", ""))
        txn, salon, new_exp = _mark_transaction_completed(
            db,
            txn,
            provider_txn_id=payme_txn_id,
            callback_payload=json.dumps(data, ensure_ascii=False),
        )
        if new_exp:
            send_billing_notification(
                db,
                f"💰 <b>Yangi to'lov!</b>\n🏪 Salon: {salon.name}\n📋 Tarif: {txn.tariff_name}\n"
                f"💵 Summa: {txn.amount:,.0f} so'm\n📅 Yangi muddat: {new_exp}\n🔄 Provider: {txn.provider}",
            )
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "transaction": str(txn.id),
                "perform_time": int(datetime.utcnow().timestamp() * 1000),
                "state": 2,
            },
        }

    if method == "CancelTransaction":
        if txn and txn.status != "completed":
            txn.status = "failed"
            txn.note = "Payme CancelTransaction"
            txn.callback_payload = json.dumps(data, ensure_ascii=False)
            db.commit()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "transaction": str(txn.id) if txn else "0",
                "cancel_time": int(datetime.utcnow().timestamp() * 1000),
                "state": -1,
            },
        }

    if method == "CheckTransaction":
        if not txn:
            return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -31003, "message": "Transaction not found"}}
        state = 2 if txn.status == "completed" else 1 if txn.status == "pending" else -1
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "transaction": str(txn.id),
                "state": state,
                "create_time": int((txn.created_at.timestamp() if txn.created_at else datetime.utcnow().timestamp()) * 1000),
            },
        }

    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found"}}


# SuperAdmin manual to'lov kiritishi
class ManualPayment(BaseModel):
    salon_id: int
    tariff_id: int
    note: str = ""

@router.post("/manual-payment")
def manual_payment(data: ManualPayment, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    """SuperAdmin qo'lda to'lov kiritishi."""
    salon = db.query(models.Salon).filter(models.Salon.id == data.salon_id).first()
    if not salon: raise HTTPException(404, "Salon topilmadi")
    tariff = db.query(models.Tariff).filter(models.Tariff.id == data.tariff_id).first()
    if not tariff: raise HTTPException(404, "Tarif topilmadi")

    today = date.today()
    current_exp = today
    if salon.expires_at:
        try: current_exp = max(today, date.fromisoformat(salon.expires_at))
        except: pass
    new_exp = current_exp + timedelta(days=tariff.duration_days)

    txn = models.Transaction(
        salon_id=salon.id, tariff_id=tariff.id,
        amount=tariff.price, provider="manual",
        status="completed", tariff_name=tariff.name,
        duration_days=tariff.duration_days,
        note=data.note or f"SuperAdmin tomonidan kiritildi",
    )
    db.add(txn)
    salon.expires_at = str(new_exp)
    salon.is_active = True
    salon.block_reason = ""
    salon.plan = tariff.plan
    db.commit()
    return {"ok": True, "message": f"✅ {salon.name} obunasi {new_exp} gacha uzaytirildi"}


# ═══════════════════════════════════════════════════════════════════════════════
# 4. OBUNA TEKSHIRUVI VA AVTO-BLOKLASH
# ═══════════════════════════════════════════════════════════════════════════════
@router.post("/check-subscriptions")
def check_subscriptions(user=Depends(require_superadmin), db: Session = Depends(get_db)):
    """Barcha salonlarning obunasini tekshirish va muddati o'tganlarni bloklash."""
    today = str(date.today())
    warn3 = str(date.today() + timedelta(days=3))
    salons = db.query(models.Salon).filter(models.Salon.expires_at != None).all()
    blocked = 0; warned = 0
    for s in salons:
        if not s.expires_at: continue
        if s.expires_at < today and s.is_active:
            s.is_active = False
            s.block_reason = "Obuna muddati tugagan"
            blocked += 1
        elif s.expires_at <= warn3 and s.is_active:
            warned += 1
            # Telegram ogohlantirish
            if s.bot_token and s.admin_chat_id:
                try:
                    from telegram_bot import send_telegram_sync
                    days_left = (date.fromisoformat(s.expires_at) - date.today()).days
                    send_telegram_sync(
                        s.bot_token, s.admin_chat_id,
                        f"⚠️ Diqqat! Obunangiz {days_left} kundan keyin tugaydi.\n"
                        f"📅 Tugash sanasi: {s.expires_at}\n"
                        f"💳 Obunani uzaytirish uchun admin panelga kiring."
                    )
                except: pass
    db.commit()
    return {"ok": True, "blocked": blocked, "warned": warned}


# ═══════════════════════════════════════════════════════════════════════════════
# 5. SUPERADMIN MOLIYA STATISTIKASI
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/finance-stats")
def finance_stats(user=Depends(require_superadmin), db: Session = Depends(get_db)):
    """SuperAdmin moliya ko'rsatkichlari."""
    today = date.today()
    month_start = f"{today.year}-{today.month:02d}-01"
    warn3 = str(today + timedelta(days=3))

    # Jami tushum (barcha to'lovlar)
    total_revenue = db.query(func.coalesce(func.sum(models.Transaction.amount), 0)).filter(
        models.Transaction.status == "completed"
    ).scalar()

    # Oylik tushum
    monthly_revenue = db.query(func.coalesce(func.sum(models.Transaction.amount), 0)).filter(
        models.Transaction.status == "completed",
        models.Transaction.created_at >= month_start,
    ).scalar()

    # Aktiv salonlar
    active_salons = db.query(models.Salon).filter(models.Salon.is_active == True).count()

    # Kutilayotgan to'lovlar (3 kun ichida tugaydigan)
    pending = db.query(models.Salon).filter(
        models.Salon.is_active == True,
        models.Salon.expires_at != None,
        models.Salon.expires_at <= warn3,
        models.Salon.expires_at >= str(today),
    ).count()

    # Oylik tranzaksiyalar soni
    monthly_txn_count = db.query(models.Transaction).filter(
        models.Transaction.status == "completed",
        models.Transaction.created_at >= month_start,
    ).count()

    return {
        "total_revenue": float(total_revenue),
        "monthly_revenue": float(monthly_revenue),
        "active_salons": active_salons,
        "pending_payments": pending,
        "monthly_txn_count": monthly_txn_count,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 6. SALON OBUNA MA'LUMOTLARI (Admin uchun)
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/my-subscription")
def my_subscription(user=Depends(require_admin), db: Session = Depends(get_db)):
    """Salon admin o'z obuna holatini ko'radi."""
    salon_id = user.get("salon_id")
    if not salon_id: return {}
    salon = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
    if not salon: return {}
    today = date.today()
    days_left = -1
    warning = ""
    if salon.expires_at:
        try:
            exp = date.fromisoformat(salon.expires_at)
            days_left = (exp - today).days
            if days_left <= 0:
                warning = "🔴 Obuna muddati tugagan! To'lov qiling."
            elif days_left == 1:
                warning = "⚠️ Diqqat! Obunangiz ERTAGA tugaydi!"
            elif days_left == 2:
                warning = "⚠️ Obunangiz 2 kundan keyin tugaydi!"
            elif days_left <= 5:
                warning = f"⏳ Obunangiz {days_left} kundan keyin tugaydi."
        except: pass
    return {
        "salon_name": salon.name, "plan": salon.plan,
        "expires_at": salon.expires_at, "days_left": days_left,
        "is_active": salon.is_active, "block_reason": salon.block_reason or "",
        "warning": warning,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 7. TIZIM SOZLAMALARI (SuperAdmin global billing bot)
# ═══════════════════════════════════════════════════════════════════════════════
def get_setting(db, key, default=""):
    s = db.query(models.SystemSettings).filter(models.SystemSettings.key == key).first()
    return s.value if s else default

def set_setting(db, key, value):
    s = db.query(models.SystemSettings).filter(models.SystemSettings.key == key).first()
    if s:
        s.value = value
    else:
        db.add(models.SystemSettings(key=key, value=value))
    db.commit()


SETTINGS_KEYS = [
    "billing_bot_token", "billing_bot_chat_id",
    "click_merchant_id", "click_service_id", "click_secret_key",
    "payme_merchant_id", "payme_secret_key",
    "app_base_url",
    "click_allowed_ips", "payme_allowed_ips",
]

@router.get("/system-settings")
def get_system_settings(user=Depends(require_superadmin), db: Session = Depends(get_db)):
    return {k: get_setting(db, k) for k in SETTINGS_KEYS}


@router.get("/callback-urls")
def get_callback_urls(user=Depends(require_superadmin), db: Session = Depends(get_db)):
    base = (get_setting(db, "app_base_url") or "").rstrip("/")
    if not base:
        return {
            "configured": False,
            "message": "app_base_url sozlanmagan",
            "click_callback_url": "",
            "payme_callback_url": "",
        }
    return {
        "configured": True,
        "click_callback_url": f"{base}/api/billing/callbacks/click",
        "payme_callback_url": f"{base}/api/billing/callbacks/payme",
    }


class SettingsUpdate(BaseModel):
    billing_bot_token: Optional[str] = None
    billing_bot_chat_id: Optional[str] = None
    click_merchant_id: Optional[str] = None
    click_service_id: Optional[str] = None
    click_secret_key: Optional[str] = None
    payme_merchant_id: Optional[str] = None
    payme_secret_key: Optional[str] = None
    app_base_url: Optional[str] = None
    click_allowed_ips: Optional[str] = None
    payme_allowed_ips: Optional[str] = None

@router.post("/system-settings")
def save_system_settings(data: SettingsUpdate, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    updated = 0
    for k in SETTINGS_KEYS:
        v = getattr(data, k, None)
        if v is not None:
            set_setting(db, k, v)
            updated += 1
    return {"ok": True, "message": f"✅ {updated} ta sozlama saqlandi"}


@router.post("/test-billing-bot")
def test_billing_bot(user=Depends(require_superadmin), db: Session = Depends(get_db)):
    """Billing bot tokenini test qilish."""
    token = get_setting(db, "billing_bot_token")
    chat_id = get_setting(db, "billing_bot_chat_id")
    if not token or not chat_id:
        raise HTTPException(400, "Bot token yoki Chat ID kiritilmagan")
    try:
        import httpx
        r = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": "✅ SalonPro Billing Bot ulandi! Test xabar."},
            timeout=10,
        )
        if r.status_code == 200:
            return {"ok": True, "message": "✅ Bot ishlaydi! Test xabar yuborildi."}
        return {"ok": False, "message": f"❌ Xato: {r.text[:100]}"}
    except Exception as e:
        raise HTTPException(500, f"Bot xatosi: {str(e)[:100]}")


def send_billing_notification(db, text):
    """Billing bot orqali SuperAdminga xabar yuborish."""
    token = get_setting(db, "billing_bot_token")
    chat_id = get_setting(db, "billing_bot_chat_id")
    if not token or not chat_id:
        return
    try:
        import httpx
        httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
    except:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
# 8. SUPERADMIN XABAR YUBORISH (Telegram orqali)
# ═══════════════════════════════════════════════════════════════════════════════
class SendMessage(BaseModel):
    salon_id: Optional[int] = None
    message: str
    send_all: bool = False

@router.post("/send-message")
def send_message_to_salon(data: SendMessage, user=Depends(require_superadmin), db: Session = Depends(get_db)):
    """SuperAdmin salonlarga Telegram orqali xabar yuborish."""
    sent = 0; failed = 0
    if data.send_all:
        salons = db.query(models.Salon).filter(models.Salon.bot_token != None, models.Salon.admin_chat_id != None).all()
    elif data.salon_id:
        salons = db.query(models.Salon).filter(models.Salon.id == data.salon_id).all()
    else:
        raise HTTPException(400, "salon_id yoki send_all kerak")

    billing_token = get_setting(db, "billing_bot_token")
    for s in salons:
        if not s.admin_chat_id:
            continue
        token = billing_token or s.bot_token
        if not token:
            continue
        try:
            import httpx
            text = f"📢 <b>SalonPro xabarnoma</b>\n━━━━━━━━━━━━━━━━━━━━\n\n{data.message}\n\n🏪 {s.name}"
            r = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": s.admin_chat_id, "text": text, "parse_mode": "HTML"}, timeout=10)
            if r.status_code == 200: sent += 1
            else: failed += 1
        except:
            failed += 1
    return {"ok": True, "sent": sent, "failed": failed, "message": f"✅ {sent} ta salonga yuborildi"}


