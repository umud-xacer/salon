"""Bronlar: mijoz yozilishi, bekor qilish, ko'chirish va salon tomonidan boshqarish.

Yozish bazadagi funksiyalar orqali (sql/005_booking.sql): mijozda jadvalga to'g'ridan-to'g'ri yozish
huquqi yo'q. O'qishda filtrni RLS qiladi: kim qaysi bronni ko'rishini baza hal qiladi.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_any_permission, require_permission
from app.schemas.appointments import (AppointmentOut, ArrivedIn, BookingCreate, CancelIn, CancelReasonIn,
                                      CancelReasonOut, QuoteIn, QuoteOut, RescheduleIn, StatusIn)
from app.services import audit

router = APIRouter(tags=["appointments"])

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Bron topilmadi"})

# LEFT JOIN: mijoz va xodimlar har xil jadvallarni ko'radi (RLS), ko'rinmagani NULL bo'lib qoladi
_SELECT = """
    SELECT a.id, a.business_id, b.name AS business_name, b.slug AS business_slug, b.address AS business_address,
           ST_Y(b.location::geometry) AS business_lat, ST_X(b.location::geometry) AS business_lng,
           a.member_id, ps.full_name AS member_name,
           a.status::text AS status, a.starts_at, a.ends_at, a.total_price, a.discount, a.discount_source, a.client_note, a.cancel_reason,
           a.checked_in_at AS arrived_at, a.processing_offset_min, a.processing_min, a.buffer_min,
           cf.f ->> 'alert' AS client_alert, cf.f ->> 'allergies' AS client_allergies,
           coalesce(c.full_name, app.own_client_name(a.id)) AS client_name, c.phone AS client_phone,  -- usta: faqat ism
           CASE WHEN r.confirmed_at IS NOT NULL THEN 'confirmed'
                WHEN r.alerted_at IS NOT NULL THEN 'no_response'
                WHEN r.sent_at IS NOT NULL THEN 'reminded' END AS attendance,
           coalesce(r.alerted_at IS NOT NULL AND r.confirmed_at IS NULL
                    AND a.status IN ('pending', 'confirmed') AND a.ends_at > now(), false) AS needs_contact,
           coalesce((SELECT array_agg(s.service_name ORDER BY s.id) FROM appointment_services s
                      WHERE s.appointment_id = a.id), '{}') AS services,
           coalesce((SELECT array_agg(coalesce(nullif(btrim(sv.name_ru), ''), s.service_name) ORDER BY s.id)
                     FROM appointment_services s LEFT JOIN services sv ON sv.id = s.service_id
                    WHERE s.appointment_id = a.id), '{}') AS services_ru,
           coalesce((SELECT array_agg(s.service_id ORDER BY s.id) FROM appointment_services s
                      WHERE s.appointment_id = a.id), '{}') AS service_ids,
           rv.rating AS review_rating, rv.staff_rating AS review_staff_rating,
           CASE WHEN a.status = 'pending' THEN app.confirm_deadline(a.business_id, a.created_at, a.starts_at) END
               AS confirm_by,
           (a.status = 'completed' AND rv.id IS NULL
            AND coalesce(a.completed_at, a.ends_at) > now() - interval '30 days') AS can_review
      FROM appointments a
      LEFT JOIN reviews rv         ON rv.appointment_id = a.id
      LEFT JOIN businesses b       ON b.id = a.business_id
      LEFT JOIN public_staff ps    ON ps.member_id = a.member_id
      LEFT JOIN business_clients c ON c.id = a.client_id
      LEFT JOIN appointment_reminders r ON r.appointment_id = a.id
      LEFT JOIN LATERAL (SELECT app.client_flags(a.id) AS f) cf ON true    -- ogohlantirish/allergiya (050)
