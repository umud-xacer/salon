"""Rollar va huquqlar: API darajasida."""
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login


def test_client_cannot_use_superadmin_api(client):
    t = otp_login(client, new_phone())
    r = client.post("/api/v1/superadmin/businesses", headers=auth_header(t), json={})
    assert r.status_code == 403


def test_superadmin_creates_business_and_owner_workspace(client, superadmin):
    biz = create_business(client, superadmin)
    me = client.get("/api/v1/auth/me", headers=auth_header(biz["owner"])).json()
    assert me["workspace"] == "business"
    m = me["memberships"][0]
    assert m["business_id"] == biz["id"] and m["role"] == "owner"
    assert {"staff.manage", "appointments.view_all", "business.manage"} <= set(m["permissions"])
    # 'finance' moduli yoqilmagan — egasida ham bu huquq yo'q
    assert "finance.view" not in m["permissions"]

    sa = client.get("/api/v1/auth/me", headers=auth_header(superadmin)).json()
    assert sa["workspace"] == "superadmin"


def test_staff_workspace_and_limited_permissions(client, superadmin):
    biz = create_business(client, superadmin)
    staff = add_member(client, biz, "staff")
    me = client.get("/api/v1/auth/me", headers=auth_header(staff["tokens"])).json()
    assert me["workspace"] == "business"
    assert me["memberships"][0]["permissions"] == ["appointments.view_own"]

    # Xodim boshqa xodim qo'sha olmaydi
    r = client.post(f"/api/v1/businesses/{biz['id']}/members", headers=auth_header(staff["tokens"]),
                    json={"phone": new_phone(), "full_name": "Begona", "role": "staff"})
    assert r.status_code == 403


def test_owner_cannot_touch_other_business(client, superadmin):
    a = create_business(client, superadmin)
    b = create_business(client, superadmin)
    r = client.get(f"/api/v1/businesses/{b['id']}/members", headers=auth_header(a["owner"]))
    assert r.status_code == 403
    r = client.post(f"/api/v1/businesses/{b['id']}/members", headers=auth_header(a["owner"]),
                    json={"phone": new_phone(), "full_name": "Josus", "role": "manager"})
    assert r.status_code == 403


def test_owner_role_cannot_be_assigned_via_api(client, superadmin):
    biz = create_business(client, superadmin)
    r = client.post(f"/api/v1/businesses/{biz['id']}/members", headers=auth_header(biz["owner"]),
                    json={"phone": new_phone(), "full_name": "Ikkinchi Ega", "role": "owner"})
    assert r.status_code == 422          # sxema 'owner' ni qabul qilmaydi


def test_privilege_escalation_blocked_by_database(client, superadmin):
    """Egasi qabulxonaga 'staff.manage' beradi. Qabulxona shu huquq bilan ham:
    - menejer qo'sha olmaydi (faqat egasi),
    - o'ziga huquq bera olmaydi,
    - o'zida yo'q huquqni boshqaga bera olmaydi,
    - egasining huquqlariga tega olmaydi."""
    biz = create_business(client, superadmin, modules=("booking", "finance"))
    rec = add_member(client, biz, "receptionist")
    staff = add_member(client, biz, "staff")
    owner_h = auth_header(biz["owner"])
    base = f"/api/v1/businesses/{biz['id']}/members"

    r = client.put(f"{base}/{rec['member']['id']}/permissions/staff.manage", headers=owner_h, json={"granted": True})
    assert r.status_code == 204
    rec_h = auth_header(rec["tokens"])

    # Endi oddiy xodim qo'sha oladi
    assert client.post(base, headers=rec_h, json={"phone": new_phone(), "full_name": "Yangi Usta", "role": "staff"}).status_code == 201

    r = client.post(base, headers=rec_h, json={"phone": new_phone(), "full_name": "Menejer", "role": "manager"})
    assert r.status_code == 403
    r = client.patch(f"{base}/{staff['member']['id']}", headers=rec_h, json={"role": "manager"})
    assert r.status_code == 403
    r = client.put(f"{base}/{rec['member']['id']}/permissions/finance.view", headers=rec_h, json={"granted": True})
    assert r.status_code == 403
    r = client.put(f"{base}/{staff['member']['id']}/permissions/finance.view", headers=rec_h, json={"granted": True})
    assert r.status_code == 403
    r = client.put(f"{base}/{biz['owner_member_id']}/permissions/staff.manage", headers=rec_h, json={"granted": False})
    assert r.status_code == 403
    r = client.patch(f"{base}/{biz['owner_member_id']}", headers=rec_h, json={"is_active": False})
    assert r.status_code == 403

    # Egasi esa huquqni olib qo'ya oladi — va u darhol kuchga kiradi
    assert client.put(f"{base}/{rec['member']['id']}/permissions/staff.manage", headers=owner_h, json={"granted": None}).status_code == 204
    assert client.get(base, headers=rec_h).status_code == 403


def test_blocked_user_and_blocked_business(client, superadmin):
    biz = create_business(client, superadmin)
    staff = add_member(client, biz, "staff")
    sa_h = auth_header(superadmin)

    # Bloklangan foydalanuvchi — token darhol rad etiladi, qayta kira olmaydi
    r = client.patch(f"/api/v1/superadmin/users/{staff['tokens']['user']['id']}/status", headers=sa_h, json={"status": "blocked"})
    assert r.status_code == 204
    assert client.get("/api/v1/auth/me", headers=auth_header(staff["tokens"])).status_code == 401
    phone = staff["tokens"]["user"]["phone"]
    code = client.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_code"]
    r = client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": code})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "user_blocked"

    # Bloklangan biznes — egasida huquq qolmaydi
    assert client.patch(f"/api/v1/superadmin/businesses/{biz['id']}/status", headers=sa_h, json={"status": "blocked"}).status_code == 204
    assert client.get(f"/api/v1/businesses/{biz['id']}/members", headers=auth_header(biz["owner"])).status_code == 403


def test_module_toggle_controls_permissions(client, superadmin):
    biz = create_business(client, superadmin)
    me = lambda: client.get("/api/v1/auth/me", headers=auth_header(biz["owner"])).json()["memberships"][0]["permissions"]
    assert "inventory.view" not in me()
    r = client.put(f"/api/v1/superadmin/businesses/{biz['id']}/modules/inventory", headers=auth_header(superadmin), json={"enabled": True})
    assert r.status_code == 204
    assert {"inventory.view", "inventory.manage"} <= set(me())
