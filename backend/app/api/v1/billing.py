"""Onlayn obuna to'lovi: direktor paket tanlaydi va Payme/Click orqali to'laydi.

Ikki qism:
  1) Direktor uchun (token bilan): obuna holati, paketlar, buyurtma ochish va uning holati.
     Obuna tugagan bo'lsa ham ishlaydi — aynan shunda to'lash kerak (app.billing_owner).
  2) To'lov tizimlari uchun (tokensiz): Payme Merchant API va Click SHOP API webhook'lari.
     Kalit/imzo shu yerda tekshiriladi, holat o'zgarishi esa bazadagi funksiyalarda (sql/037_billing.sql).
"""
import base64
import hashlib
import hmac
import logging
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_public_db
from app.core.config import get_settings

log = logging.getLogger("chronix.billing")

router = APIRouter(tags=["billing"])

Provider = Literal["payme", "click"]


# ─── Sxemalar ───────────────────────────────────────────────────────────────
class PackageOut(BaseModel):
    months: int
    discount_pct: int
    amount: int                       # so'm, chegirma bilan
    full_amount: int                  # chegirmasiz


class BillingOrderOut(BaseModel):
    id: int
    months: int
    amount: int
    provider: str
    status: str
    created_at: datetime
    paid_at: datetime | None


class BillingInfo(BaseModel):
    business_id: int
    business_name: str
    status: str
    monthly_fee: int
    subscription_ends_at: datetime | None
    operational: bool
    days_left: int | None             # None = muddatsiz; manfiy = tugaganiga shuncha kun bo'ldi
    providers: dict[str, bool]
    packages: list[PackageOut]
    orders: list[BillingOrderOut]


class OrderCreate(BaseModel):
    months: int = Field(ge=1, le=24)
    provider: Provider


class OrderCreated(BillingOrderOut):
    pay_url: str


# ─── Direktor ───────────────────────────────────────────────────────────────
def _require_owner(business_id: int, db: Session) -> None:
    if not db.scalar(text("SELECT app.billing_owner(:b)"), {"b": business_id}):
        raise HTTPException(403, detail={"code": "forbidden", "message": "Obunani faqat muassasa direktori to'laydi"})


def _providers() -> dict[str, bool]:
    s = get_settings()
    return {"payme": bool(s.payme_merchant_id and s.payme_key),
            "click": bool(s.click_service_id and s.click_merchant_id and s.click_secret_key)}


def _business(db: Session, business_id: int) -> dict:
    # Obunasi tugagan muassasa RLS orqali direktorga ko'rinmaydi (has_perm) — app.billing_business orqali
    row = db.execute(text("""
        SELECT b.id, b.name, b.slug, b.status::text AS status, b.monthly_fee, b.subscription_ends_at,
               app.business_operational(b.id) AS operational
          FROM app.billing_business(:b) b"""), {"b": business_id}).mappings().first()
    if row is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Muassasa topilmadi"})
    return dict(row)


def _order_out(r: Any) -> BillingOrderOut:
    return BillingOrderOut(id=r["id"], months=r["months"], amount=r["amount"], provider=r["provider"],
                           status=r["status"], created_at=r["created_at"], paid_at=r["paid_at"])


