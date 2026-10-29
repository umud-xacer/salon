"""
SaaS Migration: Mavjud bazaga salon_id ustunlarini qo'shish
va birinchi Salon + SuperAdmin yaratish
"""
from sqlalchemy import text
from database import engine
import models

# Default kategoriyalar
DEFAULT_CATEGORIES = [
    # Moliya daromad
    {"type": "finance_income", "name": "Xizmat daromadi", "icon": "💇"},
    {"type": "finance_income", "name": "Mahsulot sotish", "icon": "🛒"},
    # Moliya xarajat
    {"type": "finance_expense", "name": "Ijara", "icon": "🏢"},
    {"type": "finance_expense", "name": "Kommunal", "icon": "💡"},
    {"type": "finance_expense", "name": "Xomashyo", "icon": "🧴"},
    {"type": "finance_expense", "name": "Xodim maoshi", "icon": "💰"},
    {"type": "finance_expense", "name": "Boshqa", "icon": "📦"},
    # Kommunal xarajatlar (operatsion)
    {"type": "expense_operational", "name": "Elektr (Tok)", "icon": "⚡"},
    {"type": "expense_operational", "name": "Suv", "icon": "💧"},
    {"type": "expense_operational", "name": "Ijara", "icon": "🏢"},
    {"type": "expense_operational", "name": "Reklama", "icon": "📢"},
    {"type": "expense_operational", "name": "Xomashyo", "icon": "🧴"},
    {"type": "expense_operational", "name": "Boshqa", "icon": "📦"},
]

