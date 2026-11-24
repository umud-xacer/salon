"""Direktorning o'zi ro'yxatdan o'tishi va 5 kunlik sinov (sql/070_business_signup.sql)."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.security import normalize_phone

TeamSize = Literal["1", "2-5", "6-10", "11-20", "21+"]


class SignupPollIn(BaseModel):
    nonce: str = Field(min_length=16, max_length=64)


class SignupPollOut(BaseModel):
    status: Literal["pending", "ok"]
    signup_token: str | None = None
    phone: str | None = None
    full_name: str | None = None
    exists: bool = False
    has_password: bool = False


class SignupIn(BaseModel):
    signup_token: str = Field(min_length=20, max_length=2000)
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    category_id: int = Field(ge=1)
    team_size: TeamSize
    business_name: str = Field(min_length=2, max_length=120)
    region: str | None = Field(default=None, max_length=80)
    city: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=300)
    contact_phone: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("contact_phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return normalize_phone(v) if v and v.strip() else None


class Readiness(BaseModel):
    logged_in: bool = False
    services: bool = False
    staff: bool = False
    hours: bool = False
    location: bool = False
    photos: bool = False
    visible: bool = False
    all_filled: bool = False


class OnboardingOut(BaseModel):
    """Direktor paneli: ariza holati, sinov muddati va ilovaga chiqish uchun qolgan qadamlar."""
    status: Literal["none", "pending", "trial", "converted"]
    trial_ends_at: datetime | None = None
    days_left: int | None = None
    readiness: Readiness | None = None


class SignupAdminOut(BaseModel):
    business_id: int
    business_name: str
    slug: str
    category_name: str | None
    region: str | None
    city: str | None
    address: str | None
    contact_phone: str | None
    team_size: str
    owner_name: str
    owner_phone: str
    owner_telegram: bool
    status: Literal["pending", "trial", "converted"]
    created_at: datetime
    reviewed_at: datetime | None
    trial_started_at: datetime | None
    trial_ends_at: datetime | None
    sms_day3_at: datetime | None
    tg_day4_at: datetime | None
    readiness: Readiness | None


class SignupApproveIn(BaseModel):
    days: int | None = Field(default=None, ge=1, le=60)        # bo'sh — sozlamadagi (TRIAL_DAYS)


class SignupRejectIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class TrialEventOut(BaseModel):
    id: int
    business_id: int
    business_name: str
    owner_phone: str | None
    event: str
    dry_run: bool
    details: dict
    created_at: datetime
