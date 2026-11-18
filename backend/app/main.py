import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

from app.api.v1 import (analytics, appointments, auth, auto_messages, billing, broadcasts, cash_shifts, forms, resources, timesheet, blocks, waitlist, business_admin, catalog, clients, finance, geo, inventory, me, members,
                        payroll, promotions, reception, reminders, reports, reviews, schedule, superadmin, telegram, visits)
from app.core.config import get_settings
from app.db.session import MAX_INFLIGHT
from app.services.auth_service import AuthError

log = logging.getLogger("app")
settings = get_settings()

app = FastAPI(
    title="Chronix API",
    version="0.1.0",
    docs_url=None if settings.env == "prod" else "/docs",
    redoc_url=None,
    openapi_url=None if settings.env == "prod" else "/openapi.json",
)



class InflightLimit:
    """Bir vaqtda ishlanadigan HTTP so'rovlar soni baza ulanishlaridan oshmasin (db/session.py dagi izoh).
    Ortiqcha so'rovlar shu yerda navbat kutadi — qotib qolish va 500 o'rniga biroz sekinroq javob."""

    def __init__(self, app, limit: int):
        import asyncio
        self.app = app
        self.sem = asyncio.Semaphore(limit)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        async with self.sem:
            return await self.app(scope, receive, send)


app.add_middleware(InflightLimit, limit=MAX_INFLIGHT)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,                 # token Authorization sarlavhasida, cookie emas
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    if settings.env == "prod":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


@app.exception_handler(AuthError)
async def auth_error_handler(request: Request, exc: AuthError):
    return JSONResponse(status_code=exc.status_code, content={"detail": {"code": exc.code, "message": exc.message}})


# Bazaning himoya cheklovlari → tushunarli HTTP javob. Texnik tafsilot mijozga chiqmaydi.
_DB_ERRORS = {
    "42501": (403, "forbidden", "Bu amal uchun huquq yo'q"),              # RLS / guard triggerlar
    "23P01": (409, "time_conflict", "Bu vaqt band"),                       # no_double_booking
    "23505": (409, "already_exists", "Bunday yozuv allaqachon mavjud"),
    "23503": (422, "invalid_reference", "Bog'langan yozuv topilmadi yoki boshqa biznesga tegishli"),
    "23514": (422, "constraint_failed", "Qiymat qoidalarga mos emas"),
    "22P02": (422, "invalid_value", "Qiymat noto'g'ri"),
    "22023": (422, "invalid_value", "Sana yoki vaqt qadami noto'g'ri"),     # app.available_slots
    "P0002": (404, "not_found", "Usta yoki xizmat topilmadi"),             # app.available_slots
    "P0429": (429, "rate_limited", "Juda ko'p urinish"),
    "P0410": (409, "shared_account", "Bu odam boshqa salon yoki mijoz hisobiga ham bog'langan. "
                                     "Parolni o'zi yoki Super Admin o'zgartiradi"),
    "P0409": (409, "not_changeable", "Bu bronni endi o'zgartirib bo'lmaydi"),   # boshlangan yoki yopilgan bron
    "P0404": (404, "not_found", "Yozuv topilmadi"),
    "P0411": (409, "overpaid", "Summa qolgan qarzdan oshib ketdi"),
    "P0412": (409, "not_payable", "Bekor qilingan yoki mijoz kelmagan bronga to'lov qabul qilinmaydi"),
    "P0413": (409, "already_refunded", "Bu to'lov allaqachon qaytarilgan"),
    "P0414": (409, "insufficient_stock", "Omborda yetarli qoldiq yo'q"),
    "P0415": (409, "product_inactive", "Mahsulot yashirilgan, avval uni faollashtiring"),
    "P0416": (409, "payroll_locked", "Tasdiqlangan oylikni o'zgartirib bo'lmaydi"),
    "P0417": (409, "payroll_not_approved", "Oylik avval tasdiqlanishi kerak"),
    "P0418": (409, "not_completed", "Baho faqat yakunlangan tashrifdan keyin qo'yiladi"),
    "P0419": (409, "review_expired", "Baho tashrifdan keyin 30 kun ichida qo'yiladi"),
    "P0420": (409, "already_reviewed", "Bu tashrifga baho allaqachon qo'yilgan"),
    "P0421": (409, "line_not_removable", "Bu xizmatni olib tashlab bo'lmaydi: oxirgi xizmat yoki puli to'langan"),
    "P0422": (409, "advance_settled", "Bu avans oylikdan ayirilgan, endi bekor qilib bo'lmaydi"),
    "P0423": (409, "nobody_free", "Hozir bo'sh mutaxassis yo'q"),
    "P0424": (409, "resource_busy", "Bu vaqtda bo'sh xona yoki kreslo yo'q. Boshqa vaqt yoki resursni tanlang"),
    "P0425": (409, "resource_not_suitable", "Tanlangan xona yoki kreslo bu xizmatga mos emas"),
    "P0426": (409, "already_checked_in", "Bugun allaqachon kelganingiz belgilangan"),
    "P0427": (409, "not_checked_in", "Avval \"Keldim\" tugmasini bosing"),
    "P0428": (409, "has_staff", "Faol xodimlar bor. Yakka rejimga o'tish uchun avval ularni o'chiring yoki bron qilinmaydigan qiling"),
    "P0450": (409, "business_account", "Salon xodimi yoki direktori hisobini ilovadan o'chirib bo'lmaydi. "
                                       "Qo'llab-quvvatlash xizmatiga yozing"),
    "P0440": (409, "promo_not_found", "Promokod topilmadi yoki muddati tugagan"),
    "P0441": (409, "promo_used", "Bu promokoddan allaqachon foydalangansiz"),
    "P0442": (409, "promo_limit", "Promokod limiti tugagan"),
    "P0443": (409, "promo_first_visit", "Bu promokod faqat birinchi tashrif uchun"),
    "P0430": (409, "branch_parent_invalid", "Filial faqat asosiy kompaniyaga biriktiriladi (filialning filiali bo'lmaydi)"),
    "P0431": (409, "branch_has_children", "Bu muassasaning o'z filiallari bor, uni boshqasiga filial qilib bo'lmaydi"),
    "P0432": (409, "branch_parent_invalid", "Filial faqat asosiy muassasadan qo'shiladi (filialning filiali bo'lmaydi)"),
    "P0433": (402, "chain_inactive", "Avval asosiy muassasa obunasini to'lang, keyin filial qo'shing"),
    "P0434": (422, "invalid_branch_name", "Filial nomini kiriting (2–80 belgi)"),
    "P0435": (422, "location_required", "Xaritada filial joyini belgilang"),
}


