from sqlalchemy import Column, Integer, String, Float, Boolean, Date, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from database import Base


# ─── SAAS: Salonlar ────────────────────────────────────────────────────────────
class Salon(Base):
    __tablename__ = "salons"
    id           = Column(Integer, primary_key=True, index=True)
    name         = Column(String, nullable=False)        # "Gulnora Beauty Salon"
    slug         = Column(String, unique=True)           # "gulnora-beauty"
    parent_id    = Column(Integer, ForeignKey("salons.id"), nullable=True)  # filial bo'lsa parent salon ID
    owner_name   = Column(String, default="")
    phone        = Column(String, default="")
    address      = Column(String, default="")
    plan         = Column(String, default="basic")       # basic | pro | enterprise
    work_hours   = Column(String, default="09:00-20:00") # ish vaqtlari
    bot_token    = Column(String, default="")             # Telegram Bot Token
    admin_chat_id = Column(String, default="")            # Admin Telegram Chat ID
    is_active    = Column(Boolean, default=True)
    block_reason = Column(String, default="")             # Bloklash sababi
    expires_at   = Column(String, nullable=True)         # "2025-12-31"
    created_at   = Column(DateTime, server_default=func.now())


# ─── SAAS: Foydalanuvchilar (Auth) ─────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    id            = Column(Integer, primary_key=True, index=True)
    salon_id      = Column(Integer, ForeignKey("salons.id"), nullable=True)
    username      = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    full_name     = Column(String, default="")
    role          = Column(String, nullable=False)
    # role: superadmin | admin | reception | master
    staff_id      = Column(Integer, nullable=True)     # Faqat master uchun Staff.id
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime, server_default=func.now())


# ─── Xodimlar ──────────────────────────────────────────────────────────────────
class Staff(Base):
    __tablename__ = "staff"
    id          = Column(Integer, primary_key=True, index=True)
    salon_id    = Column(Integer, ForeignKey("salons.id"), nullable=False, default=1)
    name        = Column(String, nullable=False)
    phone       = Column(String)
    role        = Column(String)
    percent     = Column(Float, default=30)
    salary      = Column(Float, default=0)
    start_date  = Column(String)
    kpi         = Column(Float, default=80)
    bio         = Column(Text, default="")
    skills      = Column(Text, default="")
    highlights  = Column(Text, default="")
    experience  = Column(Integer, default=0)
    portfolio   = Column(Text, default="")
    rating      = Column(Float, default=5.0)
    review_count = Column(Integer, default=0)
    created_at  = Column(DateTime, server_default=func.now())


# ─── Xizmatlar ─────────────────────────────────────────────────────────────────
class Service(Base):
    __tablename__ = "services"
    id       = Column(Integer, primary_key=True, index=True)
    salon_id = Column(Integer, ForeignKey("salons.id"), nullable=False, default=1)
    name     = Column(String, nullable=False)
    category = Column(String)
    price    = Column(Float, nullable=False)
    duration = Column(Integer, default=60)


# ─── Ombor ─────────────────────────────────────────────────────────────────────
class Inventory(Base):
    __tablename__ = "inventory"
    id       = Column(Integer, primary_key=True, index=True)
    salon_id = Column(Integer, ForeignKey("salons.id"), nullable=False, default=1)
    name     = Column(String, nullable=False)
    category = Column(String)
    qty      = Column(Float, default=0)
    unit     = Column(String, default="dona")
    min_qty  = Column(Float, default=3)
    price    = Column(Float, default=0)


# ─── Usta Ombori ───────────────────────────────────────────────────────────────
class MasterInventory(Base):
    __tablename__ = "master_inventory"
    id            = Column(Integer, primary_key=True, index=True)
    salon_id      = Column(Integer, ForeignKey("salons.id"), nullable=False, default=1)
    master_id     = Column(Integer, nullable=False)
    master_name   = Column(String, nullable=False)
    product_id    = Column(Integer, nullable=False)
    product_name  = Column(String, nullable=False)
    unit          = Column(String, default="dona")
    given_qty     = Column(Float, default=0)
    used_qty      = Column(Float, default=0)
    remaining_qty = Column(Float, default=0)
    min_qty       = Column(Float, default=2)
    created_at    = Column(DateTime, server_default=func.now())
    updated_at    = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ─── Ombor Loglari ─────────────────────────────────────────────────────────────
class InventoryLog(Base):
    __tablename__ = "inventory_logs"
    id           = Column(Integer, primary_key=True, index=True)
    salon_id     = Column(Integer, ForeignKey("salons.id"), nullable=False, default=1)
    master_id    = Column(Integer)
    master_name  = Column(String)
    product_id   = Column(Integer)
    product_name = Column(String)
    action       = Column(String)   # given | used | returned
    quantity     = Column(Float)
    note         = Column(Text, default="")
    log_date     = Column(String)
    created_at   = Column(DateTime, server_default=func.now())


# ─── Mijozlar ──────────────────────────────────────────────────────────────────
class Client(Base):
    __tablename__ = "clients"
    id       = Column(Integer, primary_key=True, index=True)
    salon_id = Column(Integer, ForeignKey("salons.id"), nullable=False, default=1)
    name     = Column(String, nullable=False)
    phone    = Column(String, index=True)
    prefs    = Column(String, default="")
    visits   = Column(Integer, default=0)
    bonus    = Column(Float, default=0)
    source   = Column(String, default="admin")
    note     = Column(Text, default="")
    birthday = Column(String, default="")
    created_at = Column(DateTime, server_default=func.now())


