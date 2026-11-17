"""Mijoz segmentlari va ommaviy xabarlar (056_broadcasts.sql). Faqat direktor ('business.manage').

Segment bazadagi app.segment_clients da hisoblanadi; yuborish — app.send_broadcast (kunlik limit va
72 soatlik "bezovta qilmaslik" qoidasi ham bazada). Telegram'ga worker yuboradi.
"""
import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}", tags=["broadcasts"])
_manage = require_permission("business.manage")

Kind = Literal["all", "inactive", "birthday", "regular", "new"]
Gender = Literal["male", "female"]
# Har segment uchun ruxsat etilgan parametr (UI tanlovlari bilan bir xil) va standart qiymat
_PARAMS: dict[str, tuple[set[int], int]] = {
    "all": ({0}, 0), "inactive": ({30, 45, 60, 90, 180}, 30), "birthday": ({7, 14, 30}, 7),
    "regular": ({3, 5, 10}, 3), "new": ({30, 60, 90}, 30),
}


class Segment(BaseModel):
    kind: Kind = "all"
    param: int | None = None
    tag: str | None = Field(default=None, max_length=30)
    gender: Gender | None = None

    @field_validator("tag")
    @classmethod
    def _tag(cls, v: str | None) -> str | None:
        return " ".join(v.split()) or None if v else None

    @model_validator(mode="after")
    def _param(self):
        allowed, default = _PARAMS[self.kind]
        if self.param is None:
            self.param = default
        if self.param not in allowed:
            raise ValueError("Segment parametri noto'g'ri")
        return self


class SegmentPreview(BaseModel):
    total: int                                          # segmentga tushganlar
    with_app: int                                       # xabar yetadi (ilova hisobi bor)
    telegram: int                                       # Telegram'ga ham boradi
    without_app: int                                    # ilovasiz — hozircha xabar bormaydi (SMS keyin)
    sample: list[str]                                   # birinchi 20 ta ism


class BroadcastIn(Segment):
    title: str = Field(min_length=2, max_length=80)
    body: str = Field(min_length=2, max_length=500)


class BroadcastOut(BaseModel):
    id: int
    segment: dict
    title: str
    body: str
    matched: int
    sent_app: int
    sent_telegram: int
    skipped_recent: int
    created_by_name: str | None
    created_at: dt.datetime


def _segment_rows(db: Session, business_id: int, s: Segment):
    return db.execute(text("SELECT * FROM app.segment_clients(:b, :k, :p, :t, :g)"),
                      {"b": business_id, "k": s.kind, "p": s.param, "t": s.tag, "g": s.gender}).mappings().all()


@router.get("/segments/preview", response_model=SegmentPreview)
def preview(kind: Kind = "all", param: int | None = None, tag: str | None = Query(default=None, max_length=30),
            gender: Gender | None = None, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    try:
        s = Segment(kind=kind, param=param, tag=tag, gender=gender)
    except ValueError:
        raise HTTPException(422, detail={"code": "bad_segment", "message": "Segment parametri noto'g'ri"})
    rows = _segment_rows(db, business_id, s)
    app_rows = [r for r in rows if r["user_id"] is not None]
    return SegmentPreview(total=len(rows), with_app=len(app_rows), telegram=sum(1 for r in app_rows if r["chat_id"]),
                          without_app=len(rows) - len(app_rows), sample=[r["full_name"] for r in rows[:20]])


_SELECT = """
    SELECT b.id, b.segment, b.title, b.body, b.matched, b.sent_app, b.sent_telegram, b.skipped_recent,
           u.full_name AS created_by_name, b.created_at
      FROM broadcasts b LEFT JOIN users u ON u.id = b.created_by
"""


@router.post("/broadcasts", response_model=BroadcastOut, status_code=201)
def send(body: BroadcastIn, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    try:
        broadcast_id = db.scalar(text("SELECT app.send_broadcast(:b, :k, :p, :t, :g, :title, :body)"), {
            "b": business_id, "k": body.kind, "p": body.param, "t": body.tag, "g": body.gender,
            "title": body.title.strip(), "body": body.body.strip()})
    except DBAPIError as e:
        if getattr(e.orig, "sqlstate", None) == "P0429":
            db.rollback()
            raise HTTPException(429, detail={"code": "broadcast_limit",
                                             "message": "Kuniga ko'pi bilan 3 ta ommaviy xabar yuborish mumkin"})
        raise
    audit.log(db, business_id, "create", "broadcast", broadcast_id)
    db.commit()
    return BroadcastOut(**db.execute(text(f"{_SELECT} WHERE b.id = :id"), {"id": broadcast_id}).mappings().one())


@router.get("/broadcasts", response_model=list[BroadcastOut])
def history(limit: int = Query(default=30, ge=1, le=100), business_id: int = Depends(_manage),
            db: Session = Depends(get_db)):
    rows = db.execute(text(f"{_SELECT} WHERE b.business_id = :b ORDER BY b.created_at DESC LIMIT :l"),
                      {"b": business_id, "l": limit}).mappings()
    return [BroadcastOut(**r) for r in rows]