@app.exception_handler(DBAPIError)
async def db_error_handler(request: Request, exc: DBAPIError):
    state = getattr(exc.orig, "sqlstate", None)
    if state in _DB_ERRORS:
        status, code, message = _DB_ERRORS[state]
        log.info("DB rejected %s %s: %s", request.method, request.url.path, state)
        return JSONResponse(status_code=status, content={"detail": {"code": code, "message": message}})
    log.exception("Unexpected DB error")
    return JSONResponse(status_code=500, content={"detail": {"code": "server_error", "message": "Server xatosi"}})


app.include_router(auth.router, prefix="/api/v1")
app.include_router(superadmin.router, prefix="/api/v1")
app.include_router(members.router, prefix="/api/v1")
app.include_router(members.my_router, prefix="/api/v1")
app.include_router(catalog.router, prefix="/api/v1")
app.include_router(geo.router, prefix="/api/v1")
app.include_router(business_admin.router, prefix="/api/v1")
app.include_router(schedule.router, prefix="/api/v1")
app.include_router(appointments.router, prefix="/api/v1")
app.include_router(reception.router, prefix="/api/v1")
app.include_router(blocks.router, prefix="/api/v1")
app.include_router(waitlist.router, prefix="/api/v1")
app.include_router(waitlist.my_router, prefix="/api/v1")
app.include_router(auto_messages.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(analytics.admin_router, prefix="/api/v1")
app.include_router(broadcasts.router, prefix="/api/v1")
app.include_router(cash_shifts.router, prefix="/api/v1")
app.include_router(forms.router, prefix="/api/v1")
app.include_router(resources.router, prefix="/api/v1")
app.include_router(timesheet.router, prefix="/api/v1")
app.include_router(visits.router, prefix="/api/v1")
app.include_router(clients.router, prefix="/api/v1")
app.include_router(finance.router, prefix="/api/v1")
app.include_router(inventory.router, prefix="/api/v1")
app.include_router(payroll.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(reviews.router, prefix="/api/v1")
app.include_router(me.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(promotions.router, prefix="/api/v1")
app.include_router(telegram.router, prefix="/api/v1")

# Prod'da rasmlarni Caddy beradi. Dev'da shu yerdan
if settings.env != "prod":
    from pathlib import Path

    from fastapi.staticfiles import StaticFiles
    Path(settings.media_dir).mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")
app.include_router(reminders.router)


@app.get("/health", include_in_schema=False)
def health():
    return {"ok": True}
