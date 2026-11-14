"""Salon egasi (veb-admin): profil, ish soatlari, rasmlar, xizmat kategoriyalari, xizmatlar va narxlar.

Huquqlar: profil/soat/rasm — 'business.manage'; xizmatlar — 'services.manage'.
Bazada ham xuddi shu qoida (RLS); status/reyting/egasi kabi maydonlarni triggerlar himoya qiladi.
Har bir o'zgarish audit_logs ga yoziladi.
"""
from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, UploadFile, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.schemas.catalog import (HoursOut, HoursReplace, PhotoIn, PhotoOut, PresetOut, PresetsApply, PresetsOut,
                                 ProfileOut, ProfileUpdate, ServiceAdminOut, ServiceCategoryIn,
                                 ServiceCategoryOrder, ServiceCategoryOut, ServiceCategoryUpdate, ServiceCreate, ServiceUpdate)
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
    """Telefondan yoki kompyuterdan rasm. 15 MB gacha, JPG, PNG yoki WEBP. Server kichraytirib, WebP qilib saqlaydi."""
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
_CAT_COLS = ("c.id, c.name, c.name_ru, c.sort_order, (SELECT count(*) FROM services s WHERE s.category_id = c.id "
             "AND s.business_id = c.business_id AND s.is_active) AS service_count")


def _category(db: Session, business_id: int, category_id: int) -> ServiceCategoryOut:
    row = db.execute(text(f"SELECT {_CAT_COLS} FROM service_categories c WHERE c.id = :id AND c.business_id = :b"),
                     {"id": category_id, "b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    return ServiceCategoryOut(**row)


def _name_taken(db: Session, business_id: int, name: str, except_id: int | None = None) -> None:
    taken = db.scalar(text("SELECT EXISTS (SELECT 1 FROM service_categories WHERE business_id = :b "
                           "AND lower(name) = lower(:n) AND id IS DISTINCT FROM :x)"),
                      {"b": business_id, "n": name, "x": except_id})
    if taken:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "category_exists", "message": "Bunday nomli bo'lim bor"})


@router.get("/service-categories", response_model=list[ServiceCategoryOut])
def list_categories(business_id: int = Depends(_services), db: Session = Depends(get_db)):
    rows = db.execute(text(f"SELECT {_CAT_COLS} FROM service_categories c WHERE c.business_id = :b "
                           "ORDER BY c.sort_order, c.name, c.id"), {"b": business_id}).mappings()
    return [ServiceCategoryOut(**r) for r in rows]


@router.post("/service-categories", response_model=ServiceCategoryOut, status_code=201)
def create_category(body: ServiceCategoryIn, business_id: int = Depends(_services), db: Session = Depends(get_db)):
    _name_taken(db, business_id, body.name)
    order = body.sort_order
    if order is None:   # yangi bo'lim oxiriga
        order = db.scalar(text("SELECT coalesce(max(sort_order) + 1, 0) FROM service_categories WHERE business_id = :b"),
                          {"b": business_id})
    name_ru = " ".join((body.name_ru or "").split()) or None
    new_id = db.scalar(text("INSERT INTO service_categories (business_id, name, name_ru, sort_order) "
                            "VALUES (:b, :n, :r, :s) RETURNING id"),
                       {"b": business_id, "n": body.name, "r": name_ru, "s": min(order, 1000)})
    audit.log(db, business_id, "create", "service_category", new_id, {"name": body.name})
    db.commit()
    return _category(db, business_id, new_id)


@router.put("/service-categories/order", response_model=list[ServiceCategoryOut])
def reorder_categories(body: ServiceCategoryOrder, business_id: int = Depends(_services), db: Session = Depends(get_db)):
    """Bo'limlar ketma-ketligi: ro'yxatdagi tartib bo'yicha 0, 1, 2... Ilovada ham shu tartibda chiqadi."""
    ids = list(dict.fromkeys(body.ids))
    own = set(db.scalars(text("SELECT id FROM service_categories WHERE business_id = :b"), {"b": business_id}))
    if set(ids) != own:
        raise HTTPException(422,
                            {"code": "bad_order", "message": "Ro'yxatda muassasaning barcha bo'limlari bo'lishi kerak"})
    for i, cid in enumerate(ids):
        db.execute(text("UPDATE service_categories SET sort_order = :s WHERE id = :id AND business_id = :b"),
                   {"s": i, "id": cid, "b": business_id})
    audit.log(db, business_id, "update", "service_category_order", None, {"ids": ids})
    db.commit()
    return list_categories(business_id, db)