def run():
    models.Base.metadata.create_all(bind=engine)

    migrations = [
        # salon_id ustunlari
        "ALTER TABLE staff            ADD COLUMN salon_id INTEGER DEFAULT 1",
        "ALTER TABLE services         ADD COLUMN salon_id INTEGER DEFAULT 1",
        "ALTER TABLE inventory        ADD COLUMN salon_id INTEGER DEFAULT 1",
        "ALTER TABLE master_inventory ADD COLUMN salon_id INTEGER DEFAULT 1",
        "ALTER TABLE inventory_logs   ADD COLUMN salon_id INTEGER DEFAULT 1",
        "ALTER TABLE clients          ADD COLUMN salon_id INTEGER DEFAULT 1",
        "ALTER TABLE appointments     ADD COLUMN salon_id INTEGER DEFAULT 1",
        "ALTER TABLE finance          ADD COLUMN salon_id INTEGER DEFAULT 1",
        # To'lov ustunlari (appointments)
        "ALTER TABLE appointments ADD COLUMN is_paid INTEGER DEFAULT 0",
        "ALTER TABLE appointments ADD COLUMN payment_method TEXT DEFAULT 'cash'",
        "ALTER TABLE appointments ADD COLUMN discount REAL DEFAULT 0",
        "ALTER TABLE appointments ADD COLUMN final_price REAL DEFAULT 0",
        "ALTER TABLE appointments ADD COLUMN paid_at TEXT",
        "ALTER TABLE appointments ADD COLUMN checked_in_at TEXT",
        "ALTER TABLE appointments ADD COLUMN products_sold TEXT DEFAULT ''",
        # Salon yangi ustunlari
        "ALTER TABLE salons ADD COLUMN work_hours TEXT DEFAULT '09:00-20:00'",
        "ALTER TABLE salons ADD COLUMN bot_token TEXT DEFAULT ''",
        "ALTER TABLE salons ADD COLUMN admin_chat_id TEXT DEFAULT ''",
        "ALTER TABLE salons ADD COLUMN block_reason TEXT DEFAULT ''",
        "ALTER TABLE salons ADD COLUMN parent_id INTEGER",
        "ALTER TABLE transactions ADD COLUMN provider_txn_id TEXT DEFAULT ''",
        "ALTER TABLE transactions ADD COLUMN verified_at DATETIME",
        "ALTER TABLE transactions ADD COLUMN callback_payload TEXT DEFAULT ''",
    ]

    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
                print(f"✅ {sql[:60]}...")
            except Exception as e:
                print(f"⏭  O'tkazib yuborildi: {str(e)[:60]}")

    # Birinchi Salon va SuperAdmin yaratish
    from sqlalchemy.orm import sessionmaker
    from auth import hash_password
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        # Demo Salon
        if not db.query(models.Salon).first():
            salon = models.Salon(
                id=1,
                name="Demo Salon",
                slug="demo-salon",
                owner_name="Admin",
                phone="+998901234567",
                address="Toshkent",
                plan="pro",
                is_active=True,
            )
            db.add(salon)
            db.commit()
            print("✅ Demo Salon yaratildi")

        # SuperAdmin
        if not db.query(models.User).filter(models.User.username == "superadmin").first():
            su = models.User(
                salon_id=None,
                username="superadmin",
                password_hash=hash_password("admin123"),
                full_name="Super Administrator",
                role="superadmin",
                is_active=True,
            )
            db.add(su)
            db.commit()
            print("✅ SuperAdmin yaratildi → login: superadmin / admin123")

        # Demo Salon Admin
        if not db.query(models.User).filter(models.User.username == "admin").first():
            adm = models.User(
                salon_id=1,
                username="admin",
                password_hash=hash_password("salon123"),
                full_name="Salon Admin",
                role="admin",
                is_active=True,
            )
            db.add(adm)
            db.commit()
            print("✅ Admin yaratildi → login: admin / salon123")

        # Demo Reception
        if not db.query(models.User).filter(models.User.username == "reception").first():
            rec = models.User(
                salon_id=1,
                username="reception",
                password_hash=hash_password("rec123"),
                full_name="Qabulxona",
                role="reception",
                is_active=True,
            )
            db.add(rec)
            db.commit()
            print("✅ Reception yaratildi → login: reception / rec123")

        # Demo Master (Usta)
        if not db.query(models.User).filter(models.User.username == "master").first():
            # Birinchi staffni topib bog'lash
            first_staff = db.query(models.Staff).filter(models.Staff.salon_id == 1).first()
            mst = models.User(
                salon_id=1,
                username="master",
                password_hash=hash_password("master123"),
                full_name="Demo Usta",
                role="master",
                staff_id=first_staff.id if first_staff else None,
                is_active=True,
            )
            db.add(mst)
            db.commit()
            print("✅ Master yaratildi  → login: master / master123")

        # Default kategoriyalarni barcha salonlarga qo'shish
        salons = db.query(models.Salon).all()
        for salon in salons:
            existing = db.query(models.Category).filter(models.Category.salon_id == salon.id).count()
            if existing == 0:
                for cat in DEFAULT_CATEGORIES:
                    db.add(models.Category(
                        salon_id=salon.id,
                        type=cat["type"],
                        name=cat["name"],
                        icon=cat["icon"],
                        is_default=True,
                    ))
                db.commit()
                print(f"✅ '{salon.name}' uchun {len(DEFAULT_CATEGORIES)} ta default kategoriya yaratildi")

        # Default tariflarni yaratish
        if not db.query(models.Tariff).first():
            default_tariffs = [
                models.Tariff(name="Demo (3 kun)", plan="basic", price=0, duration_days=3, is_active=True),
                models.Tariff(name="1 oylik Basic", plan="basic", price=150000, duration_days=30, is_active=True),
                models.Tariff(name="1 oylik Pro", plan="pro", price=250000, duration_days=30, is_active=True),
                models.Tariff(name="3 oylik Pro", plan="pro", price=600000, duration_days=90, is_active=True),
                models.Tariff(name="1 yillik Pro", plan="pro", price=1800000, duration_days=365, is_active=True),
                models.Tariff(name="1 yillik Enterprise", plan="enterprise", price=3600000, duration_days=365, is_active=True),
            ]
            db.add_all(default_tariffs)
            db.commit()
            print("✅ 6 ta default tarif yaratildi")

        print("\n🎉 Migration muvaffaqiyatli yakunlandi!")
        print("─" * 40)
        print("👤 SuperAdmin → login: superadmin / admin123 → /superadmin/")
        print("👤 Admin      → login: admin / salon123       → /")
        print("👤 Reception  → login: reception / rec123     → /reception/")
        print("👤 Master     → login: master / master123     → /ustalar/")

    finally:
        db.close()


if __name__ == "__main__":
    run()
