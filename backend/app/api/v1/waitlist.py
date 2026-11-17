"""Kutish ro'yxati (052_waitlist.sql).

Qabulxona: /businesses/{id}/waitlist — ro'yxat, qo'shish, taklif qilingan vaqtga bron, bekor qilish.
Mijoz: /waitlist — o'zi yoziladi (ilova / chronix.uz), o'z yozuvlari, bekor qilish.
Mos bo'sh vaqtni app.waitlist_scan topadi: worker har daqiqada, bron bekor qilinganda va yozuv
qo'shilganda darhol.
"""
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.schemas.waitlist import WaitlistBook, WaitlistCreate, WaitlistJoin, WaitlistOut, WaitlistSummary
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}/waitlist", tags=["waitlist"])
my_router = APIRouter(prefix="/waitlist", tags=["waitlist"])

_manage = require_permission("appointments.manage")
_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Kutish ro'yxatida topilmadi"})

ACTIVE = ("waiting", "offered")

_SELECT = """
    SELECT w.id, w.business_id, b.name AS business_name, w.client_id, c.full_name AS client_name, c.phone AS client_phone,
           c.user_id IS NOT NULL AS has_account, w.service_id, s.name AS service_name,
           w.member_id, pm.full_name AS member_name, w.date_from, w.date_to, w.time_from, w.time_to, w.note,
           w.status, w.source, w.offered_member_id, po.full_name AS offered_member_name, w.offered_starts_at,
           w.offered_at, w.appointment_id, w.created_at,
           CASE WHEN w.status IN ('waiting', 'offered') THEN
               (SELECT count(*) FROM waitlist_entries x
                 WHERE x.business_id = w.business_id AND x.status IN ('waiting', 'offered')
                   AND (x.created_at, x.id) <= (w.created_at, w.id))::int END AS position
      FROM waitlist_entries w
      JOIN businesses b            ON b.id = w.business_id
      LEFT JOIN business_clients c ON c.id = w.client_id
      LEFT JOIN services s         ON s.id = w.service_id
      LEFT JOIN public_staff pm    ON pm.member_id = w.member_id
      LEFT JOIN public_staff po    ON po.member_id = w.offered_member_id
"""


