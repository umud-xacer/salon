from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

MAX_AMOUNT = 1_000_000_000_000

Method = Literal["cash", "card", "click", "payme", "uzum"]


class PaymentIn(BaseModel):
    amount: int = Field(gt=0, le=MAX_AMOUNT)
    method: Method
    note: str | None = Field(default=None, max_length=500)


class RefundIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class PaymentOut(BaseModel):
    id: int
    appointment_id: int | None
    amount: int
    method: str
    status: str
    paid_at: datetime
    note: str | None
    received_by_name: str | None
    client_name: str | None
    refunded_at: datetime | None
    refund_reason: str | None
    refunded_by_name: str | None


class AppointmentPayments(BaseModel):
    appointment_id: int
    payable: bool
    total: int
    paid: int
    due: int
    payments: list[PaymentOut]


class UnpaidAppointment(BaseModel):
    id: int
    starts_at: datetime
    status: str
    client_name: str | None
    member_name: str | None
    services: list[str]
    services_ru: list[str] = []
    due: int


class MethodTotal(BaseModel):
    method: str
    income: int
    refunds: int


class CashDay(BaseModel):
    date: date
    income: int
    refunds: int
    expenses: int | None          # finance.view bo'lmasa ko'rsatilmaydi
    net: int | None
    methods: list[MethodTotal]
    unpaid: list[UnpaidAppointment]
    payments: list[PaymentOut]


class ExpenseCategoryIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class ExpenseCategoryOut(BaseModel):
    id: int
    name: str


class ExpenseIn(BaseModel):
    category_id: int | None = Field(default=None, ge=1)
    amount: int = Field(gt=0, le=MAX_AMOUNT)
    spent_at: date
    note: str | None = Field(default=None, max_length=500)


class ExpenseOut(BaseModel):
    id: int
    category_id: int | None
    category_name: str | None
    amount: int
    spent_at: date
    note: str | None
    created_by_name: str | None


class ExpenseList(BaseModel):
    total: int
    items: list[ExpenseOut]
