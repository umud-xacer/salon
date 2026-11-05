"""Reyting va baholash.

Mijoz: yakunlangan tashrifga bir marta baho (muassasaga + xizmat ko'rsatgan ustaga). Yozish bazadagi
app.create_review() orqali — kimligi, qaysi salon va usta bronning o'zidan olinadi (sql/028_reviews.sql).
Ommaviy: salon sahifasi uchun xulosa va izohlar (muallif — faqat ism va familiya bosh harfi).
Direktor ('business.manage'): barcha baholar, javob yozish. Super Admin: haqoratli bahoni yashirish.
"""
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_public_db, require_permission, require_superadmin
from app.schemas.reviews import (BusinessReview, BusinessReviewsOut, HideIn, PublicReview, PublicReviewsOut, ReplyIn,
                                 ReviewCreate, ReviewSummary)
from app.services import audit

router = APIRouter(tags=["reviews"])

_manage = require_permission("business.manage")
_NOT_FOUND = HTTPException(404, detail={"code": "not_found", "message": "Baho topilmadi"})


def _summary(row) -> ReviewSummary:
    f = lambda v: None if v is None else float(v)          # noqa: E731
    return ReviewSummary(count=row["count"], rating_avg=f(row["rating_avg"]), cleanliness_avg=f(row["cleanliness_avg"]),
                         quality_avg=f(row["quality_avg"]),
                         distribution={k: row[f"s{k}"] for k in (5, 4, 3, 2, 1)})


# ─── Mijoz ──────────────────────────────────────────────────────────────────
@router.post("/appointments/{appointment_id}/review", status_code=201)
def create_review(body: ReviewCreate, appointment_id: int = Path(ge=1), db: Session = Depends(get_db)):
    review_id = db.scalar(text("SELECT app.create_review(:a, :r, :c, :q, :t, :sr, :st)"), {
        "a": appointment_id, "r": body.rating, "c": body.cleanliness, "q": body.service_quality,
        "t": body.comment, "sr": body.staff_rating, "st": body.staff_comment})
    db.commit()
    return {"id": review_id}


# ─── Ommaviy (ilova, kirishsiz ham) ─────────────────────────────────────────
@router.get("/catalog/businesses/{slug}/reviews", response_model=PublicReviewsOut)
def public_reviews(slug: str, member_id: int | None = Query(default=None, ge=1),
                   limit: int = Query(default=20, ge=1, le=50), offset: int = Query(default=0, ge=0, le=10_000),
                   db: Session = Depends(get_public_db)):
    bid = db.scalar(text("SELECT id FROM businesses WHERE slug = :s"), {"s": slug})   # RLS: faqat ochiq salon
    if bid is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Biznes topilmadi"})
    summary = db.execute(text("SELECT * FROM app.public_review_summary(:b)"), {"b": bid}).mappings().one()
    items = db.execute(text("SELECT * FROM app.public_reviews(:b, :m, :l, :o)"),
                       {"b": bid, "m": member_id, "l": limit, "o": offset}).mappings()
    return PublicReviewsOut(summary=_summary(summary), items=[PublicReview(**r) for r in items])


# ─── Direktor paneli ────────────────────────────────────────────────────────
_BIZ_SELECT = """
    SELECT r.id, r.member_id, mu.full_name AS member_name, r.rating, r.cleanliness, r.service_quality, r.comment,
           r.staff_rating, r.staff_comment, r.reply, r.reply_at, r.created_at, r.is_hidden, r.appointment_id,
           a.starts_at AS appointment_starts_at, c.full_name AS client_name, c.phone AS client_phone,
           coalesce(c.full_name, 'Mijoz') AS author, ru.full_name AS replied_by_name
      FROM reviews r
      JOIN appointments a ON a.id = r.appointment_id
      LEFT JOIN business_clients c ON c.id = a.client_id
      LEFT JOIN business_members m ON m.id = r.member_id
      LEFT JOIN users mu ON mu.id = m.user_id
      LEFT JOIN users ru ON ru.id = r.replied_by
"""


