"""'Boraman' tasdig'i, ustaning qo'ng'iroq tugmasi va ilova ichidagi xabarlar.

/r/{token} — SMS'dagi havola, kirishsiz ishlaydi. GET faqat sahifa ko'rsatadi, tasdiq POST bilan:
messenjerlar havolani oldindan ochib ko'rganda bron o'z-o'zidan tasdiqlanib qolmasin.
"""
import hashlib
from html import escape

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_public_db
from app.schemas.appointments import ClientContactOut, NotificationOut

router = APIRouter(prefix="/api/v1", tags=["reminders"])
public_router = APIRouter(include_in_schema=False)

_TOKEN = Path(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

_PAGE = """<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bronni tasdiqlash</title>
<style>body{{font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;text-align:center;color:#222}}
button{{font-size:18px;padding:14px 40px;border:0;border-radius:10px;background:#16794c;color:#fff}}</style>
</head><body>{body}</body></html>"""


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _page(body: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(_PAGE.format(body=body), status_code=status)


_EXPIRED = "<h2>Havola eskirgan</h2><p>Bron bekor qilingan yoki vaqti o'tgan.</p>"
_THANKS = "<h2>Rahmat!</h2><p>Sizni kutamiz.</p>"


@public_router.get("/r/{token}", response_class=HTMLResponse)
def reminder_page(token: str = _TOKEN, db: Session = Depends(get_public_db)):
    row = db.execute(text("SELECT * FROM app.reminder_by_token(:h)"), {"h": _hash(token)}).mappings().first()
    if row is None:
        return _page(_EXPIRED, 404)
    if row["confirmed"]:
        return _page(_THANKS)
    return _page(f"<h2>{escape(row['business_name'])}</h2><p>Broningiz soat <b>{escape(row['slot_time'])}</b> da.</p>"
                 f'<form method="post"><button type="submit">Boraman</button></form>')


@public_router.post("/r/{token}", response_class=HTMLResponse)
def reminder_confirm(token: str = _TOKEN, db: Session = Depends(get_public_db)):
    row = db.execute(text("SELECT * FROM app.reminder_by_token(:h)"), {"h": _hash(token)}).first()
    if row is None:
        return _page(_EXPIRED, 404)
    db.execute(text("SELECT app.confirm_attendance_by_token(:h)"), {"h": _hash(token)})
    db.commit()
    return _page(_THANKS)


@router.post("/appointments/{appointment_id}/attend", status_code=204)
def attend(appointment_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Ilovadagi 'Boraman' tugmasi."""
    db.execute(text("SELECT app.confirm_attendance(:id)"), {"id": appointment_id})
    db.commit()


@router.get("/appointments/{appointment_id}/client-contact", response_model=ClientContactOut)
def client_contact(appointment_id: int = Path(ge=1), db: Session = Depends(get_db)):
    """Ustaning qo'ng'iroq tugmasi: faqat ochiq ogohlantirish bo'yicha ishlaydi."""
    phone = db.scalar(text("SELECT app.client_contact(:id)"), {"id": appointment_id})
    db.commit()
    return ClientContactOut(phone=phone, tel_url=f"tel:{phone}")


@router.get("/notifications", response_model=list[NotificationOut])
def my_notifications(unread: bool = False, limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db)):
    rows = db.execute(text(f"""
        SELECT id, type, title, body, data, read_at, created_at FROM notifications
         WHERE user_id = app.uid() {'AND read_at IS NULL' if unread else ''}
         ORDER BY created_at DESC, id DESC LIMIT :limit
    """), {"limit": limit}).mappings()
    return [NotificationOut(**r) for r in rows]


@router.post("/notifications/{notification_id}/read", status_code=204)
def read_notification(notification_id: int = Path(ge=1), db: Session = Depends(get_db)):
    updated = db.execute(text("UPDATE notifications SET read_at = coalesce(read_at, now()) "
                              "WHERE id = :id AND user_id = app.uid()"), {"id": notification_id}).rowcount
    if not updated:
        raise HTTPException(404, detail={"code": "not_found", "message": "Topilmadi"})
    db.commit()
