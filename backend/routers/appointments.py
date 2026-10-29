from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
from auth import get_salon_id, get_current_user
from datetime import date
import models, schemas

router = APIRouter(prefix="/api/appointments", tags=["appointments"])


@router.get("/", response_model=list[schemas.AppointmentOut])
def get_all(date_filter: str = Query(None, alias="date"), salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    q = db.query(models.Appointment)
    if salon_id:
        q = q.filter(models.Appointment.salon_id == salon_id)
    if date_filter:
        q = q.filter(models.Appointment.appt_date == date_filter)
    return q.order_by(models.Appointment.appt_time).all()


@router.post("/", response_model=schemas.AppointmentOut)
def create(item: schemas.AppointmentCreate, user=Depends(get_current_user), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id") or 1
    conflict = db.query(models.Appointment).filter(
        models.Appointment.salon_id == salon_id,
        models.Appointment.master == item.master,
        models.Appointment.appt_date == item.appt_date,
        models.Appointment.appt_time == item.appt_time,
        models.Appointment.status != "completed",
        models.Appointment.status != "cancelled",
    ).first()
    if conflict:
        raise HTTPException(400, f"{item.master} {item.appt_time}da band!")

    data = item.model_dump()
    data["salon_id"] = salon_id

    if not data.get("price") or data["price"] == 0:
        svc = db.query(models.Service).filter(
            models.Service.name == item.service,
            models.Service.salon_id == salon_id,
        ).first()
        if svc:
            data["price"] = svc.price

    if not data.get("staff_id") or data["staff_id"] == 0:
        if item.master:
            staff = db.query(models.Staff).filter(
                models.Staff.salon_id == salon_id,
                models.Staff.name.ilike(f"%{item.master.split()[0]}%")
            ).first()
            if staff:
                data["staff_id"] = staff.id

    obj = models.Appointment(**data)
    db.add(obj); db.commit(); db.refresh(obj)

    client = db.query(models.Client).filter(
        models.Client.phone == item.client_phone,
        models.Client.salon_id == salon_id,
    ).first()
    if client:
        client.visits += 1
        svc = db.query(models.Service).filter(models.Service.name == item.service, models.Service.salon_id == salon_id).first()
        if svc:
            client.bonus += round(svc.price / 100)
        db.commit()

    # Bildirishnoma yaratish
    source_label = "bot orqali" if item.source == "bot" else "admin tomonidan"
    notif = models.Notification(
        salon_id=salon_id,
        type="booking",
        title="Yangi bron qo'shildi",
        message=f"{item.client_name} — {item.service} ({item.appt_time}) {source_label}",
        icon="📅",
        link="dashboard",
    )
    db.add(notif)
    # Aktivlik logi
    log = models.ActivityLog(
        salon_id=salon_id,
        user_id=user.get("user_id"),
        username=user.get("username", ""),
        full_name=user.get("full_name", ""),
        role=user.get("role", ""),
        action="create",
        entity_type="appointment",
        entity_id=obj.id,
        description=f"Yangi bron: {item.client_name} — {item.service} ({item.appt_date} {item.appt_time})",
    )
    db.add(log)
    db.commit()
    return obj


@router.put("/{id}", response_model=schemas.AppointmentOut)
def update(id: int, item: schemas.AppointmentCreate, db: Session = Depends(get_db)):
    obj = db.query(models.Appointment).filter(models.Appointment.id == id).first()
    if not obj:
        raise HTTPException(404, "Topilmadi")
    for k, v in item.model_dump().items():
        setattr(obj, k, v)
    db.commit(); db.refresh(obj)
    return obj


@router.patch("/{id}/status")
def update_status(id: int, status: str = Query(...), user=Depends(get_current_user), db: Session = Depends(get_db)):
    obj = db.query(models.Appointment).filter(models.Appointment.id == id).first()
    if not obj:
        raise HTTPException(404, "Topilmadi")
    old_status = obj.status
    obj.status = status
    salon_id = obj.salon_id or user.get("salon_id") or 1

    # "cancelled" (Kelolmadi) bo'lganda adminga log yozish
    if status == "cancelled":
        today = str(date.today())
        note_text = (
            f"[NO-SHOW] {obj.client_name} — {obj.service} "
            f"({obj.appt_time}) | Usta: {obj.master or '—'}"
        )
        alert = models.Finance(
            type="expense",
            category="No-show alert",
            amount=0,
            note=note_text,
            fin_date=today,
            salon_id=salon_id,
        )
        db.add(alert)

    # Bildirishnoma va log
    if status == "completed":
        notif = models.Notification(
            salon_id=salon_id, type="success",
            title=f"Usta {obj.master or '—'} ishni yakunladi",
            message=f"{obj.client_name} — {obj.service} (Tushum: {int(obj.price or 0):,} so'm)",
            icon="✅", link="dashboard",
        )
        db.add(notif)
    elif status == "cancelled":
        notif = models.Notification(
            salon_id=salon_id, type="warning",
            title="Mijoz kelmadi (No-Show)",
            message=f"{obj.client_name} — {obj.service} ({obj.appt_time})",
            icon="❌", link="dashboard",
        )
        db.add(notif)

    log = models.ActivityLog(
        salon_id=salon_id,
        user_id=user.get("user_id"),
        username=user.get("username", ""),
        full_name=user.get("full_name", ""),
        role=user.get("role", ""),
        action="update",
        entity_type="appointment",
        entity_id=obj.id,
        description=f"Bron holati o'zgartirildi: '{old_status}' → '{status}' ({obj.client_name} {obj.appt_time})",
    )
    db.add(log)

    db.commit()
    return {"ok": True, "status": status}


# ─── Check-in: Mijoz keldi ────────────────────────────────────────────────────
@router.patch("/{id}/checkin")
def checkin(id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    obj = db.query(models.Appointment).filter(models.Appointment.id == id).first()
    if not obj:
        raise HTTPException(404, "Topilmadi")
    from datetime import datetime
    obj.status       = "confirmed"
    obj.checked_in_at = datetime.now().strftime("%H:%M")
    db.commit()
    return {"ok": True, "checked_in_at": obj.checked_in_at, "message": f"{obj.client_name} keldi ✅"}


# ─── To'lov: Aqlli Payment Modal ─────────────────────────────────────────────
from pydantic import BaseModel
from typing import List, Optional

class ProductSold(BaseModel):
    id: int
    name: str
    qty: float
    price: float

class PayRequest(BaseModel):
    payment_method: str = "cash"   # cash | card | click | payme
    discount: float = 0
    products: Optional[List[ProductSold]] = []
    note: str = ""

@router.post("/{id}/pay")
def pay_appointment(id: int, body: PayRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id") or 1
    obj = db.query(models.Appointment).filter(models.Appointment.id == id).first()
    if not obj:
        raise HTTPException(404, "Topilmadi")
    if obj.is_paid:
        raise HTTPException(400, "Bu bron allaqachon to'langan")

    from datetime import datetime
    import json

    # Mahsulot narxlari
    products_total = sum(p.price * p.qty for p in (body.products or []))
    base_price     = obj.price or 0
    total          = base_price + products_total - (body.discount or 0)
    final          = max(total, 0)

    # Appointment yangilash
    obj.is_paid        = True
    obj.payment_method = body.payment_method
    obj.discount       = body.discount
    obj.final_price    = final
    obj.paid_at        = datetime.now().strftime("%H:%M")
    obj.status         = "completed"
    if body.products:
        obj.products_sold = json.dumps([p.model_dump() for p in body.products], ensure_ascii=False)

    # Finance kirim yozish
    master_first = (obj.master or "").split()[0]
    staff = db.query(models.Staff).filter(
        models.Staff.salon_id == salon_id,
        models.Staff.name.ilike(f"%{master_first}%")
    ).first()
    pct  = staff.percent if staff else 30
    note = f"{obj.client_name} — {obj.service} [{master_first}] ({pct}%) | {body.payment_method}"
    if body.note:
        note += f" | {body.note}"

    finance = models.Finance(
        salon_id=salon_id,
        type="income",
        category="Xizmat",
        amount=final,
        note=note,
        fin_date=str(date.today()),
    )
    db.add(finance)

    # Mahsulot sotilgan bo'lsa, inventorydan ayirish
    for p in (body.products or []):
        inv = db.query(models.Inventory).filter(
            models.Inventory.id == p.id,
            models.Inventory.salon_id == salon_id,
        ).first()
        if inv:
            inv.qty = max(0, inv.qty - p.qty)
        # Master inventory ham kamaysin
        mi = db.query(models.MasterInventory).filter(
            models.MasterInventory.product_id == p.id,
            models.MasterInventory.master_id  == (obj.staff_id or 0),
        ).first()
        if mi:
            mi.used_qty      += p.qty
            mi.remaining_qty  = max(0, mi.remaining_qty - p.qty)
        # Log yozish
        log = models.InventoryLog(
            salon_id=salon_id,
            master_id=obj.staff_id or 0,
            master_name=obj.master or "",
            product_id=p.id,
            product_name=p.name,
            action="used",
            quantity=p.qty,
            note=f"Mijozga sotildi: {obj.client_name}",
            log_date=str(date.today()),
        )
        db.add(log)

    # Mijozga bonus
    client = db.query(models.Client).filter(
        models.Client.phone    == obj.client_phone,
        models.Client.salon_id == salon_id,
    ).first()
    if client:
        client.bonus  += round(final / 100)   # 1% bonus
        client.visits += 1

    db.commit()
    return {
        "ok": True,
        "final_price":    final,
        "payment_method": body.payment_method,
        "paid_at":        obj.paid_at,
        "finance_note":   note,
        "message": f"✅ To'lov qabul qilindi: {int(final):,} so'm ({body.payment_method})",
    }


@router.get("/master-stats")
def master_stats(master_id: int = Query(...), db: Session = Depends(get_db)):
    """
    Usta o'zining bugungi va oylik statistikasini oladi.
    GET /api/appointments/master-stats?master_id=1
    """
    from datetime import date as dt
    today = str(dt.today())
    month = today[:7]

    staff = db.query(models.Staff).filter(models.Staff.id == master_id).first()
    if not staff:
        raise HTTPException(404, "Usta topilmadi")

    pct = staff.percent or 30
    first_name = staff.name.split()[0]

    # Bugungi bronlar (usta bo'yicha)
    today_appts = db.query(models.Appointment).filter(
        models.Appointment.appt_date == today,
        models.Appointment.master.ilike(f"%{first_name}%"),
    ).all()

    done_today = [a for a in today_appts if a.status == "completed"]
    noshow_today = [a for a in today_appts if a.status == "cancelled"]

    today_revenue = sum(a.price or 0 for a in done_today)
    today_share = round(today_revenue * pct / 100)

    # Oylik daromad (finance jadvalidan)
    month_fin = db.query(models.Finance).filter(
        models.Finance.type == "income",
        models.Finance.note.ilike(f"%[{first_name}]%"),
        models.Finance.fin_date.like(f"{month}%"),
    ).all()
    month_revenue = sum(f.amount for f in month_fin)
    month_share = round(month_revenue * pct / 100)

    # Sklad ogohlantirishlari
    low_stock = db.query(models.MasterInventory).filter(
        models.MasterInventory.master_id == master_id,
        models.MasterInventory.remaining_qty <= models.MasterInventory.min_qty,
    ).all()

    return {
        "staff_id": master_id,
        "name": staff.name,
        "role": staff.role,
        "percent": pct,
        "kpi": staff.kpi or 80,
        "rating": staff.rating or 5.0,
        "review_count": staff.review_count or 0,
        "today": {
            "total": len(today_appts),
            "done": len(done_today),
            "noshow": len(noshow_today),
            "pending": len(today_appts) - len(done_today) - len(noshow_today),
            "revenue": today_revenue,
            "usta_share": today_share,
        },
        "month": {
            "revenue": month_revenue,
            "usta_share": month_share,
            "salary": staff.salary or 0,
        },
        "low_stock_count": len(low_stock),
        "low_stock_items": [
            {"name": i.product_name, "remaining": i.remaining_qty, "unit": i.unit}
            for i in low_stock
        ],
    }



@router.post("/{id}/complete")
def complete_appointment(
    id: int,
    master_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """
    Usta "Yakunlandi" bosganida 3 ta ish:
    1. Xizmat daromadini finance jadvaliga yozadi
    2. Master inventory dan materiallarni avtomatik ayiradi (agar biriktirilgan bo'lsa)
    3. Ustaning KPI / foiz ulushini log ga saqlaydi
    """
    appt = db.query(models.Appointment).filter(models.Appointment.id == id).first()
    if not appt:
        raise HTTPException(404, "Bron topilmadi")
    if appt.status == "completed":
        return {"ok": True, "message": "Allaqachon yakunlangan", "already_done": True}

    # 1) Statusni yangilash
    appt.status = "completed"

    # 2) Xizmat narxini topish
    svc = db.query(models.Service).filter(models.Service.name == appt.service).first()
    price = svc.price if svc else 0

    # Ustani olish
    staff = db.query(models.Staff).filter(models.Staff.id == master_id).first()
    if not staff:
        raise HTTPException(404, "Usta topilmadi")
    percent = staff.percent or 30
    usta_share = round(price * percent / 100)
    salon_share = price - usta_share

    today = str(date.today())

    # 3) Finance: Daromad yozuvi
    if price > 0:
        fin = models.Finance(
            type="income",
            category="Xizmat daromadi",
            amount=price,
            note=f"{appt.service} — {appt.client_name} [{staff.name.split()[0]}] ({percent}%)",
            fin_date=today,
        )
        db.add(fin)

    # 4) Material avtomatik ayirish: ushbu ustaga biriktirilgan materiallar
    mi_list = db.query(models.MasterInventory).filter(
        models.MasterInventory.master_id == master_id
    ).all()
    used_items = []
    for mi in mi_list:
        # Har bir xizmat uchun 1 birlik ayiramiz (agar qolsa)
        if mi.remaining_qty >= 1:
            mi.used_qty += 1
            mi.remaining_qty -= 1
            log = models.InventoryLog(
                master_id=master_id,
                master_name=staff.name,
                product_id=mi.product_id,
                product_name=mi.product_name,
                action="used",
                quantity=1,
                note=f"Avtomatik: {appt.service} xizmati",
                log_date=today,
            )
            db.add(log)
            used_items.append(mi.product_name)

    db.commit()

    # Kam qolgan materiallar
    low_stock = [
        mi.product_name for mi in mi_list if mi.remaining_qty <= mi.min_qty
    ]

    return {
        "ok": True,
        "message": f"✅ Xizmat yakunlandi!",
        "price": price,
        "usta_share": usta_share,
        "salon_share": salon_share,
        "percent": percent,
        "used_materials": used_items,
        "low_stock_alerts": low_stock,
        "master_name": staff.name,
    }


@router.delete("/{id}")
def delete(id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    obj = db.query(models.Appointment).filter(models.Appointment.id == id).first()
    if not obj:
        raise HTTPException(404, "Topilmadi")
    # Aktivlik logi
    salon_id = obj.salon_id or user.get("salon_id") or 1
    log = models.ActivityLog(
        salon_id=salon_id,
        user_id=user.get("user_id"),
        username=user.get("username", ""),
        full_name=user.get("full_name", ""),
        role=user.get("role", ""),
        action="delete",
        entity_type="appointment",
        entity_id=obj.id,
        description=f"{user.get('full_name', '')} {obj.appt_time} dagi bronni o'chirdi ({obj.client_name} — {obj.service})",
    )
    db.add(log)
    db.delete(obj); db.commit()
    return {"ok": True}
