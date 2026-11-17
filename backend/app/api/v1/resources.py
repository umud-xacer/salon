"""Xonalar, kreslolar va apparatlar (059_resources.sql).

Katalog va bog'lashlar — direktor ('business.manage'); ko'rish — muassasa xodimlari (kalendar).
Bronga resurs tanlash — bron qiladiganlar ('appointments.manage'); bandlik va sig'im bazada tekshiriladi.
"""
import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.api.v1.appointments import _get
from app.schemas.appointments import AppointmentOut
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}", tags=["resources"])
_manage = require_permission("business.manage")
_book = require_permission("appointments.manage")
_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Xona yoki kreslo topilmadi"})

Kind = Literal["chair", "room", "device"]


class ResourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: Kind = "chair"
    capacity: int = Field(default=1, ge=1, le=50)
    cleanup_min: int = Field(default=0, ge=0, le=120)
    opens_at: dt.time | None = None
    closes_at: dt.time | None = None
    status: Literal["active", "maintenance"] = "active"
    service_ids: list[int] = Field(default_factory=list, max_length=200)
    member_ids: list[int] = Field(default_factory=list, max_length=100)   # shu resurs "o'z" kreslosi bo'lgan ustalar

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return " ".join(v.split())

    @model_validator(mode="after")
    def _hours(self):
        if (self.opens_at is None) != (self.closes_at is None):
            raise ValueError("Ish vaqtining boshi va oxirini birga kiriting")
        if self.opens_at and self.closes_at <= self.opens_at:
            raise ValueError("Ish vaqti oxiri boshidan keyin bo'lishi kerak")
        return self


class ResourceOut(BaseModel):
    id: int
    name: str
    kind: Kind
    capacity: int
    cleanup_min: int
    opens_at: dt.time | None
    closes_at: dt.time | None
    status: str
    service_ids: list[int]
    member_ids: list[int]
    upcoming: int                                       # kelgusi faol bronlar soni


_SELECT = """
    SELECT r.id, r.name, r.kind, r.capacity, r.cleanup_min, r.opens_at, r.closes_at, r.status,
           coalesce((SELECT array_agg(sr.service_id ORDER BY sr.service_id) FROM service_resources sr
                      WHERE sr.resource_id = r.id), '{}') AS service_ids,
           coalesce((SELECT array_agg(m.id ORDER BY m.id) FROM business_members m
                      WHERE m.default_resource_id = r.id AND m.is_active), '{}') AS member_ids,
           (SELECT count(*) FROM appointments a WHERE a.resource_id = r.id AND a.starts_at > now()
               AND a.status IN ('pending', 'confirmed', 'in_progress'))::int AS upcoming
      FROM resources r
"""


