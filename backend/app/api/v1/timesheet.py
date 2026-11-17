"""Xodimlar tabeli va ish vaqti (060_timesheet.sql).

Tabel (oylik matritsa), kunlik reja va keldi/ketdi tuzatish — 'staff.manage' yoki 'payroll.manage'.
Xodim o'zi: "Keldim" / "Ketdim" (vaqtni server qo'yadi) va o'z oyini ko'radi.
Hisob-kitob (kechikish, ishlagan daqiqa, kelmagan kunlar) bazada — app.timesheet_days.
"""
import datetime as dt
import io
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_any_permission
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}", tags=["timesheet"])
_manage = require_any_permission("staff.manage", "payroll.manage")
_MONTH = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")

Status = Literal["work", "late", "absent", "day_off", "vacation", "sick", "off", "planned", "today"]
CODES = {"late": "K", "absent": "Y", "day_off": "D", "off": "D", "vacation": "T", "sick": "B", "planned": "", "today": "·"}


def _bounds(month: str) -> tuple[dt.date, dt.date]:
    y, m = map(int, month.split("-"))
    start = dt.date(y, m, 1)
    end = (dt.date(y + (m == 12), m % 12 + 1, 1)) - dt.timedelta(days=1)
    return start, end


class Cell(BaseModel):
    day: dt.date
    status: Status
    code: str
    planned_start: dt.time | None
    planned_end: dt.time | None
    check_in: dt.datetime | None
    check_out: dt.datetime | None
    worked_min: int
    late_min: int
    early_min: int
    note: str | None
    source: str | None


class Totals(BaseModel):
    worked_days: int = 0
    worked_hours: float = 0
    late_count: int = 0
    late_minutes: int = 0
    absent_days: int = 0
    day_off: int = 0
    vacation: int = 0
    sick: int = 0


class MemberRow(BaseModel):
    member_id: int
    full_name: str
    title: str | None
    cells: list[Cell]
    totals: Totals


class TimesheetOut(BaseModel):
    month: str
    late_grace_min: int
    members: list[MemberRow]


def _code(r: dict) -> str:
    if r["status"] == "work":
        h = r["worked_min"] / 60
        return f"{h:.1f}".rstrip("0").rstrip(".") + "s" if r["worked_min"] else "✓"
    return CODES.get(r["status"], "")


def _totals(cells: list[Cell]) -> Totals:
    t = Totals()
    for c in cells:
        if c.status in ("work", "late"):
            t.worked_days += 1
            t.worked_hours += c.worked_min / 60
        if c.status == "late":
            t.late_count += 1
            t.late_minutes += c.late_min
        t.absent_days += c.status == "absent"
        t.day_off += c.status in ("day_off", "off")
        t.vacation += c.status == "vacation"
        t.sick += c.status == "sick"
    t.worked_hours = round(t.worked_hours, 1)
    return t


def _sheet(db: Session, business_id: int, month: str, member_id: int | None = None) -> TimesheetOut:
    start, end = _bounds(month)
    rows = db.execute(text("SELECT * FROM app.timesheet_days(:b, :s, :e, :m)"),
                      {"b": business_id, "s": start, "e": end, "m": member_id}).mappings().all()
    names = {r["id"]: r for r in db.execute(text("""
        SELECT m.id, u.full_name, m.title FROM business_members m JOIN users u ON u.id = m.user_id
         WHERE m.business_id = :b"""), {"b": business_id}).mappings()}
    by_member: dict[int, list[Cell]] = {}
    for r in rows:
        by_member.setdefault(r["member_id"], []).append(Cell(**r, code=_code(r)))
    grace = db.scalar(text("SELECT late_grace_min FROM timesheet_settings WHERE business_id = :b"), {"b": business_id}) or 15
    members = [MemberRow(member_id=mid, full_name=names[mid]["full_name"], title=names[mid]["title"], cells=cells,
                         totals=_totals(cells))
               for mid, cells in by_member.items() if mid in names]
    members.sort(key=lambda x: x.full_name)
    return TimesheetOut(month=month, late_grace_min=grace, members=members)


