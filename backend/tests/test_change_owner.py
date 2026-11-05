"""Super Admin: muassasa direktorini almashtirish va ismini tuzatish."""
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login


def change(client, superadmin, biz, **body):
    return client.put(f"/api/v1/superadmin/businesses/{biz['id']}/owner", headers=auth_header(superadmin), json=body)


def memberships(client, tokens):
    return client.get("/api/v1/auth/me", headers=auth_header(tokens)).json()["memberships"]


def test_replace_owner_old_becomes_manager(client, superadmin):
    biz = create_business(client, superadmin)
    phone = new_phone()
    r = change(client, superadmin, biz, phone=phone, full_name="  Yangi   Direktor ", password="Direktor2026x")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["owner_name"] == "Yangi Direktor" and b["owner_phone"] == phone and b["owner_password_status"] == "issued"

    # Eski direktor endi menejer
    (old,) = [m for m in memberships(client, biz["owner"]) if m["business_id"] == biz["id"]]
    assert old["role"] == "manager"
    # Yangi direktor berilgan parol bilan kiradi va direktor
    login = client.post("/api/v1/auth/login", json={"phone": phone, "password": "Direktor2026x"})
    assert login.status_code == 200, login.text
    (new,) = [m for m in memberships(client, login.json()) if m["business_id"] == biz["id"]]
    assert new["role"] == "owner" and "business.manage" in new["permissions"]

    audit = client.get("/api/v1/superadmin/audit", headers=auth_header(superadmin),
                       params={"business_id": biz["id"], "entity_type": "owner"}).json()
    assert audit and audit[0]["action"] == "change" and audit[0]["changes"]["previous"] == "manager"


def test_remove_previous_owner_and_promote_existing_staff(client, superadmin):
    biz = create_business(client, superadmin)
    rec = add_member(client, biz, "receptionist")
    r = change(client, superadmin, biz, phone=rec["member"]["phone"], full_name="Kassir Direktor", previous="remove")
    assert r.status_code == 200, r.text
    assert r.json()["owner_member_id"] == rec["member"]["id"]                  # o'sha a'zolik ko'tarildi
    assert [m for m in memberships(client, biz["owner"]) if m["business_id"] == biz["id"]] == []
    (m,) = [m for m in memberships(client, rec["tokens"]) if m["business_id"] == biz["id"]]
    assert m["role"] == "owner"
    # Faol direktor bitta
    staff = client.get(f"/api/v1/businesses/{biz['id']}/members", headers=auth_header(rec["tokens"])).json()
    assert [x["role"] for x in staff if x["is_active"]].count("owner") == 1


def test_same_phone_only_renames(client, superadmin):
    biz = create_business(client, superadmin)
    phone = biz["owner"]["user"]["phone"]
    r = change(client, superadmin, biz, phone=phone, full_name="Tuzatilgan Ism")
    assert r.status_code == 200, r.text
    assert r.json()["owner_name"] == "Tuzatilgan Ism" and r.json()["owner_member_id"] == biz["owner_member_id"]
    (m,) = [m for m in memberships(client, biz["owner"]) if m["business_id"] == biz["id"]]
    assert m["role"] == "owner"


def test_validation_and_permissions(client, superadmin):
    biz = create_business(client, superadmin)
    assert change(client, superadmin, biz, phone="123", full_name="X Y").status_code == 422
    assert change(client, superadmin, biz, phone=new_phone(), full_name="A").status_code == 422
    assert change(client, superadmin, biz, phone=new_phone(), full_name="Ali Vali", password="short").status_code == 422
    assert change(client, superadmin, biz, phone=new_phone(), full_name="Ali Vali", previous="x").status_code == 422
    # Direktorning o'zi o'zini almashtira olmaydi
    r = client.put(f"/api/v1/superadmin/businesses/{biz['id']}/owner", headers=auth_header(biz["owner"]),
                   json={"phone": new_phone(), "full_name": "Boshqa Odam"})
    assert r.status_code == 403
    # O'z paroli bor odamga parol yozilmaydi (u mijoz hisobi)
    customer_phone = new_phone()
    customer = otp_login(client, customer_phone, "Mijoz")
    assert client.post("/api/v1/auth/password", headers=auth_header(customer),
                       json={"new_password": "OwnPass2026x"}).status_code in (200, 204)
    r = change(client, superadmin, biz, phone=customer_phone, full_name="Mijoz Direktor", password="Direktor2026x")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "has_own_password"
    # Paroli bo'lmasa — o'tkaziladi, o'z paroli bilan kiradi
    assert change(client, superadmin, biz, phone=customer_phone, full_name="Mijoz Direktor").status_code == 200
