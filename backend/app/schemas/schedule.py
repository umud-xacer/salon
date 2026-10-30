import datetime as dt

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class BreakIn(BaseModel):
    start: dt.time
    end: dt.time

    @model_validator(mode="after")
    def _order(self):
        if self.end <= self.start:
            raise ValueError("Tanaffus tugashi boshlanishidan keyin bo'lishi kerak")
        return self


class ScheduleDay(BaseModel):
    weekday: int = Field(ge=1, le=7)                    # 1 = dushanba
    start_time: dt.time
    end_time: dt.time
    breaks: list[BreakIn] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def _check(self):
        if self.end_time <= self.start_time:
            raise ValueError("Ish tugashi boshlanishidan keyin bo'lishi kerak")
        self.breaks.sort(key=lambda b: b.start)
        prev_end = self.start_time
        for b in self.breaks:
            if b.start <= prev_end or b.end >= self.end_time:
                raise ValueError("Tanaffus ish vaqti ichida bo'lishi va boshqasiga tegmasligi kerak")
            prev_end = b.end
        return self


class ScheduleReplace(BaseModel):
    days: list[ScheduleDay] = Field(max_length=7)       # ro'yxatda yo'q kun — dam olish kuni

    @field_validator("days")
    @classmethod
    def _unique(cls, v):
        if len({d.weekday for d in v}) != len(v):
            raise ValueError("Bir kun ikki marta berilgan")
        return v


class TimeOffIn(BaseModel):
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    reason: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _order(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("Tugash vaqti boshlanishidan keyin bo'lishi kerak")
        return self


class TimeOffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    starts_at: dt.datetime
    ends_at: dt.datetime
    reason: str | None


class SlotOut(BaseModel):
    starts_at: dt.datetime
    ends_at: dt.datetime
    time: str                                           # biznes vaqti bo'yicha, "10:30"


class SlotsOut(BaseModel):
    date: dt.date
    member_id: int
    service_id: int
    slots: list[SlotOut]
