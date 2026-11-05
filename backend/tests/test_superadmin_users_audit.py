"""W7 Super Admin: foydalanuvchilar ro'yxati (qidiruv, bloklash) va audit jurnali."""
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login


def sa(superadmin):
    return auth_header(superadmin)


def users(client, superadmin, **params):
    r = client.get("/api/v1/superadmin/users", headers=sa(superadmin), params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_search_by_phone_and_name_and_kind(client, superadmin):
    phone = new_phone()
    customer = otp_login(client, phone, "Zulfiya Qidiruvova")
    biz = create_business(client, superadmin)
    usta = add_member(client, biz, "staff")

    page = users(client, superadmin, q=phone[-7:])
    assert [u["id"] for u in page["items"]] == [customer["user"]["id"]] and page["total"] == 1
    assert users(client, superadmin, q="qidiruvova")["items"][0]["phone"] == phone

    staff_ids = {u["id"] for u in users(client, superadmin, kind="staff", limit=200)["items"]}
    client_ids = {u["id"] for u in users(client, superadmin, kind="client", limit=200)["items"]}
    assert usta["tokens"]["user"]["id"] in staff_ids and customer["user"]["id"] in client_ids
    assert not staff_ids & client_ids
    owner = next(u for u in users(client, superadmin, q=biz["owner"]["user"]["phone"][-9:])["items"])
    assert owner["memberships"] == [{"business_id": biz["id"], "business_name": f"Salon {biz['slug']}", "role": "owner"}]
    assert users(client, superadmin, kind="superadmin")["items"][0]["is_superadmin"] is True

    # LIKE belgilari qidiruvni buzmaydi
    assert users(client, superadmin, q="%")["total"] >= 0


def test_block_user_logs_out_and_is_audited(client, superadmin):
    customer = otp_login(client, new_phone(), "Bloklanuvchi")
    uid = customer["user"]["id"]
    me = "/api/v1/auth/me"
    assert client.get(me, headers=auth_header(customer)).status_code == 200

    r = client.patch(f"/api/v1/superadmin/users/{uid}/status", headers=sa(superadmin), json={"status": "blocked"})
    assert r.status_code == 204
    assert client.get(me, headers=auth_header(customer)).status_code == 401
    assert users(client, superadmin, q=customer["user"]["phone"][-9:], status="blocked")["total"] == 1

    assert client.patch(f"/api/v1/superadmin/users/{uid}/status", headers=sa(superadmin),
                        json={"status": "active"}).status_code == 204

    r = client.get("/api/v1/superadmin/audit", headers=sa(superadmin), params={"entity_type": "user", "platform_only": True})
    assert r.status_code == 200, r.text
    mine = [a for a in r.json() if a["entity_id"] == uid]
    assert [a["action"] for a in mine] == ["unblock", "block"]
    assert mine[0]["user_name"] == "Super Admin" and mine[0]["business_id"] is None


def test_cannot_block_superadmin(client, superadmin):
    r = client.patch(f"/api/v1/superadmin/users/{superadmin['user']['id']}/status", headers=sa(superadmin),
                     json={"status": "blocked"})
    assert r.status_code == 403


def test_audit_filters_and_paging(client, superadmin):
    biz = create_business(client, superadmin)
    for d in (1, 2, 3):
        assert client.post(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/renew", headers=sa(superadmin),
                           json={"days": d}).status_code == 200
    url = "/api/v1/superadmin/audit"
    rows = client.get(url, headers=sa(superadmin), params={"business_id": biz["id"], "entity_type": "subscription"}).json()
    assert [a["changes"]["days"] for a in rows] == [3, 2, 1]
    assert rows[0]["business_name"] == f"Salon {biz['slug']}"
    page2 = client.get(url, headers=sa(superadmin),
                       params={"business_id": biz["id"], "entity_type": "subscription", "before_id": rows[0]["id"], "limit": 1}).json()
    assert [a["id"] for a in page2] == [rows[1]["id"]]
    types = client.get(f"{url}/entity-types", headers=sa(superadmin)).json()
    assert "subscription" in types


def test_users_and_audit_closed_for_others(client, superadmin):
    biz = create_business(client, superadmin)
    for tokens in (biz["owner"], otp_login(client, new_phone())):
        for path in ("/api/v1/superadmin/users", "/api/v1/superadmin/audit", "/api/v1/superadmin/audit/entity-types"):
            assert client.get(path, headers=auth_header(tokens)).status_code == 403
