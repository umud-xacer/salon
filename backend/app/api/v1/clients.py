"""Mijozlar bazasi. Tashriflar soni va summa bronlardan hisoblanadi, shuning uchun doim to'g'ri.
Mijoz o'chirilmaydi: bron va to'lov tarixi unga bog'langan.

Salonning ichki ma'lumoti (teglar, ogohlantirish, allergiya, eslatmalar) alohida jadvallarda —
mijozning o'zi ularni ko'rmaydi (050_client_card.sql)."""
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.api.v1.appointments import _SELECT
from app.schemas.appointments import AppointmentOut
from app.schemas.clients import ClientCreate, ClientNoteIn, ClientNoteOut, ClientOut, ClientUpdate, TagCount
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}/clients", tags=["clients"])

_clients = require_permission("clients.view")

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Mijoz topilmadi"})

_BASE_FIELDS = ("full_name", "phone", "notes", "birth_date", "gender", "source")
_INTERNAL_FIELDS = ("tags", "alert", "allergies")

_CLIENT_SELECT = """
    SELECT c.id, c.full_name, c.phone, c.notes, c.user_id IS NOT NULL AS has_account, c.created_at,
           c.birth_date, c.gender, c.source,
           coalesce(ci.tags, '{}') AS tags, ci.alert, ci.allergies,
           (SELECT count(*) FROM client_notes n WHERE n.client_id = c.id)::int AS notes_count,
           count(a.id) FILTER (WHERE a.status = 'completed')::int AS visits,
           coalesce(sum(a.total_price - a.discount) FILTER (WHERE a.status = 'completed'), 0)::bigint AS total_spent,
           max(a.starts_at) FILTER (WHERE a.status = 'completed') AS last_visit
      FROM business_clients c
      LEFT JOIN client_internal ci ON ci.client_id = c.id
      LEFT JOIN appointments a ON a.client_id = c.id
"""
_GROUP = " GROUP BY c.id, ci.client_id"


