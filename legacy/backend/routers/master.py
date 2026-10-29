"""
Master (Usta) Panel API
JWT tokendan master_id olinib, faqat o'sha ustaning ma'lumotlari qaytariladi
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
from auth import require_master, get_current_user
from datetime import date, datetime
import models

router = APIRouter(prefix="/api/master", tags=["master"])


def _get_staff(user: dict, db: Session):
    """JWT tokendan staff ID topish"""
    staff_id = user.get("staff_id")
    salon_id = user.get("salon_id") or 1
    if staff_id:
        s = db.query(models.Staff).filter(
            models.Staff.id == staff_id,
            models.Staff.salon_id == salon_id,
        ).first()
        if s:
            return s
    # Ism bo'yicha qidirish
    name = user.get("full_name", "")
    if name:
        s = db.query(models.Staff).filter(
            models.Staff.name.ilike(f"%{name.split()[0]}%"),
            models.Staff.salon_id == salon_id,
        ).first()
        if s:
            return s
    raise HTTPException(404, "Usta profili topilmadi. Admin bilan bog'laning.")


# ─── Dashboard ────────────────────────────────────────────────────────────────
@router.get("/dashboard")
def master_dashboard(user=Depends(require_master), db: Session = Depends(get_db)):
    staff    = _get_staff(user, db)
    salon_id = user.get("salon_id") or 1
    today    = str(date.today())
    month    = today[:7]
    pct      = staff.percent or 30
    first    = staff.name.split()[0]

    # Bugungi bronlar
    today_appts = db.query(models.Appointment).filter(
        models.Appointment.salon_id == salon_id,
        models.Appointment.appt_date == today,
        models.Appointment.master.ilike(f"%{first}%"),
    ).order_by(models.Appointment.appt_time).all()

    # Bugungi daromad (Finance)
    today_fin = db.query(models.Finance).filter(
        models.Finance.salon_id == salon_id,
        models.Finance.type == "income",
        models.Finance.fin_date == today,
        models.Finance.note.ilike(f"%{first}%"),
    ).all()
    today_income   = sum(f.amount for f in today_fin)
    today_earnings = round(today_income * pct / 100)

    # Oylik daromad
    month_fin = db.query(models.Finance).filter(
        models.Finance.salon_id == salon_id,
        models.Finance.type == "income",
        models.Finance.fin_date.startswith(month),
        models.Finance.note.ilike(f"%{first}%"),
    ).all()
    month_income   = sum(f.amount for f in month_fin)
    month_earnings = round(month_income * pct / 100)

    # Sklad holati
    my_inv = db.query(models.MasterInventory).filter(
        models.MasterInventory.master_id == staff.id,
        models.MasterInventory.salon_id == salon_id,
    ).all()
    low_stock = [
        {
            "name":      i.product_name,
            "remaining": i.remaining_qty,
            "min_qty":   i.min_qty,
            "unit":      i.unit,
            "pct":       round(i.remaining_qty / i.given_qty * 100) if i.given_qty else 0,
        }
        for i in my_inv if i.remaining_qty <= i.min_qty
    ]

    # Bugungi statistika
    total_today   = len(today_appts)
    done_today    = sum(1 for a in today_appts if a.status == "completed")
    pending_today = sum(1 for a in today_appts if a.status in ("pending", "confirmed"))

    def appt_out(a):
        return {
            "id":           a.id,
            "client_name":  a.client_name,
            "client_phone": a.client_phone,
            "service":      a.service,
            "appt_time":    a.appt_time,
            "price":        a.price,
            "status":       a.status,
            "is_paid":      a.is_paid,
            "checked_in_at": a.checked_in_at,
            "note":         a.note,
        }

    return {
        "staff": {
            "id":       staff.id,
            "name":     staff.name,
            "role":     staff.role,
            "percent":  pct,
            "salary":   staff.salary or 0,
            "kpi":      staff.kpi or 80,
            "rating":   staff.rating or 5.0,
        },
        "today": {
            "date":          today,
            "total_appts":   total_today,
            "done":          done_today,
            "pending":       pending_today,
            "income":        today_income,
            "earnings":      today_earnings,
            "appointments":  [appt_out(a) for a in today_appts],
        },
        "month": {
            "income":        month_income,
            "earnings":      month_earnings,
            "salary":        staff.salary or 0,
            "records": [
                {
                    "date":     f.fin_date,
                    "amount":   f.amount,
                    "earnings": round(f.amount * pct / 100),
                    "note":     f.note,
                }
                for f in sorted(month_fin, key=lambda x: x.fin_date or "", reverse=True)[:30]
            ],
        },
        "inventory": {
            "items": [
                {
                    "id":          i.id,
                    "product_id":  i.product_id,
                    "name":        i.product_name,
                    "given":       i.given_qty,
                    "used":        i.used_qty,
                    "remaining":   i.remaining_qty,
                    "min_qty":     i.min_qty,
                    "unit":        i.unit,
                    "pct_left":    round(i.remaining_qty / i.given_qty * 100) if i.given_qty else 0,
                }
                for i in my_inv
            ],
            "low_stock_count": len(low_stock),
            "alerts":          low_stock,
        },
    }


# ─── Xizmatni Boshlash (Usta tasdiqlaydi) ────────────────────────────────────
@router.patch("/appointments/{id}/start")
def start_service(id: int, user=Depends(require_master), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id") or 1
    appt = db.query(models.Appointment).filter(
        models.Appointment.id == id,
        models.Appointment.salon_id == salon_id,
    ).first()
    if not appt:
        raise HTTPException(404, "Bron topilmadi")
    appt.status       = "confirmed"
    appt.checked_in_at = datetime.now().strftime("%H:%M")
    db.commit()
    return {"ok": True, "message": f"✅ Xizmat boshlandi — {appt.client_name}"}


# ─── Qo'shimcha material sarfi ───────────────────────────────────────────────
@router.post("/use-material")
def use_material(
    product_id: int,
    qty: float = 1,
    note: str = "",
    user=Depends(require_master),
    db: Session = Depends(get_db),
):
    staff    = _get_staff(user, db)
    salon_id = user.get("salon_id") or 1
    mi = db.query(models.MasterInventory).filter(
        models.MasterInventory.master_id  == staff.id,
        models.MasterInventory.product_id == product_id,
        models.MasterInventory.salon_id   == salon_id,
    ).first()
    if not mi:
        raise HTTPException(404, "Bu mahsulot sizga biriktirilmagan")
    if mi.remaining_qty < qty:
        raise HTTPException(400, f"Yetarli emas. Qolgan: {mi.remaining_qty} {mi.unit}")

    mi.used_qty      += qty
    mi.remaining_qty -= qty

    log = models.InventoryLog(
        salon_id=salon_id,
        master_id=staff.id,
        master_name=staff.name,
        product_id=product_id,
        product_name=mi.product_name,
        action="used",
        quantity=qty,
        note=note or "Usta tomonidan ishlatildi",
        log_date=str(date.today()),
    )
    db.add(log)
    db.commit()
    return {
        "ok": True,
        "remaining": mi.remaining_qty,
        "low_stock": mi.remaining_qty <= mi.min_qty,
        "message": f"✅ {mi.product_name}: {qty} {mi.unit} sarflandi. Qoldi: {mi.remaining_qty}",
    }