@router.get("/timesheet", response_model=TimesheetOut)
def timesheet(month: str = _MONTH, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    return _sheet(db, business_id, month)


# ─── Katakni tahrirlash ──────────────────────────────────────────────────────────────────────────
DayKind = Literal["auto", "work", "day_off", "vacation", "sick", "absent"]


class DayIn(BaseModel):
    kind: DayKind = "auto"                               # auto — haftalik jadval bo'yicha
    start_time: dt.time | None = None                    # alohida smena (kind=work)
    end_time: dt.time | None = None
    check_in: dt.time | None = None                      # keldi/ketdi tuzatish (muassasa vaqti)
    check_out: dt.time | None = None
    note: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _check(self):
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("Smena boshi va oxirini birga kiriting")
        if self.start_time and (self.kind != "work" or self.end_time <= self.start_time):
            raise ValueError("Smena vaqti noto'g'ri")
        if self.check_out and not self.check_in:
            raise ValueError("Avval kelgan vaqtni kiriting")
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            raise ValueError("Ketgan vaqt kelgan vaqtdan keyin bo'lishi kerak")
        return self


def _member(db: Session, business_id: int, member_id: int) -> None:
    if not db.scalar(text("SELECT 1 FROM business_members WHERE id = :m AND business_id = :b"), {"m": member_id, "b": business_id}):
        raise HTTPException(404, detail={"code": "not_found", "message": "Xodim topilmadi"})


def _set_plan(db: Session, business_id: int, member_id: int, day: dt.date, body: DayIn) -> None:
    if body.kind == "auto":
        db.execute(text("DELETE FROM staff_days WHERE member_id = :m AND day = :d"), {"m": member_id, "d": day})
        return
    db.execute(text("""
        INSERT INTO staff_days (business_id, member_id, day, kind, start_time, end_time, note)
        VALUES (:b, :m, :d, :k, :s, :e, :n)
        ON CONFLICT (member_id, day) DO UPDATE SET kind = EXCLUDED.kind, start_time = EXCLUDED.start_time,
               end_time = EXCLUDED.end_time, note = EXCLUDED.note
    """), {"b": business_id, "m": member_id, "d": day, "k": body.kind, "s": body.start_time, "e": body.end_time,
           "n": (body.note or "").strip() or None})


@router.put("/timesheet/{member_id}/{day}", response_model=MemberRow)
def set_day(body: DayIn, member_id: int = Path(ge=1), day: dt.date = Path(), business_id: int = Depends(_manage),
            db: Session = Depends(get_db)):
    _member(db, business_id, member_id)
    _set_plan(db, business_id, member_id, day, body)
    if body.check_in:
        db.execute(text("""
            INSERT INTO staff_attendance (business_id, member_id, day, check_in, check_out, source, note)
            SELECT :b, :m, :d, (CAST(:d AS date) + CAST(:ci AS time)) AT TIME ZONE z.tz,
                   (CAST(:d AS date) + CAST(:co AS time)) AT TIME ZONE z.tz, 'admin', :n
              FROM (SELECT timezone AS tz FROM businesses WHERE id = :b) z
            ON CONFLICT (member_id, day) DO UPDATE SET check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
                   source = 'admin', note = EXCLUDED.note
        """), {"b": business_id, "m": member_id, "d": day, "ci": body.check_in, "co": body.check_out,
               "n": (body.note or "").strip() or None})
    elif body.kind in ("day_off", "vacation", "sick", "absent", "auto"):
        db.execute(text("DELETE FROM staff_attendance WHERE member_id = :m AND day = :d AND :clear"),
                   {"m": member_id, "d": day, "clear": body.kind != "auto"})
    audit.log(db, business_id, "update", "timesheet", member_id, {"day": day.isoformat(), "kind": body.kind})
    db.commit()
    return _sheet(db, business_id, day.strftime("%Y-%m"), member_id).members[0]


class RangeIn(DayIn):
    member_ids: list[int] = Field(min_length=1, max_length=100)
    date_from: dt.date
    date_to: dt.date
    weekdays: list[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6, 7])   # 1 = dushanba

    @model_validator(mode="after")
    def _range(self):
        if self.date_to < self.date_from or (self.date_to - self.date_from).days > 92:
            raise ValueError("Oraliq 3 oydan oshmasin")
        if self.check_in or self.check_out:
            raise ValueError("Keldi/ketdi faqat bitta kun uchun tuzatiladi")
        return self


