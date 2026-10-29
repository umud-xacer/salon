"""Salon egasi (veb-admin): profil, ish soatlari, rasmlar, xizmat kategoriyalari, xizmatlar va narxlar.

Huquqlar: profil/soat/rasm — 'business.manage'; xizmatlar — 'services.manage'.
Bazada ham xuddi shu qoida (RLS); status/reyting/egasi kabi maydonlarni triggerlar himoya qiladi.
Har bir o'zgarish audit_logs ga yoziladi.
"""
from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.schemas.catalog import (HoursOut, HoursReplace, PhotoIn, PhotoOut, ProfileOut, ProfileUpdate,
                                 ServiceAdminOut, ServiceCategoryIn, ServiceCategoryOut, ServiceCreate,
                                 ServiceUpdate)
from app.services import audit

router = APIRouter(prefix="/businesses/{business_id}", tags=["business-admin"])

_business = require_permission("business.manage")
_services = require_permission("services.manage")

_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Topilmadi"})


# ─── Profil ─────────────────────────────────────────────────────────────────
def _profile(db: Session, business_id: int) -> ProfileOut:
    row = db.execute(text("""
        SELECT id, slug, name, description, category_id, status::text AS status, phone, city, address,
               ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, is_listed, logo_url, cover_url
          FROM businesses WHERE id = :b
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


@router.delete("/photos/{photo_id}", status_code=204)
def delete_photo(photo_id: int = Path(ge=1), business_id: int = Depends(_business), db: Session = Depends(get_db)):
    deleted = db.execute(text("DELETE FROM business_photos WHERE id = :id AND business_id = :b"),
                         {"id": photo_id, "b": business_id}).rowcount
    if not deleted:
        raise _NOT_FOUND
    audit.log(db, business_id, "delete", "business_photo", photo_id)
    db.commit()


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
