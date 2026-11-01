"""Obuna: to'xtatilgan salon ishlamaydi, ma'lumot yo'qolmaydi, uzaytirilganda shu joyidan davom etadi."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login


def sa(superadmin):
    return auth_header(superadmin)


def membership(client, tokens):
    return client.get("/api/v1/auth/me", headers=auth_header(tokens)).json()["memberships"][0]


def subscribe(client, superadmin, biz, **body):
    r = client.patch(f"/api/v1/superadmin/businesses/{biz['id']}/subscription", headers=sa(superadmin), json=body)
    assert r.status_code == 200, r.text
    return r.json()


def add_service(client, biz):
    r = client.post(f"/api/v1/businesses/{biz['id']}/services", headers=auth_header(biz["owner"]),
                    json={"name": "Soch", "duration_min": 30, "price": 50000})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_me_gives_panel_modules_and_subscription(client, superadmin):
    biz = create_business(client, superadmin, modules=("booking", "finance", "sms"))
    staff = add_member(client, biz, "staff")
    cashier = add_member(client, biz, "receptionist")

    owner = membership(client, biz["owner"])
    assert owner["panel"] == "admin" and owner["operational"] is True
    assert owner["subscription_ends_at"] is None and set(owner["modules"]) == {"booking", "finance", "sms"}

    s = membership(client, staff["tokens"])
    assert s["panel"] == "staff"
    assert "finance.view" not in s["permissions"] and "payments.accept" not in s["permissions"]

    c = membership(client, cashier["tokens"])
    assert c["panel"] == "admin" and {"finance.view", "payments.accept"} <= set(c["permissions"])


def test_suspended_business_is_locked_but_data_stays_and_resumes(client, superadmin):
    biz = create_business(client, superadmin)
    service_id = add_service(client, biz)
    owner = auth_header(biz["owner"])
    services = f"/api/v1/businesses/{biz['id']}/services"

    subscribe(client, superadmin, biz, is_active=False)
    m = membership(client, biz["owner"])
    assert m["operational"] is False and m["permissions"] == []
    assert client.get(services, headers=owner).status_code == 403

    r = client.post(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/renew",
                    headers=sa(superadmin), json={"days": 30})
    assert r.status_code == 200 and r.json()["operational"] is True and r.json()["is_active"] is True
    assert [s["id"] for s in client.get(services, headers=owner).json()] == [service_id]


def test_suspended_business_hidden_from_public(client, superadmin):
    from app.db.session import api_session
    biz = create_business(client, superadmin)
    visible = "SELECT count(*) FROM businesses WHERE id = :b"
    with api_session(None) as db:
        assert db.scalar(text(visible), {"b": biz["id"]}) == 1
    subscribe(client, superadmin, biz, is_active=False)
    with api_session(None) as db:
        assert db.scalar(text(visible), {"b": biz["id"]}) == 0


def test_expired_date_stops_immediately_and_worker_sets_flag(client, superadmin):
    biz = create_business(client, superadmin)
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    row = subscribe(client, superadmin, biz, subscription_ends_at=past)
    assert row["is_active"] is True and row["operational"] is False     # worker kutilmaydi

    from app.worker import expire_subscriptions
    assert expire_subscriptions() >= 1
    rows = client.get("/api/v1/superadmin/businesses", headers=sa(superadmin)).json()
    assert next(b for b in rows if b["id"] == biz["id"])["is_active"] is False


def test_renew_keeps_remaining_days(client, superadmin):
    biz = create_business(client, superadmin)
    ends = datetime.now(timezone.utc) + timedelta(days=10)
    subscribe(client, superadmin, biz, subscription_ends_at=ends.isoformat())
    r = client.post(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/renew",
                    headers=sa(superadmin), json={"days": 30}).json()
    got = datetime.fromisoformat(r["subscription_ends_at"].replace("Z", "+00:00"))
    assert abs(got - (ends + timedelta(days=30))) < timedelta(seconds=5)


def test_owner_cannot_extend_or_activate_own_subscription(client, superadmin):
    biz = create_business(client, superadmin)
    r = client.post(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/renew",
                    headers=auth_header(biz["owner"]), json={"days": 30})
    assert r.status_code == 403

    # Bazada ham: API chetlab o'tilsa, guard to'xtatadi
    from app.db.session import api_session
    me = client.get("/api/v1/auth/me", headers=auth_header(biz["owner"])).json()["user"]["id"]
    with api_session(me) as db:
        with pytest.raises(Exception) as e:
            db.execute(text("UPDATE businesses SET subscription_ends_at = now() + interval '1 year' WHERE id = :b"),
                       {"b": biz["id"]})
        assert "business_field_forbidden" in str(e.value)
        db.rollback()


def test_app_role_cannot_delete_business(client, superadmin):
    biz = create_business(client, superadmin)
    from app.db.session import api_session
    sa_id = client.get("/api/v1/auth/me", headers=sa(superadmin)).json()["user"]["id"]
    with api_session(sa_id) as db:
        with pytest.raises(Exception) as e:
            db.execute(text("DELETE FROM businesses WHERE id = :b"), {"b": biz["id"]})
        assert "permission denied" in str(e.value)
        db.rollback()


def test_superadmin_toggles_module_and_lists(client, superadmin):
    biz = create_business(client, superadmin)
    url = f"/api/v1/superadmin/businesses/{biz['id']}/modules"
    assert "inventory" not in membership(client, biz["owner"])["modules"]

    assert client.put(f"{url}/inventory", headers=sa(superadmin), json={"enabled": True}).status_code == 204
    m = membership(client, biz["owner"])
    assert "inventory" in m["modules"] and "inventory.view" in m["permissions"]

    assert client.put(f"{url}/inventory", headers=sa(superadmin), json={"enabled": False}).status_code == 204
    m = membership(client, biz["owner"])
    assert "inventory" not in m["modules"] and "inventory.view" not in m["permissions"]

    codes = {x["code"] for x in client.get("/api/v1/superadmin/modules", headers=sa(superadmin)).json()}
    assert {"inventory", "finance", "payroll", "sms"} <= codes
    t = otp_login(client, new_phone())
    assert client.get("/api/v1/superadmin/businesses", headers=auth_header(t)).status_code == 403
