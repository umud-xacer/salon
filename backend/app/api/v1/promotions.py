"""Aksiyalar (sql/045_promotions.sql).

Direktor (business.manage): bo'sh soatlarga chegirma qoidalari, promokodlar, sodiqlik dasturi.
Ilova (ochiq): bugungi chegirmali bo'sh vaqtlar (Hot Slots), ko'rinadigan promokodlar; mijozning sodiqlik holati.
Chegirmani bron paytida faqat baza hisoblaydi (app.book_appointment) — bu yerda faqat ko'rsatish.
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_public_db, require_permission
from app.api.v1.catalog import _PUBLIC_WHERE
from app.schemas.promotions import (HotSlotOut, LoyaltyIn, LoyaltyOut, MyLoyaltyOut, OfferOut, PromoCodeIn, PromoCodeOut,
                                    PromoRuleIn, PromoRuleOut)
from app.services import audit

router = APIRouter(tags=["promotions"])

_manage = require_permission("business.manage")
_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Aksiya topilmadi"})

_RULE_COLS = ("id, title, percent, weekdays, time_from, time_to, service_ids, valid_from, valid_to, is_active")
_CODE_COLS = ("c.id, c.code, c.title, c.percent, c.max_uses, c.first_visit_only, c.is_public, c.valid_from, c.valid_to, "
              "c.is_active, (SELECT count(*) FROM appointments a WHERE a.promo_code_id = c.id "
              "AND a.status <> 'cancelled')::int AS uses")


def _check_services(db: Session, business_id: int, ids: list[int] | None) -> None:
    if not ids:
        return
    found = db.scalar(text("SELECT count(*) FROM services WHERE business_id = :b AND id = ANY (:ids)"),
                      {"b": business_id, "ids": ids})
    if found != len(set(ids)):
        raise HTTPException(422, detail={"code": "invalid_reference", "message": "Xizmat shu muassasaga tegishli emas"})


# ─── Direktor: bo'sh soatlarga chegirma ──────────────────────────────────────────────────────────
@router.get("/businesses/{business_id}/promo-rules", response_model=list[PromoRuleOut])
def list_rules(business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    rows = db.execute(text(f"SELECT {_RULE_COLS} FROM promo_rules WHERE business_id = :b ORDER BY is_active DESC, id DESC"),
                      {"b": business_id}).mappings()
    return [PromoRuleOut(**r) for r in rows]


@router.post("/businesses/{business_id}/promo-rules", response_model=PromoRuleOut, status_code=201)
def create_rule(body: PromoRuleIn, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    _check_services(db, business_id, body.service_ids)
    row = db.execute(text(f"""
        INSERT INTO promo_rules (business_id, title, percent, weekdays, time_from, time_to, service_ids, valid_from,
                                 valid_to, is_active)
        VALUES (:b, :title, :percent, :weekdays, :time_from, :time_to, :service_ids,
                coalesce(:valid_from, current_date), :valid_to, :is_active)
        RETURNING {_RULE_COLS}
    """), {"b": business_id, **body.model_dump()}).mappings().one()
    audit.log(db, business_id, "create", "promo_rule", row["id"], body.model_dump(mode="json"))
    db.commit()
    return PromoRuleOut(**row)


@router.put("/businesses/{business_id}/promo-rules/{rule_id}", response_model=PromoRuleOut)
def update_rule(body: PromoRuleIn, rule_id: int = Path(ge=1), business_id: int = Depends(_manage),
                db: Session = Depends(get_db)):
    _check_services(db, business_id, body.service_ids)
    row = db.execute(text(f"""
        UPDATE promo_rules SET title = :title, percent = :percent, weekdays = :weekdays, time_from = :time_from,
               time_to = :time_to, service_ids = :service_ids, valid_from = coalesce(:valid_from, valid_from),
               valid_to = :valid_to, is_active = :is_active
         WHERE id = :id AND business_id = :b
        RETURNING {_RULE_COLS}
    """), {"b": business_id, "id": rule_id, **body.model_dump()}).mappings().first()
    if row is None:
        raise _NOT_FOUND
    audit.log(db, business_id, "update", "promo_rule", rule_id, body.model_dump(mode="json"))
    db.commit()
    return PromoRuleOut(**row)


@router.delete("/businesses/{business_id}/promo-rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int = Path(ge=1), business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    if db.execute(text("DELETE FROM promo_rules WHERE id = :id AND business_id = :b"),
                  {"id": rule_id, "b": business_id}).rowcount == 0:
        raise _NOT_FOUND
    audit.log(db, business_id, "delete", "promo_rule", rule_id, {})
    db.commit()


# ─── Direktor: promokodlar ───────────────────────────────────────────────────────────────────────
@router.get("/businesses/{business_id}/promo-codes", response_model=list[PromoCodeOut])
def list_codes(business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    rows = db.execute(text(f"SELECT {_CODE_COLS} FROM promo_codes c WHERE c.business_id = :b "
                           "ORDER BY c.is_active DESC, c.id DESC"), {"b": business_id}).mappings()
    return [PromoCodeOut(**r) for r in rows]


@router.post("/businesses/{business_id}/promo-codes", response_model=PromoCodeOut, status_code=201)
def create_code(body: PromoCodeIn, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    new_id = db.scalar(text("""
        INSERT INTO promo_codes (business_id, code, title, percent, max_uses, first_visit_only, is_public, valid_from,
                                 valid_to, is_active)
        VALUES (:b, :code, :title, :percent, :max_uses, :first_visit_only, :is_public, coalesce(:valid_from, current_date),
                :valid_to, :is_active)
        RETURNING id
    """), {"b": business_id, **body.model_dump()})
    audit.log(db, business_id, "create", "promo_code", new_id, body.model_dump(mode="json"))
    db.commit()
    return PromoCodeOut(**db.execute(text(f"SELECT {_CODE_COLS} FROM promo_codes c WHERE c.id = :id"),
                                     {"id": new_id}).mappings().one())


@router.put("/businesses/{business_id}/promo-codes/{code_id}", response_model=PromoCodeOut)
def update_code(body: PromoCodeIn, code_id: int = Path(ge=1), business_id: int = Depends(_manage),
                db: Session = Depends(get_db)):
    updated = db.execute(text("""
        UPDATE promo_codes SET code = :code, title = :title, percent = :percent, max_uses = :max_uses,
               first_visit_only = :first_visit_only, is_public = :is_public,
               valid_from = coalesce(:valid_from, valid_from), valid_to = :valid_to, is_active = :is_active
         WHERE id = :id AND business_id = :b
    """), {"b": business_id, "id": code_id, **body.model_dump()}).rowcount
    if updated == 0:
        raise _NOT_FOUND
    audit.log(db, business_id, "update", "promo_code", code_id, body.model_dump(mode="json"))
    db.commit()
    return PromoCodeOut(**db.execute(text(f"SELECT {_CODE_COLS} FROM promo_codes c WHERE c.id = :id"),
                                     {"id": code_id}).mappings().one())


@router.delete("/businesses/{business_id}/promo-codes/{code_id}", status_code=204)
def delete_code(code_id: int = Path(ge=1), business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    if db.execute(text("DELETE FROM promo_codes WHERE id = :id AND business_id = :b"),
                  {"id": code_id, "b": business_id}).rowcount == 0:
        raise _NOT_FOUND
    audit.log(db, business_id, "delete", "promo_code", code_id, {})
    db.commit()


# ─── Direktor: sodiqlik dasturi ──────────────────────────────────────────────────────────────────
@router.get("/businesses/{business_id}/loyalty", response_model=LoyaltyOut | None)
def get_loyalty(business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    row = db.execute(text("SELECT visits_required, reward_percent, is_active FROM loyalty_programs WHERE business_id = :b"),
                     {"b": business_id}).mappings().first()
    return LoyaltyOut(**row) if row else None


@router.put("/businesses/{business_id}/loyalty", response_model=LoyaltyOut)
def set_loyalty(body: LoyaltyIn, business_id: int = Depends(_manage), db: Session = Depends(get_db)):
    row = db.execute(text("""
        INSERT INTO loyalty_programs (business_id, visits_required, reward_percent, is_active)
        VALUES (:b, :visits_required, :reward_percent, :is_active)
        ON CONFLICT (business_id) DO UPDATE SET visits_required = EXCLUDED.visits_required,
            reward_percent = EXCLUDED.reward_percent, is_active = EXCLUDED.is_active, updated_at = now()
        RETURNING visits_required, reward_percent, is_active
    """), {"b": business_id, **body.model_dump()}).mappings().one()
    audit.log(db, business_id, "update", "loyalty_program", business_id, body.model_dump())
    db.commit()
    return LoyaltyOut(**row)


# ─── Ilova: Hot Slots va sovg'alar (ochiq) ───────────────────────────────────────────────────────
def _nearby_ids(db: Session, lat: float, lng: float, radius_m: int) -> dict[int, dict]:
    rows = db.execute(text(f"""
        SELECT b.id, b.slug, b.name, c.name_uz AS category_name, c.name_ru AS category_name_ru,
               round(ST_Distance(b.location, p.pt))::int AS distance_m,
               (SELECT ph.url FROM business_photos ph WHERE ph.business_id = b.id ORDER BY ph.sort_order, ph.id LIMIT 1)
                   AS photo
          FROM businesses b
          JOIN business_categories c ON c.id = b.category_id
         CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS pt) p
         WHERE {_PUBLIC_WHERE} AND ST_DWithin(b.location, p.pt, :r)
         ORDER BY b.location <-> p.pt
         LIMIT 60
    """), {"lat": lat, "lng": lng, "r": radius_m}).mappings()
    return {r["id"]: dict(r) for r in rows}


@router.get("/catalog/hot-slots", response_model=list[HotSlotOut])
def hot_slots(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180),
              radius_m: int = Query(15000, ge=500, le=50000), limit: int = Query(10, ge=1, le=20),
              db: Session = Depends(get_public_db)):
    """Bugun hali bo'sh qolgan va chegirma qoidasiga tushadigan vaqtlar (har xizmat uchun eng yaqin vaqt)."""
    near = _nearby_ids(db, lat, lng, radius_m)
    if not near:
        return []
    rules = db.execute(text("SELECT * FROM app.public_hot_rules(:ids) ORDER BY percent DESC"),
                       {"ids": list(near)}).mappings().all()
    soon = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=10)
    out: list[HotSlotOut] = []
    used: set[tuple[int, int]] = set()
    for rule in rules:
        services = db.execute(text("""
            SELECT s.id, s.name, s.name_ru, s.price FROM services s
             WHERE s.business_id = :b AND s.is_active AND (CAST(:ids AS bigint[]) IS NULL OR s.id = ANY (:ids))
             ORDER BY s.price, s.id LIMIT 3
        """), {"b": rule["business_id"], "ids": rule["service_ids"]}).mappings().all()
        for s in services:
            if (rule["business_id"], s["id"]) in used:
                continue
            members = db.execute(text("""
                SELECT ps.member_id, ps.full_name, coalesce(ms.custom_price, :price) AS price
                  FROM public_staff ps JOIN member_services ms ON ms.member_id = ps.member_id AND ms.service_id = :s
                 WHERE ps.business_id = :b
            """), {"b": rule["business_id"], "s": s["id"], "price": s["price"]}).mappings().all()
            best = None
            for m in members:
                for slot in db.execute(text("SELECT slot_start, slot_time FROM app.available_slots(:m, :s, :d, 15)"),
                                       {"m": m["member_id"], "s": s["id"], "d": rule["today"]}).mappings():
                    t = dt.time.fromisoformat(slot["slot_time"])
                    if slot["slot_start"] < soon or not (rule["time_from"] <= t < rule["time_to"]):
                        continue
                    if best is None or slot["slot_start"] < best[0]["slot_start"]:
                        best = (slot, m)
                    break                                   # shu ustaning eng yaqin vaqti yetarli
            if best is None:
                continue
            slot, m = best
            b = near[rule["business_id"]]
            price = int(m["price"])
            out.append(HotSlotOut(
                business_id=b["id"], business_slug=b["slug"], business_name=b["name"], category_name=b["category_name"],
                category_name_ru=b["category_name_ru"], distance_m=b["distance_m"], photo=b["photo"],
                service_id=s["id"], service_name=s["name"], service_name_ru=s["name_ru"], member_id=m["member_id"],
                member_name=m["full_name"], starts_at=slot["slot_start"], time=slot["slot_time"],
                percent=rule["percent"], price=price, final=price - price * rule["percent"] // 100,
                rule_title=rule["title"], ends_window=rule["time_to"]))
            used.add((rule["business_id"], s["id"]))
    out.sort(key=lambda x: (x.starts_at, -x.percent))
    return out[:limit]


