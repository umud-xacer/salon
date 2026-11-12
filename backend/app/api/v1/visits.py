"""Tashrif: xizmat qatorlari (har biri o'z ijrochisi bilan), bo'limma-bo'lim chek va tezkor qabul.

Qatorlar faqat app.add_visit_service / app.remove_visit_service orqali o'zgaradi (sql/040): narx va bron
summasini baza hisoblaydi. O'qishda RLS: bronni ko'ra olgan kishi qatorlarini ham ko'radi.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.api.v1.appointments import _get
from app.schemas.appointments import AppointmentOut
from app.schemas.visits import (LineIn, LineOut, ReceiptOut, ReceiptPayment, ReceiptSection, VisitLines, WalkInBooking,
                                WalkInOption)

router = APIRouter(prefix="/businesses/{business_id}", tags=["visits"])

_booking = require_permission("appointments.manage")

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Bron topilmadi"})

_LINES = """
    SELECT l.id, l.service_id, l.service_name,
           coalesce(nullif(btrim(sv.name_ru), ''), l.service_name) AS service_name_ru,
           l.price, l.duration_min, l.house,
           CASE WHEN l.house THEN NULL ELSE coalesce(l.member_id, a.member_id) END AS member_id,
           CASE WHEN l.house THEN NULL ELSE u.full_name END AS member_name,
           sc.id AS category_id, sc.name AS category_name,
           coalesce(nullif(btrim(sc.name_ru), ''), sc.name) AS category_name_ru
      FROM appointment_services l
      JOIN appointments a            ON a.id = l.appointment_id
      LEFT JOIN services sv          ON sv.id = l.service_id
      LEFT JOIN service_categories sc ON sc.id = sv.category_id
      LEFT JOIN business_members m   ON m.id = coalesce(l.member_id, a.member_id)
      LEFT JOIN users u              ON u.id = m.user_id
     WHERE l.appointment_id = :a AND l.business_id = :b
     ORDER BY l.id
"""


def _viewer(business_id: int = Path(ge=1), db: Session = Depends(get_db)) -> int:
    """Qator va chekni kalendar ko'ruvchi ham, kassir ham ochadi."""
    allowed = db.scalar(text("""
        SELECT app.has_perm(:b, 'appointments.view_all') OR app.has_perm(:b, 'payments.accept')
    """), {"b": business_id})
    if not allowed:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Bu amal uchun huquq yo'q"})
    return business_id


def _lines(db: Session, business_id: int, appointment_id: int) -> list[LineOut]:
    rows = db.execute(text(_LINES), {"a": appointment_id, "b": business_id}).mappings()
    return [LineOut(**r) for r in rows]


def _visit(db: Session, business_id: int, appointment_id: int) -> VisitLines:
    a = db.execute(text("""
        SELECT status::text AS status, total_price - discount AS total FROM appointments
         WHERE id = :a AND business_id = :b
    """), {"a": appointment_id, "b": business_id}).mappings().first()
    if a is None:
        raise _NOT_FOUND
    return VisitLines(appointment_id=appointment_id, status=a["status"], total=a["total"],
                      lines=_lines(db, business_id, appointment_id))


@router.get("/appointments/{appointment_id}/lines", response_model=VisitLines)
def list_lines(appointment_id: int = Path(ge=1), business_id: int = Depends(_viewer), db: Session = Depends(get_db)):
    return _visit(db, business_id, appointment_id)


@router.post("/appointments/{appointment_id}/lines", response_model=VisitLines, status_code=201)
def add_line(body: LineIn, appointment_id: int = Path(ge=1), business_id: int = Depends(_booking),
             db: Session = Depends(get_db)):
    """Tashrifga yana bir xizmat: masalan ko'rikdan keyin tahlil. Ijrochi — boshqa xodim yoki muassasa."""
    db.execute(text("SELECT app.add_visit_service(:b, :a, :s, :m, :h)"),
               {"b": business_id, "a": appointment_id, "s": body.service_id, "m": body.member_id, "h": body.house})
    db.commit()
    return _visit(db, business_id, appointment_id)


