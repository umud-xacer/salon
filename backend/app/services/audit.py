"""Audit jurnali: kim, qachon, nimani o'zgartirdi. Jadval faqat qo'shiladi (UPDATE/DELETE huquqi yo'q)."""
import json

from sqlalchemy import text
from sqlalchemy.orm import Session


def log(db: Session, business_id: int, action: str, entity_type: str, entity_id: int | None,
        changes: dict | None = None) -> None:
    db.execute(text("""
        INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
        VALUES (:b, app.uid(), :a, :t, :e, CAST(:c AS jsonb))
    """), {"b": business_id, "a": action, "t": entity_type, "e": entity_id,
           "c": json.dumps(changes, ensure_ascii=False, default=str) if changes else None})
