import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.security import normalize_phone

Status = Literal["waiting", "offered", "booked", "expired", "cancelled"]


class _Window(BaseModel):
    service_id: int = Field(ge=1)
    member_id: int | None = Field(default=None, ge=1)          # None — istalgan usta
    date_from: dt.date
    date_to: dt.date
    time_from: dt.time | None = None                           # None — kun bo'yi
    time_to: dt.time | None = None
    note: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _check(self):
        if self.date_to < self.date_from or (self.date_to - self.date_from).days > 30:
            raise ValueError("Sanalar oralig'i noto'g'ri (ko'pi bilan 31 kun)")
        if (self.time_from is None) != (self.time_to is None):
            raise ValueError("Vaqt oralig'ining ikkala chegarasi ham kerak")
        if self.time_from is not None and self.time_to <= self.time_from:
            raise ValueError("Vaqt oralig'i noto'g'ri")
        return self


class WaitlistCreate(_Window):
    """Qabulxona qo'shadi."""
    client_name: str = Field(min_length=2, max_length=120)
    client_phone: str

    @field_validator("client_phone")
    @classmethod
    def _norm(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("client_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Mijoz ismi juda qisqa")
        return v


class WaitlistJoin(_Window):
    """Mijoz o'zi yoziladi (ilova / chronix.uz)."""
    business_id: int = Field(ge=1)


class WaitlistBook(BaseModel):
    """Qabulxona bron qiladi: taklif qilingan vaqt yoki o'zi tanlagan vaqt/usta."""
    member_id: int | None = Field(default=None, ge=1)
    starts_at: dt.datetime | None = None


class WaitlistOut(BaseModel):
    id: int
    business_id: int
    business_name: str | None = None
    client_id: int
    client_name: str | None
    client_phone: str | None
    has_account: bool = False                                 # ilovasi bor — taklif push bilan ketadi
    service_id: int
    service_name: str
    member_id: int | None
    member_name: str | None
    date_from: dt.date
    date_to: dt.date
    time_from: dt.time | None
    time_to: dt.time | None
    note: str | None
    status: Status
    source: Literal["admin", "app"]
    offered_member_id: int | None
    offered_member_name: str | None
    offered_starts_at: dt.datetime | None
    offered_at: dt.datetime | None
    appointment_id: int | None
    created_at: dt.datetime
    position: int | None = None                               # navbatdagi o'rni (faol yozuvlar orasida)


class WaitlistSummary(BaseModel):
    waiting: int
    offered: int
