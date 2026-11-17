"""Kalendar va qabulxona: mijoz nomidan bron, "istalgan usta"."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_any_permission, require_permission
from app.schemas.schedule import SlotsOut
from app.services.slots import available_slots
from app.api.v1.appointments import _SELECT, _get
from app.api.v1.blocks import BLOCK_SELECT
from app.schemas.blocks import CalendarBlock
from app.schemas.appointments import AppointmentOut
from app.schemas.reception import (AnySlot, CalendarOut, CalendarStaff, MyClientOut, OptionService, OptionStaff,
                                   ReceptionBooking, ReceptionOptions)

router = APIRouter(prefix="/businesses/{business_id}", tags=["reception"])

_view_all = require_permission("appointments.view_all")
_booking = require_permission("appointments.manage")
# Qabulxonasiz muassasada oddiy xodim faqat o'ziga bron qo'shadi (appointments.manage_own) — chegarani baza tekshiradi
_booking_any = require_any_permission("appointments.manage", "appointments.manage_own")
_own_view = require_permission("appointments.view_own")

DEFAULT_HOURS = (9, 20)


def _hours(db: Session, business_id: int) -> tuple[int, int]:
    row = db.execute(text("""
        SELECT min(extract(hour FROM s))::int AS first,
               ceil(max(extract(epoch FROM e)) / 3600)::int AS last
          FROM (SELECT opens_at AS s, closes_at AS e FROM business_hours WHERE business_id = :b
                UNION ALL
                SELECT start_time, end_time FROM staff_schedules WHERE business_id = :b) t
    """), {"b": business_id}).mappings().one()
    return (row["first"], row["last"]) if row["first"] is not None else DEFAULT_HOURS


@router.get("/calendar", response_model=CalendarOut)
def calendar(start: date, days: int = Query(default=1, ge=1, le=31), business_id: int = Depends(_view_all),
             db: Session = Depends(get_db)):
    """Kalendar uchun bitta so'rov: ustalar, ish soatlari va bronlar. Bekor qilinganlar kirmaydi."""
    end = start + timedelta(days=days)
    params = {"b": business_id, "s": start, "e": end}
    period = """a.starts_at >= CAST(:s AS timestamp) AT TIME ZONE z.timezone
            AND a.starts_at <  CAST(:e AS timestamp) AT TIME ZONE z.timezone"""
    tz = "(SELECT timezone FROM businesses WHERE id = :b) z(timezone)"
    # Ustun: usta yoki xizmat bajaradigan xodim, kassir emas (is_bookable xodimda standart yoqiq).
    # Ishdan chiqqan ustaning bronlari ham ko'rinsin: kalendarda yo'qolib qolmasin.
    staff = db.execute(text(f"""
        SELECT m.id, u.full_name, m.title
          FROM business_members m
          JOIN users u ON u.id = m.user_id
         CROSS JOIN {tz}
         WHERE m.business_id = :b
           AND ((m.is_active AND m.is_bookable
                 AND (m.role = 'staff' OR EXISTS (SELECT 1 FROM member_services ms WHERE ms.member_id = m.id)))
                OR EXISTS (SELECT 1 FROM appointments a
                            WHERE a.member_id = m.id AND a.status <> 'cancelled' AND {period}))
         ORDER BY m.id
    """), params).mappings()
    rows = db.execute(text(f"""{_SELECT}
         CROSS JOIN {tz}
         WHERE a.business_id = :b AND a.status <> 'cancelled' AND {period}
         ORDER BY a.starts_at
    """), params).mappings()
    blocks = db.execute(text(f"""{BLOCK_SELECT}
         CROSS JOIN {tz}
         WHERE t.business_id = :b
           AND tstzrange(t.starts_at, t.ends_at) && tstzrange(CAST(:s AS timestamp) AT TIME ZONE z.timezone,
                                                              CAST(:e AS timestamp) AT TIME ZONE z.timezone)
         ORDER BY t.starts_at
    """), params).mappings()
    hour_from, hour_to = _hours(db, business_id)
    return CalendarOut(start=start, days=days, hour_from=hour_from, hour_to=hour_to,
                       staff=[CalendarStaff(**s) for s in staff], appointments=[AppointmentOut(**r) for r in rows],
                       blocks=[CalendarBlock(**b) for b in blocks])