def _read(db: Session, business_id: int, client_id: int) -> ClientOut:
    row = db.execute(text(f"{_CLIENT_SELECT} WHERE c.id = :id AND c.business_id = :b {_GROUP}"),
                     {"id": client_id, "b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return ClientOut(**row)


def _save_internal(db: Session, business_id: int, client_id: int, data: dict) -> None:
    """Teglar, ogohlantirish, allergiya: faqat yuborilgan maydonlar yangilanadi."""
    if not data:
        return
    cols = ", ".join(data)
    params = ", ".join(f":{k}" for k in data)
    updates = ", ".join(f"{k} = EXCLUDED.{k}" for k in data)
    db.execute(text(f"""
        INSERT INTO client_internal (business_id, client_id, {cols}) VALUES (:b, :c, {params})
        ON CONFLICT (client_id) DO UPDATE SET {updates}
    """), {"b": business_id, "c": client_id, **{k: (v if k != "tags" else (v or [])) for k, v in data.items()}})


@router.get("", response_model=list[ClientOut])
def list_clients(q: str = Query(default="", max_length=60), tag: str | None = Query(default=None, max_length=30),
                 limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
                 business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    """Telefon yoki ism bo'yicha qidirish (+ teg bo'yicha filtr). % va _ oddiy belgi sifatida ishlanadi."""
    pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"
    rows = db.execute(text(_CLIENT_SELECT + r"""
         WHERE c.business_id = :b AND (c.phone LIKE :p ESCAPE '\' OR c.full_name ILIKE :p ESCAPE '\')
           AND (CAST(:tag AS text) IS NULL
                OR EXISTS (SELECT 1 FROM unnest(ci.tags) x WHERE lower(x) = lower(CAST(:tag AS text))))
    """ + _GROUP + """
         ORDER BY c.full_name, c.id
         LIMIT :limit OFFSET :offset
    """), {"b": business_id, "p": pattern, "tag": tag, "limit": limit, "offset": offset}).mappings()
    return [ClientOut(**r) for r in rows]


@router.get("/tags", response_model=list[TagCount])
def list_tags(business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    """Muassasada ishlatilgan teglar (filtr va kiritishda tavsiya uchun)."""
    rows = db.execute(text("""
        SELECT min(x) AS tag, count(*)::int AS count
          FROM client_internal ci, unnest(ci.tags) x
         WHERE ci.business_id = :b
         GROUP BY lower(x) ORDER BY count DESC, tag LIMIT 100
    """), {"b": business_id}).mappings()
    return [TagCount(**r) for r in rows]


@router.post("", response_model=ClientOut, status_code=201)
def create_client(body: ClientCreate, business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    client_id = db.scalar(text("""
        INSERT INTO business_clients (business_id, full_name, phone, birth_date, gender, source)
        VALUES (:b, :n, :p, :bd, :g, :s) RETURNING id
    """), {"b": business_id, "n": body.full_name.strip(), "p": body.phone, "bd": body.birth_date,
           "g": body.gender, "s": body.source})
    _save_internal(db, business_id, client_id,
                   {k: v for k, v in body.model_dump(include=set(_INTERNAL_FIELDS)).items() if v not in (None, [])})
    if body.notes and body.notes.strip():
        db.execute(text("INSERT INTO client_notes (business_id, client_id, body) VALUES (:b, :c, :t)"),
                   {"b": business_id, "c": client_id, "t": body.notes.strip()})
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
    base = {k: v for k, v in data.items() if k in _BASE_FIELDS}
    if base:
        sets = ", ".join(f"{col} = :{col}" for col in base)
        db.execute(text(f"UPDATE business_clients SET {sets} WHERE id = :id AND business_id = :b"),
                   {**base, "id": client_id, "b": business_id})
    _save_internal(db, business_id, client_id, {k: v for k, v in data.items() if k in _INTERNAL_FIELDS})
    if data:
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


# ─── Eslatmalar ────────────────────────────────────────────────────────────────────────────────
_NOTE_SELECT = """
    SELECT n.id, n.body, u.full_name AS author, n.created_at,
           (n.created_by = app.uid() OR app.has_perm(n.business_id, 'business.manage')) AS can_delete
      FROM client_notes n LEFT JOIN users u ON u.id = n.created_by
"""


@router.get("/{client_id}/notes", response_model=list[ClientNoteOut])
def list_notes(client_id: int = Path(ge=1), business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    _read(db, business_id, client_id)
    rows = db.execute(text(f"{_NOTE_SELECT} WHERE n.client_id = :c AND n.business_id = :b "
                           "ORDER BY n.created_at DESC, n.id DESC LIMIT 200"),
                      {"c": client_id, "b": business_id}).mappings()
    return [ClientNoteOut(**r) for r in rows]


@router.post("/{client_id}/notes", response_model=ClientNoteOut, status_code=201)
def add_note(body: ClientNoteIn, client_id: int = Path(ge=1), business_id: int = Depends(_clients),
             db: Session = Depends(get_db)):
    _read(db, business_id, client_id)
    note_id = db.scalar(text("INSERT INTO client_notes (business_id, client_id, body) VALUES (:b, :c, :t) RETURNING id"),
                        {"b": business_id, "c": client_id, "t": body.body.strip()})
    db.commit()
    return ClientNoteOut(**db.execute(text(f"{_NOTE_SELECT} WHERE n.id = :id"), {"id": note_id}).mappings().one())


@router.delete("/{client_id}/notes/{note_id}", status_code=204)
def delete_note(note_id: int = Path(ge=1), client_id: int = Path(ge=1), business_id: int = Depends(_clients),
                db: Session = Depends(get_db)):
    deleted = db.execute(text("DELETE FROM client_notes WHERE id = :id AND client_id = :c AND business_id = :b"),
                         {"id": note_id, "c": client_id, "b": business_id}).rowcount
    if not deleted:          # yo'q yoki boshqa xodimniki (RLS: o'chirish faqat muallif yoki direktor)
        raise HTTPException(404, detail={"code": "not_found", "message": "Eslatma topilmadi"})
    audit.log(db, business_id, "delete", "client_note", note_id)
    db.commit()
