"""Ombor. Qoldiqni faqat harakatlar o'zgartiradi, qoidalar sql/014_inventory.sql triggerlarida."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.schemas.inventory import (CountIn, InventorySummary, MovementIn, MovementOut, ProductCreate, ProductIn,
                                   ProductOut, ProductUpdate)
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}", tags=["inventory"])

_view = require_permission("inventory.view")
_manage = require_permission("inventory.manage")

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Mahsulot topilmadi"})

_LOW = "p.is_active AND p.min_qty > 0 AND p.current_qty <= p.min_qty"
_PRODUCT_SELECT = f"""
    SELECT p.id, p.name, p.sku, p.category, p.barcode, p.unit, p.cost_price, p.sale_price, p.min_qty, p.current_qty, p.is_active,
           {_LOW} AS is_low
      FROM products p
"""
_MOVEMENT_SELECT = """
    SELECT s.id, s.product_id, p.name AS product_name, p.unit, s.type::text AS type, s.qty, s.unit_cost, s.note,
           u.full_name AS created_by_name, s.created_at
      FROM stock_movements s
      JOIN products p  ON p.id = s.product_id
      LEFT JOIN users u ON u.id = s.created_by
"""
# Chiqim turlari ombordan kamaytiradi. Mijoz musbat miqdor yuboradi, belgini server qo'yadi.
_SIGN = {"purchase": 1, "usage": -1, "write_off": -1}


def _product(db: Session, business_id: int, product_id: int) -> ProductOut:
    row = db.execute(text(f"{_PRODUCT_SELECT} WHERE p.id = :id AND p.business_id = :b"),
                     {"id": product_id, "b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return ProductOut(**row)


def _clean(body: ProductIn) -> dict:
    return {"name": body.name.strip(), "sku": (body.sku or "").strip() or None, "unit": body.unit.strip(),
            "category": (body.category or "").strip() or None, "barcode": body.barcode or None,
            "cost": body.cost_price, "sale": body.sale_price, "min": body.min_qty}


@router.get("/inventory/summary", response_model=InventorySummary)
def summary(business_id: int = Depends(_view), db: Session = Depends(get_db)):
    """Kam qolganlar soni hamma mahsulotdan, ro'yxat esa eng qisqasidan 5 ta."""
    totals = db.execute(text(f"""
        SELECT count(*)::int AS products, count(*) FILTER (WHERE {_LOW})::int AS low_count,
               coalesce(sum(p.current_qty * p.cost_price), 0)::bigint AS stock_value
          FROM products p WHERE p.business_id = :b AND p.is_active
    """), {"b": business_id}).mappings().one()
    low = db.execute(text(f"""{_PRODUCT_SELECT} WHERE p.business_id = :b AND {_LOW}
         ORDER BY p.current_qty / p.min_qty, p.name LIMIT 5
    """), {"b": business_id}).mappings()
    return InventorySummary(**totals, low=[ProductOut(**r) for r in low])


@router.get("/products", response_model=list[ProductOut])
def list_products(q: str = Query(default="", max_length=60),
                  show: Literal["active", "low", "inactive"] = "active",
                  limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
                  business_id: int = Depends(_view), db: Session = Depends(get_db)):
    pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"
    condition = {"active": "p.is_active", "low": _LOW, "inactive": "NOT p.is_active"}[show]
    rows = db.execute(text(_PRODUCT_SELECT + rf"""
         WHERE p.business_id = :b AND {condition}
           AND (p.name ILIKE :p ESCAPE '\' OR coalesce(p.sku, '') ILIKE :p ESCAPE '\'
                OR coalesce(p.barcode, '') = :exact OR coalesce(p.category, '') ILIKE :p ESCAPE '\')
         ORDER BY p.name, p.id
         LIMIT :limit OFFSET :offset
    """), {"b": business_id, "p": pattern, "exact": q.strip(), "limit": limit, "offset": offset}).mappings()
    return [ProductOut(**r) for r in rows]


