"""Kassa va xarajatlar. To'lov faqat app.accept_payment va app.refund_payment orqali yoziladi."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.schemas.finance import (AppointmentPayments, CashDay, ExpenseCategoryIn, ExpenseCategoryOut, ExpenseIn,
                                 ExpenseList, ExpenseOut, MethodTotal, PaymentIn, PaymentOut, RefundIn,
                                 UnpaidAppointment)
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}", tags=["finance"])

_accept = require_permission("payments.accept")
_refund = require_permission("payments.refund")
_finance = require_permission("finance.view")

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Yozuv topilmadi"})

_PAYMENT_SELECT = """
    SELECT p.id, p.appointment_id, p.amount, p.method::text AS method, p.status::text AS status, p.paid_at, p.note,
           p.refunded_at, p.refund_reason, ru.full_name AS received_by_name, fu.full_name AS refunded_by_name,
           c.full_name AS client_name
      FROM payments p
      LEFT JOIN business_members rm ON rm.id = p.received_by
      LEFT JOIN users ru            ON ru.id = rm.user_id
      LEFT JOIN business_members fm ON fm.id = p.refunded_by
      LEFT JOIN users fu            ON fu.id = fm.user_id
      LEFT JOIN business_clients c  ON c.id = p.client_id
"""

_TZ = "(SELECT timezone FROM businesses WHERE id = :b) z(timezone)"
_IN_DAY = "{col} >= CAST(:d AS timestamp) AT TIME ZONE z.timezone AND {col} < CAST(:next AS timestamp) AT TIME ZONE z.timezone"


def _can(db: Session, business_id: int, permission: str) -> bool:
    return bool(db.scalar(text("SELECT app.has_perm(:b, :p)"), {"b": business_id, "p": permission}))


def _cash_viewer(business_id: int = Path(ge=1), db: Session = Depends(get_db)) -> int:
    """Kassani to'lov qabul qiluvchi ham, hisobot ko'ruvchi ham ochadi."""
    if not (_can(db, business_id, "payments.accept") or _can(db, business_id, "finance.view")):
        raise HTTPException(403, detail={"code": "forbidden", "message": "Bu amal uchun huquq yo'q"})
    return business_id


def _appointment_payments(db: Session, business_id: int, appointment_id: int) -> AppointmentPayments:
    a = db.execute(text("""
        SELECT status::text AS status, total_price - discount AS total FROM appointments
         WHERE id = :id AND business_id = :b
    """), {"id": appointment_id, "b": business_id}).mappings().first()
    if a is None:
        raise _NOT_FOUND
    rows = db.execute(text(f"{_PAYMENT_SELECT} WHERE p.appointment_id = :id AND p.business_id = :b ORDER BY p.paid_at"),
                      {"id": appointment_id, "b": business_id}).mappings()
    payments = [PaymentOut(**r) for r in rows]
    paid = sum(p.amount for p in payments if p.status == "paid")
    return AppointmentPayments(appointment_id=appointment_id, payable=a["status"] in ("in_progress", "completed"),
                               total=a["total"], paid=paid, due=max(a["total"] - paid, 0), payments=payments)


@router.get("/appointments/{appointment_id}/payments", response_model=AppointmentPayments)
def appointment_payments(appointment_id: int = Path(ge=1), business_id: int = Depends(_cash_viewer),
                         db: Session = Depends(get_db)):
    return _appointment_payments(db, business_id, appointment_id)


@router.post("/appointments/{appointment_id}/payments", response_model=AppointmentPayments, status_code=201)
def accept_payment(body: PaymentIn, appointment_id: int = Path(ge=1), business_id: int = Depends(_accept),
                   db: Session = Depends(get_db)):
    """Bir bronga bir necha qism to'lov mumkin (masalan, naqd va karta). Jami narxdan oshmaydi."""
    note = (body.note or "").strip() or None
    db.execute(text("SELECT app.accept_payment(:b, :a, :amount, :m, :note)"),
               {"b": business_id, "a": appointment_id, "amount": body.amount, "m": body.method, "note": note})
    db.commit()
    return _appointment_payments(db, business_id, appointment_id)


