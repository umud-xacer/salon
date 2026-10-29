"""Dev bazaga demo bizneslar (Toshkent) qo'shadi — API orqali, ya'ni barcha tekshiruvlardan o'tib.
Faqat ENV=dev da ishlaydi.  Ishlatish:  python -m scripts.seed_demo
"""
import sys

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

SUPERADMIN = ("+998900000001", "SuperPass123")

BUSINESSES = [
    ("Barber Lab", "barber-lab", 2, 41.3111, 69.2797, "Amir Temur ko'chasi 15",
     [("Soch turmagi", 30, 70000), ("Soqol olish", 20, 40000), ("Soch + soqol", 45, 100000)],
     [("Jasur Karimov", "Barber"), ("Bekzod Aliyev", "Barber")]),
    ("Gulnoza Beauty", "gulnoza-beauty", 1, 41.3265, 69.2285, "Chilonzor 9-kvartal",
     [("Manikyur", 60, 80000), ("Pedikyur", 75, 120000), ("Qosh dizayni", 30, 50000)],
     [("Gulnoza Rahimova", "Manikyur ustasi"), ("Dilnoza Xasanova", "Kosmetolog")]),
    ("Smile Dental", "smile-dental", 4, 41.2995, 69.2401, "Mustaqillik maydoni yaqinida",
     [("Ko'rik", 30, 100000), ("Tish tozalash", 60, 300000)],
     [("Dr. Sardor Umarov", "Stomatolog")]),
    ("Relax SPA", "relax-spa", 5, 41.2856, 69.2044, "Bunyodkor ko'chasi 7",
     [("Klassik massaj", 60, 250000), ("Hammom", 90, 300000)],
     [("Madina Yusupova", "Massajchi")]),
]


def otp_login(c, phone):
    code = c.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_code"]
    return {"Authorization": "Bearer " + c.post("/api/v1/auth/otp/verify",
                                                json={"phone": phone, "code": code}).json()["access_token"]}


def main():
    if get_settings().env != "dev":
        sys.exit("Faqat ENV=dev")
    c = TestClient(app)
    sa = c.post("/api/v1/auth/login", json={"phone": SUPERADMIN[0], "password": SUPERADMIN[1]})
    sa.raise_for_status()
    sa_h = {"Authorization": "Bearer " + sa.json()["access_token"]}

    for i, (name, slug, cat, lat, lng, addr, services, staff) in enumerate(BUSINESSES):
        owner_phone = f"+99890100000{i}"
        r = c.post("/api/v1/superadmin/businesses", headers=sa_h, json={
            "name": name, "slug": slug, "category_id": cat, "city": "Toshkent", "address": addr,
            "lat": lat, "lng": lng, "owner_phone": owner_phone, "owner_full_name": f"{name} egasi"})
        if r.status_code == 409:
            print(f"bor: {name}")
            continue
        r.raise_for_status()
        bid = r.json()["id"]
        h = otp_login(c, owner_phone)
        base = f"/api/v1/businesses/{bid}"
        c.patch(f"{base}/profile", headers=h, json={"description": f"{name} — Toshkentdagi ishonchli maskan",
                                                    "phone": f"+99871200000{i}"}).raise_for_status()
        c.put(f"{base}/hours", headers=h, json={"days": [
            {"weekday": d, "opens_at": "09:00", "closes_at": "21:00"} for d in range(1, 7)]}).raise_for_status()
        sids = []
        for sname, dur, price in services:
            r = c.post(f"{base}/services", headers=h, json={"name": sname, "duration_min": dur, "price": price})
            r.raise_for_status()
            sids.append(r.json()["id"])
        for j, (full_name, title) in enumerate(staff):
            r = c.post(f"{base}/members", headers=h, json={
                "phone": f"+99893{i}{j:06d}", "full_name": full_name, "role": "staff", "title": title})
            r.raise_for_status()
            c.put(f"{base}/members/{r.json()['id']}/services", headers=h,
                  json={"services": [{"service_id": s} for s in sids]}).raise_for_status()
        print(f"qo'shildi: {name} (egasi {owner_phone})")


if __name__ == "__main__":
    main()
