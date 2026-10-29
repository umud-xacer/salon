"""
Mavjud salonpro.db ga yangi ustunlar va jadvallar qo'shish (migration v2)
Faqat bir marta ishga tushiriladi.
"""
import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "salonpro.db")
conn = sqlite3.connect(db_path)
cur = conn.cursor()

print("=" * 50)
print("SalonPro DB Migration v2")
print("=" * 50)

# 1) Staff jadvalidagi yangi ustunlar
staff_columns = [
    ("bio",          "TEXT DEFAULT ''"),
    ("skills",       "TEXT DEFAULT ''"),
    ("highlights",   "TEXT DEFAULT ''"),
    ("experience",   "INTEGER DEFAULT 0"),
    ("portfolio",    "TEXT DEFAULT ''"),
    ("rating",       "REAL DEFAULT 5.0"),
    ("review_count", "INTEGER DEFAULT 0"),
]

print("\n[1] Staff jadvaliga yangi ustunlar...")
for col, col_def in staff_columns:
    try:
        cur.execute(f"ALTER TABLE staff ADD COLUMN {col} {col_def}")
        print(f"  ✅  Qo'shildi: {col}")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            print(f"  ⏩  Mavjud:   {col}")
        else:
            print(f"  ❌  Xato ({col}): {e}")

# 2) master_inventory jadvali
print("\n[2] master_inventory jadvali yaratilmoqda...")
cur.execute("""
CREATE TABLE IF NOT EXISTS master_inventory (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    master_id       INTEGER NOT NULL,
    master_name     TEXT NOT NULL,
    product_id      INTEGER NOT NULL,
    product_name    TEXT NOT NULL,
    unit            TEXT DEFAULT 'dona',
    given_qty       REAL DEFAULT 0,
    used_qty        REAL DEFAULT 0,
    remaining_qty   REAL DEFAULT 0,
    min_qty         REAL DEFAULT 2,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)
""")
print("  ✅  master_inventory tayyor")

# 3) inventory_logs jadvali
print("\n[3] inventory_logs jadvali yaratilmoqda...")
cur.execute("""
CREATE TABLE IF NOT EXISTS inventory_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    master_id    INTEGER,
    master_name  TEXT,
    product_id   INTEGER,
    product_name TEXT,
    action       TEXT,
    quantity     REAL,
    note         TEXT DEFAULT '',
    log_date     TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)
""")
print("  ✅  inventory_logs tayyor")

# 4) Demo master inventory ma'lumotlari
print("\n[4] Demo master inventory ma'lumotlari...")
cur.execute("SELECT COUNT(*) FROM master_inventory")
count = cur.fetchone()[0]

if count == 0:
    from datetime import date
    today = str(date.today())

    # Ustalar va mahsulotlar ID larini olish
    cur.execute("SELECT id, name FROM staff LIMIT 4")
    staff = cur.fetchall()
    cur.execute("SELECT id, name, unit FROM inventory LIMIT 4")
    products = cur.fetchall()

    if staff and products:
        demo_data = []
        for i, (s_id, s_name) in enumerate(staff):
            for j, (p_id, p_name, p_unit) in enumerate(products[:2]):  # har ustaga 2 mahsulot
                given = 3 + (i + j) % 3
                used = given - (1 + i % 2)
                demo_data.append((
                    s_id, s_name, p_id, p_name, p_unit or 'dona',
                    given, used, given - used, 2
                ))

        cur.executemany("""
            INSERT INTO master_inventory
            (master_id, master_name, product_id, product_name, unit, given_qty, used_qty, remaining_qty, min_qty)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, demo_data)

        # Loglar
        for s_id, s_name, p_id, p_name, *_ in demo_data:
            cur.execute("""
                INSERT INTO inventory_logs
                (master_id, master_name, product_id, product_name, action, quantity, note, log_date)
                VALUES (?, ?, ?, ?, 'given', 3, 'Demo data', ?)
            """, (s_id, s_name, p_id, p_name, today))

        print(f"  ✅  {len(demo_data)} ta demo yozuv qo'shildi")
    else:
        print("  ⚠   Staff yoki inventory bo'sh — demo skip")
else:
    print(f"  ⏩  Allaqachon {count} ta yozuv bor")

conn.commit()
conn.close()
print("\n" + "=" * 50)
print("Migration muvaffaqiyatli tugadi! ✅")
print("=" * 50)
