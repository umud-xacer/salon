"""
Admin Settings Router: Profil, Salon sozlamalari, Bildirishnomalar, Aktivlik Tarixi
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel
from typing import Optional
from database import get_db
from auth import get_current_user, require_admin, hash_password, verify_password, get_salon_id
import models

router = APIRouter(prefix="/api/admin", tags=["admin-settings"])


# ═══════════════════════════════════════════════════════════════════════════════
# UTILITY: Aktivlik logi yozish
# ═══════════════════════════════════════════════════════════════════════════════
def log_activity(
    db: Session,
    user: dict,
    action: str,
    entity_type: str = "",
    entity_id: int = None,
    description: str = "",
    ip_address: str = "",
):
    """Har bir muhim amalni logga yozish."""
    log = models.ActivityLog(
        salon_id=user.get("salon_id"),
        user_id=user.get("user_id"),
        username=user.get("username", ""),
        full_name=user.get("full_name", ""),
        role=user.get("role", ""),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        description=description,
        ip_address=ip_address,
    )
    db.add(log)
    db.commit()


def add_notification(
    db: Session,
    salon_id: int,
    type: str,
    title: str,
    message: str,
    icon: str = "🔔",
    link: str = "",
):
    """Bildirishnoma qo'shish."""
    notif = models.Notification(
        salon_id=salon_id,
        type=type,
        title=title,
        message=message,
        icon=icon,
        link=link,
    )
    db.add(notif)
    db.commit()
    return notif


# ═══════════════════════════════════════════════════════════════════════════════
# 1. PROFIL — Parol o'zgartirish
# ═══════════════════════════════════════════════════════════════════════════════
class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

