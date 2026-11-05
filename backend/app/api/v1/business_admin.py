"""Salon egasi (veb-admin): profil, ish soatlari, rasmlar, xizmat kategoriyalari, xizmatlar va narxlar.

Huquqlar: profil/soat/rasm — 'business.manage'; xizmatlar — 'services.manage'.
Bazada ham xuddi shu qoida (RLS); status/reyting/egasi kabi maydonlarni triggerlar himoya qiladi.
Har bir o'zgarish audit_logs ga yoziladi.
"""
from fastapi import APIRouter, Depends, File, HTTPException, Path, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.schemas.catalog import (HoursOut, HoursReplace, PhotoIn, PhotoOut, PresetOut, PresetsApply, PresetsOut,
                                 ProfileOut, ProfileUpdate, ServiceAdminOut, ServiceCategoryIn,
                                 ServiceCategoryOut, ServiceCreate, ServiceUpdate)
from app.services import audit, media

router = APIRouter(prefix="/businesses/{business_id}", tags=["business-admin"])

_business = require_permission("business.manage")
_services = require_permission("services.manage")

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Topilmadi"})


# ─── Profil ─────────────────────────────────────────────────────────────────
def _profile(db: Session, business_id: int) -> ProfileOut:
    row = db.execute(text("""
        SELECT b.id, b.slug, b.name, b.description, b.category_id, b.status::text AS status, b.phone, b.city,
               b.address, ST_Y(b.location::geometry) AS lat, ST_X(b.location::geometry) AS lng, b.is_listed,
               b.logo_url, b.cover_url, c.name_uz AS category_name,
               c.opens_at AS default_opens_at, c.closes_at AS default_closes_at
          FROM businesses b JOIN business_categories c ON c.id = b.category_id
         WHERE b.id = :b
    """), {"b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return ProfileOut(**row)


@router.get("/profile", response_model=ProfileOut)
def get_profile(business_id: int = Depends(_business), db: Session = Depends(get_db)):
    return _profile(db, business_id)


@router.patch("/profile", response_model=ProfileOut)
def update_profile(body: ProfileUpdate, business_id: int = Depends(_business), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    lat, lng = data.pop("lat", None), data.pop("lng", None)
    # Ustun nomlari faqat sxemadagi ruxsat etilgan ro'yxatdan — foydalanuvchi matni SQL'ga kirmaydi
    sets = [f"{col} = :{col}" for col in data]
    if lat is not None:
        sets.append("location = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography")
        data.update(lat=lat, lng=lng)
    if sets:
        db.execute(text(f"UPDATE businesses SET {', '.join(sets)} WHERE id = :b"), {**data, "b": business_id})
        audit.log(db, business_id, "update", "business", business_id, data)
        db.commit()
    return _profile(db, business_id)


# ─── Ish soatlari ───────────────────────────────────────────────────────────
@router.get("/hours", response_model=list[HoursOut])
def get_hours(business_id: int = Depends(_business), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT weekday, opens_at, closes_at FROM business_hours WHERE business_id = :b "
                           "ORDER BY weekday"), {"b": business_id}).mappings()
    return [HoursOut(**r) for r in rows]


@router.put("/hours", response_model=list[HoursOut])
def replace_hours(body: HoursReplace, business_id: int = Depends(_business), db: Session = Depends(get_db)):
    """Butun haftani bir tranzaksiyada almashtiradi. Ro'yxatda yo'q kun — dam olish."""
    db.execute(text("DELETE FROM business_hours WHERE business_id = :b"), {"b": business_id})
    for d in body.days:
        db.execute(text("INSERT INTO business_hours (business_id, weekday, opens_at, closes_at) "
                        "VALUES (:b, :w, :o, :c)"), {"b": business_id, "w": d.weekday, "o": d.opens_at, "c": d.closes_at})
    audit.log(db, business_id, "update", "business_hours", business_id, {"days": [d.model_dump() for d in body.days]})
    db.commit()
    return get_hours(business_id, db)


# ─── Rasmlar ────────────────────────────────────────────────────────────────
@router.get("/photos", response_model=list[PhotoOut])
def list_photos(business_id: int = Depends(_business), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id, url, sort_order FROM business_photos WHERE business_id = :b "
                           "ORDER BY sort_order, id"), {"b": business_id}).mappings()
    return [PhotoOut(**r) for r in rows]


@router.post("/photos", response_model=PhotoOut, status_code=201)
def add_photo(body: PhotoIn, business_id: int = Depends(_business), db: Session = Depends(get_db)):
    row = db.execute(text("INSERT INTO business_photos (business_id, url, sort_order) VALUES (:b, :u, :s) "
                          "RETURNING id, url, sort_order"), {"b": business_id, "u": str(body.url), "s": body.sort_order}
                     ).mappings().one()
    audit.log(db, business_id, "create", "business_photo", row["id"], {"url": row["url"]})
    db.commit()
    return PhotoOut(**row)


@router.post("/photos/upload", response_model=PhotoOut, status_code=201)
async def upload_photo(file: UploadFile = File(...), business_id: int = Depends(_business),
                       db: Session = Depends(get_db)):
    """Telefondan yoki kompyuterdan rasm. 8 MB gacha, JPG, PNG yoki WEBP. Server qayta siqib saqlaydi."""
    data = await file.read(media.MAX_BYTES + 1)
    try:
        url = media.save_business_photo(business_id, data)
    except media.BadImage as e:
        raise HTTPException(422, detail={"code": "bad_image", "message": str(e)})
    try:
        order = db.scalar(text("SELECT coalesce(max(sort_order), -1) + 1 FROM business_photos WHERE business_id = :b"),
                          {"b": business_id})
        row = db.execute(text("INSERT INTO business_photos (business_id, url, sort_order) VALUES (:b, :u, :s) "
                              "RETURNING id, url, sort_order"), {"b": business_id, "u": url, "s": min(order, 100)}
                         ).mappings().one()
        audit.log(db, business_id, "upload", "business_photo", row["id"], {"url": url})
        db.commit()
    except Exception:
        db.rollback()
        media.delete_by_url(url)               # bazaga yozilmagan fayl diskda qolmasin
        raise
    return PhotoOut(**row)


@router.delete("/photos/{photo_id}", status_code=204)
def delete_photo(photo_id: int = Path(ge=1), business_id: int = Depends(_business), db: Session = Depends(get_db)):
    url = db.scalar(text("DELETE FROM business_photos WHERE id = :id AND business_id = :b RETURNING url"),
                    {"id": photo_id, "b": business_id})
    if url is None:
        raise _NOT_FOUND
    audit.log(db, business_id, "delete", "business_photo", photo_id)
    db.commit()
    media.delete_by_url(url)


# ─── Xizmat kategoriyalari ──────────────────────────────────────────────────
@router.get("/service-categories", response_model=list[ServiceCategoryOut])
def list_categories(business_id: int = Depends(_services), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id, name, sort_order FROM service_categories WHERE business_id = :b "
                           "ORDER BY sort_order, name"), {"b": business_id}).mappings()
    return [ServiceCategoryOut(**r) for r in rows]


