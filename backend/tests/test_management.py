"""Boshqaruv: xodimlar va huquqlar, mijozlar bazasi, Super Admin lokatsiyasi."""
import pytest

from tests.conftest import add_member, auth_header, create_business, new_phone
from tests.test_appointments import at
from tests.test_reception import post
from tests.test_schedule import day_from_today, new_master, new_service


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin)


def base(biz):
    return f"/api/v1/businesses/{biz['id']}"


def test_member_list_has_names_and_defaults(client, biz):
    h = auth_header(biz["owner"])
    phone = new_phone()
    r = client.post(f"{base(biz)}/members", headers=h,
                    json={"phone": phone, "full_name": "Nodira Kassir", "role": "receptionist"})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["full_name"] == "Nodira Kassir" and m["phone"] == phone
    assert m["is_bookable"] is False                                       # kassir mijoz qabul qilmaydi

    usta = client.post(f"{base(biz)}/members", headers=h,
                       json={"phone": new_phone(), "full_name": "Usta", "role": "staff"}).json()
    assert usta["is_bookable"] is True

    names = {x["full_name"] for x in client.get(f"{base(biz)}/members", headers=h).json()}
    assert {"Nodira Kassir", "Usta", "Salon Egasi"} <= names


def test_permissions_show_role_override_and_module(client, superadmin):
    biz = create_business(client, superadmin, modules=("booking", "finance"))
    rec = add_member(client, biz, "receptionist")
    h, mid = auth_header(biz["owner"]), rec["member"]["id"]
    url = f"{base(biz)}/members/{mid}/permissions"

    rows = {p["code"]: p for p in client.get(url, headers=h).json()}
    assert rows["payments.accept"]["role_default"] is True and rows["payments.accept"]["effective"] is True
    assert rows["services.manage"]["effective"] is False
    # Modul o'chiq: rol bersa ham amalda yo'q
    assert rows["inventory.view"]["module_enabled"] is False and rows["inventory.view"]["effective"] is False

    assert client.put(f"{url}/services.manage", headers=h, json={"granted": True}).status_code == 204
    assert client.put(f"{url}/payments.accept", headers=h, json={"granted": False}).status_code == 204
    rows = {p["code"]: p for p in client.get(url, headers=h).json()}
    assert rows["services.manage"]["effective"] is True and rows["services.manage"]["override"] is True
    assert rows["payments.accept"]["effective"] is False

    assert client.put(f"{url}/payments.accept", headers=h, json={"granted": None}).status_code == 204
    assert {p["code"]: p for p in client.get(url, headers=h).json()}["payments.accept"]["override"] is None


def test_staff_cannot_read_members_or_permissions(client, biz):
    usta = add_member(client, biz, "staff")
    h = auth_header(usta["tokens"])
    assert client.get(f"{base(biz)}/members", headers=h).status_code == 403
    assert client.get(f"{base(biz)}/members/{usta['member']['id']}/permissions", headers=h).status_code == 403


def test_owner_record_cannot_be_changed_by_owner_or_other(client, biz):
    r = client.patch(f"{base(biz)}/members/{biz['owner_member_id']}", headers=auth_header(biz["owner"]),
                     json={"title": "x"})
    assert r.status_code == 403


def test_superadmin_sees_and_adds_staff_of_any_salon(client, superadmin, biz):
    h = auth_header(superadmin)
    r = client.post(f"{base(biz)}/members", headers=h, json={"phone": new_phone(), "full_name": "SA Usta", "role": "manager"})
    assert r.status_code == 201, r.text
    assert "SA Usta" in {x["full_name"] for x in client.get(f"{base(biz)}/members", headers=h).json()}


