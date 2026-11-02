from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

MAX_MONEY = 1_000_000_000_000


class CompensationIn(BaseModel):
    base_salary: int = Field(ge=0, le=MAX_MONEY)
    commission_percent: Decimal = Field(ge=0, le=100, decimal_places=2)


class CompensationOut(BaseModel):
    member_id: int
    full_name: str
    role: str
    title: str | None
    base_salary: int
    commission_percent: float


class GenerateIn(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


class GenerateOut(BaseModel):
    members: int


class PayrollAdjust(BaseModel):
    bonus: int = Field(ge=0, le=MAX_MONEY)
    deductions: int = Field(ge=0, le=MAX_MONEY)
    note: str | None = Field(default=None, max_length=500)


class PayrollOut(BaseModel):
    id: int
    member_id: int
    full_name: str
    title: str | None
    period_start: date
    period_end: date
    base_salary: int
    revenue: int
    commission_percent: float
    commission: int
    bonus: int
    deductions: int
    total: int
    status: str
    note: str | None
    approved_at: datetime | None
    paid_at: datetime | None


class PayrollList(BaseModel):
    month: str
    total: int
    paid: int
    items: list[PayrollOut]
