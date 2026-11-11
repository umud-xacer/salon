from datetime import date

from pydantic import BaseModel


class MoneyStats(BaseModel):
    income: int            # to'langan
    refunds: int           # qaytarilgan
    net_income: int        # income - refunds
    expenses: int          # xarajatlar (to'langan oyliklar ham shu yerda)
    profit: int            # net_income - expenses
    prev_net_income: int   # oldingi teng davr — o'sishni ko'rsatish uchun
    prev_profit: int


class MethodRow(BaseModel):
    method: str
    income: int
    refunds: int


class ExpenseRow(BaseModel):
    name: str
    amount: int


class BookingStats(BaseModel):
    total: int
    by_status: dict[str, int]
    by_source: dict[str, int]
    completed: int
    completed_revenue: int
    avg_check: int
    cancel_rate: float     # foiz


class ServiceRow(BaseModel):
    name: str
    name_ru: str | None = None
    count: int
    revenue: int


class StaffRow(BaseModel):
    member_id: int
    name: str
    bookings: int
    completed: int
    no_show: int
    revenue: int


class ClientStats(BaseModel):
    total: int
    new: int
    returning: int


class DayRow(BaseModel):
    date: date
    income: int
    refunds: int
    expenses: int
    bookings: int


class ReportOut(BaseModel):
    date_from: date
    date_to: date
    money: MoneyStats
    methods: list[MethodRow]
    expenses_by_category: list[ExpenseRow]
    bookings: BookingStats
    services: list[ServiceRow]
    staff: list[StaffRow]
    clients: ClientStats
    daily: list[DayRow]
