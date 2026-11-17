"""Kassa smenasi (057_cash_shifts.sql): ochish, naqd kirim/chiqim, yopish va hisobot.

Hisob-kitob (tushum, kutilgan naqd) bazada; bu yerda — chaqirish va javobni yig'ish.
"""
import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.api.v1.finance import _cash_viewer
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}/cash", tags=["cash-shifts"])
_accept = require_permission("payments.accept")

_ERRORS = {
    "shift_already_open": (409, "Smena allaqachon ochiq"),
    "no_open_shift": (409, "Ochiq smena yo'q — avval kassani oching"),
}


class OpenIn(BaseModel):
    opening_cash: int = Field(ge=0, le=10_000_000_000)


class MoveIn(BaseModel):
    kind: Literal["in", "out"]
    amount: int = Field(gt=0, le=10_000_000_000)
    note: str = Field(min_length=2, max_length=200)


class CloseIn(BaseModel):
    counted_cash: int = Field(ge=0, le=10_000_000_000)
    note: str | None = Field(default=None, max_length=500)


class MethodRow(BaseModel):
    method: str
    income: int
    refunds: int


class MovementOut(BaseModel):
    id: int
    kind: Literal["in", "out"]
    amount: int
    note: str
    created_by_name: str | None
    created_at: dt.datetime


class ShiftOut(BaseModel):
    id: int
    is_open: bool
    opened_at: dt.datetime
    opened_by_name: str | None
    opening_cash: int
    closed_at: dt.datetime | None
    closed_by_name: str | None
    counted_cash: int | None
    expected_cash: int                                  # ochiq smenada — joriy hisob
    difference: int | None                              # sanalgan − kutilgan (yopilganda)
    income: int                                         # barcha usullar bo'yicha tushum − qaytarishlar
    methods: list[MethodRow]
    cash_in: int
    cash_out: int
    movements: list[MovementOut] = []
    note: str | None


_SELECT = """
    SELECT s.*, ou.full_name AS opened_by_name, cu.full_name AS closed_by_name
      FROM cash_shifts s LEFT JOIN users ou ON ou.id = s.opened_by LEFT JOIN users cu ON cu.id = s.closed_by
"""


def _call(db: Session, sql: str, params: dict) -> int:
    try:
        return db.scalar(text(sql), params)
    except DBAPIError as e:
        msg = str(getattr(e.orig, "diag", None) and e.orig.diag.message_primary or "")
        if msg in _ERRORS:
            db.rollback()
            code, text_ = _ERRORS[msg]
            raise HTTPException(code, detail={"code": msg, "message": text_})
        raise


def _shift(db: Session, business_id: int, shift_id: int, with_movements: bool = True) -> ShiftOut:
    s = db.execute(text(f"{_SELECT} WHERE s.id = :id AND s.business_id = :b"), {"id": shift_id, "b": business_id}).mappings().first()
    if s is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Smena topilmadi"})
    is_open = s["closed_at"] is None
    if is_open:
        methods = [dict(r) for r in db.execute(text("SELECT * FROM app.shift_totals(:id)"), {"id": shift_id}).mappings()]
        expected = db.scalar(text("SELECT app.shift_expected_cash(:id)"), {"id": shift_id})
        moves = db.execute(text("SELECT kind, coalesce(sum(amount), 0)::bigint AS s FROM cash_movements "
                                "WHERE shift_id = :id GROUP BY kind"), {"id": shift_id}).all()
        cash_in = next((x.s for x in moves if x.kind == "in"), 0)
        cash_out = next((x.s for x in moves if x.kind == "out"), 0)
    else:
        totals = s["totals"] or {}
        methods = totals.get("methods", [])
        expected, cash_in, cash_out = s["expected_cash"], totals.get("cash_in", 0), totals.get("cash_out", 0)
    movements = []
    if with_movements:
        movements = [MovementOut(**r) for r in db.execute(text("""
            SELECT m.id, m.kind, m.amount, m.note, u.full_name AS created_by_name, m.created_at
              FROM cash_movements m LEFT JOIN users u ON u.id = m.created_by
             WHERE m.shift_id = :id ORDER BY m.created_at DESC"""), {"id": shift_id}).mappings()]
    return ShiftOut(
        id=s["id"], is_open=is_open, opened_at=s["opened_at"], opened_by_name=s["opened_by_name"],
        opening_cash=s["opening_cash"], closed_at=s["closed_at"], closed_by_name=s["closed_by_name"],
        counted_cash=s["counted_cash"], expected_cash=expected or 0,
        difference=None if is_open else s["counted_cash"] - (expected or 0),
        income=sum(m["income"] - m["refunds"] for m in methods), methods=[MethodRow(**m) for m in methods],
        cash_in=cash_in, cash_out=cash_out, movements=movements, note=s["note"])


@router.get("/shift/current", response_model=ShiftOut | None)
def current(business_id: int = Depends(_cash_viewer), db: Session = Depends(get_db)):
    sid = db.scalar(text("SELECT id FROM cash_shifts WHERE business_id = :b AND closed_at IS NULL"), {"b": business_id})
    return _shift(db, business_id, sid) if sid else None


@router.get("/shifts", response_model=list[ShiftOut])
def history(limit: int = Query(default=20, ge=1, le=100), business_id: int = Depends(_cash_viewer),
            db: Session = Depends(get_db)):
    ids = db.scalars(text("SELECT id FROM cash_shifts WHERE business_id = :b ORDER BY opened_at DESC LIMIT :l"),
                     {"b": business_id, "l": limit}).all()
    return [_shift(db, business_id, i, with_movements=False) for i in ids]


@router.get("/shifts/{shift_id}", response_model=ShiftOut)
def detail(shift_id: int = Path(ge=1), business_id: int = Depends(_cash_viewer), db: Session = Depends(get_db)):
    return _shift(db, business_id, shift_id)


@router.post("/shift/open", response_model=ShiftOut, status_code=201)
def open_shift(body: OpenIn, business_id: int = Depends(_accept), db: Session = Depends(get_db)):
    sid = _call(db, "SELECT app.open_shift(:b, :c)", {"b": business_id, "c": body.opening_cash})
    audit.log(db, business_id, "create", "cash_shift", sid)
    db.commit()
    return _shift(db, business_id, sid)


@router.post("/shift/move", response_model=ShiftOut, status_code=201)
def move(body: MoveIn, business_id: int = Depends(_accept), db: Session = Depends(get_db)):
    _call(db, "SELECT app.cash_move(:b, :k, :a, :n)", {"b": business_id, "k": body.kind, "a": body.amount, "n": body.note})
    db.commit()
    sid = db.scalar(text("SELECT id FROM cash_shifts WHERE business_id = :b AND closed_at IS NULL"), {"b": business_id})
    return _shift(db, business_id, sid)


@router.post("/shift/close", response_model=ShiftOut)
def close_shift(body: CloseIn, business_id: int = Depends(_accept), db: Session = Depends(get_db)):
    sid = _call(db, "SELECT app.close_shift(:b, :c, :n)", {"b": business_id, "c": body.counted_cash, "n": body.note})
    audit.log(db, business_id, "update", "cash_shift", sid, ["closed"])
    db.commit()
    return _shift(db, business_id, sid)
