"""Mijozlar bazasi. Tashriflar soni va summa bronlardan hisoblanadi, shuning uchun doim to'g'ri.
Mijoz o'chirilmaydi: bron va to'lov tarixi unga bog'langan."""
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.api.v1.appointments import _SELECT
from app.schemas.appointments import AppointmentOut
from app.schemas.clients import ClientCreate, ClientOut, ClientUpdate
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}/clients", tags=["clients"])

_clients = require_permission("clients.view")

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Mijoz topilmadi"})

_CLIENT_SELECT = """
    SELECT c.id, c.full_name, c.phone, c.notes, c.user_id IS NOT NULL AS has_account, c.created_at,
           count(a.id) FILTER (WHERE a.status = 'completed')::int AS visits,
           coalesce(sum(a.total_price - a.discount) FILTER (WHERE a.status = 'completed'), 0)::bigint AS total_spent,
           max(a.starts_at) FILTER (WHERE a.status = 'completed') AS last_visit
      FROM business_clients c
      LEFT JOIN appointments a ON a.client_id = c.id
"""


def _read(db: Session, business_id: int, client_id: int) -> ClientOut:
    row = db.execute(text(f"{_CLIENT_SELECT} WHERE c.id = :id AND c.business_id = :b GROUP BY c.id"),
                     {"id": client_id, "b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return ClientOut(**row)


@router.get("", response_model=list[ClientOut])
def list_clients(q: str = Query(default="", max_length=60), limit: int = Query(default=50, ge=1, le=100),
                 offset: int = Query(default=0, ge=0), business_id: int = Depends(_clients),
                 db: Session = Depends(get_db)):
    """Telefon yoki ism bo'yicha qidirish. % va _ oddiy belgi sifatida ishlanadi."""
    pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"
    rows = db.execute(text(_CLIENT_SELECT + r"""
         WHERE c.business_id = :b AND (c.phone LIKE :p ESCAPE '\' OR c.full_name ILIKE :p ESCAPE '\')
         GROUP BY c.id
         ORDER BY c.full_name, c.id
         LIMIT :limit OFFSET :offset
    """), {"b": business_id, "p": pattern, "limit": limit, "offset": offset}).mappings()
    return [ClientOut(**r) for r in rows]


@router.post("", response_model=ClientOut, status_code=201)
def create_client(body: ClientCreate, business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    client_id = db.scalar(text("""
        INSERT INTO business_clients (business_id, full_name, phone, notes)
        VALUES (:b, :n, :p, :notes) RETURNING id
    """), {"b": business_id, "n": body.full_name.strip(), "p": body.phone, "notes": body.notes})
    audit.log(db, business_id, "create", "client", client_id)
    db.commit()
    return _read(db, business_id, client_id)


@router.patch("/{client_id}", response_model=ClientOut)
def update_client(body: ClientUpdate, client_id: int = Path(ge=1), business_id: int = Depends(_clients),
                  db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(422, detail={"code": "empty", "message": "O'zgartirish yo'q"})
    if data.get("full_name") is None:
        data.pop("full_name", None)
    if data.get("phone") is None:
        data.pop("phone", None)

    has_account = db.scalar(text("SELECT user_id IS NOT NULL FROM business_clients WHERE id = :id AND business_id = :b"),
                            {"id": client_id, "b": business_id})
    if has_account is None:
        raise _NOT_FOUND
    # Telefon bilan mijoz hisobi tasdiqlangan: uni salon almashtirsa, begona odam bronlarni ko'rib qoladi
    if has_account and "phone" in data:
        raise HTTPException(409, detail={"code": "phone_locked",
                                         "message": "Mobil ilovadagi mijoz telefonini salon o'zgartira olmaydi"})
    if data:
        sets = ", ".join(f"{col} = :{col}" for col in data)
        db.execute(text(f"UPDATE business_clients SET {sets} WHERE id = :id AND business_id = :b"),
                   {**data, "id": client_id, "b": business_id})
        audit.log(db, business_id, "update", "client", client_id, sorted(data))
    db.commit()
    return _read(db, business_id, client_id)


@router.get("/{client_id}/appointments", response_model=list[AppointmentOut])
def client_history(client_id: int = Path(ge=1), business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    """Oxirgi 50 ta bron."""
    _read(db, business_id, client_id)
    rows = db.execute(text(f"{_SELECT} WHERE a.client_id = :c AND a.business_id = :b ORDER BY a.starts_at DESC LIMIT 50"),
                      {"c": client_id, "b": business_id}).mappings()
    return [AppointmentOut(**r) for r in rows]
