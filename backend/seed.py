from datetime import date
import models


def seed_db(db):
    # Agar allaqachon ma'lumot bo'lsa, qayta seed qilmaslik
    if db.query(models.Staff).count() > 0:
        return

    today = str(date.today())

    # Staff
    staff_list = [
        models.Staff(
            name="Dilnoza Xasanova", phone="+998901111111",
            role="Soch bo'yash ustasi", percent=35, salary=2500000,
            start_date="2023-03-15", kpi=88,
            bio="5 yillik tajribaga ega soch bo'yash mutaxassisi. Evropa texnikalarida malakali.",
            skills="Soch qirqish,Soch bo'yash,Oshirib bo'yash,Soch to'lqinlash,Pleyok",
            highlights="Kreativ va balayaj bo'yash bo'yicha ekspert. Har bir rang individual tanlash uslubida.",
            experience=5, rating=4.9, review_count=87
        ),
        models.Staff(
            name="Nasiba Mirzayeva", phone="+998902222222",
            role="Manikyur ustasi", percent=30, salary=2000000,
            start_date="2023-06-01", kpi=92,
            bio="Manikyur va pedikyur sohasida 3 yillik tajriba. Gel-lak texnikasida ixtisoslashgan.",
            skills="Manikyur,Pedikyur,Gel-lak,Nail-art,Qo'llar massaji",
            highlights="Nail-art dizayn va 3D bezak bo'yicha yuqori malakali specialist.",
            experience=3, rating=4.8, review_count=64
        ),
        models.Staff(
            name="Kamola Ergasheva", phone="+998903333333",
            role="Kosmetolog", percent=40, salary=3000000,
            start_date="2022-11-20", kpi=75,
            bio="Tibbiy kosmetologiya va teri parvarishi mutaxassisi. 6 yillik klinik tajriba.",
            skills="Yuz tozalash,Teri massaji,Mezoterapiya,Botoks,Ko'z atrofi parvarishi",
            highlights="Muammoli teri va akne davolash bo'yicha tibbiy kosmetolog.",
            experience=6, rating=4.7, review_count=112
        ),
        models.Staff(
            name="Shahlo Tursunova", phone="+998904444444",
            role="Vizajist", percent=32, salary=2200000,
            start_date="2024-01-10", kpi=85,
            bio="Professional vizajist, to'y va foto-sessiya makiyajida ixtisoslashgan.",
            skills="To'y grimi,Foto-vizaj,Kunlik vizaj,Smoky eye,Airbrush",
            highlights="To'y va kechki tadbir uchun premium vizaj xizmati.",
            experience=4, rating=4.9, review_count=43
        ),
    ]
    db.add_all(staff_list); db.commit()

    # Services
    services_list = [
        models.Service(name="Soch kesish", category="Soch", price=80000, duration=45),
        models.Service(name="Soch bo'yash", category="Soch", price=250000, duration=120),
        models.Service(name="Manikyur", category="Manikyur", price=90000, duration=60),
        models.Service(name="Pedikyur", category="Pedikyur", price=100000, duration=60),
        models.Service(name="Makiyaj", category="Makiyaj", price=200000, duration=90),
        models.Service(name="Yuz tozalash", category="Kosmetologiya", price=150000, duration=75),
    ]
    db.add_all(services_list); db.commit()

    # Inventory
    inventory_list = [
        models.Inventory(name="Schwarzkopf shampun", category="Shampun", qty=8, unit="dona", min_qty=3, price=85000),
        models.Inventory(name="Qizil soch bo'yog'i", category="Soch bo'yog'i", qty=2, unit="dona", min_qty=3, price=45000),
        models.Inventory(name="Soch lak", category="Lak", qty=12, unit="dona", min_qty=4, price=30000),
        models.Inventory(name="Neyl lak to'plami", category="Gel", qty=5, unit="dona", min_qty=2, price=120000),
    ]
    db.add_all(inventory_list); db.commit()

    # Clients
    clients_list = [
        models.Client(name="Malika Yusupova", phone="+998901234567", prefs="Soch kesish, bo'yash", visits=12, bonus=1200, source="bot", birthday="1995-05-14"),
        models.Client(name="Sarvinoz Karimova", phone="+998907654321", prefs="Manikyur, Pedikyur", visits=8, bonus=800, source="admin", note="VIP mijoz", birthday="1990-08-22"),
        models.Client(name="Feruza Tosheva", phone="+998993334455", prefs="Soch bo'yash", visits=5, bonus=500, source="bot", birthday="1998-12-03"),
        models.Client(name="Zulfiya Rahimova", phone="+998901112233", prefs="Pedikyur, Makiyaj", visits=20, bonus=2000, source="admin", note="Doimiy", birthday="1988-03-17"),
    ]
    db.add_all(clients_list); db.commit()

    # Appointments
    appts_list = [
        models.Appointment(client_name="Malika Yusupova", client_phone="+998901234567", service="Soch kesish", master="Dilnoza", appt_date=today, appt_time="10:00", source="bot", status="pending"),
        models.Appointment(client_name="Sarvinoz Karimova", client_phone="+998907654321", service="Manikyur", master="Nasiba", appt_date=today, appt_time="11:30", source="admin", status="confirmed"),
        models.Appointment(client_name="Feruza Tosheva", client_phone="+998993334455", service="Soch bo'yash", master="Dilnoza", appt_date=today, appt_time="14:00", note="Qizil rang", source="bot", status="pending"),
        models.Appointment(client_name="Zulfiya Rahimova", client_phone="+998901112233", service="Pedikyur", master="Kamola", appt_date=today, appt_time="15:30", source="admin", status="completed"),
    ]
    db.add_all(appts_list); db.commit()

    # Finance
    finance_list = [
        models.Finance(type="income", category="Xizmat daromadi", amount=350000, note="Dilnoza xizmatlari", fin_date=today),
        models.Finance(type="income", category="Xizmat daromadi", amount=250000, note="Nasiba manikyur", fin_date=today),
        models.Finance(type="expense", category="Xomashyo", amount=85000, note="Shampun xaridi", fin_date=today),
        models.Finance(type="expense", category="Kommunal", amount=120000, note="Elektr", fin_date=today),
    ]
    db.add_all(finance_list); db.commit()