@router.get("/catalog/offers", response_model=list[OfferOut])
def offers(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180),
           radius_m: int = Query(15000, ge=500, le=50000), db: Session = Depends(get_public_db)):
    """Ilovada ko'rinadigan promokodlar (muassasa "sovg'a" deb belgilagan)."""
    near = _nearby_ids(db, lat, lng, radius_m)
    if not near:
        return []
    rows = db.execute(text("SELECT * FROM app.public_promo_codes(:ids) LIMIT 10"), {"ids": list(near)}).mappings()
    return [OfferOut(**r, business_slug=near[r["business_id"]]["slug"], business_name=near[r["business_id"]]["name"],
                     distance_m=near[r["business_id"]]["distance_m"]) for r in rows]


@router.get("/me/loyalty", response_model=list[MyLoyaltyOut])
def my_loyalty(db: Session = Depends(get_db)):
    """Mijozning sodiqlik dasturlaridagi holati (tashrif qilgan muassasalari)."""
    rows = db.execute(text("""
        SELECT l.business_id, b.slug AS business_slug, b.name AS business_name, l.visits, l.required, l.percent, l.ready
          FROM app.my_loyalty() l JOIN businesses b ON b.id = l.business_id
         ORDER BY l.ready DESC, (l.required - l.visits), b.name
    """)).mappings()
    return [MyLoyaltyOut(**r) for r in rows]
