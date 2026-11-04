"""Panellar domen bo'yicha ajratilgan: Super Admin — ega.*, direktor va xodimlar — www.*; mobil (api.*) — cheklovsiz.
Super Admin faqat direktor parolini ko'radi."""
from tests.conftest import add_member, auth_header, create_business, new_phone

ADMIN = {"host": "ega.test.chronix.local"}
PANEL = {"host": "www.test.chronix.local"}
SA_LOGIN = {"phone": "+998900000001", "password": "SuperPass123"}


def test_superadmin_logs_in_only_on_admin_host(client):
    r = client.post("/api/v1/auth/login", headers=PANEL, json=SA_LOGIN)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "wrong_panel"
    assert "ega.ariqalqon.uz" in r.json()["detail"]["message"]
    assert client.post("/api/v1/auth/login", headers=ADMIN, json=SA_LOGIN).status_code == 200


def test_superadmin_token_rejected_on_business_panel(client, superadmin):
    h = auth_header(superadmin)
    assert client.get("/api/v1/superadmin/businesses", headers={**h, **ADMIN}).status_code == 200
    r = client.get("/api/v1/superadmin/businesses", headers={**h, **PANEL})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "wrong_panel"


def test_director_and_staff_only_on_business_panel(client, superadmin):
    phone = new_phone()
    r = client.post("/api/v1/superadmin/businesses", headers=auth_header(superadmin), json={
        "name": "Panel Salon", "slug": f"panel-{phone[-7:]}", "category_id": 1, "lat": 41.3, "lng": 69.2,
        "owner_phone": phone, "owner_full_name": "Direktor", "owner_password": "Direktor2026ab"})
    assert r.status_code == 201, r.text
    login = {"phone": phone, "password": "Direktor2026ab"}
    r = client.post("/api/v1/auth/login", headers=ADMIN, json=login)
    assert r.status_code == 403 and "www.ariqalqon.uz" in r.json()["detail"]["message"]
    tokens = client.post("/api/v1/auth/login", headers=PANEL, json=login)
    assert tokens.status_code == 200
    assert client.get("/api/v1/auth/me", headers={**auth_header(tokens.json()), **ADMIN}).status_code == 403
    # Mobil ilova (boshqa domen) — cheklovsiz
    assert client.post("/api/v1/auth/login", json=login).status_code == 200


def test_superadmin_sees_only_owner_password(client, superadmin):
    biz = create_business(client, superadmin)
    sa, owner = auth_header(superadmin), auth_header(biz["owner"])
    base = f"/api/v1/businesses/{biz['id']}/members"
    staff = add_member(client, biz, "staff")
    client.post(f"{base}/{staff['member']['id']}/password", headers=owner, json={"new_password": "Usta2026parol"})
    # Direktor o'z xodimining parolini ko'radi, Super Admin — yo'q
    assert client.get(f"{base}/{staff['member']['id']}/password", headers=owner).json()["password"] == "Usta2026parol"
    assert client.get(f"{base}/{staff['member']['id']}/password", headers=sa).status_code == 403

    assert client.post(f"{base}/{biz['owner_member_id']}/password", headers=sa,
                       json={"new_password": "Direktor2026ab"}).status_code == 204
    assert client.get(f"{base}/{biz['owner_member_id']}/password", headers=sa).json()["password"] == "Direktor2026ab"