@router.post("/service-categories", response_model=ServiceCategoryOut, status_code=201)
def create_category(body: ServiceCategoryIn, business_id: int = Depends(_services), db: Session = Depends(get_db)):
    row = db.execute(text("INSERT INTO service_categories (business_id, name, sort_order) VALUES (:b, :n, :s) "
                          "RETURNING id, name, sort_order"), {"b": business_id, "n": body.name.strip(), "s": body.sort_order}
                     ).mappings().one()
    audit.log(db, business_id, "create", "service_category", row["id"], body.model_dump())
    db.commit()
    return ServiceCategoryOut(**row)


@router.patch("/service-categories/{category_id}", response_model=ServiceCategoryOut)
def update_category(body: ServiceCategoryIn, category_id: int = Path(ge=1),
                    business_id: int = Depends(_services), db: Session = Depends(get_db)):
    row = db.execute(text("UPDATE service_categories SET name = :n, sort_order = :s WHERE id = :id AND business_id = :b "
                          "RETURNING id, name, sort_order"),
                     {"n": body.name.strip(), "s": body.sort_order, "id": category_id, "b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    audit.log(db, business_id, "update", "service_category", category_id, body.model_dump())
    db.commit()
    return ServiceCategoryOut(**row)


@router.delete("/service-categories/{category_id}", status_code=204)
def delete_category(category_id: int = Path(ge=1), business_id: int = Depends(_services), db: Session = Depends(get_db)):
    """Kategoriya o'chadi, undagi xizmatlar 'Boshqa' guruhiga o'tadi."""
    db.execute(text("UPDATE services SET category_id = NULL WHERE category_id = :id AND business_id = :b"),
               {"id": category_id, "b": business_id})
    deleted = db.execute(text("DELETE FROM service_categories WHERE id = :id AND business_id = :b"),
                         {"id": category_id, "b": business_id}).rowcount
    if not deleted:
        raise _NOT_FOUND
    audit.log(db, business_id, "delete", "service_category", category_id)
    db.commit()


# ─── Xizmatlar va narxlar ───────────────────────────────────────────────────
_SERVICE_COLS = "id, name, description, category_id, duration_min, price, is_active"


@router.get("/services", response_model=list[ServiceAdminOut])
def list_services(business_id: int = Depends(_services), db: Session = Depends(get_db)):
    """Barcha xizmatlar, jumladan o'chirilganlar (is_active=false)."""
    rows = db.execute(text(f"SELECT {_SERVICE_COLS} FROM services WHERE business_id = :b ORDER BY is_active DESC, name"),
                      {"b": business_id}).mappings()
    return [ServiceAdminOut(**r) for r in rows]


@router.post("/services", response_model=ServiceAdminOut, status_code=201)
def create_service(body: ServiceCreate, business_id: int = Depends(_services), db: Session = Depends(get_db)):
    row = db.execute(text(f"""
        INSERT INTO services (business_id, category_id, name, description, duration_min, price)
        VALUES (:b, :category_id, :name, :description, :duration_min, :price)
        RETURNING {_SERVICE_COLS}
    """), {"b": business_id, **body.model_dump()}).mappings().one()
    audit.log(db, business_id, "create", "service", row["id"], body.model_dump())
    db.commit()
    return ServiceAdminOut(**row)


def _presets(db: Session, business_id: int) -> PresetsOut:
    row = db.execute(text("""
        SELECT c.name_uz, c.service_presets FROM businesses b JOIN business_categories c ON c.id = b.category_id
         WHERE b.id = :b"""), {"b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    have = {n.lower() for n in db.scalars(text("SELECT lower(name) FROM services WHERE business_id = :b"),
                                          {"b": business_id})}
    return PresetsOut(category_name=row["name_uz"],
                      presets=[PresetOut(**p, exists=p["name"].lower() in have) for p in row["service_presets"]])


@router.get("/service-presets", response_model=PresetsOut)
def list_presets(business_id: int = Depends(_services), db: Session = Depends(get_db)):
    """Muassasa turiga mos tavsiya xizmatlar (Super Admin belgilaydi)."""
    return _presets(db, business_id)


@router.post("/service-presets", response_model=list[ServiceAdminOut], status_code=201)
def apply_presets(body: PresetsApply, business_id: int = Depends(_services), db: Session = Depends(get_db)):
    """Tanlangan tavsiya xizmatlarni qo'shadi. Salonda bor nomlar va ro'yxatda yo'q nomlar o'tkazib yuboriladi."""
    wanted = {n.strip().lower() for n in body.names}
    created = []
    # Bo'lim: salonda shu nomli bo'lim bo'lsa — o'sha, bo'lmasa yaratiladi (tavsiyadagi tartib bo'yicha)
    categories = {name.lower(): cid for cid, name in db.execute(
        text("SELECT id, name FROM service_categories WHERE business_id = :b"), {"b": business_id})}
    next_order = db.scalar(text("SELECT coalesce(max(sort_order), 0) FROM service_categories WHERE business_id = :b"),
                           {"b": business_id})

    def category_id(name: str | None) -> int | None:
        nonlocal next_order
        if not name:
            return None
        if name.lower() not in categories:
            next_order += 1
            categories[name.lower()] = db.scalar(text(
                "INSERT INTO service_categories (business_id, name, sort_order) VALUES (:b, :n, :o) RETURNING id"),
                {"b": business_id, "n": name, "o": next_order})
        return categories[name.lower()]

    for p in _presets(db, business_id).presets:
        if p.exists or p.name.lower() not in wanted:
            continue
        row = db.execute(text(f"""
            INSERT INTO services (business_id, name, duration_min, price, category_id) VALUES (:b, :name, :d, :price, :c)
            RETURNING {_SERVICE_COLS}"""), {"b": business_id, "name": p.name, "d": p.duration_min, "price": p.price,
                                            "c": category_id(p.category)}
        ).mappings().one()
        created.append(ServiceAdminOut(**row))
    if created:
        audit.log(db, business_id, "create", "service", None, {"presets": [s.name for s in created]})
    db.commit()
    return created


@router.patch("/services/{service_id}", response_model=ServiceAdminOut)
def update_service(body: ServiceUpdate, service_id: int = Path(ge=1),
                   business_id: int = Depends(_services), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(422, detail={"code": "empty", "message": "O'zgartirish yo'q"})
    old = db.execute(text("SELECT price, duration_min FROM services WHERE id = :id AND business_id = :b"),
                     {"id": service_id, "b": business_id}).mappings().first()
    if old is None:
        raise _NOT_FOUND
    sets = ", ".join(f"{col} = :{col}" for col in data)
    row = db.execute(text(f"UPDATE services SET {sets} WHERE id = :id AND business_id = :b RETURNING {_SERVICE_COLS}"),
                     {**data, "id": service_id, "b": business_id}).mappings().one()
    changes = dict(data)
    if "price" in data:
        changes["price"] = [old["price"], data["price"]]       # narx tarixi auditda
    audit.log(db, business_id, "update", "service", service_id, changes)
    db.commit()
    return ServiceAdminOut(**row)


@router.delete("/services/{service_id}", status_code=204)
def deactivate_service(service_id: int = Path(ge=1), business_id: int = Depends(_services),
                       db: Session = Depends(get_db)):
    """Xizmat o'chirilmaydi, yashiriladi: eski bronlar va hisobotlar buzilmasin."""
    updated = db.execute(text("UPDATE services SET is_active = false WHERE id = :id AND business_id = :b"),
                         {"id": service_id, "b": business_id}).rowcount
    if not updated:
        raise _NOT_FOUND
    audit.log(db, business_id, "deactivate", "service", service_id)
    db.commit()
