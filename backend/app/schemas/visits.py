import datetime as dt

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.security import normalize_phone


class LineIn(BaseModel):
    service_id: int = Field(ge=1)
    member_id: int | None = Field(default=None, ge=1)     # None = bronning o'z mutaxassisi
    house: bool = False                                   # muassasa hisobiga: hech kimga foiz yo'q

    @model_validator(mode="after")
    def _house_has_no_member(self):
        if self.house:
            self.member_id = None
        return self


class LineOut(BaseModel):
    id: int
    service_id: int
    service_name: str
    service_name_ru: str
    price: int
    duration_min: int
    house: bool
    member_id: int | None          # haqiqiy ijrochi (house bo'lsa None)
    member_name: str | None
    category_id: int | None
    category_name: str | None
    category_name_ru: str | None


class VisitLines(BaseModel):
    appointment_id: int
    status: str
    total: int                     # chegirmadan keyin
    lines: list[LineOut]


class ReceiptSection(BaseModel):
    category_id: int | None        # None = bo'limsiz xizmatlar
    name: str | None
    name_ru: str | None
    subtotal: int
    lines: list[LineOut]


class ReceiptPayment(BaseModel):
    method: str
    amount: int
    paid_at: dt.datetime


class ReceiptOut(BaseModel):
    appointment_id: int
    business_name: str
    business_address: str | None
    business_phone: str | None
    client_name: str | None
    client_phone: str | None
    starts_at: dt.datetime
    status: str
    printed_at: dt.datetime
    sections: list[ReceiptSection]
    subtotal: int
    discount: int
    total: int
    paid: int
    due: int
    payments: list[ReceiptPayment]


class WalkInOption(BaseModel):
    member_id: int
    full_name: str
    title: str | None
    price: int
    duration_min: int
    free: bool
    busy_until: dt.datetime | None
    on_shift: bool


class WalkInBooking(BaseModel):
    service_id: int = Field(ge=1)
    member_id: int | None = Field(default=None, ge=1)     # None = bo'sh mutaxassislardan eng kam bandi
    client_name: str = Field(min_length=2, max_length=120)
    client_phone: str
    note: str | None = Field(default=None, max_length=500)

    @field_validator("client_phone")
    @classmethod
    def _norm(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("client_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Mijoz ismi juda qisqa")
        return v
