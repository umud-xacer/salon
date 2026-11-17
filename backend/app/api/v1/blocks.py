"""Kalendarda vaqtni bloklash (tushlik, tozalash, majlis...) va blok turlari (049_time_blocks.sql).

Blok staff_time_off jadvaliga yoziladi, shuning uchun bo'sh vaqtlar va barcha bron yo'llari uni
avtomatik band deb biladi. Kim bloklashi mumkinligini RLS hal qiladi: qabulxona ('appointments.manage'),
'staff.manage' egasi yoki xodimning o'zi (faqat o'ziga).
"""
from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_any_permission, require_permission
from app.schemas.blocks import BlockTypeIn, BlockTypeOut, CalendarBlock, TimeBlockIn
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}", tags=["time-blocks"])

_member = require_any_permission("appointments.view_all", "appointments.view_own", "business.manage")
_settings = require_permission("business.manage")
_blocker = require_any_permission("appointments.manage", "staff.manage", "appointments.view_own")

_TYPE_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Blok turi topilmadi"})

BLOCK_SELECT = """
    SELECT t.id, t.member_id, t.starts_at, t.ends_at, t.is_block, t.block_type_id AS type_id,
           coalesce(bt.name, t.reason) AS title,
           CASE WHEN bt.id IS NOT NULL THEN t.reason END AS note
      FROM staff_time_off t
      LEFT JOIN time_block_types bt ON bt.id = t.block_type_id
"""


# ─── Blok turlari (Sozlamalar) ────────────────────────────────────────────────────────────────
@router.get("/block-types", response_model=list[BlockTypeOut])
def list_block_types(business_id: int = Depends(_member), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id, name, duration_min, sort_order FROM time_block_types "
                           "WHERE business_id = :b ORDER BY sort_order, id"), {"b": business_id}).mappings()
    return [BlockTypeOut(**r) for r in rows]


@router.post("/block-types", response_model=BlockTypeOut, status_code=201)
def add_block_type(body: BlockTypeIn, business_id: int = Depends(_settings), db: Session = Depends(get_db)):
    row = db.execute(text("INSERT INTO time_block_types (business_id, name, duration_min, sort_order) "
                          "VALUES (:b, :n, :d, :o) RETURNING id, name, duration_min, sort_order"),
                     {"b": business_id, "n": body.name, "d": body.duration_min, "o": body.sort_order}).mappings().one()
    db.commit()
    return BlockTypeOut(**row)


@router.put("/block-types/{type_id}", response_model=BlockTypeOut)
def update_block_type(body: BlockTypeIn, type_id: int = Path(ge=1), business_id: int = Depends(_settings),
                      db: Session = Depends(get_db)):
    row = db.execute(text("UPDATE time_block_types SET name = :n, duration_min = :d, sort_order = :o "
                          "WHERE id = :id AND business_id = :b RETURNING id, name, duration_min, sort_order"),
                     {"b": business_id, "id": type_id, "n": body.name, "d": body.duration_min,
                      "o": body.sort_order}).mappings().first()
    if row is None:
        raise _TYPE_NOT_FOUND
    db.commit()
    return BlockTypeOut(**row)


@router.delete("/block-types/{type_id}", status_code=204)
def delete_block_type(type_id: int = Path(ge=1), business_id: int = Depends(_settings), db: Session = Depends(get_db)):
    # Mavjud bloklar qoladi: nomi izohga ko'chiriladi, vaqt band bo'lib turaveradi
    db.execute(text("""
        UPDATE staff_time_off t SET reason = coalesce(t.reason, bt.name)
          FROM time_block_types bt WHERE bt.id = t.block_type_id AND bt.id = :id AND bt.business_id = :b
    """), {"b": business_id, "id": type_id})
    deleted = db.execute(text("DELETE FROM time_block_types WHERE id = :id AND business_id = :b"),
                         {"b": business_id, "id": type_id}).rowcount
    if not deleted:
        raise _TYPE_NOT_FOUND
    db.commit()


# ─── Bloklar ──────────────────────────────────────────────────────────────────────────────────
@router.post("/time-blocks", response_model=CalendarBlock, status_code=201)
def add_block(body: TimeBlockIn, business_id: int = Depends(_blocker), db: Session = Depends(get_db)):
    type_name = None
    if body.type_id is not None:
        type_name = db.scalar(text("SELECT name FROM time_block_types WHERE id = :t AND business_id = :b"),
                              {"t": body.type_id, "b": business_id})
        if type_name is None:
            raise _TYPE_NOT_FOUND
    if type_name is None and body.note is None:
        raise HTTPException(422, detail={"code": "title_required", "message": "Blok turini tanlang yoki izoh yozing"})

    # Faol bron ustiga blok qo'yilmaydi — avval bronni ko'chirish yoki bekor qilish kerak.
    # RLS: usta faqat o'z bronlarini ko'radi, lekin bloklashi ham faqat o'ziga mumkin — tekshiruv to'liq.
    clash = db.scalar(text("""
        SELECT EXISTS (SELECT 1 FROM appointments a
                        WHERE a.member_id = :m AND a.business_id = :b
                          AND a.status IN ('pending', 'confirmed', 'in_progress')
                          AND a.busy && tstzmultirange(tstzrange(:s, :e)))   -- kutish oynasiga blok qo'yish mumkin
    """), {"m": body.member_id, "b": business_id, "s": body.starts_at, "e": body.ends_at})
    if clash:
        raise HTTPException(409, detail={"code": "time_conflict",
                                         "message": "Bu vaqtda bron bor. Avval bronni ko'chiring yoki bekor qiling"})

    block_id = db.scalar(text("""
        INSERT INTO staff_time_off (business_id, member_id, starts_at, ends_at, reason, block_type_id, is_block, created_by)
        VALUES (:b, :m, :s, :e, :r, :t, TRUE, app.uid()) RETURNING id
    """), {"b": business_id, "m": body.member_id, "s": body.starts_at, "e": body.ends_at, "r": body.note,
           "t": body.type_id})
    audit.log(db, business_id, "create", "time_block", block_id, body.model_dump(mode="json"))
    db.commit()
    row = db.execute(text(f"{BLOCK_SELECT} WHERE t.id = :id"), {"id": block_id}).mappings().one()
    return CalendarBlock(**row)


@router.delete("/time-blocks/{block_id}", status_code=204)
def delete_block(block_id: int = Path(ge=1), business_id: int = Depends(_blocker), db: Session = Depends(get_db)):
    deleted = db.execute(text("DELETE FROM staff_time_off WHERE id = :id AND business_id = :b AND is_block"),
                         {"id": block_id, "b": business_id}).rowcount
    if not deleted:
        raise HTTPException(404, detail={"code": "not_found", "message": "Blok topilmadi"})
    audit.log(db, business_id, "delete", "time_block", block_id)
    db.commit()
