from datetime import time

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from app.core.security import normalize_phone

Price = Field(ge=0, le=100_000_000)            # so'm
Duration = Field(ge=5, le=720)                 # daqiqa


def _https(v: HttpUrl | None) -> str | None:
    if v is None:
        return None
    if v.scheme != "https":
        raise ValueError("Faqat https:// havola")
    return str(v)


# ─── Ochiq katalog ──────────────────────────────────────────────────────────
class CategoryOut(BaseModel):
    id: int
    slug: str
    name_uz: str
    name_ru: str
    icon: str | None


class BusinessCard(BaseModel):
    """Ro'yxat va xarita belgisi uchun qisqa ma'lumot."""
    id: int
    slug: str
    name: str
    category: str
    category_name: str
    city: str | None
    address: str | None
    lat: float
    lng: float
    distance_m: int | None = None
    rating_avg: float
    rating_count: int
    logo_url: str | None
    min_price: int | None
    is_open_now: bool


class NearbyOut(BaseModel):
    items: list[BusinessCard]
    total: int
    radius_m: int


class HoursOut(BaseModel):
    weekday: int
    opens_at: time
    closes_at: time


class ServiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    duration_min: int
    price: int


class ServiceGroupOut(BaseModel):
    category_id: int | None
    category_name: str
    services: list[ServiceOut]


class StaffOut(BaseModel):
    member_id: int
    full_name: str
    title: str | None
    bio: str | None
    photo_url: str | None
    rating_avg: float
    rating_count: int
    service_ids: list[int]


class BusinessDetail(BaseModel):
    id: int
    slug: str
    name: str
    description: str | None
    category: str
    category_name: str
    phone: str | None
    city: str | None
    address: str | None
    lat: float | None
    lng: float | None
    logo_url: str | None
    cover_url: str | None
    rating_avg: float
    rating_count: int
    is_open_now: bool
    hours: list[HoursOut]
    photos: list[str]
    service_groups: list[ServiceGroupOut]
    staff: list[StaffOut]


class PlaceOut(BaseModel):
    address: str
    name: str
    lat: float
    lng: float
    precision: str


# ─── Salon egasi: profil ────────────────────────────────────────────────────
class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=3000)
    phone: str | None = None
    city: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=300)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    is_listed: bool | None = None
    logo_url: HttpUrl | None = None
    cover_url: HttpUrl | None = None

    @field_validator("phone")
    @classmethod
    def norm_phone(cls, v):
        return normalize_phone(v) if v else v

    @field_validator("logo_url", "cover_url")
    @classmethod
    def https_only(cls, v):
        return _https(v)

    @model_validator(mode="after")
    def _both_coords(self):
        if (self.lat is None) != (self.lng is None):
            raise ValueError("lat va lng birga yuborilishi kerak")
        return self


class ProfileOut(BaseModel):
    id: int
    slug: str
    name: str
    description: str | None
    category_id: int
    status: str
    phone: str | None
    city: str | None
    address: str | None
    lat: float | None
    lng: float | None
    is_listed: bool
    logo_url: str | None
    cover_url: str | None


class HoursIn(BaseModel):
    weekday: int = Field(ge=1, le=7)
    opens_at: time
    closes_at: time

    @model_validator(mode="after")
    def _order(self):
        if self.closes_at <= self.opens_at:
            raise ValueError("Yopilish vaqti ochilishdan keyin bo'lishi kerak")
        return self


class HoursReplace(BaseModel):
    days: list[HoursIn] = Field(max_length=7)          # ro'yxatda yo'q kun — dam olish kuni

    @field_validator("days")
    @classmethod
    def _unique(cls, v):
        if len({d.weekday for d in v}) != len(v):
            raise ValueError("Bir kun ikki marta berilgan")
        return v


class PhotoIn(BaseModel):
    url: HttpUrl
    sort_order: int = Field(default=0, ge=0, le=100)

    @field_validator("url")
    @classmethod
    def https_only(cls, v):
        return _https(v)


class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    url: str
    sort_order: int


# ─── Salon egasi: xizmatlar ─────────────────────────────────────────────────
class ServiceCategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = Field(default=0, ge=0, le=1000)


class ServiceCategoryOut(ServiceCategoryIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ServiceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    category_id: int | None = Field(default=None, ge=1)
    duration_min: int = Duration
    price: int = Price


class ServiceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    category_id: int | None = Field(default=None, ge=1)
    duration_min: int | None = Field(default=None, ge=5, le=720)
    price: int | None = Field(default=None, ge=0, le=100_000_000)
    is_active: bool | None = None


class ServiceAdminOut(ServiceOut):
    category_id: int | None
    is_active: bool


class MemberServiceIn(BaseModel):
    service_id: int = Field(ge=1)
    custom_price: int | None = Field(default=None, ge=0, le=100_000_000)
    custom_duration: int | None = Field(default=None, ge=5, le=720)


class MemberServicesReplace(BaseModel):
    services: list[MemberServiceIn] = Field(max_length=200)

    @field_validator("services")
    @classmethod
    def _unique(cls, v):
        if len({s.service_id for s in v}) != len(v):
            raise ValueError("Xizmat ikki marta berilgan")
        return v