@router.patch("/service-categories/{category_id}", response_model=ServiceCategoryOut)
def update_category(body: ServiceCategoryUpdate, category_id: int = Path(ge=1),
                    business_id: int = Depends(_services), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_none=True)
    if "name_ru" in body.model_fields_set:      # bo'sh — ruscha nom o'chadi
        data["name_ru"] = " ".join((body.name_ru or "").split()) or None
    _category(db, business_id, category_id)
    if "name" in data:
        _name_taken(db, business_id, data["name"], category_id)
    if data:
        sets = ", ".join(f"{k} = :{k}" for k in data)
        db.execute(text(f"UPDATE service_categories SET {sets} WHERE id = :id AND business_id = :b"),
                   {**data, "id": category_id, "b": business_id})
        audit.log(db, business_id, "update", "service_category", category_id, data)
        db.commit()
    return _category(db, business_id, category_id)


@router.delete("/service-categories/{category_id}", status_code=204)
def delete_category(category_id: int = Path(ge=1), move_to: int | None = Query(default=None, ge=1),
                    business_id: int = Depends(_services), db: Session = Depends(get_db)):
    """Bo'lim o'chadi. Undagi xizmatlar o'chmaydi: move_to bo'limiga yoki 'Boshqa' guruhiga o'tadi."""
    _category(db, business_id, category_id)
    if move_to is not None:
        if move_to == category_id:
            raise HTTPException(422, {"code": "bad_target", "message": "Boshqa bo'limni tanlang"})
        _category(db, business_id, move_to)
    db.execute(text("UPDATE services SET category_id = :t WHERE category_id = :id AND business_id = :b"),
               {"t": move_to, "id": category_id, "b": business_id})
    db.execute(text("DELETE FROM service_categories WHERE id = :id AND business_id = :b"), {"id": category_id, "b": business_id})
    audit.log(db, business_id, "delete", "service_category", category_id, {"move_to": move_to})
    db.commit()


# ─── Xizmatlar va narxlar ───────────────────────────────────────────────────
_SERVICE_COLS = "id, name, name_ru, description, category_id, duration_min, price, is_active"


@router.get("/services", response_model=list[ServiceAdminOut])
def list_services(business_id: int = Depends(_services), db: Session = Depends(get_db)):
    """Barcha xizmatlar, jumladan o'chirilganlar (is_active=false)."""
    rows = db.execute(text(f"SELECT {_SERVICE_COLS} FROM services WHERE business_id = :b ORDER BY is_active DESC, name"),
                      {"b": business_id}).mappings()
    return [ServiceAdminOut(**r) for r in rows]


@router.post("/services", response_model=ServiceAdminOut, status_code=201)
def create_service(body: ServiceCreate, business_id: int = Depends(_services), db: Session = Depends(get_db)):
    row = db.execute(text(f"""
        INSERT INTO services (business_id, category_id, name, name_ru, description, duration_min, price)
        VALUES (:b, :category_id, :name, :name_ru, :description, :duration_min, :price)
        RETURNING {_SERVICE_COLS}
    """), {"b": business_id, **body.model_dump()}).mappings().one()
    audit.log(db, business_id, "create", "service", row["id"], body.model_dump())
    db.commit()
    return ServiceAdminOut(**row)


def _presets(db: Session, business_id: int) -> PresetsOut:
    row = db.execute(text("""
        SELECT c.name_uz, c.name_ru, c.service_presets FROM businesses b JOIN business_categories c ON c.id = b.category_id
         WHERE b.id = :b"""), {"b": business_id}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    have = {n.lower() for n in db.scalars(text("SELECT lower(name) FROM services WHERE business_id = :b"),
                                          {"b": business_id})}
    return PresetsOut(category_name=row["name_uz"], category_name_ru=row["name_ru"],
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

    def category_id(name: str | None, name_ru: str | None = None) -> int | None:
        nonlocal next_order
        if not name:
            return None
        if name.lower() not in categories:
            next_order += 1
            categories[name.lower()] = db.scalar(text(
                "INSERT INTO service_categories (business_id, name, name_ru, sort_order) VALUES (:b, :n, :r, :o) RETURNING id"),
                {"b": business_id, "n": name, "r": name_ru or None, "o": next_order})
        return categories[name.lower()]

    for p in _presets(db, business_id).presets:
        if p.exists or p.name.lower() not in wanted:
            continue
        row = db.execute(text(f"""
            INSERT INTO services (business_id, name, name_ru, duration_min, price, category_id)
            VALUES (:b, :name, :name_ru, :d, :price, :c)
            RETURNING {_SERVICE_COLS}"""), {"b": business_id, "name": p.name, "name_ru": p.name_ru or None, "d": p.duration_min,
                                            "price": p.price, "c": category_id(p.category, p.category_ru)}
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