@router.post("/change-password")
def change_password(
    data: ChangePasswordRequest,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db_user = db.query(models.User).filter(models.User.id == user["user_id"]).first()
    if not db_user:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    if not verify_password(data.old_password, db_user.password_hash):
        raise HTTPException(400, "Eski parol noto'g'ri")
    if len(data.new_password) < 6:
        raise HTTPException(400, "Yangi parol kamida 6 belgi bo'lishi kerak")
    db_user.password_hash = hash_password(data.new_password)
    db.commit()
    log_activity(db, user, "update", "password", db_user.id, f"{user.get('full_name','')} parolini o'zgartirdi")
    return {"ok": True, "message": "Parol muvaffaqiyatli o'zgartirildi ✅"}


# ═══════════════════════════════════════════════════════════════════════════════
# 2. PROFIL — Admin ismini yangilash
# ═══════════════════════════════════════════════════════════════════════════════
class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None

@router.put("/profile")
def update_profile(
    data: UpdateProfileRequest,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db_user = db.query(models.User).filter(models.User.id == user["user_id"]).first()
    if not db_user:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    if data.full_name is not None:
        old_name = db_user.full_name
        db_user.full_name = data.full_name
        log_activity(db, user, "update", "profile", db_user.id,
                     f"Ism o'zgartirildi: '{old_name}' → '{data.full_name}'")
    db.commit()
    return {"ok": True, "message": "Profil yangilandi", "full_name": db_user.full_name}


# ═══════════════════════════════════════════════════════════════════════════════
# 3. SALON SOZLAMALARI
# ═══════════════════════════════════════════════════════════════════════════════
class SalonSettingsRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    work_hours: Optional[str] = None
    bot_token: Optional[str] = None
    admin_chat_id: Optional[str] = None

@router.get("/salon-settings")
def get_salon_settings(
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    salon_id = user.get("salon_id")
    if not salon_id:
        raise HTTPException(400, "Salon topilmadi")
    salon = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
    if not salon:
        raise HTTPException(404, "Salon topilmadi")
    return {
        "id": salon.id,
        "name": salon.name,
        "phone": salon.phone or "",
        "address": salon.address or "",
        "work_hours": salon.work_hours or "09:00-20:00",
        "plan": salon.plan,
        "owner_name": salon.owner_name or "",
        "bot_token": salon.bot_token or "",
        "admin_chat_id": salon.admin_chat_id or "",
    }

@router.put("/salon-settings")
def update_salon_settings(
    data: SalonSettingsRequest,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    salon_id = user.get("salon_id")
    salon = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
    if not salon:
        raise HTTPException(404, "Salon topilmadi")

    changes = []
    if data.name is not None and data.name != salon.name:
        changes.append(f"Nomi: '{salon.name}' → '{data.name}'")
        salon.name = data.name
    if data.phone is not None and data.phone != salon.phone:
        changes.append(f"Telefon: '{salon.phone}' → '{data.phone}'")
        salon.phone = data.phone
    if data.address is not None and data.address != salon.address:
        changes.append(f"Manzil: '{salon.address}' → '{data.address}'")
        salon.address = data.address
    if data.work_hours is not None and data.work_hours != salon.work_hours:
        changes.append(f"Ish vaqti: '{salon.work_hours}' → '{data.work_hours}'")
        salon.work_hours = data.work_hours
    if data.bot_token is not None and data.bot_token != (salon.bot_token or ""):
        changes.append("Bot token yangilandi")
        salon.bot_token = data.bot_token
    if data.admin_chat_id is not None and data.admin_chat_id != (salon.admin_chat_id or ""):
        changes.append(f"Admin Chat ID: '{data.admin_chat_id}'")
        salon.admin_chat_id = data.admin_chat_id

    db.commit()
    if changes:
        log_activity(db, user, "update", "settings", salon.id,
                     f"Salon sozlamalari yangilandi: {'; '.join(changes)}")
    return {"ok": True, "message": "Salon sozlamalari saqlandi ✅"}


# ════════════════ TELEGRAM BOT TEST ════════════════
@router.post("/test-telegram")
def test_telegram(
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Telegram bot ulanishini tekshirish."""
    salon_id = user.get("salon_id")
    salon = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
    if not salon or not salon.bot_token or not salon.admin_chat_id:
        raise HTTPException(400, "Bot token yoki Chat ID kiritilmagan")
    from telegram_bot import send_telegram_sync
    msg = f"✅ <b>SalonPro — Telegram Ulanish Testi</b>\n\n🏢 Salon: {salon.name}\n💬 Test xabari muvaffaqiyatli yuborildi!"
    ok = send_telegram_sync(salon.bot_token, salon.admin_chat_id, msg)
    if ok:
        return {"ok": True, "message": "✅ Telegram xabari muvaffaqiyatli yuborildi!"}
    raise HTTPException(400, "Telegram xabar yuborilmadi. Token va Chat ID ni tekshiring.")


# ════════════════ XODIM PAROLINI YANGILASH (Admin uchun) ════════════════
class ResetStaffPasswordRequest(BaseModel):
    user_id: int
    new_password: str

@router.post("/reset-staff-password")
def reset_staff_password(
    data: ResetStaffPasswordRequest,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin o'z salonidagi xodim parolini o'zgartirishi."""
    salon_id = user.get("salon_id")
    target = db.query(models.User).filter(models.User.id == data.user_id).first()
    if not target:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    # Admin faqat o'z saloni xodimini o'zgartira oladi
    if target.salon_id != salon_id:
        raise HTTPException(403, "Boshqa salon xodimini o'zgartira olmaysiz")
    # Admin boshqa adminni o'zgartira olmaydi
    if target.role in ("admin", "superadmin"):
        raise HTTPException(403, "Admin/SuperAdmin parolini bu yerda o'zgartira olmaysiz")
    if len(data.new_password) < 6:
        raise HTTPException(400, "Parol kamida 6 belgi bo'lishi kerak")
    target.password_hash = hash_password(data.new_password)
    db.commit()
    log_activity(db, user, "update", "user_password", target.id,
                 f"Admin '{target.username}' ({target.role}) parolini yangiladi")
    return {"ok": True, "message": f"✅ {target.full_name or target.username} paroli yangilandi"}


@router.get("/salon-users")
def get_salon_users(
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin o'z salonidagi barcha foydalanuvchilarni ko'rishi."""
    salon_id = user.get("salon_id")
    users = db.query(models.User).filter(models.User.salon_id == salon_id).all()
    return [{
        "id": u.id, "username": u.username, "full_name": u.full_name,
        "role": u.role, "is_active": u.is_active, "staff_id": u.staff_id,
    } for u in users]


class CreateUserRequest(BaseModel):
    username: str
    password: str
    full_name: str = ""
    role: str = "master"
    staff_id: Optional[int] = None


class BranchCreateRequest(BaseModel):
    name: str
    phone: str = ""
    address: str = ""
    owner_name: str = ""
    work_hours: str = "09:00-20:00"

@router.post("/create-user")
def create_user(
    data: CreateUserRequest,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin yangi foydalanuvchi qo'shishi."""
    salon_id = user.get("salon_id")
    if data.role in ("admin", "superadmin"):
        raise HTTPException(403, "Admin/SuperAdmin yaratish mumkin emas")
    if db.query(models.User).filter(models.User.username == data.username).first():
        raise HTTPException(400, f"'{data.username}' allaqachon mavjud")
    if len(data.password) < 6:
        raise HTTPException(400, "Parol kamida 6 belgi")
    new_user = models.User(
        salon_id=salon_id, username=data.username,
        password_hash=hash_password(data.password),
        full_name=data.full_name, role=data.role,
        staff_id=data.staff_id, is_active=True,
    )
    db.add(new_user); db.commit()
    log_activity(db, user, "create", "user", new_user.id,
                 f"Yangi foydalanuvchi: {data.username} ({data.role})")
    return {"ok": True, "message": f"✅ {data.full_name or data.username} qo'shildi"}


@router.get("/branches")
def get_branches(
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin o'z saloniga bog'langan filiallarni ko'radi."""
    salon_id = user.get("salon_id")
    if not salon_id:
        raise HTTPException(400, "Salon topilmadi")
    rows = db.query(models.Salon).filter(models.Salon.parent_id == salon_id).order_by(models.Salon.id.desc()).all()
    return [{
        "id": b.id,
        "name": b.name,
        "phone": b.phone or "",
        "address": b.address or "",
        "owner_name": b.owner_name or "",
        "plan": b.plan,
        "is_active": b.is_active,
        "expires_at": b.expires_at or "",
        "parent_id": b.parent_id,
    } for b in rows]


@router.post("/branches")
def create_branch(
    data: BranchCreateRequest,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin dashboard: 'Filial qo'shish'."""
    salon_id = user.get("salon_id")
    parent = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
    if not parent:
        raise HTTPException(404, "Asosiy salon topilmadi")
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(400, "Filial nomi bo'sh bo'lmasin")

    slug_base = name.lower().replace(" ", "-").replace("'", "")
    slug = slug_base or f"branch-{salon_id}"
    idx = 1
    while db.query(models.Salon).filter(models.Salon.slug == slug).first():
        idx += 1
        slug = f"{slug_base}-{idx}" if slug_base else f"branch-{salon_id}-{idx}"

    branch = models.Salon(
        name=name,
        slug=slug,
        parent_id=parent.id,
        owner_name=data.owner_name or parent.owner_name,
        phone=data.phone or parent.phone,
        address=data.address or "",
        plan=parent.plan,
        work_hours=data.work_hours or parent.work_hours or "09:00-20:00",
        bot_token=parent.bot_token or "",
        admin_chat_id=parent.admin_chat_id or "",
        is_active=parent.is_active,
        expires_at=parent.expires_at,
    )
    db.add(branch)
    db.commit()
    db.refresh(branch)

    log_activity(
        db,
        user,
        "create",
        "branch",
        branch.id,
        f"Yangi filial yaratildi: {branch.name} (parent salon: {parent.name})",
    )
    return {
        "ok": True,
        "branch_id": branch.id,
        "parent_id": parent.id,
        "message": f"✅ '{branch.name}' filiali yaratildi",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 4. BILDIRISHNOMALAR (Notifications)
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/notifications")
def get_notifications(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    salon_id = user.get("salon_id")
    q = db.query(models.Notification).order_by(desc(models.Notification.created_at))
    if salon_id:
        q = q.filter(models.Notification.salon_id == salon_id)
    notifs = q.limit(50).all()
    return [{
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "message": n.message,
        "icon": n.icon,
        "is_read": n.is_read,
        "link": n.link,
        "created_at": str(n.created_at) if n.created_at else "",
    } for n in notifs]


@router.get("/notifications/unread-count")
def get_unread_count(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    salon_id = user.get("salon_id")
    q = db.query(models.Notification).filter(models.Notification.is_read == False)
    if salon_id:
        q = q.filter(models.Notification.salon_id == salon_id)
    return {"count": q.count()}


@router.patch("/notifications/{notif_id}/read")
def mark_notification_read(
    notif_id: int,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notif = db.query(models.Notification).filter(models.Notification.id == notif_id).first()
    if notif:
        notif.is_read = True
        db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    salon_id = user.get("salon_id")
    q = db.query(models.Notification).filter(models.Notification.is_read == False)
    if salon_id:
        q = q.filter(models.Notification.salon_id == salon_id)
    q.update({"is_read": True})
    db.commit()
    return {"ok": True, "message": "Barcha bildirishnomalar o'qildi"}


@router.delete("/notifications/clear")
def clear_notifications(
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    salon_id = user.get("salon_id")
    q = db.query(models.Notification)
    if salon_id:
        q = q.filter(models.Notification.salon_id == salon_id)
    q.delete()
    db.commit()
    return {"ok": True, "message": "Barcha bildirishnomalar tozalandi"}


# ═══════════════════════════════════════════════════════════════════════════════
# 5. AKTIVLIK TARIXI (Activity Logs)
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/activity-logs")
def get_activity_logs(
    limit: int = 100,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    salon_id = user.get("salon_id")
    q = db.query(models.ActivityLog).order_by(desc(models.ActivityLog.created_at))
    if salon_id:
        q = q.filter(models.ActivityLog.salon_id == salon_id)
    logs = q.limit(limit).all()
    return [
        {
            "id": l.id,
            "username": l.username,
            "full_name": l.full_name,
            "role": l.role,
            "action": l.action,
            "entity_type": l.entity_type,
            "entity_id": l.entity_id,
            "description": l.description,
            "ip_address": l.ip_address,
            "created_at": str(l.created_at) if l.created_at else "",
        }
        for l in logs
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# 6. OMBOR KAMLIGI TEKSHIRISH (Low Stock Check)
# ═══════════════════════════════════════════════════════════════════════════════
@router.post("/check-low-stock")
def check_low_stock(
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Ombordagi kam qolgan mahsulotlarni tekshirib bildirishnoma yaratadi."""
    salon_id = user.get("salon_id")
    q = db.query(models.Inventory).filter(
        models.Inventory.qty <= models.Inventory.min_qty,
    )
    if salon_id:
        q = q.filter(models.Inventory.salon_id == salon_id)
    low_items = q.all()
    created = 0
    for item in low_items:
        recent = db.query(models.Notification).filter(
            models.Notification.salon_id == (salon_id or item.salon_id),
            models.Notification.type == "inventory",
            models.Notification.title.ilike(f"%{item.name}%"),
            models.Notification.is_read == False,
        ).first()
        if not recent:
            notif = models.Notification(
                salon_id=salon_id or item.salon_id,
                type="inventory",
                title=f"Skladda {item.name} tugab qolmoqda!",
                message=f"Qolgan: {item.qty} {item.unit} (Minimum: {item.min_qty} {item.unit})",
                icon="⚠️",
                link="services",
            )
            db.add(notif)
            created += 1
    db.commit()
    return {"ok": True, "low_stock_count": len(low_items), "notifications_created": created}


# ═══════════════════════════════════════════════════════════════════════════════
# 7. KATEGORIYALAR BOSHQARUVI
# ═══════════════════════════════════════════════════════════════════════════════
DEFAULT_CATS = [
    {"type": "finance_income", "name": "Xizmat daromadi", "icon": "💇"},
    {"type": "finance_income", "name": "Mahsulot sotish", "icon": "🛒"},
    {"type": "finance_expense", "name": "Ijara", "icon": "🏢"},
    {"type": "finance_expense", "name": "Kommunal", "icon": "💡"},
    {"type": "finance_expense", "name": "Xomashyo", "icon": "🧴"},
    {"type": "finance_expense", "name": "Xodim maoshi", "icon": "💰"},
    {"type": "finance_expense", "name": "Boshqa", "icon": "📦"},
    {"type": "expense_operational", "name": "Elektr (Tok)", "icon": "⚡"},
    {"type": "expense_operational", "name": "Suv", "icon": "💧"},
    {"type": "expense_operational", "name": "Ijara", "icon": "🏢"},
    {"type": "expense_operational", "name": "Reklama", "icon": "📢"},
    {"type": "expense_operational", "name": "Xomashyo", "icon": "🧴"},
    {"type": "expense_operational", "name": "Boshqa", "icon": "📦"},
]


@router.get("/categories")
def get_categories(
    cat_type: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Salon kategoriyalarini olish. cat_type: finance_income|finance_expense|expense_operational"""
    salon_id = user.get("salon_id")
    if not salon_id:
        return []
    # Agar hali yo'q bo'lsa, default yaratish
    count = db.query(models.Category).filter(models.Category.salon_id == salon_id).count()
    if count == 0:
        for c in DEFAULT_CATS:
            db.add(models.Category(salon_id=salon_id, type=c["type"], name=c["name"], icon=c["icon"], is_default=True))
        db.commit()
    q = db.query(models.Category).filter(models.Category.salon_id == salon_id)
    if cat_type:
        q = q.filter(models.Category.type == cat_type)
    cats = q.order_by(models.Category.id).all()
    return [{"id": c.id, "type": c.type, "name": c.name, "icon": c.icon, "is_default": c.is_default} for c in cats]


class CategoryCreate(BaseModel):
    type: str      # finance_income | finance_expense | expense_operational
    name: str
    icon: str = "📁"


@router.post("/categories")
def create_category(
    data: CategoryCreate,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    salon_id = user.get("salon_id")
    if not data.name.strip():
        raise HTTPException(400, "Kategoriya nomi bo'sh bo'lmasin")
    cat = models.Category(
        salon_id=salon_id,
        type=data.type,
        name=data.name.strip(),
        icon=data.icon,
        is_default=False,
    )
    db.add(cat); db.commit(); db.refresh(cat)
    log_activity(db, user, "create", "category", cat.id, f"Kategoriya qo'shildi: {cat.name} ({cat.type})")
    return {"ok": True, "id": cat.id, "message": f"✅ '{cat.name}' kategoriyasi qo'shildi"}


@router.delete("/categories/{cat_id}")
def delete_category(
    cat_id: int,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    salon_id = user.get("salon_id")
    cat = db.query(models.Category).filter(
        models.Category.id == cat_id,
        models.Category.salon_id == salon_id,
    ).first()
    if not cat:
        raise HTTPException(404, "Kategoriya topilmadi")
    name = cat.name
    db.delete(cat); db.commit()
    log_activity(db, user, "delete", "category", cat_id, f"Kategoriya o'chirildi: {name}")
    return {"ok": True, "message": f"🗑 '{name}' kategoriyasi o'chirildi"}

