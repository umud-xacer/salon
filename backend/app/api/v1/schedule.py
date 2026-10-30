"""Ish jadvali, ta'tillar va bo'sh vaqtlar (salon tomoni).

Jadvalni 'staff.manage' egasi o'zgartiradi. Xodim o'z jadvalini ko'radi va o'z ta'tilini kiritadi.
Bazada ham xuddi shu qoida (RLS). Mijoz uchun bo'sh vaqtlar: GET /catalog/slots.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.api.v1.members import _get_member
from app.schemas.schedule import BreakIn, ScheduleDay, ScheduleReplace, SlotsOut, TimeOffIn, TimeOffOut
from app.services import audit
from app.services.slots import available_slots

router = APIRouter(prefix="/businesses/{business_id}", tags=["schedule"])

_manage = require_permission("staff.manage")
_booking = require_permission("appointments.manage")


def _manager_or_self(member_id: int = Path(ge=1), business_id: int = Path(ge=1),
                     db: Session = Depends(get_db)) -> int:
    allowed = db.scalar(text("SELECT app.has_perm(:b, 'staff.manage') OR CAST(:m AS BIGINT) = ANY (app.my_member_ids())"),
                        {"b": business_id, "m": member_id})
    if not allowed:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Bu amal uchun huquq yo'q"})
    _get_member(db, business_id, member_id)
    return member_id


def _read_schedule(db: Session, member_id: int) -> list[ScheduleDay]:
    rows = db.execute(text("SELECT weekday, start_time, end_time FROM staff_schedules WHERE member_id = :m "
                           "ORDER BY weekday, start_time"), {"m": member_id}).mappings()
    days: dict[int, ScheduleDay] = {}
    for r in rows:
        day = days.get(r["weekday"])
        if day is None:
            days[r["weekday"]] = ScheduleDay(**r)
        else:                                             # oraliqlar orasidagi bo'shliq — tanaffus
            day.breaks.append(BreakIn(start=day.end_time, end=r["start_time"]))
            day.end_time = r["end_time"]
    return list(days.values())


@router.get("/members/{member_id}/schedule", response_model=list[ScheduleDay])
def get_schedule(member_id: int = Depends(_manager_or_self), db: Session = Depends(get_db)):
    return _read_schedule(db, member_id)


@router.put("/members/{member_id}/schedule", response_model=list[ScheduleDay])
def replace_schedule(body: ScheduleReplace, member_id: int = Path(ge=1), business_id: int = Depends(_manage),
                     db: Session = Depends(get_db)):
    """Butun haftani bir tranzaksiyada almashtiradi. Ro'yxatda yo'q kun — dam olish."""
    _get_member(db, business_id, member_id)
    db.execute(text("DELETE FROM staff_schedules WHERE member_id = :m AND business_id = :b"),
               {"m": member_id, "b": business_id})
    for d in body.days:
        points = [d.start_time, *(t for b in d.breaks for t in (b.start, b.end)), d.end_time]
        for start, end in zip(points[::2], points[1::2]):
            db.execute(text("INSERT INTO staff_schedules (business_id, member_id, weekday, start_time, end_time) "
                            "VALUES (:b, :m, :w, :s, :e)"),
                       {"b": business_id, "m": member_id, "w": d.weekday, "s": start, "e": end})
    audit.log(db, business_id, "update", "staff_schedule", member_id, body.model_dump(mode="json"))
    db.commit()
    return _read_schedule(db, member_id)


@router.get("/members/{member_id}/time-off", response_model=list[TimeOffOut])
def list_time_off(member_id: int = Depends(_manager_or_self), db: Session = Depends(get_db)):
    """Hali tugamagan ta'tillar."""
    rows = db.execute(text("SELECT id, starts_at, ends_at, reason FROM staff_time_off "
                           "WHERE member_id = :m AND ends_at > now() ORDER BY starts_at"), {"m": member_id}).mappings()
    return [TimeOffOut(**r) for r in rows]


@router.post("/members/{member_id}/time-off", response_model=TimeOffOut, status_code=201)
def add_time_off(body: TimeOffIn, business_id: int = Path(ge=1), member_id: int = Depends(_manager_or_self),
                 db: Session = Depends(get_db)):
    row = db.execute(text("INSERT INTO staff_time_off (business_id, member_id, starts_at, ends_at, reason) "
                          "VALUES (:b, :m, :s, :e, :r) RETURNING id, starts_at, ends_at, reason"),
                     {"b": business_id, "m": member_id, "s": body.starts_at, "e": body.ends_at, "r": body.reason}
                     ).mappings().one()
    audit.log(db, business_id, "create", "staff_time_off", row["id"], body.model_dump(mode="json"))
    db.commit()
    return TimeOffOut(**row)


@router.delete("/members/{member_id}/time-off/{time_off_id}", status_code=204)
def delete_time_off(time_off_id: int = Path(ge=1), business_id: int = Path(ge=1),
                    member_id: int = Depends(_manager_or_self), db: Session = Depends(get_db)):
    deleted = db.execute(text("DELETE FROM staff_time_off WHERE id = :id AND member_id = :m AND business_id = :b"),
                         {"id": time_off_id, "m": member_id, "b": business_id}).rowcount
    if not deleted:
        raise HTTPException(404, detail={"code": "not_found", "message": "Topilmadi"})
    audit.log(db, business_id, "delete", "staff_time_off", time_off_id)
    db.commit()


@router.get("/slots", response_model=SlotsOut)
def business_slots(member_id: int = Query(ge=1), service_id: int = Query(ge=1), day: date = Query(alias="date"),
                   step: int = Query(default=30), business_id: int = Depends(_booking), db: Session = Depends(get_db)):
    """Qabulxona uchun: katalogda ko'rinmaydigan biznesda ham ishlaydi."""
    _get_member(db, business_id, member_id)
    return available_slots(db, member_id, service_id, day, step)
