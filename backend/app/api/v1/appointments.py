"""Bronlar: mijoz yozilishi, bekor qilish, ko'chirish va salon tomonidan boshqarish.

Yozish bazadagi funksiyalar orqali (sql/005_booking.sql): mijozda jadvalga to'g'ridan-to'g'ri yozish
huquqi yo'q. O'qishda filtrni RLS qiladi: kim qaysi bronni ko'rishini baza hal qiladi.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.appointments import AppointmentOut, BookingCreate, CancelIn, RescheduleIn, StatusIn
from app.services import audit

router = APIRouter(tags=["appointments"])

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Bron topilmadi"})

# LEFT JOIN: mijoz va xodimlar har xil jadvallarni ko'radi (RLS), ko'rinmagani NULL bo'lib qoladi
_SELECT = """
    SELECT a.id, a.business_id, b.name AS business_name, a.member_id, ps.full_name AS member_name,
           a.status::text AS status, a.starts_at, a.ends_at, a.total_price, a.client_note, a.cancel_reason,
           c.full_name AS client_name, c.phone AS client_phone,
           coalesce((SELECT array_agg(s.service_name ORDER BY s.id) FROM appointment_services s
                      WHERE s.appointment_id = a.id), '{}') AS services
      FROM appointments a
      LEFT JOIN businesses b       ON b.id = a.business_id
      LEFT JOIN public_staff ps    ON ps.member_id = a.member_id
      LEFT JOIN business_clients c ON c.id = a.client_id
"""


def _get(db: Session, appointment_id: int) -> AppointmentOut:
    row = db.execute(text(f"{_SELECT} WHERE a.id = :id"), {"id": appointment_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return AppointmentOut(**row)


@router.post("/appointments", response_model=AppointmentOut, status_code=201)
def create_booking(body: BookingCreate, db: Session = Depends(get_db)):
    appointment_id = db.scalar(text("SELECT app.book_appointment(:m, :s, :t, :n)"),
                               {"m": body.member_id, "s": body.service_id, "t": body.starts_at, "n": body.note})
    db.commit()
    return _get(db, appointment_id)


@router.get("/appointments/mine", response_model=list[AppointmentOut])
def my_bookings(upcoming: bool = True, db: Session = Depends(get_db)):
    when = "AND a.ends_at > now() ORDER BY a.starts_at" if upcoming else "ORDER BY a.starts_at DESC LIMIT 100"
    rows = db.execute(text(f"{_SELECT} WHERE a.client_id = ANY (app.my_client_ids()) {when}")).mappings()
    return [AppointmentOut(**r) for r in rows]


@router.get("/appointments/{appointment_id}", response_model=AppointmentOut)
def get_booking(appointment_id: int = Path(ge=1), db: Session = Depends(get_db)):
    return _get(db, appointment_id)


@router.post("/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel_booking(body: CancelIn, appointment_id: int = Path(ge=1), db: Session = Depends(get_db)):
    db.execute(text("SELECT app.cancel_appointment(:id, :r)"), {"id": appointment_id, "r": body.reason})
    db.commit()
    return _get(db, appointment_id)


@router.post("/appointments/{appointment_id}/reschedule", response_model=AppointmentOut)
def reschedule_booking(body: RescheduleIn, appointment_id: int = Path(ge=1), db: Session = Depends(get_db)):
    db.execute(text("SELECT app.reschedule_appointment(:id, :t)"), {"id": appointment_id, "t": body.starts_at})
    db.commit()
    return _get(db, appointment_id)


def _require_viewer(business_id: int = Path(ge=1), db: Session = Depends(get_db)) -> int:
    allowed = db.scalar(text("SELECT app.has_perm(:b, 'appointments.view_all') OR app.has_perm(:b, 'appointments.view_own')"),
                        {"b": business_id})
    if not allowed:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Bu amal uchun huquq yo'q"})
    return business_id


@router.get("/businesses/{business_id}/appointments", response_model=list[AppointmentOut])
def business_bookings(day: date = Query(alias="date"), member_id: int | None = Query(default=None, ge=1),
                      business_id: int = Depends(_require_viewer), db: Session = Depends(get_db)):
    """Kunlik jadval. Oddiy xodim RLS tufayli faqat o'z bronlarini ko'radi."""
    rows = db.execute(text(f"""{_SELECT}
        WHERE a.business_id = :b
          AND a.starts_at >= CAST(:d AS timestamp) AT TIME ZONE b.timezone
          AND a.starts_at <  CAST(:next AS timestamp) AT TIME ZONE b.timezone
          AND (CAST(:m AS BIGINT) IS NULL OR a.member_id = :m)
        ORDER BY a.starts_at
    """), {"b": business_id, "d": day, "next": day + timedelta(days=1), "m": member_id}).mappings()
    return [AppointmentOut(**r) for r in rows]


@router.patch("/businesses/{business_id}/appointments/{appointment_id}/status", response_model=AppointmentOut)
def set_status(body: StatusIn, appointment_id: int = Path(ge=1), business_id: int = Depends(_require_viewer),
               db: Session = Depends(get_db)):
    """Tasdiqlash va tashrif holatlari. Oddiy xodimga nima mumkinligini guard_appointments hal qiladi."""
    updated = db.execute(text("""
        UPDATE appointments
           SET status = CAST(:st AS appointment_status),
               checked_in_at = CASE WHEN :st = 'in_progress' THEN now() ELSE checked_in_at END,
               completed_at  = CASE WHEN :st = 'completed'   THEN now() ELSE completed_at END
         WHERE id = :id AND business_id = :b AND status IN ('pending', 'confirmed', 'in_progress')
    """), {"st": body.status, "id": appointment_id, "b": business_id}).rowcount
    if not updated:
        raise _NOT_FOUND
    audit.log(db, business_id, "status", "appointment", appointment_id, {"status": body.status})
    db.commit()
    return _get(db, appointment_id)
