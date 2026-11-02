"""Foydalanuvchining o'z ma'lumotlari: sevimli salonlar."""
from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.v1.catalog import _CARD_COLUMNS, _PUBLIC_WHERE
from app.schemas.catalog import BusinessCard

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/favorites", response_model=list[BusinessCard])
def favorites(db: Session = Depends(get_db)):
    """Yopilgan yoki yashirilgan salon ro'yxatda ko'rinmaydi, lekin yozuv saqlanadi."""
    rows = db.execute(text(f"""
        SELECT {_CARD_COLUMNS}
          FROM favorite_businesses f
          JOIN businesses b ON b.id = f.business_id
          JOIN business_categories c ON c.id = b.category_id
         WHERE f.user_id = app.uid() AND {_PUBLIC_WHERE}
         ORDER BY f.created_at DESC
         LIMIT 200
    """)).mappings()
    return [BusinessCard(**r) for r in rows]


@router.get("/favorites/ids", response_model=list[int])
def favorite_ids(db: Session = Depends(get_db)):
    return list(db.scalars(text("SELECT business_id FROM favorite_businesses WHERE user_id = app.uid()")))


@router.put("/favorites/{business_id}", status_code=204)
def add_favorite(business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    public = db.scalar(text(f"SELECT 1 FROM businesses b WHERE b.id = :id AND {_PUBLIC_WHERE}"), {"id": business_id})
    if public is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Salon topilmadi"})
    db.execute(text("""
        INSERT INTO favorite_businesses (user_id, business_id) VALUES (app.uid(), :id) ON CONFLICT DO NOTHING
    """), {"id": business_id})
    db.commit()


@router.delete("/favorites/{business_id}", status_code=204)
def remove_favorite(business_id: int = Path(ge=1), db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM favorite_businesses WHERE user_id = app.uid() AND business_id = :id"),
               {"id": business_id})
    db.commit()
