import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

from app.api.v1 import auth, members, superadmin
from app.core.config import get_settings
from app.services.auth_service import AuthError

log = logging.getLogger("app")
settings = get_settings()

app = FastAPI(
    title="Salon Platform API",
    version="0.1.0",
    docs_url=None if settings.env == "prod" else "/docs",
    redoc_url=None,
    openapi_url=None if settings.env == "prod" else "/openapi.json",
)

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
    "P0429": (429, "rate_limited", "Juda ko'p urinish"),
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


@app.get("/health", include_in_schema=False)
def health():
    return {"ok": True}
