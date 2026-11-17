"""Anketalar va mijoz/bemor kartalari (058_forms.sql).

Shablonlar (konstruktor) — direktor; to'ldirish, imzo, fayllar va tashriflar tarixi — mijozlar bazasi huquqi.
Tibbiy fayllar ochiq /media ga emas, bazaga yoziladi va shu yerdan token bilan beriladi.
"""
import datetime as dt
import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_any_permission, require_permission
from app.services import audit, media

router = APIRouter(prefix="/businesses/{business_id}", tags=["forms"])
_manage = require_permission("business.manage")
_clients = require_permission("clients.view")
_read_templates = require_any_permission("clients.view", "business.manage")

FieldType = Literal["text", "textarea", "radio", "checkbox", "boolean", "date", "number", "file"]
_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Topilmadi"})


class FieldIn(BaseModel):
    label: str = Field(min_length=2, max_length=300)
    help: str | None = Field(default=None, max_length=300)
    type: FieldType
    options: list[str] = Field(default_factory=list, max_length=30)
    required: bool = False
    alert_values: list[str] = Field(default_factory=list, max_length=30)
    alert_label: str | None = Field(default=None, max_length=80)

    @field_validator("options", "alert_values")
    @classmethod
    def _clean(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for x in v:
            x = " ".join(x.split())
            if x and x not in out:
                out.append(x[:100])
        return out

    @model_validator(mode="after")
    def _check(self):
        if self.type in ("radio", "checkbox") and not self.options:
            raise ValueError("Tanlov maydoniga kamida bitta variant kiriting")
        if self.type not in ("radio", "checkbox"):
            self.options = []
        if self.type == "boolean":
            self.alert_values = [v for v in self.alert_values if v in ("true", "false")]
        elif self.type in ("radio", "checkbox"):
            self.alert_values = [v for v in self.alert_values if v in self.options]
        else:
            self.alert_values = []
        if self.alert_values and not (self.alert_label and self.alert_label.strip()):
            self.alert_label = self.label[:80]
        if not self.alert_values:
            self.alert_label = None
        return self


class TemplateIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool = True
    require_signature: bool = False
    fields: list[FieldIn] = Field(min_length=1, max_length=80)


class FieldOut(FieldIn):
    id: int


class TemplateOut(BaseModel):
    id: int
    title: str
    description: str | None
    is_active: bool
    require_signature: bool
    fields: list[FieldOut]
    submissions: int = 0


# Tayyor shablonlar: muassasa bir bosishda o'ziga nusxa oladi va keyin tahrirlaydi
def _yn(label: str, alert: str | None = None, required: bool = True) -> dict:
    return {"label": label, "type": "boolean", "required": required,
            "alert_values": ["true"] if alert else [], "alert_label": alert}


PRESETS: dict[str, dict] = {
    "dental": {"title": "Stomatologiya bemor kartasi", "require_signature": True,
               "description": "Birinchi tashrifda to'ldiriladi. Davolashdan oldin shifokor ko'rib chiqadi.", "fields": [
        {"label": "Shikoyatingiz (nima bezovta qilyapti?)", "type": "textarea", "required": True},
        _yn("Dori-darmonlarga allergiyangiz bormi?", "Dori allergiyasi"),
        {"label": "Qaysi dorilarga allergiya?", "type": "text"},
        _yn("Og'riqsizlantirish (anesteziya) dan keyin noxush holat bo'lganmi?", "Anesteziyaga reaksiya"),
        _yn("Qandli diabet bormi?", "Qandli diabet"),
        _yn("Yurak-qon tomir kasalligi yoki qon bosimi muammosi bormi?", "Yurak / qon bosimi"),
        _yn("Qon ivishi buzilgan yoki qon suyultiruvchi dori ichasizmi?", "Qon ivishi"),
        _yn("Homiladorlik bormi?", "Homiladorlik", required=False),
        {"label": "Doimiy ichadigan dorilar", "type": "textarea"},
        {"label": "Rentgen yoki oldingi tahlil natijalari", "type": "file"},
    ]},
    "cosmetology": {"title": "Kosmetologik protsedura oldi anketasi", "require_signature": True,
                    "description": "Protseduradan oldin mijoz to'ldiradi va roziligini imzolaydi.", "fields": [
        {"label": "Teri turi", "type": "radio", "required": True, "options": ["Quruq", "Yog'li", "Aralash", "Normal", "Sezgir"]},
        _yn("Kosmetika yoki dori-darmonlarga allergiyangiz bormi?", "Allergiya"),
        {"label": "Allergiya nimaga?", "type": "text"},
        _yn("Homiladorlik yoki emizish davri?", "Homiladorlik / emizish"),
        _yn("Oxirgi 2 haftada quyoshda qoraygansizmi yoki solyariy?", "Yaqinda qoraygan"),
        {"label": "Teri kasalliklari", "type": "checkbox",
         "options": ["Ekzema", "Psoriaz", "Herpes (uchuq)", "Akne", "Yo'q"], "alert_values": ["Ekzema", "Psoriaz", "Herpes (uchuq)"],
         "alert_label": "Teri kasalligi"},
        {"label": "\"Oldin\" surati", "type": "file"},
    ]},
    "spa": {"title": "SPA salomatlik so'rovnomasi", "require_signature": False,
            "description": "Massaj va SPA muolajalaridan oldin.", "fields": [
        _yn("Qon bosimi muammosi bormi?", "Qon bosimi"),
        _yn("Yurak kasalligi bormi?", "Yurak kasalligi"),
        _yn("Varikoz bormi?", "Varikoz"),
        _yn("Homiladorlik bormi?", "Homiladorlik", required=False),
        {"label": "Jarohat yoki operatsiyalar (oxirgi 6 oy)", "type": "textarea"},
        {"label": "Massaj bosimi", "type": "radio", "options": ["Yengil", "O'rtacha", "Kuchli"]},
    ]},
}


def _templates(db: Session, business_id: int, template_id: int | None = None) -> list[TemplateOut]:
    rows = db.execute(text("""
        SELECT t.id, t.title, t.description, t.is_active, t.require_signature,
               (SELECT count(*) FROM client_form_submissions s WHERE s.template_id = t.id)::int AS submissions,
               coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label, 'help', f.help, 'type', f.type,
                                                             'options', f.options, 'required', f.required,
                                                             'alert_values', f.alert_values, 'alert_label', f.alert_label)
                                          ORDER BY f.sort_order, f.id)
                           FROM form_fields f WHERE f.template_id = t.id), '[]') AS fields
          FROM form_templates t
         WHERE t.business_id = :b AND (CAST(:t AS bigint) IS NULL OR t.id = :t)
         ORDER BY t.sort_order, t.id
    """), {"b": business_id, "t": template_id}).mappings()
    return [TemplateOut(**r) for r in rows]


def _write_fields(db: Session, business_id: int, template_id: int, fields: list[FieldIn]) -> None:
    db.execute(text("DELETE FROM form_fields WHERE template_id = :t"), {"t": template_id})
    for i, f in enumerate(fields):
        db.execute(text("""
            INSERT INTO form_fields (business_id, template_id, sort_order, label, help, type, options, required,
                                     alert_values, alert_label)
            VALUES (:b, :t, :i, :label, :help, :type, :options, :required, :alert_values, :alert_label)
        """), {"b": business_id, "t": template_id, "i": i, **f.model_dump()})


@router.get("/forms", response_model=list[TemplateOut])
def list_templates(business_id: int = Depends(_read_templates), db: Session = Depends(get_db)):
    return _templates(db, business_id)


@router.get("/forms/presets", response_model=list[dict])
def presets(business_id: int = Depends(_manage)):
    return [{"key": k, "title": v["title"], "fields": len(v["fields"])} for k, v in PRESETS.items()]


@router.post("/forms", response_model=TemplateOut, status_code=201)
def create_template(body: TemplateIn, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    tid = db.scalar(text("""
        INSERT INTO form_templates (business_id, title, description, is_active, require_signature, sort_order)
        VALUES (:b, :title, :description, :is_active, :require_signature,
                (SELECT coalesce(max(sort_order), 0) + 1 FROM form_templates WHERE business_id = :b))
        RETURNING id
    """), {"b": business_id, **body.model_dump(exclude={"fields"})})
    _write_fields(db, business_id, tid, body.fields)
    audit.log(db, business_id, "create", "form_template", tid)
    db.commit()
    return _templates(db, business_id, tid)[0]


@router.post("/forms/from-preset", response_model=TemplateOut, status_code=201)
def from_preset(preset: Literal["dental", "cosmetology", "spa"] = Query(), business_id: int = Depends(_manage),
                db: Session = Depends(get_db)):
    return create_template(TemplateIn(**PRESETS[preset]), business_id, db)


@router.put("/forms/{template_id}", response_model=TemplateOut)
def update_template(body: TemplateIn, template_id: int = Path(ge=1), business_id: int = Depends(_manage),
                    db: Session = Depends(get_db)):
    """Maydonlar butunlay almashtiriladi. Eski anketalar buzilmaydi: ularda maydonlar surati saqlangan."""
    n = db.execute(text("""
        UPDATE form_templates SET title = :title, description = :description, is_active = :is_active,
               require_signature = :require_signature, updated_at = now()
         WHERE id = :id AND business_id = :b
    """), {"id": template_id, "b": business_id, **body.model_dump(exclude={"fields"})}).rowcount
    if not n:
        raise _NOT_FOUND
    _write_fields(db, business_id, template_id, body.fields)
    audit.log(db, business_id, "update", "form_template", template_id)
    db.commit()
    return _templates(db, business_id, template_id)[0]


@router.delete("/forms/{template_id}", status_code=204)
def delete_template(template_id: int = Path(ge=1), business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    """To'ldirilgan anketalar o'chmaydi (shablon havolasi bo'shaydi). To'ldirilgan bo'lsa — faqat o'chirib qo'yish tavsiya."""
    n = db.execute(text("DELETE FROM form_templates WHERE id = :id AND business_id = :b"),
                   {"id": template_id, "b": business_id}).rowcount
    if not n:
        raise _NOT_FOUND
    audit.log(db, business_id, "delete", "form_template", template_id)
    db.commit()


# ─── To'ldirish ────────────────────────────────────────────────────────────────────────────────
class SubmissionIn(BaseModel):
    template_id: int = Field(ge=1)
    answers: dict[str, Any] = Field(default_factory=dict)
    appointment_id: int | None = Field(default=None, ge=1)


class SubmissionOut(BaseModel):
    id: int
    template_id: int | None
    title: str
    fields: list[dict]
    answers: dict
    alerts: list[str]
    appointment_id: int | None
    signature_file: int | None
    signed_at: dt.datetime | None
    filled_by_name: str | None
    created_at: dt.datetime


_SUB_SELECT = """
    SELECT s.id, s.template_id, s.title, s.fields, s.answers, s.alerts, s.appointment_id, s.signature_file, s.signed_at,
           u.full_name AS filled_by_name, s.created_at
      FROM client_form_submissions s LEFT JOIN users u ON u.id = s.filled_by
"""


def _client_or_404(db: Session, business_id: int, client_id: int) -> None:
    if not db.scalar(text("SELECT 1 FROM business_clients WHERE id = :c AND business_id = :b"), {"c": client_id, "b": business_id}):
        raise _NOT_FOUND


def _bad(msg: str) -> HTTPException:
    return HTTPException(422, detail={"code": "invalid_answer", "message": msg})


def _validate(db: Session, business_id: int, client_id: int, fields: list[FieldOut], answers: dict) -> dict:
    out: dict[str, Any] = {}
    for f in fields:
        v = answers.get(str(f.id))
        empty = v is None or v == "" or v == []
        if empty:
            if f.required:
                raise _bad(f"Majburiy savol: {f.label}")
            continue
        if f.type in ("text", "textarea"):
            if not isinstance(v, str) or len(v) > (500 if f.type == "text" else 5000):
                raise _bad(f"Matn noto'g'ri: {f.label}")
            v = v.strip()
        elif f.type == "boolean":
            if not isinstance(v, bool):
                raise _bad(f"Ha yoki Yo'q: {f.label}")
            v = "true" if v else "false"
        elif f.type == "radio":
            if v not in f.options:
                raise _bad(f"Variantlardan birini tanlang: {f.label}")
        elif f.type == "checkbox":
            if not isinstance(v, list) or any(x not in f.options for x in v):
                raise _bad(f"Variantlar noto'g'ri: {f.label}")
        elif f.type == "number":
            if isinstance(v, bool) or not isinstance(v, (int, float)) or abs(v) > 1e9:
                raise _bad(f"Raqam kiriting: {f.label}")
        elif f.type == "date":
            try:
                v = dt.date.fromisoformat(str(v)).isoformat()
            except ValueError:
                raise _bad(f"Sana noto'g'ri: {f.label}")
        elif f.type == "file":
            ids = v if isinstance(v, list) else [v]
            if not all(isinstance(x, int) for x in ids) or len(ids) > 10:
                raise _bad(f"Fayl noto'g'ri: {f.label}")
            found = db.scalar(text("SELECT count(*) FROM client_files WHERE client_id = :c AND business_id = :b "
                                   "AND id = ANY(:ids) AND kind = 'photo'"), {"c": client_id, "b": business_id, "ids": ids})
            if found != len(set(ids)):
                raise _bad(f"Fayl topilmadi: {f.label}")
            v = ids
        out[str(f.id)] = v
    return out


@router.get("/clients/{client_id}/forms", response_model=list[SubmissionOut])
def list_submissions(client_id: int = Path(ge=1), business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    rows = db.execute(text(f"{_SUB_SELECT} WHERE s.client_id = :c AND s.business_id = :b ORDER BY s.created_at DESC LIMIT 100"),
                      {"c": client_id, "b": business_id}).mappings()
    return [SubmissionOut(**r) for r in rows]


@router.post("/clients/{client_id}/forms", response_model=SubmissionOut, status_code=201)
def submit(body: SubmissionIn, client_id: int = Path(ge=1), business_id: int = Depends(_clients),
           db: Session = Depends(get_db)):
    _client_or_404(db, business_id, client_id)
    tpl = _templates(db, business_id, body.template_id)
    if not tpl or not tpl[0].is_active:
        raise HTTPException(404, detail={"code": "not_found", "message": "Anketa topilmadi"})
    t = tpl[0]
    if body.appointment_id and not db.scalar(text("SELECT 1 FROM appointments WHERE id = :a AND client_id = :c"),
                                              {"a": body.appointment_id, "c": client_id}):
        raise _NOT_FOUND
    answers = _validate(db, business_id, client_id, t.fields, body.answers)
    snapshot = [f.model_dump() for f in t.fields]
    sid = db.scalar(text("""
        INSERT INTO client_form_submissions (business_id, client_id, template_id, title, fields, answers, appointment_id)
        VALUES (:b, :c, :t, :title, CAST(:fields AS jsonb), CAST(:answers AS jsonb), :a) RETURNING id
    """), {"b": business_id, "c": client_id, "t": t.id, "title": t.title, "fields": json.dumps(snapshot),
           "answers": json.dumps(answers, ensure_ascii=False), "a": body.appointment_id})
    audit.log(db, business_id, "create", "form_submission", sid)
    db.commit()
    return SubmissionOut(**db.execute(text(f"{_SUB_SELECT} WHERE s.id = :id"), {"id": sid}).mappings().one())


# ─── Fayllar (rasm, imzo) ────────────────────────────────────────────────────────────────────────
class FileOut(BaseModel):
    id: int
    kind: str
    caption: str | None
    submission_id: int | None
    appointment_id: int | None
    created_by_name: str | None
    created_at: dt.datetime


_FILE_SELECT = """
    SELECT f.id, f.kind, f.caption, f.submission_id, f.appointment_id, u.full_name AS created_by_name, f.created_at
      FROM client_files f LEFT JOIN users u ON u.id = f.created_by
"""


def _store(db: Session, business_id: int, client_id: int, data: bytes, kind: str, caption: str | None,
           appointment_id: int | None = None, submission_id: int | None = None) -> int:
    try:
        content = media.process_image(data, max_width=1600, max_height=2000)
    except media.BadImage as e:
        raise HTTPException(422, detail={"code": "bad_image", "message": str(e)})
    return db.scalar(text("""
        INSERT INTO client_files (business_id, client_id, submission_id, appointment_id, kind, caption, mime, content)
        VALUES (:b, :c, :s, :a, :k, :cap, 'image/webp', :content) RETURNING id
    """), {"b": business_id, "c": client_id, "s": submission_id, "a": appointment_id, "k": kind,
           "cap": (caption or "").strip()[:200] or None, "content": content})


@router.post("/clients/{client_id}/files", response_model=FileOut, status_code=201)
async def upload_file(file: UploadFile = File(...), caption: str | None = Form(default=None),
                      appointment_id: int | None = Form(default=None), client_id: int = Path(ge=1),
                      business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    """Rentgen, tahlil, "oldin/keyin" surati. JPG/PNG/WEBP, 15 MB gacha; server kichraytirib WebP qiladi."""
    _client_or_404(db, business_id, client_id)
    if appointment_id and not db.scalar(text("SELECT 1 FROM appointments WHERE id = :a AND client_id = :c"),
                                        {"a": appointment_id, "c": client_id}):
        raise _NOT_FOUND
    fid = _store(db, business_id, client_id, await file.read(media.MAX_BYTES + 1), "photo", caption, appointment_id)
    audit.log(db, business_id, "upload", "client_file", fid)
    db.commit()
    return FileOut(**db.execute(text(f"{_FILE_SELECT} WHERE f.id = :id"), {"id": fid}).mappings().one())


@router.post("/clients/{client_id}/forms/{submission_id}/signature", response_model=SubmissionOut)
async def sign(file: UploadFile = File(...), submission_id: int = Path(ge=1), client_id: int = Path(ge=1),
               business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    """Mijoz ekranda barmog'i bilan imzo qo'yadi (PNG). Bir marta: imzolangan anketa qayta imzolanmaydi."""
    row = db.execute(text("SELECT signature_file FROM client_form_submissions WHERE id = :s AND client_id = :c AND business_id = :b"),
                     {"s": submission_id, "c": client_id, "b": business_id}).first()
    if row is None:
        raise _NOT_FOUND
    if row.signature_file:
        raise HTTPException(409, detail={"code": "already_signed", "message": "Anketa allaqachon imzolangan"})
    fid = _store(db, business_id, client_id, await file.read(2_000_001), "signature", "Imzo", submission_id=submission_id)
    db.execute(text("UPDATE client_form_submissions SET signature_file = :f, signed_at = now() WHERE id = :s"),
               {"f": fid, "s": submission_id})
    audit.log(db, business_id, "sign", "form_submission", submission_id)
    db.commit()
    return SubmissionOut(**db.execute(text(f"{_SUB_SELECT} WHERE s.id = :id"), {"id": submission_id}).mappings().one())


@router.get("/clients/{client_id}/files", response_model=list[FileOut])
def list_files(client_id: int = Path(ge=1), business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    rows = db.execute(text(f"{_FILE_SELECT} WHERE f.client_id = :c AND f.business_id = :b AND f.kind = 'photo' "
                           "ORDER BY f.created_at DESC LIMIT 200"), {"c": client_id, "b": business_id}).mappings()
    return [FileOut(**r) for r in rows]


@router.get("/clients/{client_id}/files/{file_id}")
def get_file(file_id: int = Path(ge=1), client_id: int = Path(ge=1), business_id: int = Depends(_clients),
             db: Session = Depends(get_db)):
    row = db.execute(text("SELECT mime, content FROM client_files WHERE id = :f AND client_id = :c AND business_id = :b"),
                     {"f": file_id, "c": client_id, "b": business_id}).first()
    if row is None:
        raise _NOT_FOUND
    # Brauzer keshida qolmasin (tibbiy ma'lumot)
    return Response(content=bytes(row.content), media_type=row.mime, headers={"Cache-Control": "private, no-store"})


@router.delete("/clients/{client_id}/files/{file_id}", status_code=204)
def delete_file(file_id: int = Path(ge=1), client_id: int = Path(ge=1), business_id: int = Depends(_clients),
                db: Session = Depends(get_db)):
    n = db.execute(text("DELETE FROM client_files WHERE id = :f AND client_id = :c AND business_id = :b AND kind = 'photo'"),
                   {"f": file_id, "c": client_id, "b": business_id}).rowcount
    if not n:
        raise _NOT_FOUND
    audit.log(db, business_id, "delete", "client_file", file_id)
    db.commit()


# ─── Tashriflar tarixi (timeline) ────────────────────────────────────────────────────────────────
class TimelineItem(BaseModel):
    kind: Literal["visit", "form", "note", "file"]
    at: dt.datetime
    id: int
    title: str
    detail: str | None = None
    member_name: str | None = None
    status: str | None = None
    amount: int | None = None
    alerts: list[str] = []


@router.get("/clients/{client_id}/timeline", response_model=list[TimelineItem])
def timeline(limit: int = Query(default=100, ge=1, le=300), client_id: int = Path(ge=1),
             business_id: int = Depends(_clients), db: Session = Depends(get_db)):
    """Tashriflar (kim, qanday xizmat, materiallar — izoh), anketalar, eslatmalar va rasmlar — bitta lentada."""
    _client_or_404(db, business_id, client_id)
    rows = db.execute(text("""
        SELECT * FROM (
            SELECT 'visit' AS kind, a.starts_at AS at, a.id,
                   coalesce((SELECT string_agg(s.service_name, ', ' ORDER BY s.id) FROM appointment_services s
                              WHERE s.appointment_id = a.id), 'Tashrif') AS title,
                   a.client_note AS detail, u.full_name AS member_name, a.status::text AS status,
                   (a.total_price - a.discount)::bigint AS amount, '{}'::text[] AS alerts
              FROM appointments a
              LEFT JOIN business_members m ON m.id = a.member_id LEFT JOIN users u ON u.id = m.user_id
             WHERE a.client_id = :c AND a.business_id = :b
            UNION ALL
            SELECT 'form', s.created_at, s.id, s.title,
                   CASE WHEN s.signed_at IS NOT NULL THEN 'Imzolangan' END, u.full_name, NULL, NULL, s.alerts
              FROM client_form_submissions s LEFT JOIN users u ON u.id = s.filled_by
             WHERE s.client_id = :c AND s.business_id = :b
            UNION ALL
            SELECT 'note', n.created_at, n.id, 'Eslatma', n.body, u.full_name, NULL, NULL, '{}'
              FROM client_notes n LEFT JOIN users u ON u.id = n.created_by
             WHERE n.client_id = :c AND n.business_id = :b
            UNION ALL
            SELECT 'file', f.created_at, f.id, coalesce(f.caption, 'Rasm'), NULL, u.full_name, NULL, NULL, '{}'
              FROM client_files f LEFT JOIN users u ON u.id = f.created_by
             WHERE f.client_id = :c AND f.business_id = :b AND f.kind = 'photo'
        ) x ORDER BY at DESC, id DESC LIMIT :l
    """), {"c": client_id, "b": business_id, "l": limit}).mappings()
    return [TimelineItem(**r) for r in rows]