@router.get("/businesses/{business_id}/reviews", response_model=BusinessReviewsOut)
def business_reviews(business_id: int = Depends(_manage),
                     member_id: int | None = Query(default=None, ge=1),
                     rating: int | None = Query(default=None, ge=1, le=5),
                     unanswered: bool = False,
                     limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0),
                     db: Session = Depends(get_db)):
    where, p = ["r.business_id = :b"], {"b": business_id, "l": limit, "o": offset}
    if member_id:
        where.append("r.member_id = :m")
        p["m"] = member_id
    if rating:
        where.append("r.rating = :r")
        p["r"] = rating
    if unanswered:
        where.append("r.reply IS NULL")
    w = " AND ".join(where)
    total = db.scalar(text(f"SELECT count(*) FROM reviews r WHERE {w}"), p)
    rows = db.execute(text(f"{_BIZ_SELECT} WHERE {w} ORDER BY r.created_at DESC, r.id DESC LIMIT :l OFFSET :o"), p).mappings()
    summary = db.execute(text("""
        SELECT count(*), round(avg(rating), 1) AS rating_avg, round(avg(cleanliness), 1) AS cleanliness_avg,
               round(avg(service_quality), 1) AS quality_avg,
               count(*) FILTER (WHERE rating = 1) AS s1, count(*) FILTER (WHERE rating = 2) AS s2,
               count(*) FILTER (WHERE rating = 3) AS s3, count(*) FILTER (WHERE rating = 4) AS s4,
               count(*) FILTER (WHERE rating = 5) AS s5
          FROM reviews WHERE business_id = :b AND NOT is_hidden"""), {"b": business_id}).mappings().one()
    return BusinessReviewsOut(summary=_summary(summary), items=[BusinessReview(**r) for r in rows], total=total)


@router.get("/businesses/{business_id}/reviews/mine", response_model=PublicReviewsOut)
def my_staff_reviews(business_id: int = Path(ge=1), limit: int = Query(default=50, ge=1, le=200),
                     db: Session = Depends(get_db)):
    """Usta / shifokor: o'ziga qo'yilgan baholar. Mijoz — faqat ism va familiya bosh harfi."""
    member_id = db.scalar(text("SELECT app.my_member_in(:b)"), {"b": business_id})
    if member_id is None:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Bu muassasa xodimi emassiz"})
    rows = db.execute(text("""
        SELECT r.id, 'Mijoz' AS author, r.member_id, NULL::text AS member_name, r.rating, r.cleanliness,
               r.service_quality, r.comment, r.staff_rating, r.staff_comment, r.reply, r.reply_at, r.created_at,
               coalesce(split_part(trim(c.full_name), ' ', 1)
                        || coalesce(' ' || nullif(left(split_part(trim(c.full_name), ' ', 2), 1), '') || '.', ''),
                        'Mijoz') AS short_name
          FROM reviews r
          JOIN appointments a ON a.id = r.appointment_id
          LEFT JOIN business_clients c ON c.id = a.client_id
         WHERE r.business_id = :b AND r.member_id = :m AND r.staff_rating IS NOT NULL AND NOT r.is_hidden
         ORDER BY r.created_at DESC LIMIT :l"""), {"b": business_id, "m": member_id, "l": limit}).mappings().all()
    s = db.execute(text("""
        SELECT count(*), round(avg(staff_rating), 1) AS rating_avg, NULL::numeric AS cleanliness_avg,
               NULL::numeric AS quality_avg,
               count(*) FILTER (WHERE staff_rating = 1) AS s1, count(*) FILTER (WHERE staff_rating = 2) AS s2,
               count(*) FILTER (WHERE staff_rating = 3) AS s3, count(*) FILTER (WHERE staff_rating = 4) AS s4,
               count(*) FILTER (WHERE staff_rating = 5) AS s5
          FROM reviews WHERE business_id = :b AND member_id = :m AND staff_rating IS NOT NULL AND NOT is_hidden"""),
        {"b": business_id, "m": member_id}).mappings().one()
    items = [PublicReview(**{**{k: v for k, v in r.items() if k != "short_name"}, "author": r["short_name"]}) for r in rows]
    return PublicReviewsOut(summary=_summary(s), items=items)


@router.put("/businesses/{business_id}/reviews/{review_id}/reply", response_model=BusinessReview)
def reply_review(body: ReplyIn, business_id: int = Depends(_manage), review_id: int = Path(ge=1),
                 db: Session = Depends(get_db)):
    updated = db.execute(text("UPDATE reviews SET reply = :t WHERE id = :id AND business_id = :b"),
                         {"t": body.reply, "id": review_id, "b": business_id}).rowcount
    if not updated:
        raise _NOT_FOUND
    audit.log(db, business_id, "reply" if body.reply else "delete", "review", review_id)
    db.commit()
    return BusinessReview(**db.execute(text(f"{_BIZ_SELECT} WHERE r.id = :id"), {"id": review_id}).mappings().one())


# ─── Super Admin: moderatsiya ───────────────────────────────────────────────
@router.patch("/superadmin/reviews/{review_id}", status_code=204, dependencies=[Depends(require_superadmin)])
def hide_review(body: HideIn, review_id: int = Path(ge=1), db: Session = Depends(get_db)):
    business_id = db.scalar(text("UPDATE reviews SET is_hidden = :h WHERE id = :id RETURNING business_id"),
                            {"h": body.is_hidden, "id": review_id})
    if business_id is None:
        raise _NOT_FOUND
    audit.log(db, business_id, "hide" if body.is_hidden else "unhide", "review", review_id)
    db.commit()
