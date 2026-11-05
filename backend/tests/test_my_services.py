"""Usta o'z xizmati davomiyligini sozlaydi; direktor boshqa muassasaga kira olmaydi."""
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login
from tests.test_appointments import book
from tests.test_schedule import day_from_today, new_master, new_service


def test_master_sets_own_duration_and_booking_uses_it(client, superadmin):
    biz = create_business(client, superadmin)
    s = new_service(client, biz, duration=60)
    other = new_service(client, biz, duration=30)
    master = new_master(client, biz, s)
    h = auth_header(master["tokens"])
    url = f"/api/v1/businesses/{biz['id']}/my-services"

    mine = client.get(url, headers=h).json()
    assert [(x["service_id"], x["duration_min"], x["custom_duration"]) for x in mine] == [(s["id"], 60, None)]

    assert client.put(f"{url}/{s['id']}", headers=h, json={"custom_duration": 45}).status_code == 204
    assert client.get(url, headers=h).json()[0]["custom_duration"] == 45
    # Bron shu ustaga 45 daqiqa bo'ladi
    a = book(client, otp_login(client, new_phone()), master, s, day_from_today(biz, 1), "10:00").json()
    from datetime import datetime
    mins = (datetime.fromisoformat(a["ends_at"]) - datetime.fromisoformat(a["starts_at"])).seconds // 60
    assert mins == 45

    # Biriktirilmagan xizmat, noto'g'ri qiymat, umumiyga qaytish
    assert client.put(f"{url}/{other['id']}", headers=h, json={"custom_duration": 30}).status_code == 404
    for bad in (3, 47, 721):
        assert client.put(f"{url}/{s['id']}", headers=h, json={"custom_duration": bad}).status_code == 422, bad
    assert client.put(f"{url}/{s['id']}", headers=h, json={"custom_duration": None}).status_code == 204
    assert client.get(url, headers=h).json()[0]["custom_duration"] is None

    # Boshqa usta va mijoz bu ustaning vaqtiga tegolmaydi
    master2 = new_master(client, biz, other)
    assert client.put(f"{url}/{s['id']}", headers=auth_header(master2["tokens"]), json={"custom_duration": 90}).status_code == 404
    customer = otp_login(client, new_phone())
    assert client.get(url, headers=auth_header(customer)).status_code == 403
    assert client.put(f"{url}/{s['id']}", headers=auth_header(customer), json={"custom_duration": 90}).status_code == 403


def test_director_cannot_reach_other_business(client, superadmin):
    a, b = create_business(client, superadmin), create_business(client, superadmin)
    rec_b = add_member(client, b, "receptionist")
    owner_a = auth_header(a["owner"])
    base = f"/api/v1/businesses/{b['id']}"
    for path in ("/members", "/services", "/reviews", "/reviews/mine", "/my-services", "/calendar?start=2027-01-04&days=1",
                 "/reports?date_from=2027-01-01&date_to=2027-01-02", "/clients"):
        r = client.get(base + path, headers=owner_a)
        assert r.status_code in (403, 404), (path, r.status_code)
    # Yozish ham: xodim qo'shish, parol berish, xizmat qo'shish
    assert client.post(f"{base}/members", headers=owner_a, json={"phone": new_phone(), "full_name": "Begona",
                                                                 "role": "staff"}).status_code in (403, 404)
    assert client.post(f"{base}/members/{rec_b['member']['id']}/password", headers=owner_a,
                       json={"new_password": "Hack2026xx"}).status_code in (403, 404)
    assert client.post(f"{base}/services", headers=owner_a,
                       json={"name": "Begona", "duration_min": 30, "price": 1}).status_code in (403, 404)
    # Super Admin amallari direktorga yopiq
    assert client.put(f"/api/v1/superadmin/businesses/{b['id']}/owner", headers=owner_a,
                      json={"phone": new_phone(), "full_name": "Begona Odam"}).status_code == 403
    # O'z muassasasi ishlaydi
    assert client.get(f"/api/v1/businesses/{a['id']}/members", headers=owner_a).status_code == 200
