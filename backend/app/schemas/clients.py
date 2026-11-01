import datetime as dt

from pydantic import BaseModel, Field, field_validator

from app.core.security import normalize_phone


class ClientOut(BaseModel):
    id: int
    full_name: str
    phone: str
    notes: str | None
    has_account: bool                                   # mobil ilovada hisobi bor
    visits: int                                         # yakunlangan tashriflar
    total_spent: int
    last_visit: dt.datetime | None
    created_at: dt.datetime


class ClientCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("phone")
    @classmethod
    def _norm(cls, v: str) -> str:
        return normalize_phone(v)


class ClientUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("phone")
    @classmethod
    def _norm(cls, v: str | None) -> str | None:
        return normalize_phone(v) if v is not None else None
