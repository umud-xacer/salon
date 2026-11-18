"""Direktor filialni o'zi qo'shadi, filialning bepul imtiyozli davri (sql/064_director_branches.sql)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from tests.conftest import add_member, auth_header, create_business
from tests.test_billing import billing_keys, next_first, sa, set_sub  # noqa: F401
from tests.test_chain_billing import admin_db, ends_of, info, pay  # noqa: F401

BODY = {"branch_name": "Sergeli filiali", "region": "Toshkent shahri", "city": "Sergeli", "address": "Yangi Sergeli 5",
        "lat": 41.23, "lng": 69.21}


def url(biz, tail=""):
    return f"/api/v1/businesses/{biz['id']}/branches{tail}"


def chain(client, superadmin, months_ahead=2):
    head = create_business(client, superadmin)
    end = next_first(datetime.now(timezone.utc))
    for _ in range(months_ahead - 1):
        end = next_first(end + timedelta(days=1))
    set_sub(client, superadmin, head, monthly_fee=100000, subscription_ends_at=end.isoformat())
    return head, end


def test_director_adds_branch_with_five_free_days(client, superadmin, admin_db, billing_keys):
    head, end = chain(client, superadmin)
    h = auth_header(head["owner"])
    q = client.get(url(head), headers=h)
    assert q.status_code == 200, q.text
    quote = q.json()["quote"]
    assert quote["monthly_fee"] == 70000 and quote["discount_pct"] == 30 and q.json()["branches"] == []
    free_left = datetime.fromisoformat(quote["free_until"]) - datetime.now(timezone.utc)
    assert timedelta(days=4, hours=23) < free_left <= timedelta(days=5, minutes=1)

    r = client.post(url(head), headers=h, json=BODY)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["slug"].startswith(head["slug"] + "-sergeli-filiali") and b["operational"] is True
    with admin_db.connect() as c:
        row = c.execute(text("""SELECT parent_id, plan_id IS NOT DISTINCT FROM (SELECT plan_id FROM businesses WHERE id = :h) AS same_plan,
                                       is_solo_mode, location IS NOT NULL AS loc,
                                       (SELECT count(*) FROM business_hours WHERE business_id = b.id) AS hours,
                                       (SELECT role FROM business_members WHERE business_id = b.id) AS role
                                  FROM businesses b WHERE b.id = :b"""), {"b": b["id"], "h": head["id"]}).mappings().one()
        expect = c.execute(text("SELECT app.prorate(70000, now() + interval '5 days', :e)"), {"e": end}).scalar()
    assert row["parent_id"] == head["id"] and row["same_plan"] and row["is_solo_mode"] is False and row["loc"]
    assert row["hours"] == 6 and row["role"] == "owner"

    # Qarz: 5 kun bepul, keyin tarmoq muddatigacha; filial ham, asosiy ham bitta chekda ko'rinadi
    data = info(client, head["id"], head["owner"])
    assert [(x["business_id"], x["amount"], x["kind"]) for x in data["charges"]] == [(b["id"], expect, "branch")]
    me = client.get("/api/v1/auth/me", headers=h).json()["memberships"]
    assert any(m["business_id"] == b["id"] and m["operational"] for m in me)

    # Imtiyoz tugadi — filial yopiladi (to'lov oynasi), asosiy ishlayveradi
    with admin_db.begin() as c:
        c.execute(text("UPDATE businesses SET subscription_ends_at = now() - interval '1 hour' WHERE id = :b"), {"b": b["id"]})
    me = {m["business_id"]: m for m in client.get("/api/v1/auth/me", headers=h).json()["memberships"]}
    assert me[b["id"]]["operational"] is False and me[head["id"]]["operational"] is True
    # Filial sahifasidan to'lanadi — muddat tarmoqqa tenglashadi
    assert info(client, b["id"], head["owner"])["charges_total"] == expect
    pay(client, b["id"], head["owner"], kind="charges")
    assert ends_of(admin_db, b["id"]) == end
    listed = client.get(url(head), headers=h).json()["branches"]
    assert [x["id"] for x in listed] == [b["id"]] and listed[0]["operational"] is True

    # Ikkinchi filial — slug takrorlanmaydi
    r2 = client.post(url(head), headers=h, json=BODY)
    assert r2.status_code == 201 and r2.json()["slug"] != b["slug"]


def test_grace_reaching_chain_end_is_free(client, superadmin, admin_db):
    head = create_business(client, superadmin)
    end = datetime.now(timezone.utc) + timedelta(days=3)
    set_sub(client, superadmin, head, monthly_fee=100000, subscription_ends_at=end.isoformat())
    q = client.get(url(head), headers=auth_header(head["owner"])).json()["quote"]
    assert q["amount"] == 0
    b = client.post(url(head), headers=auth_header(head["owner"]), json=BODY).json()
    assert info(client, head["id"], head["owner"])["charges"] == []
    assert abs((ends_of(admin_db, b["id"]) - end).total_seconds()) < 1


def test_branch_rules_and_permissions(client, superadmin, admin_db):
    head, _ = chain(client, superadmin)
    h = auth_header(head["owner"])
    staff = add_member(client, head, "manager")
    assert client.post(url(head), headers=auth_header(staff["tokens"]), json=BODY).status_code == 403
    assert client.get(url(head), headers=auth_header(staff["tokens"])).status_code == 403

    bad = client.post(url(head), headers=h, json={**BODY, "branch_name": " x "})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_branch_name"
    bad = client.post(url(head), headers=h, json={**BODY, "lat": 95})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "location_required"

    b = client.post(url(head), headers=h, json=BODY).json()
    r = client.post(f"/api/v1/businesses/{b['id']}/branches", headers=h, json=BODY)       # filialning filiali yo'q
    assert r.status_code == 409 and r.json()["detail"]["code"] == "branch_parent_invalid"

    # Asosiy obuna tugagan — avval to'lov
    with admin_db.begin() as c:
        c.execute(text("UPDATE businesses SET subscription_ends_at = now() - interval '1 hour' WHERE id = :h"), {"h": head["id"]})
    r = client.post(url(head), headers=h, json=BODY)
    assert r.status_code in (402, 403)

    # Boshqa direktor begona tarmoqqa filial qo'sha olmaydi
    other = create_business(client, superadmin)
    assert client.post(url(head), headers=auth_header(other["owner"]), json=BODY).status_code == 403


def test_branch_grace_setting(client, superadmin):
    r = client.get("/api/v1/superadmin/billing/settings", headers=sa(superadmin))
    assert r.json()["branch_grace_days"] == 5
    try:
        r = client.put("/api/v1/superadmin/billing/settings", headers=sa(superadmin),
                       json={"activation_grace_days": 1, "branch_grace_days": 7})
        assert r.status_code == 200 and r.json()["branch_grace_days"] == 7
        head, _ = chain(client, superadmin)
        q = client.get(url(head), headers=auth_header(head["owner"])).json()["quote"]
        left = datetime.fromisoformat(q["free_until"]) - datetime.now(timezone.utc)
        assert timedelta(days=6, hours=23) < left <= timedelta(days=7, minutes=1)
    finally:
        client.put("/api/v1/superadmin/billing/settings", headers=sa(superadmin),
                   json={"activation_grace_days": 1, "branch_grace_days": 5})
