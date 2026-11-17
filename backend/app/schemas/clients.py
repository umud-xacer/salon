import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.security import normalize_phone

Gender = Literal["male", "female"]
# Mijoz qayerdan keldi (050_client_card.sql dagi CHECK bilan bir xil)
Source = Literal["instagram", "telegram", "recommendation", "walk_by", "google", "chronix", "advert", "other"]


class ClientOut(BaseModel):
    id: int
    full_name: str
    phone: str
    notes: str | None                                   # eski bitta izoh (mobil API uchun); panel — /notes
    has_account: bool                                   # mobil ilovada hisobi bor
    visits: int                                         # yakunlangan tashriflar
    total_spent: int
    last_visit: dt.datetime | None
    created_at: dt.datetime
    birth_date: dt.date | None = None
    gender: Gender | None = None
    source: Source | None = None
    backup_phone: str | None = None                     # ilovadagi mijoz o'zi kiritgan zaxira raqam (053)
    # Salonning ichki ma'lumoti (mijoz o'zi ko'rmaydi)
    tags: list[str] = []
    alert: str | None = None                            # jamoa uchun ogohlantirish (kalendarda ko'rinadi)
    allergies: str | None = None
    notes_count: int = 0


def _clean_tags(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    out: list[str] = []
    for tag in v:
        tag = " ".join(tag.split())
        if tag and tag.lower() not in (x.lower() for x in out):
            out.append(tag)
    if len(out) > 10:
        raise ValueError("Ko'pi bilan 10 ta teg")
    if any(len(x) > 30 for x in out):
        raise ValueError("Teg 30 belgidan oshmasin")
    return out


class _ClientFields(BaseModel):
    birth_date: dt.date | None = None
    gender: Gender | None = None
    source: Source | None = None
    tags: list[str] | None = None
    alert: str | None = Field(default=None, max_length=300)
    allergies: str | None = Field(default=None, max_length=500)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str] | None) -> list[str] | None:
        return _clean_tags(v)

    @field_validator("birth_date")
    @classmethod
    def _birth(cls, v: dt.date | None) -> dt.date | None:
        if v is not None and (v > dt.date.today() or v.year < 1900):
            raise ValueError("Tug'ilgan sana noto'g'ri")
        return v


class ClientCreate(_ClientFields):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str
    notes: str | None = Field(default=None, max_length=2000)   # birinchi eslatma sifatida yoziladi

    @field_validator("phone")
    @classmethod
    def _norm(cls, v: str) -> str:
        return normalize_phone(v)


class ClientUpdate(_ClientFields):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("phone")
    @classmethod
    def _norm(cls, v: str | None) -> str | None:
        return normalize_phone(v) if v is not None else None


class ClientNoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ClientNoteOut(BaseModel):
    id: int
    body: str
    author: str | None
    created_at: dt.datetime
    can_delete: bool


class TagCount(BaseModel):
    tag: str
    count: int
