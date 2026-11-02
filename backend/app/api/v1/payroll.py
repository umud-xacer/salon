"""Oylik. Pul yozuvi faqat app.*_payroll funksiyalari orqali o'zgaradi (sql/015_payroll.sql)."""
import calendar
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.schemas.payroll import (CompensationIn, CompensationOut, GenerateIn, GenerateOut, PayrollAdjust, PayrollList,
                                 PayrollOut)
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}", tags=["payroll"])

_manage = require_permission("payroll.manage")

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Yozuv topilmadi"})
_MONTH = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")

_SELECT = """
    SELECT p.id, p.member_id, u.full_name, m.title, p.period_start, p.period_end, p.base_salary, p.revenue,
           p.commission_percent, p.commission, p.bonus, p.deductions, p.total, p.status::text AS status, p.note,
           p.approved_at, p.paid_at
      FROM payrolls p
      JOIN business_members m ON m.id = p.member_id
      JOIN users u            ON u.id = m.user_id
"""
_COMPENSATION = """
    SELECT m.id AS member_id, u.full_name, m.role::text AS role, m.title,
           coalesce(c.base_salary, 0) AS base_salary, coalesce(c.commission_percent, 0) AS commission_percent
      FROM business_members m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN member_compensation c ON c.member_id = m.id
"""


def _bounds(month: str) -> tuple[date, date]:
    year, number = map(int, month.split("-"))
    return date(year, number, 1), date(year, number, calendar.monthrange(year, number)[1])


def _payroll(db: Session, business_id: int, payroll_id: int) -> PayrollOut:
    row = db.execute(text(f"{_SELECT} WHERE p.id = :id AND p.business_id = :b"),
                     {"id": payroll_id, "b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return PayrollOut(**row)


@router.get("/payroll/compensation", response_model=list[CompensationOut])
def list_compensation(business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    rows = db.execute(text(f"{_COMPENSATION} WHERE m.business_id = :b AND m.is_active ORDER BY u.full_name"),
                      {"b": business_id}).mappings()
    return [CompensationOut(**r) for r in rows]


@router.put("/payroll/compensation/{member_id}", response_model=CompensationOut)
def set_compensation(body: CompensationIn, member_id: int = Path(ge=1), business_id: int = Depends(_manage),
                     db: Session = Depends(get_db)):
    """Yangi stavka faqat keyingi hisoblashda qo'llanadi, tasdiqlangan oyliklar o'zgarmaydi."""
    exists = db.scalar(text("SELECT 1 FROM business_members WHERE id = :m AND business_id = :b AND is_active"),
                       {"m": member_id, "b": business_id})
    if exists is None:
        raise _NOT_FOUND
    db.execute(text("""
        INSERT INTO member_compensation (member_id, business_id, base_salary, commission_percent)
        VALUES (:m, :b, :s, :p)
        ON CONFLICT (member_id) DO UPDATE
           SET base_salary = EXCLUDED.base_salary, commission_percent = EXCLUDED.commission_percent, updated_at = now()
    """), {"m": member_id, "b": business_id, "s": body.base_salary, "p": body.commission_percent})
    audit.log(db, business_id, "update", "compensation", member_id,
              {"base_salary": body.base_salary, "commission_percent": str(body.commission_percent)})
    db.commit()
    row = db.execute(text(f"{_COMPENSATION} WHERE m.id = :m"), {"m": member_id}).mappings().one()
    return CompensationOut(**row)


@router.get("/payroll", response_model=PayrollList)
def list_payroll(month: str = _MONTH, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    start, end = _bounds(month)
    rows = db.execute(text(f"""{_SELECT}
         WHERE p.business_id = :b AND p.period_start = :s AND p.period_end = :e
         ORDER BY u.full_name
    """), {"b": business_id, "s": start, "e": end}).mappings()
    items = [PayrollOut(**r) for r in rows]
    return PayrollList(month=month, total=sum(i.total for i in items),
                       paid=sum(i.total for i in items if i.status == "paid"), items=items)


@router.post("/payroll/generate", response_model=GenerateOut)
def generate(body: GenerateIn, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    """Qoralamalarni qayta hisoblaydi. Tasdiqlangan va to'langanlarga tegmaydi."""
    start, end = _bounds(body.month)
    members = db.scalar(text("SELECT app.generate_payroll(:b, :s, :e)"), {"b": business_id, "s": start, "e": end})
    db.commit()
    return GenerateOut(members=members)


@router.put("/payroll/{payroll_id}", response_model=PayrollOut)
def adjust(body: PayrollAdjust, payroll_id: int = Path(ge=1), business_id: int = Depends(_manage),
           db: Session = Depends(get_db)):
    db.execute(text("SELECT app.adjust_payroll(:b, :id, :bonus, :ded, :note)"),
               {"b": business_id, "id": payroll_id, "bonus": body.bonus, "ded": body.deductions,
                "note": (body.note or "").strip() or None})
    db.commit()
    return _payroll(db, business_id, payroll_id)


@router.post("/payroll/{payroll_id}/approve", response_model=PayrollOut)
def approve(payroll_id: int = Path(ge=1), business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    db.execute(text("SELECT app.approve_payroll(:b, :id)"), {"b": business_id, "id": payroll_id})
    db.commit()
    return _payroll(db, business_id, payroll_id)


@router.post("/payroll/{payroll_id}/pay", response_model=PayrollOut)
def pay(payroll_id: int = Path(ge=1), business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    """To'langan oylik Xarajatlarga "Oylik" toifasi bilan tushadi."""
    db.execute(text("SELECT app.pay_payroll(:b, :id)"), {"b": business_id, "id": payroll_id})
    db.commit()
    return _payroll(db, business_id, payroll_id)


@router.get("/my-payroll", response_model=list[PayrollOut])
def my_payroll(business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Xodim o'z oyliklari. RLS qoralamani va boshqalarning hisobini yashiradi."""
    rows = db.execute(text(f"""{_SELECT}
         WHERE p.business_id = :b AND p.member_id = ANY (app.my_member_ids())
           AND p.status <> 'draft'
         ORDER BY p.period_start DESC
         LIMIT 24
    """), {"b": business_id}).mappings()
    return [PayrollOut(**r) for r in rows]
