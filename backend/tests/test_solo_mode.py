"""Yakka tadbirkor (solo) va jamoaviy rejim (062_solo_mode.sql)."""
import datetime as dt
import os

from sqlalchemy import create_engine, text

from tests.conftest import add_member, auth_header, new_phone, otp_login
from tests.test_reception_mode import url
from tests.test_schedule import day_from_today, new_service

ADMIN = create_engine(os.environ["MIGRATION_DATABASE_URL"])


def create(client, superadmin, mode=None, **extra):
    phone = new_phone()
    body = {"name": f"Yakka {phone[-4:]}", "slug": f"solo-{phone[-7:]}", "category_id": 1, "city": "Toshkent",
            "lat": 41.3, "lng": 69.28, "owner_phone": phone, "owner_full_name": "Yakka Usta",
            "modules": ["booking"], **extra}
    if mode:
        body["work_mode"] = mode
    r = client.post("/api/v1/superadmin/businesses", headers=auth_header(superadmin), json=body)
    assert r.status_code == 201, r.text
    b = r.json()
    with ADMIN.begin() as db:
        db.execute(text("UPDATE businesses SET is_listed = true WHERE id = :b"), {"b": b["id"]})
    return {"id": b["id"], "slug": body["slug"], "owner_member_id": b["owner_member_id"], "owner": otp_login(client, phone)}


def workday(biz) -> dt.date:
    d = day_from_today(biz, 2)
    return d + dt.timedelta(days=1) if d.isoweekday() == 7 else d          # muassasa vaqti: dushanba–shanba


def solo(biz) -> bool:
    with ADMIN.connect() as db:
        return db.execute(text("SELECT is_solo_mode FROM businesses WHERE id = :b"), {"b": biz["id"]}).scalar()


def book(client, biz, service, customer, member_id=None, clock="11:00"):
    body = {"service_id": service["id"], "starts_at": f"{workday(biz)}T{clock}:00+05:00"}
    if member_id:
        body["member_id"] = member_id
    return client.post("/api/v1/appointments", headers=auth_header(customer), json=body)


def test_solo_owner_is_provider_and_booking_goes_to_owner(client, superadmin):
    biz = create(client, superadmin, "solo")
    assert solo(biz)
    service = new_service(client, biz)                                      # yangi xizmat — darhol direktorga
    detail = client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()
    assert detail["solo"] is True
    assert [s["member_id"] for s in detail["staff"]] == [biz["owner_member_id"]]
    assert service["id"] in detail["staff"][0]["service_ids"]

    customer = otp_login(client, new_phone(), "Mijoz Yakka")
    q = client.post("/api/v1/appointments/quote", headers=auth_header(customer), json={
        "service_id": service["id"], "starts_at": f"{workday(biz)}T11:00:00+05:00"})
    assert q.status_code == 200 and q.json()["price"] == 50000
    r = book(client, biz, service, customer)                                # "Usta tanlang" yo'q
    assert r.status_code == 201, r.text
    assert r.json()["member_id"] == biz["owner_member_id"]
    prof = client.get(url(biz, "profile"), headers=auth_header(biz["owner"])).json()
    assert prof["is_solo_mode"] is True


def test_adding_staff_switches_to_team_and_back(client, superadmin):
    biz = create(client, superadmin, "solo")
    service = new_service(client, biz)
    staff = add_member(client, biz, "staff")
    assert not solo(biz)                                                    # xodim qo'shildi — jamoa
    customer = otp_login(client, new_phone(), "Mijoz Jamoa")
    r = book(client, biz, service, customer)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "member_required"
    assert client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()["solo"] is False

    # Xodim ishdan chiqdi — yana yakka, bron yana direktorga
    r = client.patch(url(biz, f"members/{staff['member']['id']}"), headers=auth_header(biz["owner"]), json={"is_active": False})
    assert r.status_code == 200, r.text
    assert solo(biz)
    assert book(client, biz, service, customer, clock="13:00").status_code == 201


def test_default_team_and_switching_rules(client, superadmin):
    biz = create(client, superadmin)                                        # ko'rsatilmasa — jamoa (eski xatti-harakat)
    assert not solo(biz)
    service = new_service(client, biz)
    customer = otp_login(client, new_phone(), "Mijoz")
    assert book(client, biz, service, customer).json()["detail"]["code"] == "member_required"

    h = auth_header(biz["owner"])
    r = client.put(url(biz, "work-mode"), headers=h, json={"solo": True})   # xodimi yo'q — yakkaga o'tadi
    assert r.status_code == 200 and r.json()["is_solo_mode"] is True
    with ADMIN.connect() as db:
        assert db.execute(text("SELECT count(*) FROM member_services WHERE member_id = :m"),
                          {"m": biz["owner_member_id"]}).scalar() == 1
    add_member(client, biz, "staff")
    r = client.put(url(biz, "work-mode"), headers=h, json={"solo": True})   # faol xodim bor
    assert r.status_code == 409 and r.json()["detail"]["code"] == "has_staff"
    staff = add_member(client, biz, "staff")
    assert client.put(url(biz, "work-mode"), headers=auth_header(staff["tokens"]), json={"solo": False}).status_code == 403


def test_branch_is_always_team(client, superadmin):
    parent = create(client, superadmin, "solo")
    r = client.post("/api/v1/superadmin/businesses", headers=auth_header(superadmin), json={
        "name": "Filial", "slug": f"filial-{new_phone()[-7:]}", "category_id": 1, "city": "Toshkent", "lat": 41.31,
        "lng": 69.29, "parent_id": parent["id"], "branch_name": "Chilonzor", "work_mode": "solo", "modules": ["booking"]})
    assert r.status_code == 201, r.text
    with ADMIN.connect() as db:
        assert db.execute(text("SELECT is_solo_mode FROM businesses WHERE id = :b"), {"b": r.json()["id"]}).scalar() is False