def test_client_create_edit_and_stats(client, biz):
    s = new_service(client, biz, duration=60)
    a, b_ = new_master(client, biz, s), new_master(client, biz, s)
    rec = add_member(client, biz, "receptionist")
    h = auth_header(rec["tokens"])
    url = f"{base(biz)}/clients"
    phone = new_phone()

    r = client.post(url, headers=h, json={"full_name": "Ra'no Karimova", "phone": phone, "notes": "Allergiya bor"})
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["visits"] == 0 and c["notes"] == "Allergiya bor" and c["has_account"] is False
    assert client.post(url, headers=h, json={"full_name": "Dublikat", "phone": phone}).status_code == 409

    r = client.patch(f"{url}/{c['id']}", headers=h, json={"full_name": "Rano Karimova", "notes": None})
    assert r.status_code == 200 and r.json()["full_name"] == "Rano Karimova" and r.json()["notes"] is None

    ctx = {"service": s, "day": day_from_today(biz, 1), "rec": rec}
    done = post(client, biz, ctx, "10:00", a, client_phone=phone, client_name="xx").json()
    post(client, biz, ctx, "12:00", b_, client_phone=phone, client_name="xx")
    r = client.patch(f"{base(biz)}/appointments/{done['id']}/status", headers=h, json={"status": "completed"})
    assert r.status_code == 200

    got = client.get(f"{url}/{c['id']}/appointments", headers=h).json()
    assert len(got) == 2
    row = next(x for x in client.get(url, headers=h, params={"q": phone[-7:]}).json())
    assert row["visits"] == 1 and row["total_spent"] == s["price"] and row["last_visit"]


def test_app_client_phone_is_locked(client, biz):
    from tests.conftest import otp_login
    s = new_service(client, biz, duration=60)
    m = new_master(client, biz, s)
    phone = new_phone()
    t = otp_login(client, phone, "Ilova Mijoz")
    r = client.post("/api/v1/appointments", headers=auth_header(t), json={
        "member_id": m["member"]["id"], "service_id": s["id"], "starts_at": at(day_from_today(biz, 1), "10:00")})
    assert r.status_code == 201, r.text

    h = auth_header(biz["owner"])
    c = client.get(f"{base(biz)}/clients", headers=h, params={"q": phone}).json()[0]
    assert c["has_account"] is True
    assert client.patch(f"{base(biz)}/clients/{c['id']}", headers=h, json={"phone": new_phone()}).status_code == 409
    assert client.patch(f"{base(biz)}/clients/{c['id']}", headers=h, json={"notes": "VIP"}).status_code == 200


def test_clients_are_isolated_between_salons(client, superadmin, biz):
    other = create_business(client, superadmin)
    r = client.post(f"{base(biz)}/clients", headers=auth_header(biz["owner"]),
                    json={"full_name": "Bizniki", "phone": new_phone()})
    cid = r.json()["id"]
    h = auth_header(other["owner"])
    assert client.get(f"{base(biz)}/clients", headers=h).status_code == 403
    assert client.get(f"{base(other)}/clients", headers=h).json() == []
    assert client.patch(f"{base(other)}/clients/{cid}", headers=h, json={"notes": "x"}).status_code == 404
    assert client.get(f"{base(other)}/clients/{cid}/appointments", headers=h).status_code == 404


def test_staff_cannot_open_clients(client, biz):
    usta = add_member(client, biz, "staff")
    assert client.get(f"{base(biz)}/clients", headers=auth_header(usta["tokens"])).status_code == 403


def test_superadmin_sets_location_and_details(client, superadmin, biz):
    h = auth_header(superadmin)
    url = f"/api/v1/superadmin/businesses/{biz['id']}"
    r = client.patch(url, headers=h, json={"name": "Yangi Nom", "address": "Navoiy 5", "lat": 41.3, "lng": 69.25})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["name"] == "Yangi Nom" and b["address"] == "Navoiy 5"
    assert b["lat"] == pytest.approx(41.3) and b["lng"] == pytest.approx(69.25)

    assert client.patch(url, headers=h, json={"lat": 41.3}).status_code == 422
    assert client.patch(url, headers=h, json={"lat": 100, "lng": 69}).status_code == 422
    r = client.patch(url, headers=h, json={"lat": None, "lng": None})
    assert r.status_code == 200 and r.json()["lat"] is None

    assert client.patch(url, headers=auth_header(biz["owner"]), json={"name": "Hack"}).status_code == 403