@router.get("/reception/options", response_model=ReceptionOptions)
def options(business_id: int = Depends(_booking), db: Session = Depends(get_db)):
    """Bron oynasi uchun faol xizmatlar va ularni bajaradigan ustalar."""
    services = db.execute(text("""
        SELECT id, name, duration_min, price FROM services
         WHERE business_id = :b AND is_active ORDER BY name
    """), {"b": business_id}).mappings()
    staff = db.execute(text("""
        SELECT m.id, u.full_name, m.title,
               coalesce((SELECT array_agg(ms.service_id) FROM member_services ms WHERE ms.member_id = m.id),
                        '{}') AS service_ids
          FROM business_members m
          JOIN users u ON u.id = m.user_id
         WHERE m.business_id = :b AND m.is_active AND m.is_bookable
         ORDER BY u.full_name
    """), {"b": business_id}).mappings()
    return ReceptionOptions(services=[OptionService(**s) for s in services], staff=[OptionStaff(**s) for s in staff])


@router.get("/reception/slots", response_model=list[AnySlot])
def any_staff_slots(service_id: int = Query(ge=1), day: date = Query(alias="date"), step: int = Query(default=30),
                    business_id: int = Depends(_booking), db: Session = Depends(get_db)):
    """Istalgan usta: kamida bitta usta bo'sh bo'lgan vaqtlar."""
    rows = db.execute(text("""
        SELECT slot_start AS starts_at, slot_end AS ends_at, slot_time AS time, free_staff
          FROM app.any_staff_slots(:b, :s, :d, :step)
    """), {"b": business_id, "s": service_id, "d": day, "step": step}).mappings()
    return [AnySlot(**r) for r in rows]


@router.post("/reception/appointments", response_model=AppointmentOut, status_code=201)
def book_for_client(body: ReceptionBooking, business_id: int = Depends(_booking_any), db: Session = Depends(get_db)):
    """Telefon qilgan yoki kelgan mijoz uchun bron. Narx va tugash vaqtini server hisoblaydi."""
    appointment_id = db.scalar(text("""
        SELECT app.reception_book(:b, :m, :s, :t, :name, :phone, :note)
    """), {"b": business_id, "m": body.member_id, "s": body.service_id, "t": body.starts_at,
           "name": body.client_name, "phone": body.client_phone, "note": body.note})
    db.commit()
    return _get(db, appointment_id)


# ─── Xodimning o'zi (qabulxonasiz rejim va "Mijozlarim") ──────────────────────
def _me(db: Session, business_id: int) -> int:
    member = db.scalar(text("SELECT app.my_member_in(:b)"), {"b": business_id})
    if member is None:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Bu amal uchun huquq yo'q"})
    return member


@router.get("/my-slots", response_model=SlotsOut)
def my_slots(service_id: int = Query(ge=1), day: date = Query(alias="date"), step: int = Query(default=15, ge=5, le=60),
             business_id: int = Depends(_booking_any), db: Session = Depends(get_db)):
    """Xodimning o'z bo'sh vaqtlari — o'ziga bron qo'shish uchun."""
    return available_slots(db, _me(db, business_id), service_id, day, step)


@router.get("/my-clients", response_model=list[MyClientOut])
def my_clients(business_id: int = Depends(_own_view), db: Session = Depends(get_db)):
    """O'z bronlaridagi mijozlar: ism, telefon, tashriflar soni, oxirgi va keyingi tashrif."""
    rows = db.execute(text("SELECT * FROM app.my_clients(:b)"), {"b": business_id}).mappings()
    return [MyClientOut(**r) for r in rows]
