from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from auth import get_salon_id, require_admin, require_reception_or_above
import models, schemas

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.get("/", response_model=list[schemas.ClientOut])
def get_all(salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    q = db.query(models.Client)
    if salon_id:
        q = q.filter(models.Client.salon_id == salon_id)
    return q.order_by(models.Client.visits.desc()).all()


@router.post("/", response_model=schemas.ClientOut)
def create(item: schemas.ClientCreate, user=Depends(require_reception_or_above), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id") or 1
    existing = db.query(models.Client).filter(
        models.Client.phone == item.phone,
        models.Client.salon_id == salon_id,
    ).first()
    if existing:
        raise HTTPException(400, "Bu telefon raqam allaqachon mavjud")
    data = item.model_dump()
    data["salon_id"] = salon_id
    obj = models.Client(**data)
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


@router.put("/{id}", response_model=schemas.ClientOut)
def update(id: int, item: schemas.ClientCreate, user=Depends(require_reception_or_above), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id")
    q = db.query(models.Client).filter(models.Client.id == id)
    if salon_id:
        q = q.filter(models.Client.salon_id == salon_id)
    obj = q.first()
    if not obj: raise HTTPException(404, "Topilmadi")
    for k, v in item.model_dump().items():
        setattr(obj, k, v)
    db.commit(); db.refresh(obj)
    return obj


@router.delete("/{id}")
def delete(id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id")
    q = db.query(models.Client).filter(models.Client.id == id)
    if salon_id:
        q = q.filter(models.Client.salon_id == salon_id)
    obj = q.first()
    if not obj: raise HTTPException(404, "Topilmadi")
    db.delete(obj); db.commit()
    return {"ok": True}
