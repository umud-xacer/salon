"""Zaxira telefon va raqamni tasdiqlash (053_backup_phone.sql)."""
import pytest

from tests.conftest import auth_header, create_business, new_phone, otp_login
from tests.test_reception_mode import ctx, url  # noqa: F401  (ctx — fixture)


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance"))


def test_profile_backup_phone_rules(client):
    phone = new_phone()
    user = otp_login(client, phone, "Zaxira Mijoz")
    h = auth_header(user)
    assert user["user"]["backup_phone"] is None and user["user"]["phone_confirmed_at"] is None

    backup = new_phone()
    r = client.patch("/api/v1/auth/me", headers=h, json={"backup_phone": backup[4:]})   # +998 siz ham qabul
    assert r.status_code == 200, r.text
    assert r.json()["backup_phone"] == backup

    r = client.patch("/api/v1/auth/me", headers=h, json={"backup_phone": phone})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "backup_same_as_phone"
    assert client.patch("/api/v1/auth/me", headers=h, json={"backup_phone": "12345"}).status_code == 422

    r = client.patch("/api/v1/auth/me", headers=h, json={"backup_phone": ""})            # o'chirish
    assert r.status_code == 200 and r.json()["backup_phone"] is None


def test_confirm_phone_sets_timestamp_and_optional_backup(client):
    user = otp_login(client, new_phone(), "Tasdiq Mijoz")
    h = auth_header(user)
    r = client.post("/api/v1/auth/me/confirm-phone", headers=h, json={})
    assert r.status_code == 200, r.text
    first = r.json()["phone_confirmed_at"]
    assert first and r.json()["backup_phone"] is None

    backup = new_phone()
    r = client.post("/api/v1/auth/me/confirm-phone", headers=h, json={"backup_phone": backup})
    assert r.json()["backup_phone"] == backup and r.json()["phone_confirmed_at"] >= first
    me = client.get("/api/v1/auth/me", headers=h).json()["user"]
    assert me["backup_phone"] == backup
    assert client.post("/api/v1/auth/me/confirm-phone", headers=h,
                       json={"backup_phone": user["user"]["phone"]}).status_code == 422


def test_salon_sees_backup_phone_only_with_clients_permission(client, superadmin, biz, ctx):
    customer = otp_login(client, new_phone(), "Ilova Mijoz")
    backup = new_phone()
    client.patch("/api/v1/auth/me", headers=auth_header(customer), json={"backup_phone": backup})
    r = client.post("/api/v1/appointments", headers=auth_header(customer), json={
        "member_id": ctx["a"]["member"]["id"], "service_id": ctx["service"]["id"],
        "starts_at": f"{ctx['day']}T15:00:00+05:00"})
    assert r.status_code == 201, r.text
    appt_id = r.json()["id"]

    owner = auth_header(biz["owner"])
    appt = client.get(f"/api/v1/appointments/{appt_id}", headers=owner).json()
    assert appt["client_backup_phone"] == backup
    row = next(c for c in client.get(url(biz, "clients"), headers=owner).json() if c["full_name"] == "Ilova Mijoz")
    assert row["backup_phone"] == backup

    # Usta (mijozlar bazasiga huquqsiz) — ko'rmaydi; mijozning o'ziga ham bron javobida chiqmaydi
    mine = client.get(url(biz, f"appointments?date={ctx['day']}"), headers=auth_header(ctx["a"]["tokens"])).json()
    assert all(x["client_backup_phone"] is None for x in mine)
    own = client.get(f"/api/v1/appointments/{appt_id}", headers=auth_header(customer)).json()
    assert own["client_backup_phone"] is None
