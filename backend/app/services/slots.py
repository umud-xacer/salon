"""Bo'sh vaqtlar hisobi bazadagi app.available_slots() da (sql/004_schedule.sql)."""
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.schedule import SlotOut, SlotsOut


def available_slots(db: Session, member_id: int, service_id: int, day: date, step: int) -> SlotsOut:
    rows = db.execute(text("SELECT slot_start AS starts_at, slot_end AS ends_at, slot_time AS time "
                           "FROM app.available_slots(:m, :s, :d, :step)"),
                      {"m": member_id, "s": service_id, "d": day, "step": step}).mappings()
    return SlotsOut(date=day, member_id=member_id, service_id=service_id, slots=[SlotOut(**r) for r in rows])
