"""'Boraman' tasdig'i, ustaning qo'ng'iroq tugmasi, ilova xabarlari va push qurilmalari."""
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.appointments import ClientContactOut, DeviceIn, NotificationOut

router = APIRouter(prefix="/api/v1", tags=["reminders"])


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


@router.post("/devices", status_code=204)
def register_device(body: DeviceIn, db: Session = Depends(get_db)):
    db.execute(text("SELECT app.register_device(:t, :p)"), {"t": body.token, "p": body.platform})
    db.commit()


@router.delete("/devices", status_code=204)
def remove_device(body: DeviceIn, db: Session = Depends(get_db)):
    """Hisobdan chiqishda: bu telefonga boshqa xabar kelmasin."""
    db.execute(text("DELETE FROM device_tokens WHERE token = :t AND user_id = app.uid()"), {"t": body.token})
    db.commit()


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
