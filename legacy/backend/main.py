from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import engine, get_db
from datetime import date
import models
import os

# DB jadvallarini yaratish
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="SalonPro SaaS API", version="2.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routerlar ─────────────────────────────────────────────────────────────────
from routers.auth         import router as auth_router
from routers.superadmin   import router as superadmin_router
from routers.appointments import router as appt_router
from routers.staff        import router as staff_router
from routers.services     import router as svc_router
from routers.inventory    import router as inv_router
from routers.clients      import router as clients_router
from routers.finance      import router as finance_router
from routers.master_inventory import router as master_inv_router
from routers.master       import router as master_router
from routers.admin_settings import router as admin_settings_router
from routers.billing       import router as billing_router

app.include_router(auth_router)
app.include_router(superadmin_router)
app.include_router(appt_router)
app.include_router(staff_router)
app.include_router(svc_router)
app.include_router(inv_router)
app.include_router(clients_router)
app.include_router(finance_router)
app.include_router(master_inv_router)
app.include_router(master_router)
app.include_router(admin_settings_router)
app.include_router(billing_router)


# ─── Startup: Obunalarni tekshirish ───────────────────────────────────────────
@app.on_event("startup")
def check_expired_salons():
    """Server ishga tushganda muddati o'tgan salonlarni bloklash."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        today = str(date.today())
        expired = db.query(models.Salon).filter(
            models.Salon.expires_at != None,
            models.Salon.expires_at < today,
            models.Salon.is_active == True,
        ).all()
        for s in expired:
            s.is_active = False
            try: s.block_reason = "Obuna muddati tugagan"
            except: pass
        if expired:
            db.commit()
            print(f"⚠️ {len(expired)} ta salon obunasi tugaganligi uchun bloklandi")
    except Exception as e:
        print(f"⚠️ Startup tekshiruv xatosi (zararsiz): {e}")
    finally:
        db.close()


# ─── Dashboard Stats ───────────────────────────────────────────────────────────
from auth import get_salon_id, check_salon_active

@app.get("/api/dashboard/stats")
def dashboard_stats(user=Depends(check_salon_active), salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    today = str(date.today())
    q_appt = db.query(models.Appointment)
    q_fin  = db.query(models.Finance)
    q_inv  = db.query(models.Inventory)
    if salon_id:
        q_appt = q_appt.filter(models.Appointment.salon_id == salon_id)
        q_fin  = q_fin.filter(models.Finance.salon_id == salon_id)
        q_inv  = q_inv.filter(models.Inventory.salon_id == salon_id)

    today_appts  = q_appt.filter(models.Appointment.appt_date == today).count()
    today_income = sum(f.amount for f in q_fin.filter(
        models.Finance.fin_date == today,
        models.Finance.type == "income"
    ).all())

    staff_q = db.query(models.Staff)
    client_q = db.query(models.Client)
    if salon_id:
        staff_q  = staff_q.filter(models.Staff.salon_id == salon_id)
        client_q = client_q.filter(models.Client.salon_id == salon_id)

    return {
        "today_bookings": today_appts,
        "active_staff":   staff_q.count(),
        "total_clients":  client_q.count(),
        "today_income":   today_income,
        "low_inventory":  q_inv.filter(
            models.Inventory.qty <= models.Inventory.min_qty
        ).count(),
    }


@app.get("/health")
def health():
    return {"status": "ok", "app": "SalonPro SaaS", "version": "2.0.0"}


# ─── Admin Panel uchun user yaratish (Admin tomonidan) ─────────────────────────
from auth import require_admin, hash_password
from pydantic import BaseModel

class UserCreateByAdmin(BaseModel):
    username: str
    password: str
    full_name: str = ""
    role: str = "reception"   # reception | master
    staff_id: int = None

@app.post("/api/admin/users")
def admin_create_user(data: UserCreateByAdmin, user=Depends(require_admin), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id")
    if not salon_id:
        from fastapi import HTTPException
        raise HTTPException(400, "Salon ID aniqlanmadi")
    if db.query(models.User).filter(models.User.username == data.username).first():
        from fastapi import HTTPException
        raise HTTPException(400, f"'{data.username}' allaqachon mavjud")
    new_user = models.User(
        salon_id=salon_id,
        username=data.username,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        role=data.role,
        staff_id=data.staff_id,
        is_active=True,
    )
    db.add(new_user); db.commit()
    return {"ok": True, "message": f"'{data.username}' ({data.role}) muvaffaqiyatli yaratildi"}

@app.get("/api/admin/users")
def admin_get_users(user=Depends(require_admin), db: Session = Depends(get_db)):
    salon_id = user.get("salon_id")
    q = db.query(models.User)
    if salon_id:
        q = q.filter(models.User.salon_id == salon_id)
    users = q.all()
    return [{"id": u.id, "username": u.username, "role": u.role,
             "full_name": u.full_name, "is_active": u.is_active,
             "staff_id": u.staff_id} for u in users]


# ─── Frontend fayllarni serve qilish ──────────────────────────────────────────
BASE  = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PATHS = {
    "ustalar":    os.path.join(BASE, "ustalar"),
    "login":      os.path.join(BASE, "login"),
    "superadmin": os.path.join(BASE, "superadmin"),
    "reception":  os.path.join(BASE, "reception"),
}

def _file(folder, name):
    return FileResponse(os.path.join(folder, name))

# Admin panel
@app.get("/")           
def serve_index():    return _file(BASE, "index.html")
@app.get("/app.js")   
def serve_js():       return _file(BASE, "app.js")
@app.get("/style.css")
def serve_css():      return _file(BASE, "style.css")

# Login
@app.get("/login/")
def serve_login():    return _file(PATHS["login"], "index.html")

# SuperAdmin
@app.get("/superadmin/")
def serve_superadmin(): return _file(PATHS["superadmin"], "index.html")

# Reception
@app.get("/reception/")
def serve_reception():     return _file(PATHS["reception"], "index.html")
@app.get("/reception/style.css")
def serve_reception_css(): return _file(PATHS["reception"], "style.css")
@app.get("/reception/app.js")
def serve_reception_js():  return _file(PATHS["reception"], "app.js")


# Ustalar
@app.get("/ustalar/")
def serve_ustalar():  return _file(PATHS["ustalar"], "index.html")
@app.get("/ustalar/index.html")
def serve_ustalar2(): return _file(PATHS["ustalar"], "index.html")
@app.get("/ustalar/style.css")
def serve_ustalar_css(): return _file(PATHS["ustalar"], "style.css")
@app.get("/ustalar/app.js")
def serve_ustalar_js():  return _file(PATHS["ustalar"], "app.js")
