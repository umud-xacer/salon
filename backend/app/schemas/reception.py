import datetime as dt

from pydantic import AwareDatetime, BaseModel, Field, field_validator

from app.core.security import normalize_phone
from app.schemas.appointments import AppointmentOut


class CalendarStaff(BaseModel):
    id: int
    full_name: str
    title: str | None


class CalendarOut(BaseModel):
    start: dt.date
    days: int
    hour_from: int
    hour_to: int
    staff: list[CalendarStaff]
    appointments: list[AppointmentOut]


class OptionService(BaseModel):
    id: int
    name: str
    duration_min: int
    price: int


class OptionStaff(CalendarStaff):
    service_ids: list[int]


class ReceptionOptions(BaseModel):
    services: list[OptionService]
    staff: list[OptionStaff]


class AnySlot(BaseModel):
    starts_at: dt.datetime
    ends_at: dt.datetime
    time: str
    free_staff: int


class ReceptionBooking(BaseModel):
    member_id: int | None = Field(default=None, ge=1)     # None = istalgan usta
    service_id: int = Field(ge=1)
    starts_at: AwareDatetime
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