@router.post("/payments/{payment_id}/refund", response_model=PaymentOut)
def refund_payment(body: RefundIn, payment_id: int = Path(ge=1), business_id: int = Depends(_refund),
                   db: Session = Depends(get_db)):
    db.execute(text("SELECT app.refund_payment(:b, :p, :r)"), {"b": business_id, "p": payment_id, "r": body.reason})
    db.commit()
    row = db.execute(text(f"{_PAYMENT_SELECT} WHERE p.id = :p"), {"p": payment_id}).mappings().one()
    return PaymentOut(**row)


@router.get("/cash/day", response_model=CashDay)
def cash_day(day: date = Query(alias="date"), business_id: int = Depends(_cash_viewer),
             db: Session = Depends(get_db)):
    """Kunlik kassa. Qaytarish to'lov kuniga emas, qaytarilgan kunga yoziladi: o'tgan kun hisoboti o'zgarmaydi."""
    params = {"b": business_id, "d": day, "next": day + timedelta(days=1)}
    paid_in_day = _IN_DAY.format(col="p.paid_at")
    refunded_in_day = _IN_DAY.format(col="p.refunded_at")

    methods = db.execute(text(f"""
        SELECT p.method::text AS method,
               coalesce(sum(p.amount) FILTER (WHERE {paid_in_day}), 0)::bigint AS income,
               coalesce(sum(p.amount) FILTER (WHERE {refunded_in_day}), 0)::bigint AS refunds
          FROM payments p CROSS JOIN {_TZ}
         WHERE p.business_id = :b AND (({paid_in_day}) OR ({refunded_in_day}))
         GROUP BY p.method ORDER BY income DESC, method
    """), params).mappings().all()
    income = sum(m["income"] for m in methods)
    refunds = sum(m["refunds"] for m in methods)

    expenses = net = None
    if _can(db, business_id, "finance.view"):
        expenses = db.scalar(text("SELECT coalesce(sum(amount), 0)::bigint FROM expenses WHERE business_id = :b AND spent_at = :d"),
                             params)
        net = income - refunds - expenses

    unpaid = db.execute(text(f"""
        SELECT a.id, a.starts_at, a.status::text AS status, c.full_name AS client_name, u.full_name AS member_name,
               coalesce((SELECT array_agg(s.service_name ORDER BY s.id) FROM appointment_services s
                          WHERE s.appointment_id = a.id), '{{}}') AS services,
               a.total_price - a.discount - coalesce(
                   (SELECT sum(p.amount) FROM payments p WHERE p.appointment_id = a.id AND p.status = 'paid'), 0) AS due
          FROM appointments a
          LEFT JOIN business_clients c ON c.id = a.client_id
          LEFT JOIN business_members m ON m.id = a.member_id
          LEFT JOIN users u            ON u.id = m.user_id
         CROSS JOIN {_TZ}
         WHERE a.business_id = :b AND a.status IN ('in_progress', 'completed')
           AND {_IN_DAY.format(col="a.starts_at")}
         ORDER BY a.starts_at
    """), params).mappings()

    payments = db.execute(text(f"""{_PAYMENT_SELECT} CROSS JOIN {_TZ}
         WHERE p.business_id = :b AND (({paid_in_day}) OR ({refunded_in_day}))
         ORDER BY p.paid_at DESC
    """), params).mappings()

    return CashDay(date=day, income=income, refunds=refunds, expenses=expenses, net=net,
                   methods=[MethodTotal(**m) for m in methods],
                   unpaid=[UnpaidAppointment(**u) for u in unpaid if u["due"] > 0],
                   payments=[PaymentOut(**p) for p in payments])


@router.get("/expense-categories", response_model=list[ExpenseCategoryOut])
def list_categories(business_id: int = Depends(_finance), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id, name FROM expense_categories WHERE business_id = :b ORDER BY name"),
                      {"b": business_id}).mappings()
    return [ExpenseCategoryOut(**r) for r in rows]


