import datetime as dt
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field


class BookingCreate(BaseModel):
    member_id: int = Field(ge=1)
    service_id: int = Field(ge=1)
    starts_at: AwareDatetime
    note: str | None = Field(default=None, max_length=500)


class CancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


class RescheduleIn(BaseModel):
    starts_at: AwareDatetime


class StatusIn(BaseModel):
    status: Literal["confirmed", "in_progress", "completed", "no_show"]


class DeviceIn(BaseModel):
    token: str = Field(pattern=r"^ExponentPushToken\[[A-Za-z0-9_-]+\]$", max_length=200)
    platform: Literal["ios", "android"]


class ClientContactOut(BaseModel):
    phone: str
    tel_url: str


class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    body: str | None
    data: dict | None
    read_at: dt.datetime | None
    created_at: dt.datetime


class AppointmentOut(BaseModel):
    id: int
    business_id: int
    business_name: str | None
    business_slug: str | None = None
    business_address: str | None = None
    business_lat: float | None = None
    business_lng: float | None = None
    member_id: int
    member_name: str | None
    status: str
    starts_at: dt.datetime
    ends_at: dt.datetime
    total_price: int
    services: list[str]
    services_ru: list[str] = []                         # ruscha nomlar (yo'q bo'lsa o'zbekchasi) — ruscha ilova/panel uchun
    service_ids: list[int]
    client_note: str | None
    cancel_reason: str | None
    attendance: Literal["reminded", "confirmed", "no_response"] | None = None
    needs_contact: bool = False                         # ochiq ogohlantirish: qo'ng'iroq tugmasi faol
    review_rating: int | None = None                    # mijoz qo'ygan baho (bo'lsa)
    review_staff_rating: int | None = None
    can_review: bool = False                            # yakunlangan, 30 kun o'tmagan, hali baholanmagan
    confirm_by: dt.datetime | None = None               # 'pending': salon shu vaqtgacha tasdiqlamasa — avtomatik bekor
    client_name: str | None = None                      # faqat 'clients.view' huquqi borlarga
    client_phone: str | None = None