# ─── Bronlar ───────────────────────────────────────────────────────────────────
class Appointment(Base):
    __tablename__ = "appointments"
    id              = Column(Integer, primary_key=True, index=True)
    salon_id        = Column(Integer, ForeignKey("salons.id"), nullable=False, default=1)
    client_name     = Column(String, nullable=False)
    client_phone    = Column(String)
    service         = Column(String)
    master          = Column(String)
    staff_id        = Column(Integer, default=0)
    appt_date       = Column(String, nullable=False)
    appt_time       = Column(String, nullable=False)
    price           = Column(Float, default=0)
    note            = Column(Text, default="")
    source          = Column(String, default="admin")
    status          = Column(String, default="pending")
    # ─── To'lov ───────────────────────────────────────────────────────
    is_paid         = Column(Boolean, default=False)
    payment_method  = Column(String, default="cash")   # cash | card | click | payme
    discount        = Column(Float, default=0)         # chegirma (so'm)
    final_price     = Column(Float, default=0)         # chegirmadan keyin
    paid_at         = Column(String, nullable=True)    # to'lov vaqti
    # ─── Check-in ─────────────────────────────────────────────────────
    checked_in_at   = Column(String, nullable=True)    # mijoz kelgan vaqt
    products_sold   = Column(Text, default="")         # JSON: [{id,name,qty,price}]
    created_at      = Column(DateTime, server_default=func.now())


# ─── Moliya ────────────────────────────────────────────────────────────────────
class Finance(Base):
    __tablename__ = "finance"
    id       = Column(Integer, primary_key=True, index=True)
    salon_id = Column(Integer, ForeignKey("salons.id"), nullable=False, default=1)
    type     = Column(String, nullable=False)   # income | expense
    category = Column(String)
    amount   = Column(Float, nullable=False)
    note     = Column(Text, default="")
    fin_date = Column(String)
    created_at = Column(DateTime, server_default=func.now())


# ─── Aktivlik Tarixi (Audit Log) ──────────────────────────────────────────────
class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id          = Column(Integer, primary_key=True, index=True)
    salon_id    = Column(Integer, ForeignKey("salons.id"), nullable=True)
    user_id     = Column(Integer, nullable=True)
    username    = Column(String, default="")
    full_name   = Column(String, default="")
    role        = Column(String, default="")        # admin | reception | master
    action      = Column(String, nullable=False)    # login | logout | create | update | delete
    entity_type = Column(String, default="")        # appointment | staff | inventory | finance | settings
    entity_id   = Column(Integer, nullable=True)
    description = Column(Text, default="")          # "Reception xodimi 14:00 dagi bronni o'chirdi"
    ip_address  = Column(String, default="")
    created_at  = Column(DateTime, server_default=func.now())


# ─── Bildirishnomalar ─────────────────────────────────────────────────────────
class Notification(Base):
    __tablename__ = "notifications"
    id          = Column(Integer, primary_key=True, index=True)
    salon_id    = Column(Integer, ForeignKey("salons.id"), nullable=True)
    type        = Column(String, default="info")    # info | warning | success | booking | inventory | finance
    title       = Column(String, default="")
    message     = Column(Text, default="")
    icon        = Column(String, default="🔔")
    is_read     = Column(Boolean, default=False)
    link        = Column(String, default="")        # navigate target: "dashboard", "services" etc.
    created_at  = Column(DateTime, server_default=func.now())


# ─── Kategoriyalar (Admin boshqaruvi) ─────────────────────────────────────────
class Category(Base):
    __tablename__ = "categories"
    id        = Column(Integer, primary_key=True, index=True)
    salon_id  = Column(Integer, ForeignKey("salons.id"), nullable=False)
    type      = Column(String, nullable=False)     # finance_income | finance_expense | expense_operational | service
    name      = Column(String, nullable=False)     # "Xizmat daromadi", "Tok", "Suv"
    icon      = Column(String, default="📁")
    is_default = Column(Boolean, default=False)    # Tizimdan kelgan (o'chirish mumkin emas)
    created_at = Column(DateTime, server_default=func.now())


# ─── Tariflar ─────────────────────────────────────────────────────────────────
class Tariff(Base):
    __tablename__ = "tariffs"
    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String, nullable=False)          # "1 oylik PRO"
    plan          = Column(String, default="pro")           # basic | pro | enterprise
    price         = Column(Float, default=0)                # 200000 so'm
    duration_days = Column(Integer, default=30)              # 30, 90, 365
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime, server_default=func.now())


# ─── To'lovlar tarixi ─────────────────────────────────────────────────────────
class Transaction(Base):
    __tablename__ = "transactions"
    id            = Column(Integer, primary_key=True, index=True)
    salon_id      = Column(Integer, ForeignKey("salons.id"), nullable=False)
    tariff_id     = Column(Integer, ForeignKey("tariffs.id"), nullable=True)
    amount        = Column(Float, default=0)
    provider      = Column(String, default="manual")        # click | payme | manual
    status        = Column(String, default="pending")       # pending | completed | failed
    tariff_name   = Column(String, default="")              # "1 oylik PRO"
    duration_days = Column(Integer, default=30)
    note          = Column(String, default="")
    provider_txn_id = Column(String, default="")         # Click/Payme transaction id
    verified_at   = Column(DateTime, nullable=True)      # provayder tasdiqlagan vaqt
    callback_payload = Column(Text, default="")          # callback body (audit)
    created_at    = Column(DateTime, server_default=func.now())


# ─── Tizim Sozlamalari (SuperAdmin global) ────────────────────────────────────
class SystemSettings(Base):
    __tablename__ = "system_settings"
    id    = Column(Integer, primary_key=True, index=True)
    key   = Column(String, unique=True, nullable=False)
    value = Column(Text, default="")


