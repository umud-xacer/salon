"""Sayt sozlamalari (sql/068): chronix.uz footer'idagi havolalar va kontaktlar.

GET /site/settings — ochiq (sayt o'qiydi, keshlanadi); GET/PUT /superadmin/site-settings — faqat Super Admin.
Bo'sh maydon saytda ko'rsatilmaydi.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_public_db, require_superadmin
from app.core.cache import public_cache, ttl
from app.services import audit

router = APIRouter(prefix="/site", tags=["site"])
admin_router = APIRouter(prefix="/superadmin/site-settings", tags=["superadmin"],
                         dependencies=[Depends(require_superadmin)])

URL_FIELDS = ("telegram_url", "instagram_url", "youtube_url", "play_url", "appstore_url")
TEXT_FIELDS = ("phone", "email", "address_uz", "address_ru", "work_hours_uz", "work_hours_ru", "about_uz", "about_ru")
FIELDS = URL_FIELDS + TEXT_FIELDS
_URL = re.compile(r'^https://[^\s<>"]+$')
_PHONE = re.compile(r"^\+[0-9 ()-]{7,30}$")
_EMAIL = re.compile(r'^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$')


class SiteSettings(BaseModel):
    telegram_url: str = Field("", max_length=300)
    instagram_url: str = Field("", max_length=300)
    youtube_url: str = Field("", max_length=300)
    play_url: str = Field("", max_length=300)
    appstore_url: str = Field("", max_length=300)
    phone: str = Field("", max_length=32)
    email: str = Field("", max_length=120)
    address_uz: str = Field("", max_length=300)
    address_ru: str = Field("", max_length=300)
    work_hours_uz: str = Field("", max_length=120)
    work_hours_ru: str = Field("", max_length=120)
    about_uz: str = Field("", max_length=400)
    about_ru: str = Field("", max_length=400)

    @field_validator(*FIELDS, mode="before")
    @classmethod
    def _strip(cls, v):
        return (v or "").strip() if isinstance(v, str) or v is None else v

    @field_validator(*URL_FIELDS)
    @classmethod
    def _url(cls, v: str) -> str:
        if v and not _URL.match(v):
            raise ValueError("Havola https:// bilan boshlanishi kerak (masalan https://t.me/chronix)")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        if v and not _PHONE.match(v):
            raise ValueError("Telefon + bilan boshlansin, masalan +998 20 003 55 99")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        if v and not _EMAIL.match(v):
            raise ValueError("Email noto'g'ri")
        return v


def _load(db: Session) -> SiteSettings:
    row = db.execute(text(f"SELECT {', '.join(FIELDS)} FROM site_settings")).mappings().first()
    return SiteSettings(**row) if row else SiteSettings()


@router.get("/settings", response_model=SiteSettings)
def public_settings(db: Session = Depends(get_public_db)):
    return public_cache.get_or_set(("site_settings",), ttl(10), lambda: _load(db))


@admin_router.get("", response_model=SiteSettings)
def get_settings_admin(db: Session = Depends(get_db)):
    return _load(db)


@admin_router.put("", response_model=SiteSettings)
def update_settings(body: SiteSettings, db: Session = Depends(get_db)):
    data = body.model_dump()
    try:
        res = db.execute(text(f"UPDATE site_settings SET {', '.join(f'{f} = :{f}' for f in FIELDS)}, updated_at = now()"),
                         data)
    except IntegrityError:
        db.rollback()
        raise HTTPException(422, detail={"code": "invalid", "message": "Ma'lumot noto'g'ri formatda"})
    if res.rowcount != 1:
        raise HTTPException(500, detail={"code": "no_row", "message": "Sozlamalar qatori topilmadi"})
    audit.log(db, None, "update", "site_settings", None, data)
    db.commit()
    public_cache.clear()          # sayt darhol yangisini ko'rsin
    return _load(db)