"""


def _get(db: Session, appointment_id: int) -> AppointmentOut:
    row = db.execute(text(f"{_SELECT} WHERE a.id = :id"), {"id": appointment_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return AppointmentOut(**row)


@router.post("/appointments", response_model=AppointmentOut, status_code=201)
def create_booking(body: BookingCreate, db: Session = Depends(get_db)):
    appointment_id = db.scalar(text("SELECT app.book_appointment(:m, :s, :t, :n, :c)"),
                               {"m": body.member_id, "s": body.service_id, "t": body.starts_at, "n": body.note,
                                "c": body.promo_code})
    db.commit()
    return _get(db, appointment_id)


@router.post("/appointments/quote", response_model=QuoteOut)
def booking_quote(body: QuoteIn, db: Session = Depends(get_db)):
    """Tasdiqlash ekrani uchun: narx va qo'llanadigan chegirma (bo'sh soat, sodiqlik yoki promokod)."""
    r = db.execute(text("SELECT * FROM app.booking_quote(:m, :s, :t, :c)"),
                   {"m": body.member_id, "s": body.service_id, "t": body.starts_at, "c": body.promo_code}).mappings().one()
    return QuoteOut(price=r["price"], percent=r["percent"], discount=r["discount"], final=r["price"] - r["discount"],
                    source=r["source"] if r["percent"] > 0 else None, code_error=r["code_error"])


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
    out = _get(db, appointment_id)
    # Vaqt bo'shadi — kutish ro'yxatidagi navbatdagi mijozga darhol taklif (052). Xato bekor qilishni buzmasin.
    try:
        db.execute(text("SELECT app.waitlist_scan(:b)"), {"b": out.business_id})
        db.commit()
    except Exception:
        db.rollback()
    return out


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
               checked_in_at = CASE WHEN :st = 'in_progress' THEN coalesce(checked_in_at, now()) ELSE checked_in_at END,
               completed_at  = CASE WHEN :st = 'completed'   THEN now() ELSE completed_at END
         WHERE id = :id AND business_id = :b AND status IN ('pending', 'confirmed', 'in_progress')
    """), {"st": body.status, "id": appointment_id, "b": business_id}).rowcount
    if not updated:
        raise _NOT_FOUND
    audit.log(db, business_id, "status", "appointment", appointment_id, {"status": body.status})
    db.commit()
    return _get(db, appointment_id)


@router.post("/businesses/{business_id}/appointments/{appointment_id}/arrived", response_model=AppointmentOut)
def mark_arrived(body: ArrivedIn, appointment_id: int = Path(ge=1), business_id: int = Depends(_require_viewer),
                 db: Session = Depends(get_db)):
    """'Mijoz keldi' belgisi. Kim bosishi mumkinligini app.mark_arrived hal qiladi (048)."""
    db.execute(text("SELECT app.mark_arrived(:b, :id, :v)"), {"b": business_id, "id": appointment_id, "v": body.arrived})
    db.commit()
    return _get(db, appointment_id)


# ─── Bekor qilish sabablari (Sozlamalar) ───────────────────────────────────────────────────────
# O'qish: bronni bekor qila oladiganlar; yozish: 'business.manage' (RLS — 048_arrival_cancel_reasons.sql)

_REASON_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Sabab topilmadi"})


@router.get("/businesses/{business_id}/cancel-reasons", response_model=list[CancelReasonOut])
def list_cancel_reasons(business_id: int = Depends(require_any_permission("appointments.manage", "business.manage")),
                        db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id, name, sort_order FROM cancel_reasons WHERE business_id = :b "
                           "ORDER BY sort_order, id"), {"b": business_id}).mappings()
    return [CancelReasonOut(**r) for r in rows]


@router.post("/businesses/{business_id}/cancel-reasons", response_model=CancelReasonOut, status_code=201)
def add_cancel_reason(body: CancelReasonIn, business_id: int = Depends(require_permission("business.manage")),
                      db: Session = Depends(get_db)):
    row = db.execute(text("INSERT INTO cancel_reasons (business_id, name, sort_order) VALUES (:b, :n, :o) "
                          "RETURNING id, name, sort_order"),
                     {"b": business_id, "n": body.name, "o": body.sort_order}).mappings().one()
    db.commit()
    return CancelReasonOut(**row)


@router.put("/businesses/{business_id}/cancel-reasons/{reason_id}", response_model=CancelReasonOut)
def update_cancel_reason(body: CancelReasonIn, reason_id: int = Path(ge=1),
                         business_id: int = Depends(require_permission("business.manage")),
                         db: Session = Depends(get_db)):
    row = db.execute(text("UPDATE cancel_reasons SET name = :n, sort_order = :o WHERE id = :id AND business_id = :b "
                          "RETURNING id, name, sort_order"),
                     {"b": business_id, "id": reason_id, "n": body.name, "o": body.sort_order}).mappings().first()
    if row is None:
        raise _REASON_NOT_FOUND
    db.commit()
    return CancelReasonOut(**row)


@router.delete("/businesses/{business_id}/cancel-reasons/{reason_id}", status_code=204)
def delete_cancel_reason(reason_id: int = Path(ge=1), business_id: int = Depends(require_permission("business.manage")),
                         db: Session = Depends(get_db)):
    deleted = db.execute(text("DELETE FROM cancel_reasons WHERE id = :id AND business_id = :b"),
                         {"b": business_id, "id": reason_id}).rowcount
    if not deleted:
        raise _REASON_NOT_FOUND
    db.commit()