@router.post("/timesheet/plan", status_code=204)
def plan_range(body: RangeIn, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    """Smenalar grafigi: bir nechta xodimga oraliq bo'yicha (masalan, ta'til 10 kun yoki kunora smena)."""
    for mid in set(body.member_ids):
        _member(db, business_id, mid)
    d = body.date_from
    while d <= body.date_to:
        if d.isoweekday() in body.weekdays:
            for mid in set(body.member_ids):
                _set_plan(db, business_id, mid, d, body)
        d += dt.timedelta(days=1)
    audit.log(db, business_id, "update", "timesheet", None,
              {"from": body.date_from.isoformat(), "to": body.date_to.isoformat(), "kind": body.kind})
    db.commit()


class SettingsIn(BaseModel):
    late_grace_min: int = Field(ge=0, le=120)


@router.put("/timesheet/settings", response_model=SettingsIn)
def settings(body: SettingsIn, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    db.execute(text("""
        INSERT INTO timesheet_settings (business_id, late_grace_min) VALUES (:b, :g)
        ON CONFLICT (business_id) DO UPDATE SET late_grace_min = EXCLUDED.late_grace_min
    """), {"b": business_id, "g": body.late_grace_min})
    db.commit()
    return body


@router.get("/timesheet/export")
def export(month: str = _MONTH, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    """Excel: xodimlar qatorda, kunlar ustunda, oxirida jami."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    sheet = _sheet(db, business_id, month)
    name = db.scalar(text("SELECT name FROM businesses WHERE id = :b"), {"b": business_id})
    start, end = _bounds(month)
    wb = Workbook()
    ws = wb.active
    ws.title = f"Tabel {month}"
    ws.append([f"{name} — xodimlar tabeli, {month}"])
    ws["A1"].font = Font(bold=True, size=13)
    days = [(start + dt.timedelta(days=i)) for i in range((end - start).days + 1)]
    header = ["Xodim"] + [str(d.day) for d in days] + ["Kun", "Soat", "Kechikish", "Kelmagan", "Dam", "Ta'til", "Kasal"]
    ws.append(header)
    for c in ws[2]:
        c.font = Font(bold=True)
        c.alignment = Alignment(horizontal="center")
    red = PatternFill("solid", fgColor="FDE2E2")
    grey = PatternFill("solid", fgColor="EEEEEE")
    for m in sheet.members:
        t = m.totals
        ws.append([m.full_name] + [c.code for c in m.cells]
                  + [t.worked_days, t.worked_hours, t.late_count, t.absent_days, t.day_off, t.vacation, t.sick])
        row = ws.max_row
        for i, c in enumerate(m.cells, start=2):
            cell = ws.cell(row=row, column=i)
            cell.alignment = Alignment(horizontal="center")
            if c.status in ("late", "absent"):
                cell.fill = red
            elif c.status in ("day_off", "off", "vacation", "sick"):
                cell.fill = grey
    ws.column_dimensions["A"].width = 28
    for i in range(2, len(header) + 1):
        ws.column_dimensions[ws.cell(row=2, column=i).column_letter].width = 5 if i <= len(days) + 1 else 10
    ws.append([])
    ws.append(["Belgilar: 8s — ishlagan soat, K — kechikdi, Y — kelmadi, D — dam olish, T — ta'til, B — kasallik"])
    buf = io.BytesIO()
    wb.save(buf)
    return Response(content=buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="tabel-{month}.xlsx"'})


# ─── Xodimning o'zi ──────────────────────────────────────────────────────────────────────────────
class MyAttendance(BaseModel):
    today: Cell | None
    month: MemberRow | None


def _my_member(db: Session, business_id: int) -> int:
    mid = db.scalar(text("SELECT id FROM business_members WHERE business_id = :b AND user_id = app.uid() AND is_active"),
                    {"b": business_id})
    if mid is None:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Bu muassasa xodimi emassiz"})
    return mid


@router.get("/attendance/me", response_model=MyAttendance)
def my_attendance(business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    mid = _my_member(db, business_id)
    today = db.scalar(text("SELECT (now() AT TIME ZONE timezone)::date FROM businesses WHERE id = :b"), {"b": business_id})
    sheet = _sheet(db, business_id, today.strftime("%Y-%m"), mid)
    row = sheet.members[0] if sheet.members else None
    return MyAttendance(today=next((c for c in row.cells if c.day == today), None) if row else None, month=row)


@router.post("/attendance/{action}", response_model=MyAttendance)
def mark(action: Literal["check-in", "check-out"], business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    db.execute(text("SELECT app.attendance_mark(:b, :a)"), {"b": business_id, "a": "in" if action == "check-in" else "out"})
    db.commit()
    return my_attendance(business_id, db)
