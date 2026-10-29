from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from auth import get_salon_id, require_admin, require_master, check_same_salon
from datetime import date
import models

router = APIRouter(prefix="/api/master-inventory", tags=["master-inventory"])


def _own_master_id(user: dict, db: Session, master_id):
    """Usta roli bo'lsa — faqat o'z staff ID'si; admin istalgan ustani ko'radi."""
    if user.get("role") == "master":
        from routers.master import _get_staff
        return _get_staff(user, db).id
    return master_id


# ──────────────────────────────────────────
# Ustadagi materiallar ro'yxati
# ──────────────────────────────────────────
@router.get("/")
def list_master_inventory(master_id: int = None, user=Depends(require_master), salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    master_id = _own_master_id(user, db, master_id)
    q = db.query(models.MasterInventory)
    if salon_id:
        q = q.filter(models.MasterInventory.salon_id == salon_id)
    if master_id:
        q = q.filter(models.MasterInventory.master_id == master_id)
    return q.order_by(models.MasterInventory.master_name).all()


@router.get("/low-stock")
def low_stock_alerts(user=Depends(require_admin), salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    q = db.query(models.MasterInventory).filter(
        models.MasterInventory.remaining_qty <= models.MasterInventory.min_qty
    )
    if salon_id:
        q = q.filter(models.MasterInventory.salon_id == salon_id)
    return [
        {
            "master_name": i.master_name,
            "product_name": i.product_name,
            "remaining": i.remaining_qty,
            "min_qty": i.min_qty,
            "unit": i.unit,
        }
        for i in q.all()
    ]


@router.get("/analytics")
def usage_analytics(user=Depends(require_admin), salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    """Qaysi usta eng ko'p material ishlatdi"""
    q = db.query(
        models.MasterInventory.master_name,
        func.sum(models.MasterInventory.used_qty).label("total_used"),
    )
    if salon_id:
        q = q.filter(models.MasterInventory.salon_id == salon_id)
    rows = (
        q.group_by(models.MasterInventory.master_name)
        .order_by(func.sum(models.MasterInventory.used_qty).desc())
        .all()
    )
    return [{"master_name": r[0], "total_used": r[1] or 0} for r in rows]


# ──────────────────────────────────────────
# Admin: Ustaga material berish
# ──────────────────────────────────────────
@router.post("/distribute")
def distribute_to_master(
    master_id: int,
    product_id: int,
    quantity: float,
    note: str = "",
    user=Depends(require_admin),
    db: Session = Depends(get_db),
):
    if quantity <= 0:
        raise HTTPException(400, "Miqdor musbat bo'lishi kerak")

    # 1) Asosiy sklad tekshiruv
    product = db.query(models.Inventory).filter(models.Inventory.id == product_id).first()
    if not product:
        raise HTTPException(404, "Mahsulot topilmadi")
    check_same_salon(user, product.salon_id)
    if product.qty < quantity:
        raise HTTPException(400, f"Asosiy sklad yetarli emas. Mavjud: {product.qty} {product.unit}")

    # 2) Ustani olish (mahsulot bilan bir salondan)
    master = db.query(models.Staff).filter(
        models.Staff.id == master_id,
        models.Staff.salon_id == product.salon_id,
    ).first()
    if not master:
        raise HTTPException(404, "Usta topilmadi")

    # 3) Asosiy sklad kamayadi
    product.qty -= quantity

    # 4) Master inventory yangilanadi (yoki yaratiladi)
    mi = db.query(models.MasterInventory).filter(
        models.MasterInventory.master_id == master_id,
        models.MasterInventory.product_id == product_id,
    ).first()

    if mi:
        mi.given_qty += quantity
        mi.remaining_qty += quantity
    else:
        mi = models.MasterInventory(
            salon_id=master.salon_id,
            master_id=master_id,
            master_name=master.name,
            product_id=product_id,
            product_name=product.name,
            unit=product.unit,
            given_qty=quantity,
            used_qty=0,
            remaining_qty=quantity,
            min_qty=2,
        )
        db.add(mi)

    # 5) Log yozish
    log = models.InventoryLog(
        salon_id=master.salon_id,
        master_id=master_id,
        master_name=master.name,
        product_id=product_id,
        product_name=product.name,
        action="given",
        quantity=quantity,
        note=note or f"Admin tomonidan berildi",
        log_date=str(date.today()),
    )
    db.add(log)
    db.commit()

    return {
        "ok": True,
        "message": f"{master.name} ga {quantity} {product.unit} {product.name} berildi",
        "remaining_main_stock": product.qty,
    }


# ──────────────────────────────────────────
# Usta: Material ishlatish
# ──────────────────────────────────────────
@router.post("/use")
def use_material(
    master_id: int,
    product_id: int,
    quantity: float = 1,
    note: str = "",
    user=Depends(require_master),
    db: Session = Depends(get_db),
):
    if quantity <= 0:
        raise HTTPException(400, "Miqdor musbat bo'lishi kerak")
    master_id = _own_master_id(user, db, master_id)
    mi = db.query(models.MasterInventory).filter(
        models.MasterInventory.master_id == master_id,
        models.MasterInventory.product_id == product_id,
    ).first()

    if not mi:
        raise HTTPException(404, "Bu mahsulot sizga biriktirilmagan")
    check_same_salon(user, mi.salon_id)
    if mi.remaining_qty < quantity:
        raise HTTPException(400, f"Sizda yetarli miqdor yo'q. Qolgan: {mi.remaining_qty}")

    mi.used_qty += quantity
    mi.remaining_qty -= quantity

    log = models.InventoryLog(
        salon_id=mi.salon_id,
        master_id=master_id,
        master_name=mi.master_name,
        product_id=product_id,
        product_name=mi.product_name,
        action="used",
        quantity=quantity,
        note=note or "Usta tomonidan ishlatildi",
        log_date=str(date.today()),
    )
    db.add(log)
    db.commit()

    return {
        "ok": True,
        "remaining": mi.remaining_qty,
        "low_stock": mi.remaining_qty <= mi.min_qty,
        "message": f"{mi.product_name} dan {quantity} {mi.unit} ishlatildi. Qoldi: {mi.remaining_qty}",
    }


# ──────────────────────────────────────────
# Loglar
# ──────────────────────────────────────────
@router.get("/logs")
def get_logs(master_id: int = None, limit: int = 50, user=Depends(require_master), salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    master_id = _own_master_id(user, db, master_id)
    q = db.query(models.InventoryLog)
    if salon_id:
        q = q.filter(models.InventoryLog.salon_id == salon_id)
    if master_id:
        q = q.filter(models.InventoryLog.master_id == master_id)
    return q.order_by(models.InventoryLog.created_at.desc()).limit(min(limit, 500)).all()