@router.post("/expense-categories", response_model=ExpenseCategoryOut, status_code=201)
def create_category(body: ExpenseCategoryIn, business_id: int = Depends(_finance), db: Session = Depends(get_db)):
    name = body.name.strip()
    category_id = db.scalar(text("INSERT INTO expense_categories (business_id, name) VALUES (:b, :n) RETURNING id"),
                            {"b": business_id, "n": name})
    audit.log(db, business_id, "create", "expense_category", category_id)
    db.commit()
    return ExpenseCategoryOut(id=category_id, name=name)


@router.delete("/expense-categories/{category_id}", status_code=204)
def delete_category(category_id: int = Path(ge=1), business_id: int = Depends(_finance), db: Session = Depends(get_db)):
    """Xarajatlar o'chmaydi, faqat toifasiz qoladi."""
    db.execute(text("UPDATE expenses SET category_id = NULL WHERE category_id = :c AND business_id = :b"),
               {"c": category_id, "b": business_id})
    deleted = db.execute(text("DELETE FROM expense_categories WHERE id = :c AND business_id = :b"),
                         {"c": category_id, "b": business_id}).rowcount
    if not deleted:
        raise _NOT_FOUND
    audit.log(db, business_id, "delete", "expense_category", category_id)
    db.commit()


_EXPENSE_SELECT = """
    SELECT e.id, e.category_id, c.name AS category_name, e.amount, e.spent_at, e.note, u.full_name AS created_by_name
      FROM expenses e
      LEFT JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN users u              ON u.id = e.created_by
"""


@router.get("/expenses", response_model=ExpenseList)
def list_expenses(date_from: date, date_to: date, business_id: int = Depends(_finance), db: Session = Depends(get_db)):
    if date_to < date_from or (date_to - date_from).days > 366:
        raise HTTPException(422, detail={"code": "invalid_period", "message": "Davr noto'g'ri"})
    params = {"b": business_id, "f": date_from, "t": date_to}
    rows = db.execute(text(f"""{_EXPENSE_SELECT}
         WHERE e.business_id = :b AND e.spent_at BETWEEN :f AND :t
         ORDER BY e.spent_at DESC, e.id DESC
    """), params).mappings()
    items = [ExpenseOut(**r) for r in rows]
    return ExpenseList(total=sum(e.amount for e in items), items=items)


def _expense(db: Session, business_id: int, expense_id: int) -> ExpenseOut:
    row = db.execute(text(f"{_EXPENSE_SELECT} WHERE e.id = :id AND e.business_id = :b"),
                     {"id": expense_id, "b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return ExpenseOut(**row)


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
def create_expense(body: ExpenseIn, business_id: int = Depends(_finance), db: Session = Depends(get_db)):
    expense_id = db.scalar(text("""
        INSERT INTO expenses (business_id, category_id, amount, spent_at, note)
        VALUES (:b, :c, :a, :d, :n) RETURNING id
    """), {"b": business_id, "c": body.category_id, "a": body.amount, "d": body.spent_at,
           "n": (body.note or "").strip() or None})
    audit.log(db, business_id, "create", "expense", expense_id, {"amount": body.amount})
    db.commit()
    return _expense(db, business_id, expense_id)


@router.put("/expenses/{expense_id}", response_model=ExpenseOut)
def update_expense(body: ExpenseIn, expense_id: int = Path(ge=1), business_id: int = Depends(_finance),
                   db: Session = Depends(get_db)):
    updated = db.execute(text("""
        UPDATE expenses SET category_id = :c, amount = :a, spent_at = :d, note = :n
         WHERE id = :id AND business_id = :b
    """), {"id": expense_id, "b": business_id, "c": body.category_id, "a": body.amount, "d": body.spent_at,
           "n": (body.note or "").strip() or None}).rowcount
    if not updated:
        raise _NOT_FOUND
    db.commit()
    return _expense(db, business_id, expense_id)


@router.delete("/expenses/{expense_id}", status_code=204)
def delete_expense(expense_id: int = Path(ge=1), business_id: int = Depends(_finance), db: Session = Depends(get_db)):
    deleted = db.execute(text("DELETE FROM expenses WHERE id = :id AND business_id = :b"),
                         {"id": expense_id, "b": business_id}).rowcount
    if not deleted:
        raise _NOT_FOUND
    db.commit()
