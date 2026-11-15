import datetime as dt

from pydantic import BaseModel, Field, field_validator, model_validator


class PromoRuleIn(BaseModel):
    title: str = Field(min_length=2, max_length=80)
    percent: int = Field(ge=5, le=70)
    weekdays: list[int] = Field(min_length=1, max_length=7)
    time_from: dt.time
    time_to: dt.time
    service_ids: list[int] | None = Field(default=None, max_length=100)
    valid_from: dt.date | None = None
    valid_to: dt.date | None = None
    is_active: bool = True

    @field_validator("weekdays")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in v):
            raise ValueError("Hafta kuni 1 (dushanba) dan 7 (yakshanba) gacha")
        return sorted(set(v))

    @field_validator("service_ids")
    @classmethod
    def _services(cls, v: list[int] | None) -> list[int] | None:
        return sorted(set(v)) if v else None

    @model_validator(mode="after")
    def _range(self):
        if self.time_to <= self.time_from:
            raise ValueError("Tugash vaqti boshlanishidan keyin bo'lsin")
        if self.valid_from and self.valid_to and self.valid_to < self.valid_from:
            raise ValueError("Tugash sanasi boshlanishidan oldin bo'lmasin")
        return self


class PromoRuleOut(BaseModel):
    id: int
    title: str
    percent: int
    weekdays: list[int]
    time_from: dt.time
    time_to: dt.time
    service_ids: list[int] | None
    valid_from: dt.date
    valid_to: dt.date | None
    is_active: bool


class PromoCodeIn(BaseModel):
    code: str = Field(min_length=3, max_length=20)
    title: str = Field(min_length=2, max_length=80)
    percent: int = Field(ge=5, le=90)
    max_uses: int | None = Field(default=None, ge=1, le=1_000_000)
    first_visit_only: bool = False
    is_public: bool = False
    valid_from: dt.date | None = None
    valid_to: dt.date | None = None
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = v.strip().upper()
        if not v.isascii() or not v.isalnum():
            raise ValueError("Promokod faqat lotin harflari va raqamlardan iborat bo'lsin")
        return v

    @model_validator(mode="after")
    def _range(self):
        if self.valid_from and self.valid_to and self.valid_to < self.valid_from:
            raise ValueError("Tugash sanasi boshlanishidan oldin bo'lmasin")
        return self


class PromoCodeOut(BaseModel):
    id: int
    code: str
    title: str
    percent: int
    max_uses: int | None
    first_visit_only: bool
    is_public: bool
    valid_from: dt.date
    valid_to: dt.date | None
    is_active: bool
    uses: int


class LoyaltyIn(BaseModel):
    visits_required: int = Field(ge=2, le=20)
    reward_percent: int = Field(ge=5, le=100)
    is_active: bool = True


class LoyaltyOut(LoyaltyIn):
    pass


class HotSlotOut(BaseModel):
    business_id: int
    business_slug: str
    business_name: str
    category_name: str
    category_name_ru: str | None = None
    distance_m: int | None
    photo: str | None
    service_id: int
    service_name: str
    service_name_ru: str | None = None
    member_id: int
    member_name: str
    starts_at: dt.datetime
    time: str
    percent: int
    price: int
    final: int
    rule_title: str
    ends_window: dt.time


class OfferOut(BaseModel):
    business_id: int
    business_slug: str
    business_name: str
    distance_m: int | None
    code: str
    title: str
    percent: int
    first_visit_only: bool
    valid_to: dt.date | None


class MyLoyaltyOut(BaseModel):
    business_id: int
    business_slug: str
    business_name: str
    visits: int
    required: int
    percent: int
    ready: bool
