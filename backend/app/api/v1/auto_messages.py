"""Avtomatik xabarlar sozlamalari va yuborilganlar tarixi (054_auto_messages.sql).

Yuborishni worker qiladi (app.auto_messages_scan har daqiqada); bu yerda — faqat sozlash va ko'rish.
"""
import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}/auto-messages", tags=["auto-messages"])

_manage = require_permission("business.manage")
_clients = require_permission("clients.view")

_FIELDS = ("birthday_enabled", "birthday_text", "review_enabled", "review_delay_hours",
           "winback_enabled", "winback_days", "winback_text")


class AutoMessageSettings(BaseModel):
    birthday_enabled: bool = False
    birthday_text: str | None = Field(default=None, max_length=500)
    review_enabled: bool = True
    review_delay_hours: int = Field(default=0, ge=0, le=72)
    winback_enabled: bool = False
    winback_days: int = Field(default=45, ge=14, le=365)
    winback_text: str | None = Field(default=None, max_length=500)


class AutoMessageSent(BaseModel):
    id: int
    kind: Literal["birthday", "review", "winback"]
    client_id: int
    client_name: str
    telegram: bool
    sent_at: dt.datetime


class AutoMessagesOut(BaseModel):
    settings: AutoMessageSettings
    sent_30d: dict[str, int]                            # oxirgi 30 kunda turi bo'yicha soni


def _settings(db: Session, business_id: int) -> AutoMessageSettings:
    row = db.execute(text(f"SELECT {', '.join(_FIELDS)} FROM auto_message_settings WHERE business_id = :b"),
                     {"b": business_id}).mappings().first()
    return AutoMessageSettings(**row) if row else AutoMessageSettings()


@router.get("", response_model=AutoMessagesOut)
def get_auto_messages(business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    counts = dict(db.execute(text("""
        SELECT kind, count(*)::int FROM auto_messages_sent
         WHERE business_id = :b AND sent_at > now() - INTERVAL '30 days' GROUP BY kind
    """), {"b": business_id}).all())
    return AutoMessagesOut(settings=_settings(db, business_id),
                           sent_30d={k: counts.get(k, 0) for k in ("birthday", "review", "winback")})


@router.put("", response_model=AutoMessageSettings)
def save_auto_messages(body: AutoMessageSettings, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    data = body.model_dump()
    for k in ("birthday_text", "winback_text"):
        data[k] = (data[k] or "").strip() or None
    cols = ", ".join(_FIELDS)
    params = ", ".join(f":{k}" for k in _FIELDS)
    updates = ", ".join(f"{k} = EXCLUDED.{k}" for k in _FIELDS)
    db.execute(text(f"""
        INSERT INTO auto_message_settings (business_id, {cols}) VALUES (:b, {params})
        ON CONFLICT (business_id) DO UPDATE SET {updates}, updated_at = now()
    """), {"b": business_id, **data})
    audit.log(db, business_id, "update", "auto_messages", business_id)
    db.commit()
    return _settings(db, business_id)


@router.get("/sent", response_model=list[AutoMessageSent])
def sent_messages(kind: Literal["birthday", "review", "winback"] | None = None,
                  limit: int = Query(default=50, ge=1, le=200),
                  business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT s.id, s.kind, s.client_id, c.full_name AS client_name, s.telegram, s.sent_at
          FROM auto_messages_sent s JOIN business_clients c ON c.id = s.client_id
         WHERE s.business_id = :b AND (CAST(:k AS text) IS NULL OR s.kind = :k)
         ORDER BY s.sent_at DESC, s.id DESC LIMIT :l
    """), {"b": business_id, "k": kind, "l": limit}).mappings()
    return [AutoMessageSent(**r) for r in rows]