@router.get("/products/by-barcode/{barcode}", response_model=ProductOut)
def product_by_barcode(barcode: str = Path(pattern=r"^[0-9A-Za-z-]{4,64}$"), business_id: int = Depends(_view),
                       db: Session = Depends(get_db)):
    """Skaner o'qigan kod bo'yicha aniq qidiruv (veb-panel kamerasi, kelgusida mobil ilova).
    Yashirilgan mahsulot ham qaytadi (is_active=false) — aks holda "yangi mahsulot" deb qayta qo'shilib,
    kod takrorlanishi xatosiga uchrardi. Topilmasa 404 — mijoz "yangi mahsulot qo'shish"ni taklif qiladi."""
    row = db.execute(text(f"{_PRODUCT_SELECT} WHERE p.business_id = :b AND p.barcode = :c"),
                     {"b": business_id, "c": barcode}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return ProductOut(**row)


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(body: ProductCreate, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    product_id = db.scalar(text("""
        INSERT INTO products (business_id, name, sku, category, barcode, unit, cost_price, sale_price, min_qty)
        VALUES (:b, :name, :sku, :category, :barcode, :unit, :cost, :sale, :min) RETURNING id
    """), {"b": business_id, **_clean(body)})
    audit.log(db, business_id, "create", "product", product_id)
    if body.initial_qty > 0:        # mahsulot va birinchi kirim bitta tranzaksiyada: yarim saqlanib qolmaydi
        _insert_movement(db, business_id, product_id, "purchase", body.initial_qty, body.cost_price, None)
    db.commit()
    return _product(db, business_id, product_id)


@router.put("/products/{product_id}", response_model=ProductOut)
def update_product(body: ProductUpdate, product_id: int = Path(ge=1), business_id: int = Depends(_manage),
                   db: Session = Depends(get_db)):
    updated = db.execute(text("""
        UPDATE products
           SET name = :name, sku = :sku, category = :category, barcode = :barcode, unit = :unit,
               cost_price = :cost, sale_price = :sale, min_qty = :min,
               is_active = :active
         WHERE id = :id AND business_id = :b
    """), {"id": product_id, "b": business_id, "active": body.is_active, **_clean(body)}).rowcount
    if not updated:
        raise _NOT_FOUND
    audit.log(db, business_id, "update", "product", product_id,
              {"cost_price": body.cost_price, "sale_price": body.sale_price, "is_active": body.is_active})
    db.commit()
    return _product(db, business_id, product_id)


def _insert_movement(db: Session, business_id: int, product_id: int, kind: str, qty, unit_cost, note) -> None:
    db.execute(text("""
        INSERT INTO stock_movements (business_id, product_id, type, qty, unit_cost, note)
        VALUES (:b, :p, CAST(:t AS stock_move_type), :q, :c, :n)
    """), {"b": business_id, "p": product_id, "t": kind, "q": qty, "c": unit_cost, "n": note})
    audit.log(db, business_id, kind, "product", product_id, {"qty": str(qty)})


@router.post("/products/{product_id}/movements", response_model=ProductOut, status_code=201)
def add_movement(body: MovementIn, product_id: int = Path(ge=1), business_id: int = Depends(_manage),
                 db: Session = Depends(get_db)):
    """Kirim, ishlatish yoki hisobdan chiqarish. Hisobdan chiqarishda sabab majburiy."""
    _product(db, business_id, product_id)
    note = (body.note or "").strip() or None
    if body.type == "write_off" and (note is None or len(note) < 3):
        raise HTTPException(422, detail={"code": "reason_required", "message": "Sababini yozing"})
    _insert_movement(db, business_id, product_id, body.type, _SIGN[body.type] * body.qty, body.unit_cost, note)
    db.commit()
    return _product(db, business_id, product_id)


@router.post("/products/{product_id}/count", response_model=ProductOut, status_code=201)
def count_stock(body: CountIn, product_id: int = Path(ge=1), business_id: int = Depends(_manage),
                db: Session = Depends(get_db)):
    """Sanoq. Qator qulflanadi: shu orada boshqa chiqim bo'lsa, farq eskirgan qoldiqdan hisoblanmaydi."""
    current = db.scalar(text("SELECT current_qty FROM products WHERE id = :id AND business_id = :b FOR UPDATE"),
                        {"id": product_id, "b": business_id})
    if current is None:
        raise _NOT_FOUND
    delta = body.counted - current
    if delta == 0:
        raise HTTPException(409, detail={"code": "no_difference", "message": "Qoldiq farq qilmaydi"})
    _insert_movement(db, business_id, product_id, "adjustment", delta, None, body.note.strip())
    db.commit()
    return _product(db, business_id, product_id)


@router.get("/stock-movements", response_model=list[MovementOut])
def list_movements(product_id: int | None = Query(default=None, ge=1), limit: int = Query(default=50, ge=1, le=100),
                   offset: int = Query(default=0, ge=0), business_id: int = Depends(_view),
                   db: Session = Depends(get_db)):
    rows = db.execute(text(f"""{_MOVEMENT_SELECT}
         WHERE s.business_id = :b AND (CAST(:p AS bigint) IS NULL OR s.product_id = :p)
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT :limit OFFSET :offset
    """), {"b": business_id, "p": product_id, "limit": limit, "offset": offset}).mappings()
    return [MovementOut(**r) for r in rows]
