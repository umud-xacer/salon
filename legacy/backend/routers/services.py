from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from auth import get_salon_id, require_admin
import models, schemas

router = APIRouter(prefix="/api/services", tags=["services"])


@router.get("/", response_model=list[schemas.ServiceOut])
def get_all(salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    q = db.query(models.Service)
    if salon_id:
        q = q.filter(models.Service.salon_id == salon_id)
    return q.all()


@router.post("/", response_model=schemas.ServiceOut)
def create(item: schemas.ServiceCreate, user=Depends(require_admin), db: Session = Depends(get_db)):
    data = item.model_dump()
    data["salon_id"] = user.get("salon_id") or 1
    obj = models.Service(**data)
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


@router.put("/{id}", response_model=schemas.ServiceOut)
def update(id: int, item: schemas.ServiceCreate, user=Depends(require_admin), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id")
    q = db.query(models.Service).filter(models.Service.id == id)
    if salon_id:
        q = q.filter(models.Service.salon_id == salon_id)
    obj = q.first()
    if not obj: raise HTTPException(404, "Topilmadi")
    for k, v in item.model_dump().items():
        setattr(obj, k, v)
    db.commit(); db.refresh(obj)
    return obj


@router.delete("/{id}")
def delete(id: int, user=Depends(require_admin), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id")
    q = db.query(models.Service).filter(models.Service.id == id)
    if salon_id:
        q = q.filter(models.Service.salon_id == salon_id)
    obj = q.first()
    if not obj: raise HTTPException(404, "Topilmadi")
    db.delete(obj); db.commit()
    return {"ok": True}
