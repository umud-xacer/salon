import datetime as dt

from pydantic import AwareDatetime, BaseModel, Field, model_validator


class BlockTypeIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    duration_min: int = Field(default=30, ge=5, le=720)
    sort_order: int = Field(default=0, ge=0, le=999)


class BlockTypeOut(BaseModel):
    id: int
    name: str
    duration_min: int
    sort_order: int


class TimeBlockIn(BaseModel):
    member_id: int = Field(ge=1)
    type_id: int | None = Field(default=None, ge=1)
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    note: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _check(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("Tugash vaqti boshlanishdan keyin bo'lishi kerak")
        if self.ends_at - self.starts_at > dt.timedelta(hours=12):
            raise ValueError("Blok 12 soatdan oshmaydi (uzoqroq bo'lsa — ta'til)")
        if self.note is not None:
            self.note = self.note.strip() or None
        return self


class CalendarBlock(BaseModel):
    """Kalendardagi band oraliq: blok (tushlik, tozalash...) yoki ta'til."""
    id: int
    member_id: int
    starts_at: dt.datetime
    ends_at: dt.datetime
    is_block: bool                     # false — ta'til/dam olish (Xodimlar bo'limida kiritiladi)
    type_id: int | None
    title: str | None                  # tur nomi yoki izoh
    note: str | None
