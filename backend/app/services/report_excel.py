"""Hisobotni Excel (.xlsx) ga yozish.

Xavfsizlik: mijoz yoki xizmat nomi '=' bilan boshlansa, Excel uni formula deb bajarib yuborishi mumkin
(CSV/formula injection). Shuning uchun barcha matnlar majburan matn turida yoziladi.
"""
import io
from datetime import date, datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.schemas.reports import ReportOut

METHODS = {"cash": "Naqd", "card": "Karta", "click": "Click", "payme": "Payme", "uzum": "Uzum", "bonus": "Bonus"}
STATUSES = {"pending": "Kutilmoqda", "confirmed": "Tasdiqlangan", "in_progress": "Jarayonda",
            "completed": "Bajarilgan", "cancelled": "Bekor qilingan", "no_show": "Kelmagan"}
PAY_STATUSES = {"paid": "To'langan", "refunded": "Qaytarilgan", "pending": "Kutilmoqda", "failed": "Xato"}
SOURCES = {"app": "Ilova", "admin": "Panel", "walk_in": "O'zi kelgan", "telegram": "Telegram"}

_HEAD = Font(bold=True, color="FFFFFF")
_HEAD_FILL = PatternFill("solid", fgColor="010D49")
_MONEY = '#,##0 "so\'m"'


def _cell(ws, row: int, col: int, value):
    c = ws.cell(row=row, column=col)
    if isinstance(value, str):
        c.value = value
        c.data_type = "s"                    # formula sifatida o'qilmasin
    else:
        c.value = value
    return c


def _table(ws, start_row: int, headers: list[str], rows: list[list], money_cols: set[int] = frozenset()) -> int:
    for i, h in enumerate(headers, 1):
        c = _cell(ws, start_row, i, h)
        c.font, c.fill = _HEAD, _HEAD_FILL
        c.alignment = Alignment(vertical="center")
    for r, values in enumerate(rows, start_row + 1):
        for i, v in enumerate(values, 1):
            c = _cell(ws, r, i, v)
            if i in money_cols:
                c.number_format = _MONEY
            elif isinstance(v, (date, datetime)):
                c.number_format = "dd.mm.yyyy hh:mm" if isinstance(v, datetime) else "dd.mm.yyyy"
    return start_row + len(rows) + 1


def _widths(ws, widths: list[int]) -> None:
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def build_workbook(business_name: str, r: ReportOut, payments: list) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Umumiy"
    _cell(ws, 1, 1, business_name).font = Font(bold=True, size=14)
    _cell(ws, 2, 1, f"Hisobot: {r.date_from:%d.%m.%Y} – {r.date_to:%d.%m.%Y}")
    m, b = r.money, r.bookings
    row = _table(ws, 4, ["Ko'rsatkich", "Qiymat"], [
        ["Tushum", m.income], ["Qaytarilgan", m.refunds], ["Sof tushum", m.net_income],
        ["Xarajatlar", m.expenses], ["Foyda", m.profit],
        ["Oldingi davr sof tushumi", m.prev_net_income], ["Oldingi davr foydasi", m.prev_profit],
        ["Bajarilgan bronlar summasi", b.completed_revenue], ["O'rtacha chek", b.avg_check],
    ], money_cols={2})
    row = _table(ws, row + 1, ["Bronlar", "Soni"], [
        ["Jami", b.total], ["Bajarilgan", b.completed],
        *[[STATUSES.get(k, k), v] for k, v in b.by_status.items() if k != "completed"],
        ["Bekor qilish ulushi, %", b.cancel_rate],
        *[[f"Manba: {SOURCES.get(k, k)}", v] for k, v in b.by_source.items()],
        ["Mijozlar (jami)", r.clients.total], ["Yangi mijozlar", r.clients.new], ["Qaytgan mijozlar", r.clients.returning],
    ])
    _table(ws, row + 1, ["To'lov usuli", "Tushum", "Qaytarilgan"],
           [[METHODS.get(x.method, x.method), x.income, x.refunds] for x in r.methods], money_cols={2, 3})
    _widths(ws, [32, 18, 16])

    ws = wb.create_sheet("Kunlar")
    _table(ws, 1, ["Sana", "Tushum", "Qaytarilgan", "Xarajat", "Bronlar"],
           [[d.date, d.income, d.refunds, d.expenses, d.bookings] for d in r.daily], money_cols={2, 3, 4})
    _widths(ws, [14, 16, 16, 16, 10])

    ws = wb.create_sheet("Xizmatlar")
    _table(ws, 1, ["Xizmat", "Soni", "Summa"], [[s.name, s.count, s.revenue] for s in r.services], money_cols={3})
    _widths(ws, [40, 10, 18])

    ws = wb.create_sheet("Xodimlar")
    _table(ws, 1, ["Xodim", "Bronlar", "Bajarilgan", "Kelmagan", "Summa"],
           [[s.name, s.bookings, s.completed, s.no_show, s.revenue] for s in r.staff], money_cols={5})
    _widths(ws, [30, 10, 12, 10, 18])

    ws = wb.create_sheet("Xarajatlar")
    _table(ws, 1, ["Toifa", "Summa"], [[e.name, e.amount] for e in r.expenses_by_category], money_cols={2})
    _widths(ws, [30, 18])

    ws = wb.create_sheet("To'lovlar")
    _table(ws, 1, ["To'langan", "Mijoz", "Usul", "Summa", "Holat", "Qaytarilgan", "Sabab", "Qabul qildi"],
           [[p["paid_at"], p["client"] or "", METHODS.get(p["method"], p["method"]), p["amount"],
             PAY_STATUSES.get(p["status"], p["status"]), p["refunded_at"], p["refund_reason"] or "",
             p["received_by"] or ""] for p in payments], money_cols={4})
    _widths(ws, [18, 26, 10, 16, 14, 18, 30, 24])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