def _read(db: Session, business_id: int, resource_id: int) -> ResourceOut:
    row = db.execute(text(f"{_SELECT} WHERE r.id = :id AND r.business_id = :b"), {"id": resource_id, "b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return ResourceOut(**row)


def _links(db: Session, business_id: int, resource_id: int, body: ResourceIn) -> None:
    db.execute(text("DELETE FROM service_resources WHERE resource_id = :r"), {"r": resource_id})
    if body.service_ids:
        n = db.execute(text("""
            INSERT INTO service_resources (business_id, service_id, resource_id)
            SELECT :b, s.id, :r FROM services s WHERE s.business_id = :b AND s.id = ANY(:ids)
        """), {"b": business_id, "r": resource_id, "ids": body.service_ids}).rowcount
        if n != len(set(body.service_ids)):
            raise HTTPException(422, detail={"code": "invalid_reference", "message": "Xizmat topilmadi"})
    db.execute(text("UPDATE business_members SET default_resource_id = NULL WHERE business_id = :b "
                    "AND default_resource_id = :r AND NOT (id = ANY(:ids))"),
               {"b": business_id, "r": resource_id, "ids": body.member_ids})
    if body.member_ids:
        n = db.execute(text("UPDATE business_members SET default_resource_id = :r WHERE business_id = :b AND id = ANY(:ids)"),
                       {"b": business_id, "r": resource_id, "ids": body.member_ids}).rowcount
        if n != len(set(body.member_ids)):
            raise HTTPException(422, detail={"code": "invalid_reference", "message": "Xodim topilmadi"})


_FIELDS = ("name", "kind", "capacity", "cleanup_min", "opens_at", "closes_at", "status")


@router.get("/resources", response_model=list[ResourceOut])
def list_resources(business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Muassasa xodimlari ko'radi (RLS); boshqalarga bo'sh ro'yxat."""
    rows = db.execute(text(f"{_SELECT} WHERE r.business_id = :b ORDER BY r.sort_order, r.id"), {"b": business_id}).mappings()
    return [ResourceOut(**r) for r in rows]


@router.post("/resources", response_model=ResourceOut, status_code=201)
def create_resource(body: ResourceIn, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    rid = db.scalar(text(f"""
        INSERT INTO resources (business_id, {', '.join(_FIELDS)}, sort_order)
        VALUES (:b, {', '.join(':' + f for f in _FIELDS)},
                (SELECT coalesce(max(sort_order), 0) + 1 FROM resources WHERE business_id = :b))
        RETURNING id
    """), {"b": business_id, **body.model_dump(include=set(_FIELDS))})
    _links(db, business_id, rid, body)
    audit.log(db, business_id, "create", "resource", rid)
    db.commit()
    return _read(db, business_id, rid)


@router.put("/resources/{resource_id}", response_model=ResourceOut)
def update_resource(body: ResourceIn, resource_id: int = Path(ge=1), business_id: int = Depends(_manage),
                    db: Session = Depends(get_db)):
    sets = ", ".join(f"{f} = :{f}" for f in _FIELDS)
    n = db.execute(text(f"UPDATE resources SET {sets} WHERE id = :id AND business_id = :b"),
                   {"id": resource_id, "b": business_id, **body.model_dump(include=set(_FIELDS))}).rowcount
    if not n:
        raise _NOT_FOUND
    _links(db, business_id, resource_id, body)
    audit.log(db, business_id, "update", "resource", resource_id)
    db.commit()
    return _read(db, business_id, resource_id)


@router.delete("/resources/{resource_id}", status_code=204)
def delete_resource(resource_id: int = Path(ge=1), business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    """Kelgusi bronlari bo'lsa o'chirilmaydi — avval "Ta'mirda" qiling yoki bronlarni boshqasiga o'tkazing."""
    if db.scalar(text("SELECT count(*) FROM appointments WHERE resource_id = :r AND starts_at > now() "
                      "AND status IN ('pending', 'confirmed', 'in_progress')"), {"r": resource_id}):
        raise HTTPException(409, detail={"code": "resource_in_use",
                                         "message": "Bu resursda kelgusi bronlar bor. Avval ularni boshqa joyga o'tkazing"})
    n = db.execute(text("DELETE FROM resources WHERE id = :id AND business_id = :b"), {"id": resource_id, "b": business_id}).rowcount
    if not n:
        raise _NOT_FOUND
    audit.log(db, business_id, "delete", "resource", resource_id)
    db.commit()


class AssignIn(BaseModel):
    resource_id: int = Field(ge=1)


@router.put("/appointments/{appointment_id}/resource", response_model=AppointmentOut)
def assign(body: AssignIn, appointment_id: int = Path(ge=1), business_id: int = Depends(_book),
           db: Session = Depends(get_db)):
    """Bronni boshqa xona/kresloga o'tkazish. Band yoki mos bo'lmasa — 409."""
    if not db.scalar(text("SELECT 1 FROM appointments WHERE id = :a AND business_id = :b"), {"a": appointment_id, "b": business_id}):
        raise HTTPException(404, detail={"code": "not_found", "message": "Bron topilmadi"})
    db.execute(text("SELECT app.assign_resource(:a, :r)"), {"a": appointment_id, "r": body.resource_id})
    audit.log(db, business_id, "update", "appointment", appointment_id, ["resource"])
    db.commit()
    return _get(db, appointment_id)
