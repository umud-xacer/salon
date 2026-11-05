import datetime as dt

from pydantic import BaseModel, Field, field_validator


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)                               # muassasaga umumiy baho
    cleanliness: int = Field(ge=1, le=5)                          # tozalik
    service_quality: int = Field(ge=1, le=5)                      # qabul va xizmat sifati
    comment: str | None = Field(default=None, max_length=2000)
    staff_rating: int | None = Field(default=None, ge=1, le=5)    # xizmat ko'rsatgan usta / shifokorga
    staff_comment: str | None = Field(default=None, max_length=1000)


class ReplyIn(BaseModel):
    reply: str | None = Field(default=None, max_length=1000)     # bo'sh yoki null — javob olib tashlanadi

    @field_validator("reply")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class HideIn(BaseModel):
    is_hidden: bool


class PublicReview(BaseModel):
    id: int
    author: str
    member_id: int | None
    member_name: str | None
    rating: int
    cleanliness: int | None
    service_quality: int | None
    comment: str | None
    staff_rating: int | None
    staff_comment: str | None
    reply: str | None
    reply_at: dt.datetime | None
    created_at: dt.datetime


class ReviewSummary(BaseModel):
    count: int
    rating_avg: float | None
    cleanliness_avg: float | None
    quality_avg: float | None
    distribution: dict[int, int]                                  # {5: 12, 4: 3, ...}


class PublicReviewsOut(BaseModel):
    summary: ReviewSummary
    items: list[PublicReview]


class BusinessReview(PublicReview):
    """Direktor paneli: mijozning to'liq ismi va telefoni (clients.view bo'lmasa ham — o'z mijozi), yashirilganmi."""
    client_name: str | None
    client_phone: str | None
    appointment_id: int
    appointment_starts_at: dt.datetime
    is_hidden: bool
    replied_by_name: str | None


class BusinessReviewsOut(BaseModel):
    summary: ReviewSummary
    items: list[BusinessReview]
    total: int