def _get(db: Session, entry_id: int) -> WaitlistOut:
    row = db.execute(text(f"{_SELECT} WHERE w.id = :id"), {"id": entry_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return WaitlistOut(**row)


def scan(db: Session, business_id: int) -> int:
    """Shu muassasa navbatini darhol tekshirish (bron bekor qilinganda ham chaqiriladi)."""
    return db.scalar(text("SELECT app.waitlist_scan(:b)"), {"b": business_id}) or 0


# ─── Qabulxona ─────────────────────────────────────────────────────────────────────────────────
@router.get("", response_model=list[WaitlistOut])
def list_entries(state: str = Query(default="active", pattern="^(active|done|all)$"),
                 business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    where = {"active": "w.status IN ('waiting', 'offered')",
             "done": "w.status IN ('booked', 'expired', 'cancelled')", "all": "TRUE"}[state]
    order = "w.created_at, w.id" if state == "active" else "w.updated_at DESC, w.id DESC"
    rows = db.execute(text(f"{_SELECT} WHERE w.business_id = :b AND {where} ORDER BY {order} LIMIT 200"),
                      {"b": business_id}).mappings()
    return [WaitlistOut(**r) for r in rows]


@router.get("/summary", response_model=WaitlistSummary)
def summary(business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT count(*) FILTER (WHERE status = 'waiting') AS waiting, count(*) FILTER (WHERE status = 'offered') AS offered
          FROM waitlist_entries WHERE business_id = :b
    """), {"b": business_id}).mappings().one()
    return WaitlistSummary(**row)


@router.post("", response_model=WaitlistOut, status_code=201)
def add_entry(body: WaitlistCreate, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    ok = db.scalar(text("""
        SELECT EXISTS (SELECT 1 FROM services s WHERE s.id = :s AND s.business_id = :b AND s.is_active)
           AND (CAST(:m AS BIGINT) IS NULL OR EXISTS (
                SELECT 1 FROM member_services ms WHERE ms.member_id = :m AND ms.service_id = :s AND ms.business_id = :b))
    """), {"b": business_id, "s": body.service_id, "m": body.member_id})
    if not ok:
        raise HTTPException(404, detail={"code": "not_found", "message": "Xizmat yoki usta topilmadi"})
    # Mavjud mijozning ismi o'zgarmaydi (qabulxona bron qilgandagi qoida bilan bir xil)
    client_id = db.scalar(text("""
        INSERT INTO business_clients (business_id, full_name, phone) VALUES (:b, :n, :p)
        ON CONFLICT (business_id, phone) DO UPDATE SET full_name = business_clients.full_name
        RETURNING id
    """), {"b": business_id, "n": body.client_name, "p": body.client_phone})
    entry_id = db.scalar(text("""
        INSERT INTO waitlist_entries (business_id, client_id, service_id, member_id, date_from, date_to, time_from, time_to,
                                      note, source, created_by)
        VALUES (:b, :c, :s, :m, :df, :dt, :tf, :tt, :note, 'admin', app.uid()) RETURNING id
    """), {"b": business_id, "c": client_id, "s": body.service_id, "m": body.member_id, "df": body.date_from,
           "dt": body.date_to, "tf": body.time_from, "tt": body.time_to, "note": body.note})
    audit.log(db, business_id, "create", "waitlist", entry_id)
    scan(db, business_id)                        # bo'sh vaqt allaqachon bo'lsa — darhol taklif
    db.commit()
    return _get(db, entry_id)


@router.post("/scan", response_model=WaitlistSummary)
def scan_now(business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    scan(db, business_id)
    db.commit()
    return summary(business_id, db)


@router.post("/{entry_id}/book", response_model=WaitlistOut)
def book_entry(body: WaitlistBook, entry_id: int = Path(ge=1), business_id: int = Depends(_manage),
               db: Session = Depends(get_db)):
    current = _get(db, entry_id)
    if current.business_id != business_id:
        raise _NOT_FOUND
    if body.starts_at is None and current.offered_starts_at is None:
        raise HTTPException(422, detail={"code": "time_required", "message": "Bo'sh vaqt hali topilmagan — vaqtni tanlang"})
    db.execute(text("SELECT app.book_from_waitlist(:b, :id, :m, :t)"),
               {"b": business_id, "id": entry_id, "m": body.member_id, "t": body.starts_at})
    scan(db, business_id)                        # shu vaqtni kutgan boshqa yozuvlar qayta taqsimlansin
    db.commit()
    return _get(db, entry_id)


@router.post("/{entry_id}/cancel", response_model=WaitlistOut)
def cancel_entry(entry_id: int = Path(ge=1), business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    updated = db.execute(text("UPDATE waitlist_entries SET status = 'cancelled' "
                              "WHERE id = :id AND business_id = :b AND status IN ('waiting', 'offered')"),
                         {"id": entry_id, "b": business_id}).rowcount
    if not updated:
        raise _NOT_FOUND
    audit.log(db, business_id, "cancel", "waitlist", entry_id)
    scan(db, business_id)                        # bo'shagan taklif keyingi navbatga o'tsin
    db.commit()
    return _get(db, entry_id)


# ─── Mijoz ─────────────────────────────────────────────────────────────────────────────────────
@my_router.post("", response_model=WaitlistOut, status_code=201)
def join(body: WaitlistJoin, db: Session = Depends(get_db)):
    entry_id = db.scalar(text("SELECT app.join_waitlist(:b, :s, :m, :df, :dt, :tf, :tt, :note)"), {
        "b": body.business_id, "s": body.service_id, "m": body.member_id, "df": body.date_from, "dt": body.date_to,
        "tf": body.time_from, "tt": body.time_to, "note": body.note})
    scan(db, body.business_id)
    db.commit()
    return _get(db, entry_id)


@my_router.get("/mine", response_model=list[WaitlistOut])
def my_entries(db: Session = Depends(get_db)):
    rows = db.execute(text(f"{_SELECT} WHERE w.client_id = ANY (app.my_client_ids()) "
                           "ORDER BY (w.status IN ('waiting', 'offered')) DESC, w.created_at DESC LIMIT 50")).mappings()
    return [WaitlistOut(**r) for r in rows]


@my_router.post("/{entry_id}/cancel", response_model=WaitlistOut)
def cancel_mine(entry_id: int = Path(ge=1), db: Session = Depends(get_db)):
    db.execute(text("SELECT app.cancel_my_waitlist(:id)"), {"id": entry_id})
    db.commit()
    return _get(db, entry_id)
