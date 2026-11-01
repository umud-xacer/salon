"""Parolni direktor va Super Admin o'rnatishi: kim kimga, hisobni egallashdan himoya, sessiyalar."""
import pytest
from sqlalchemy import text

from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login

NEW = "YangiParol123"


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin)


def member_url(biz, member_id):
    return f"/api/v1/businesses/{biz['id']}/members/{member_id}/password"


def set_password(client, biz, member_id, tokens, password=NEW):
    return client.post(member_url(biz, member_id), headers=auth_header(tokens), json={"new_password": password})


def login(client, phone, password=NEW):
    return client.post("/api/v1/auth/login", json={"phone": phone, "password": password})


def test_owner_sets_staff_password_and_sessions_end(client, biz):
    usta = add_member(client, biz, "staff")
    assert client.get("/api/v1/auth/me", headers=auth_header(usta["tokens"])).status_code == 200

    assert set_password(client, biz, usta["member"]["id"], biz["owner"]).status_code == 204
    assert login(client, usta["member"]["phone"]).status_code == 200
    # Eski kirishlar darhol bekor
    assert client.get("/api/v1/auth/me", headers=auth_header(usta["tokens"])).status_code == 401
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": usta["tokens"]["refresh_token"]})
    assert r.status_code == 401


def test_weak_password_rejected(client, biz):
    usta = add_member(client, biz, "staff")
    assert set_password(client, biz, usta["member"]["id"], biz["owner"], "qisqa").status_code == 422


def test_only_owner_not_manager_or_staff(client, biz):
    usta = add_member(client, biz, "staff")
    manager = add_member(client, biz, "manager")
    mid = usta["member"]["id"]
    assert set_password(client, biz, mid, manager["tokens"]).status_code == 403
    assert set_password(client, biz, mid, usta["tokens"]).status_code == 403

    # staff.manage berilgan menejer ham parolga tega olmaydi
    h = auth_header(biz["owner"])
    r = client.put(f"/api/v1/businesses/{biz['id']}/members/{manager['member']['id']}/permissions/staff.manage",
                   headers=h, json={"granted": True})
    assert r.status_code == 204
    assert set_password(client, biz, mid, manager["tokens"]).status_code == 403


def test_owner_cannot_touch_other_salon_or_self_or_owner(client, superadmin, biz):
    other = create_business(client, superadmin)
    usta = add_member(client, other, "staff")
    assert set_password(client, other, usta["member"]["id"], biz["owner"]).status_code == 403
    assert set_password(client, biz, usta["member"]["id"], biz["owner"]).status_code == 404   # o'z salonida yo'q
    assert set_password(client, biz, biz["owner_member_id"], biz["owner"]).status_code == 403


def test_owner_cannot_take_over_foreign_account_by_adding_phone(client, superadmin, biz):
    """Boshqa salon direktori raqamini "xodim" qilib qo'shib, parolini almashtirish ishlamasligi kerak."""
    other = create_business(client, superadmin)
    me = client.get("/api/v1/auth/me", headers=auth_header(other["owner"])).json()["user"]
    h = auth_header(biz["owner"])
    r = client.post(f"/api/v1/businesses/{biz['id']}/members", headers=h,
                    json={"phone": me["phone"], "full_name": "Begona", "role": "staff"})
    assert r.status_code == 201, r.text
    assert r.json()["password_block"] == "shared_account"
    r = set_password(client, biz, r.json()["id"], biz["owner"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "shared_account"
    assert login(client, me["phone"]).status_code == 401


def test_owner_cannot_take_over_client_account(client, biz):
    phone = new_phone()
    t = otp_login(client, phone, "Mijoz")
    from tests.test_schedule import day_from_today, new_master, new_service
    from tests.test_appointments import at
    s = new_service(client, biz)
    m = new_master(client, biz, s)
    assert client.post("/api/v1/appointments", headers=auth_header(t), json={
        "member_id": m["member"]["id"], "service_id": s["id"],
        "starts_at": at(day_from_today(biz, 1), "10:00")}).status_code == 201

    r = client.post(f"/api/v1/businesses/{biz['id']}/members", headers=auth_header(biz["owner"]),
                    json={"phone": phone, "full_name": "Mijoz", "role": "staff"})
    assert set_password(client, biz, r.json()["id"], biz["owner"]).status_code == 409


def test_superadmin_resets_director(client, superadmin, biz):
    phone = client.get("/api/v1/auth/me", headers=auth_header(biz["owner"])).json()["user"]["phone"]
    r = set_password(client, biz, biz["owner_member_id"], superadmin)
    assert r.status_code == 204
    assert login(client, phone).status_code == 200

    rows = client.get("/api/v1/superadmin/businesses", headers=auth_header(superadmin)).json()
    assert next(b for b in rows if b["id"] == biz["id"])["owner_phone"] == phone


def test_superadmin_works_even_when_salon_suspended_owner_does_not(client, superadmin, biz):
    usta = add_member(client, biz, "staff")
    client.patch(f"/api/v1/superadmin/businesses/{biz['id']}/subscription",
                 headers=auth_header(superadmin), json={"is_active": False})
    assert set_password(client, biz, usta["member"]["id"], biz["owner"]).status_code == 403
    assert set_password(client, biz, biz["owner_member_id"], superadmin).status_code == 204


def test_direct_sql_cannot_write_password_or_skip_function(client, biz):
    usta = add_member(client, biz, "staff")
    owner_id = biz["owner"]["user"]["id"]
    with api_session(owner_id) as db:
        with pytest.raises(Exception) as e:
            db.execute(text("UPDATE users SET password_hash = 'x' WHERE id = :u"), {"u": usta["member"]["user_id"]})
        assert "permission denied" in str(e.value)
        db.rollback()


def test_audit_has_no_secret(client, biz):
    usta = add_member(client, biz, "staff")
    set_password(client, biz, usta["member"]["id"], biz["owner"])
    from app.core.config import get_settings
    from sqlalchemy import create_engine
    e = create_engine(get_settings().migration_database_url)
    with e.connect() as c:
        got = c.execute(text("SELECT changes FROM audit_logs WHERE action = 'password_set' AND entity_id = :m"),
                        {"m": usta["member"]["id"]}).all()
    e.dispose()
    assert got == [(None,)]