@router.delete("/appointments/{appointment_id}/lines/{line_id}", response_model=VisitLines)
def remove_line(appointment_id: int = Path(ge=1), line_id: int = Path(ge=1), business_id: int = Depends(_booking),
                db: Session = Depends(get_db)):
    belongs = db.scalar(text("""
        SELECT 1 FROM appointment_services WHERE id = :l AND appointment_id = :a AND business_id = :b
    """), {"l": line_id, "a": appointment_id, "b": business_id})
    if belongs is None:
        raise _NOT_FOUND
    db.execute(text("SELECT app.remove_visit_service(:b, :l)"), {"b": business_id, "l": line_id})
    db.commit()
    return _visit(db, business_id, appointment_id)


@router.get("/appointments/{appointment_id}/receipt", response_model=ReceiptOut)
def receipt(appointment_id: int = Path(ge=1), business_id: int = Depends(_viewer), db: Session = Depends(get_db)):
    """Chek: xizmatlar bo'limlar bo'yicha guruhlangan, har birida ijrochi; jami, to'langan va qarz."""
    a = db.execute(text("""
        SELECT b.name AS business_name, b.address AS business_address, b.phone AS business_phone,
               c.full_name AS client_name, c.phone AS client_phone, a.starts_at, a.status::text AS status,
               a.total_price AS subtotal, a.discount
          FROM appointments a
          JOIN businesses b            ON b.id = a.business_id
          LEFT JOIN business_clients c ON c.id = a.client_id
         WHERE a.id = :a AND a.business_id = :b
    """), {"a": appointment_id, "b": business_id}).mappings().first()
    if a is None:
        raise _NOT_FOUND

    sections: dict[int | None, ReceiptSection] = {}
    for line in _lines(db, business_id, appointment_id):
        section = sections.setdefault(line.category_id, ReceiptSection(
            category_id=line.category_id, name=line.category_name, name_ru=line.category_name_ru, subtotal=0, lines=[]))
        section.lines.append(line)
        section.subtotal += line.price

    payments = db.execute(text("""
        SELECT method::text AS method, amount, paid_at FROM payments
         WHERE appointment_id = :a AND business_id = :b AND status = 'paid' ORDER BY paid_at
    """), {"a": appointment_id, "b": business_id}).mappings().all()
    paid = sum(p["amount"] for p in payments)
    total = a["subtotal"] - a["discount"]
    # Bo'limli xizmatlar avval, bo'limsizlari oxirida
    ordered = sorted(sections.values(), key=lambda s: (s.category_id is None, s.name or ""))
    return ReceiptOut(appointment_id=appointment_id, printed_at=datetime.now(timezone.utc), sections=ordered,
                      total=total, paid=paid, due=max(total - paid, 0),
                      payments=[ReceiptPayment(**p) for p in payments], **a)


@router.get("/reception/walk-in", response_model=list[WalkInOption])
def walk_in_options(service_id: int = Query(ge=1), business_id: int = Depends(_booking), db: Session = Depends(get_db)):
    """Yozilmasdan kelgan mijoz uchun: shu xizmatni bajaradiganlar, avval hozir bo'sh va ish vaqtidagilar."""
    rows = db.execute(text("""
        SELECT member_id, full_name, title, price, duration_min, free, busy_until, on_shift
          FROM app.walk_in_options(:b, :s)
    """), {"b": business_id, "s": service_id}).mappings()
    return [WalkInOption(**r) for r in rows]


@router.post("/reception/walk-in", response_model=AppointmentOut, status_code=201)
def walk_in(body: WalkInBooking, business_id: int = Depends(_booking), db: Session = Depends(get_db)):
    """Shu daqiqadan yozadi va darhol "keldi" holatiga o'tkazadi — to'lovni shu zahoti olish mumkin."""
    appointment_id = db.scalar(text("SELECT app.walk_in_book(:b, :m, :s, :name, :phone, :note)"),
                               {"b": business_id, "m": body.member_id, "s": body.service_id,
                                "name": body.client_name, "phone": body.client_phone,
                                "note": (body.note or "").strip() or None})
    db.commit()
    return _get(db, appointment_id)
