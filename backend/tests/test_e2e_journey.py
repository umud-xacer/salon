"""W8: butun hayot sikli bitta ssenariyda — rollar va bosqichlar bir-biriga to'g'ri ulanganini tekshiradi.

Super Admin muassasa ochadi -> direktor xizmat va usta qo'shadi -> salon ilovada ko'rinadi -> mijoz bron qiladi ->
qabulxona xizmatni boshlaydi va to'lov oladi -> hisobotda tushum -> statistika va audit -> obuna tugaydi
(salon yashirinadi, panel yopiladi, ma'lumot qoladi) -> to'lov bilan uzaytiriladi -> hammasi joyida.
"""
from datetime import datetime, timedelta, timezone

from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login
from tests.test_appointments import book as customer_book
from tests.test_finance import today
from tests.test_schedule import day_from_today, new_master, new_service, slots

CAT = "/api/v1/catalog/businesses"


def test_full_business_lifecycle(client, superadmin):
    sa = auth_header(superadmin)
    biz = create_business(client, superadmin, modules=("booking", "finance"))
    owner = auth_header(biz["owner"])
    base = f"/api/v1/businesses/{biz['id']}"

    # Xizmatsiz salon ilovada ko'rinmaydi
    assert client.get(f"{CAT}/{biz['slug']}").status_code == 404

    service = new_service(client, biz, duration=60)
    master = new_master(client, biz, service)
    rec = add_member(client, biz, "receptionist")
    assert client.get(f"{CAT}/{biz['slug']}").status_code == 200

    # Mijoz ilovadan bron qiladi: vaqt band bo'ladi
    customer = otp_login(client, new_phone(), "Sayyora Mijoz")
    day = day_from_today(biz, 1)
    assert "10:00" in slots(client, master, service, day)
    r = customer_book(client, customer, master, service, day, "10:00")
    assert r.status_code == 201, r.text
    appt = r.json()
    assert "10:00" not in slots(client, master, service, day)
    mine = client.get("/api/v1/appointments/mine", headers=auth_header(customer))
    assert mine.status_code == 200 and any(a["id"] == appt["id"] for a in mine.json())

    # Qabulxona xizmatni boshlaydi va to'liq to'lov oladi
    desk = auth_header(rec["tokens"])
    r = client.patch(f"{base}/appointments/{appt['id']}/status", headers=desk, json={"status": "in_progress"})
    assert r.status_code == 200, r.text
    r = client.post(f"{base}/appointments/{appt['id']}/payments", headers=desk,
                    json={"amount": appt["total_price"], "method": "card"})
    assert r.status_code == 201 and r.json()["due"] == 0, r.text

    # Direktor hisobotida tushum ko'rinadi, usta hisobotni ko'ra olmaydi
    rep = client.get(f"{base}/reports", headers=owner, params={"date_from": today(), "date_to": str(day)})
    assert rep.status_code == 200, rep.text
    assert rep.json()["money"]["income"] == appt["total_price"]
    assert client.get(f"{base}/reports", headers=auth_header(master["tokens"]),
                      params={"date_from": today(), "date_to": today()}).status_code == 403

    # Super Admin: statistika va jurnal
    stats = client.get("/api/v1/superadmin/stats", headers=sa).json()
    assert stats["bookings_today"] >= 1
    audit = client.get("/api/v1/superadmin/audit", headers=sa, params={"business_id": biz["id"]}).json()
    assert {"appointment", "payment"} <= {a["entity_type"] for a in audit}

    # Obuna tugaydi: ilovada yo'q, panel yopiq, bron qilib bo'lmaydi
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    assert client.patch(f"/api/v1/superadmin/businesses/{biz['id']}/subscription", headers=sa,
                        json={"subscription_ends_at": past}).status_code == 200
    assert client.get(f"{CAT}/{biz['slug']}").status_code == 404
    assert client.get(f"{base}/services", headers=owner).status_code == 403
    assert customer_book(client, customer, master, service, day, "12:00").status_code >= 400

    # To'lov bilan uzaytiriladi: hamma narsa shu joyidan davom etadi
    r = client.post(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/renew", headers=sa,
                    json={"days": 30, "amount": 200000, "method": "transfer"})
    assert r.status_code == 200 and r.json()["operational"] is True, r.text
    assert client.get(f"{CAT}/{biz['slug']}").status_code == 200
    services = client.get(f"{base}/services", headers=owner)
    assert services.status_code == 200 and any(s["id"] == service["id"] for s in services.json())
    assert customer_book(client, customer, master, service, day, "12:00").status_code == 201
    hist = client.get(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/payments", headers=sa).json()
    assert [p["amount"] for p in hist] == [200000]