@router.get("/businesses/{business_id}/billing", response_model=BillingInfo)
def billing_info(business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    _require_owner(business_id, db)
    b = _business(db, business_id)
    packages = [PackageOut(months=r["months"], discount_pct=r["discount_pct"],
                           amount=r["amount"], full_amount=b["monthly_fee"] * r["months"])
                for r in db.execute(text("""
                    SELECT p.months, p.discount_pct, app.billing_price(:b, p.months) AS amount
                      FROM billing_packages p WHERE p.is_active ORDER BY p.months"""), {"b": business_id}).mappings()
                if r["amount"] is not None]
    orders = db.execute(text("""
        SELECT id, months, amount, provider, status, created_at, paid_at FROM billing_orders
         WHERE business_id = :b ORDER BY created_at DESC, id DESC LIMIT 20"""), {"b": business_id}).mappings()
    ends = b["subscription_ends_at"]
    days_left = None
    if ends is not None:
        days_left = int((ends - datetime.now(timezone.utc)).total_seconds() // 86400)
    return BillingInfo(business_id=b["id"], business_name=b["name"], status=b["status"], monthly_fee=b["monthly_fee"],
                       subscription_ends_at=ends, operational=b["operational"], days_left=days_left,
                       providers=_providers(), packages=packages, orders=[_order_out(o) for o in orders])


def _pay_url(order_id: int, amount: int, provider: str, slug: str) -> str:
    s = get_settings()
    back = f"{s.business_panel_url.rstrip('/')}/{slug}/obuna?order={order_id}"
    if provider == "payme":
        params = f"m={s.payme_merchant_id};ac.order_id={order_id};a={amount * 100};c={back}"
        host = "https://test.paycom.uz" if s.payme_test_mode else "https://checkout.paycom.uz"
        return f"{host}/{base64.b64encode(params.encode()).decode()}"
    query = urlencode({"service_id": s.click_service_id, "merchant_id": s.click_merchant_id, "amount": amount,
                       "transaction_param": order_id, "return_url": back,
                       **({"merchant_user_id": s.click_merchant_user_id} if s.click_merchant_user_id else {})})
    return f"https://my.click.uz/services/pay?{query}"


@router.post("/businesses/{business_id}/billing/orders", response_model=OrderCreated, status_code=201)
def create_order(body: OrderCreate, business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    _require_owner(business_id, db)
    if not _providers()[body.provider]:
        raise HTTPException(409, detail={"code": "provider_disabled",
                                         "message": "Bu to'lov usuli hozircha ulanmagan"})
    b = _business(db, business_id)
    if b["status"] == "blocked":
        raise HTTPException(409, detail={"code": "business_blocked", "message": "Muassasa bloklangan"})
    try:
        # Summani baza hisoblaydi (guard_billing_orders): bu yerda yuborilmaydi ham
        row = db.execute(text("""
            INSERT INTO billing_orders (business_id, months, amount, provider) VALUES (:b, :m, 1, :p)
            RETURNING id, months, amount, provider, status, created_at, paid_at"""),
            {"b": business_id, "m": body.months, "p": body.provider}).mappings().one()
    except DBAPIError as e:
        db.rollback()
        if "billing_package_unavailable" in str(e.orig) or "foreign key" in str(e.orig).lower():
            raise HTTPException(422, detail={"code": "package_unavailable", "message": "Bunday paket yo'q"})
        raise
    db.commit()
    return OrderCreated(**_order_out(row).model_dump(), pay_url=_pay_url(row["id"], row["amount"], body.provider, b["slug"]))


@router.get("/businesses/{business_id}/billing/orders/{order_id}", response_model=BillingOrderOut)
def get_order(business_id: int = Path(ge=1), order_id: int = Path(ge=1), db: Session = Depends(get_db)):
    _require_owner(business_id, db)
    row = db.execute(text("""
        SELECT id, months, amount, provider, status, created_at, paid_at FROM billing_orders
         WHERE id = :o AND business_id = :b"""), {"o": order_id, "b": business_id}).mappings().first()
    if row is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Buyurtma topilmadi"})
    return _order_out(row)


# ─── Payme Merchant API ─────────────────────────────────────────────────────
# Xato kodlari: https://developer.help.paycom.uz/protokol-merchant-api/
_PAYME_ERRORS = {
    "auth": (-32504, "Avtorizatsiya xatosi"),
    "method": (-32601, "Metod topilmadi"),
    "format": (-32600, "So'rov formati noto'g'ri"),
    "wrong_amount": (-31001, "Summa noto'g'ri"),
    "not_found": (-31003, "Tranzaksiya topilmadi"),
    "cannot_cancel": (-31007, "Buyurtma bajarilgan, bekor qilib bo'lmaydi"),
    "cannot_perform": (-31008, "Amalni bajarib bo'lmaydi"),
    "order_not_found": (-31050, "Buyurtma topilmadi"),
    "order_unavailable": (-31051, "Buyurtma to'langan yoki yopilgan"),
    "order_busy": (-31052, "Buyurtma uchun boshqa tranzaksiya kutilmoqda"),
}


def _payme_error(req_id: Any, code: str, data: str | None = None) -> JSONResponse:
    num, msg = _PAYME_ERRORS[code]
    err: dict[str, Any] = {"code": num, "message": {"uz": msg, "ru": msg, "en": msg}}
    if data:
        err["data"] = data
    return JSONResponse({"jsonrpc": "2.0", "id": req_id, "error": err})


def _payme_authorized(request: Request) -> bool:
    key = get_settings().payme_key
    header = request.headers.get("authorization", "")
    if key is None or not header.lower().startswith("basic "):
        return False
    try:
        login, _, password = base64.b64decode(header[6:]).decode().partition(":")
    except Exception:
        return False
    return login == "Paycom" and hmac.compare_digest(password, key.get_secret_value())


def _txn_payload(r: Any) -> dict:
    return {"id": r["ext_id"], "time": r["provider_time"], "amount": r["amount"] * 100,
            "account": {"order_id": str(r["order_id"])}, "create_time": r["create_time"],
            "perform_time": r["perform_time"], "cancel_time": r["cancel_time"], "transaction": str(r["transaction"]),
            "state": r["state"], "reason": r["reason"]}


def _tiyin_to_som(amount: Any) -> int | None:
    if not isinstance(amount, int) or amount <= 0 or amount % 100:
        return None
    return amount // 100


def _order_id(params: dict) -> int | None:
    raw = (params.get("account") or {}).get("order_id")
    try:
        value = int(str(raw))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


@router.post("/billing/payme", include_in_schema=False)
async def payme_webhook(request: Request, db: Session = Depends(get_public_db)):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
    req_id = body.get("id") if isinstance(body, dict) else None
    if not _payme_authorized(request):
        return _payme_error(req_id, "auth")
    if not isinstance(body, dict) or not isinstance(body.get("params"), dict):
        return _payme_error(req_id, "format")
    method, params = body.get("method"), body["params"]

    def ok(result: dict) -> JSONResponse:
        db.commit()
        return JSONResponse({"jsonrpc": "2.0", "id": req_id, "result": result})

    if method in ("CheckPerformTransaction", "CreateTransaction"):
        amount, order = _tiyin_to_som(params.get("amount")), _order_id(params)
        if order is None:
            return _payme_error(req_id, "order_not_found", "order_id")
        if amount is None:
            return _payme_error(req_id, "wrong_amount")
        if method == "CheckPerformTransaction":
            code = db.scalar(text("SELECT app.billing_check('payme', :o, :a)"), {"o": order, "a": amount})
            return ok({"allow": True}) if code == "ok" else _payme_error(req_id, code, "order_id")
        ext, time_ms = params.get("id"), params.get("time")
        if not isinstance(ext, str) or not ext or len(ext) > 64 or not isinstance(time_ms, int):
            return _payme_error(req_id, "format")
        r = db.execute(text("SELECT * FROM app.payme_create(:e, :o, :a, :t)"),
                       {"e": ext, "o": order, "a": amount, "t": time_ms}).mappings().one()
        db.commit()                                   # 12 soatlik bekor qilish ham saqlansin
        if r["code"] != "ok":
            return _payme_error(req_id, r["code"], "order_id" if r["code"].startswith("order") else None)
        return ok({"create_time": r["create_time"], "transaction": str(r["transaction"]), "state": r["state"]})

    if method in ("PerformTransaction", "CancelTransaction", "CheckTransaction"):
        ext = params.get("id")
        if not isinstance(ext, str) or not ext:
            return _payme_error(req_id, "format")
        if method == "PerformTransaction":
            r = db.execute(text("SELECT * FROM app.payme_perform(:e)"), {"e": ext}).mappings().one()
            db.commit()
            if r["code"] != "ok":
                return _payme_error(req_id, r["code"])
            return ok({"transaction": str(r["transaction"]), "perform_time": r["perform_time"], "state": r["state"]})
        if method == "CancelTransaction":
            reason = params.get("reason")
            if not isinstance(reason, int):
                return _payme_error(req_id, "format")
            r = db.execute(text("SELECT * FROM app.payme_cancel(:e, :r)"), {"e": ext, "r": reason}).mappings().one()
            db.commit()
            if r["code"] != "ok":
                return _payme_error(req_id, r["code"])
            return ok({"transaction": str(r["transaction"]), "cancel_time": r["cancel_time"], "state": r["state"]})
        r = db.execute(text("SELECT * FROM app.payme_get(:e)"), {"e": ext}).mappings().first()
        if r is None:
            return _payme_error(req_id, "not_found")
        return ok({"create_time": r["create_time"], "perform_time": r["perform_time"], "cancel_time": r["cancel_time"],
                   "transaction": str(r["transaction"]), "state": r["state"], "reason": r["reason"]})

    if method == "GetStatement":
        start, end = params.get("from"), params.get("to")
        if not isinstance(start, int) or not isinstance(end, int):
            return _payme_error(req_id, "format")
        rows = db.execute(text("SELECT * FROM app.payme_statement(:f, :t)"), {"f": start, "t": end}).mappings()
        return ok({"transactions": [_txn_payload(r) for r in rows]})

    return _payme_error(req_id, "method")


# ─── Click SHOP API ─────────────────────────────────────────────────────────
# Xato kodlari: 0 ok, -1 imzo, -2 summa, -3 action, -4 allaqachon to'langan, -5 buyurtma yo'q,
# -6 tranzaksiya yo'q, -8 so'rov xatosi, -9 bekor qilingan
_CLICK_NOTES = {0: "Success", -1: "SIGN CHECK FAILED", -2: "Incorrect parameter amount", -3: "Action not found",
                -4: "Already paid", -5: "Order not found", -6: "Transaction does not exist",
                -8: "Error in request from click", -9: "Transaction cancelled"}


def _click_reply(form: dict, error: int, **extra: Any) -> dict:
    return {"click_trans_id": form.get("click_trans_id"), "merchant_trans_id": form.get("merchant_trans_id"),
            "error": error, "error_note": _CLICK_NOTES.get(error, "Error"), **extra}


def _click_sign_ok(form: dict, with_prepare: bool) -> bool:
    s = get_settings()
    if s.click_secret_key is None or s.click_service_id is None:
        return False
    parts = [form.get("click_trans_id", ""), form.get("service_id", ""), s.click_secret_key.get_secret_value(),
             form.get("merchant_trans_id", "")]
    if with_prepare:
        parts.append(form.get("merchant_prepare_id", ""))
    parts += [form.get("amount", ""), form.get("action", ""), form.get("sign_time", "")]
    expected = hashlib.md5("".join(str(p) for p in parts).encode()).hexdigest()
    return (hmac.compare_digest(expected, str(form.get("sign_string", "")).lower())
            and str(form.get("service_id")) == str(s.click_service_id))


def _click_amount(raw: Any) -> int | None:
    try:
        value = float(str(raw))
    except (TypeError, ValueError):
        return None
    return int(value) if value > 0 and value == int(value) else None


async def _click_form(request: Request) -> dict:
    return {k: str(v) for k, v in (await request.form()).items()}


@router.post("/billing/click/prepare", include_in_schema=False)
async def click_prepare(request: Request, db: Session = Depends(get_public_db)):
    form = await _click_form(request)
    if not _click_sign_ok(form, with_prepare=False):
        return _click_reply(form, -1)
    if form.get("action") != "0":
        return _click_reply(form, -3)
    amount, ext = _click_amount(form.get("amount")), form.get("click_trans_id", "")
    try:
        order = int(form.get("merchant_trans_id", ""))
    except ValueError:
        return _click_reply(form, -5)
    if amount is None:
        return _click_reply(form, -2)
    if not ext or len(ext) > 64:
        return _click_reply(form, -8)
    r = db.execute(text("SELECT * FROM app.click_prepare(:e, :o, :a)"), {"e": ext, "o": order, "a": amount}).mappings().one()
    db.commit()
    return _click_reply(form, r["error"], merchant_prepare_id=r["prepare_id"])


@router.post("/billing/click/complete", include_in_schema=False)
async def click_complete(request: Request, db: Session = Depends(get_public_db)):
    form = await _click_form(request)
    if not _click_sign_ok(form, with_prepare=True):
        return _click_reply(form, -1)
    if form.get("action") != "1":
        return _click_reply(form, -3)
    amount, ext = _click_amount(form.get("amount")), form.get("click_trans_id", "")
    try:
        order, prepare = int(form.get("merchant_trans_id", "")), int(form.get("merchant_prepare_id", ""))
        click_error = int(form.get("error", "0"))
    except ValueError:
        return _click_reply(form, -6)
    if amount is None:
        return _click_reply(form, -2)
    r = db.execute(text("SELECT * FROM app.click_complete(:e, :o, :p, :a, :x)"),
                   {"e": ext, "o": order, "p": prepare, "a": amount, "x": click_error}).mappings().one()
    db.commit()
    return _click_reply(form, r["error"], merchant_confirm_id=r["confirm_id"])
