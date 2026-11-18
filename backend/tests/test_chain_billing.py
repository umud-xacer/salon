"""Tarmoq obunasi (sql/043): filial chegirmasi, pullik modullar (tarmoqqa bir marta), 1-sanaga to'g'rilash,
kunbay faollashtirish qarzi va uning muhlati."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text

from tests.conftest import DB_NAME, _admin, add_member, auth_header, create_business, new_phone
from tests.test_billing import TZ, billing_keys, next_first, payme, now_ms, prorate, sa, set_sub  # noqa: F401

SA_BIZ = "/api/v1/superadmin/businesses"


@pytest.fixture(scope="module")
def admin_db():
    eng = create_engine(_admin.set(database=DB_NAME))
    yield eng
    eng.dispose()


def info(client, biz_id, tokens):
    r = client.get(f"/api/v1/businesses/{biz_id}/billing", headers=auth_header(tokens))
    assert r.status_code == 200, r.text
    return r.json()


def pay(client, biz_id, tokens, **body):
    r = client.post(f"/api/v1/businesses/{biz_id}/billing/orders", headers=auth_header(tokens),
                    json={"provider": "payme", **body})
    assert r.status_code == 201, r.text
    o = r.json()
    ext = f"pm-{o['id']}-{now_ms()}"
    payme(client, "CreateTransaction", {"id": ext, "time": now_ms(), "amount": o["amount"] * 100,
                                        "account": {"order_id": str(o["id"])}})
    assert payme(client, "PerformTransaction", {"id": ext})["result"]["state"] == 2
    return o


def branch(client, superadmin, parent, name="Filial"):
    r = client.post(SA_BIZ, headers=sa(superadmin), json={
        "name": "Tarmoq", "slug": f"tarmoq-{new_phone()[-7:]}", "category_id": 1, "lat": 41.3, "lng": 69.2,
        "parent_id": parent["id"], "branch_name": name, "modules": ["booking"]})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def ends_of(admin_db, biz_id):
    with admin_db.connect() as c:
        return c.execute(text("SELECT subscription_ends_at FROM businesses WHERE id = :b"), {"b": biz_id}).scalar()


@pytest.fixture()
def module_price(client, superadmin):
    def setp(code, fee):
        r = client.put(f"/api/v1/superadmin/billing/module-prices/{code}", headers=sa(superadmin),
                       json={"monthly_fee": fee, "is_addon": True})
        assert r.status_code == 200, r.text
    yield setp
    for code in ("inventory", "payroll"):
        setp(code, 0)


def test_prorate_by_calendar_days(admin_db):
    with admin_db.connect() as c:
        q = lambda f, a, b: c.execute(text("SELECT app.prorate(:f, CAST(:a AS timestamptz), CAST(:b AS timestamptz))"),
                                      {"f": f, "a": a, "b": b}).scalar()
        assert q(70000, "2026-11-12 15:00+05", "2026-12-01 00:00+05") == 70000 * 19 // 30      # TZ misoli: 44 333
        assert q(28000, "2027-02-10 09:00+05", "2027-03-01 00:00+05") == 19000                 # fevral 28 kun
        assert q(30000, "2026-11-16 00:00+05", "2027-01-01 00:00+05") == 15000 + 30000         # oylar kesishmasi
        assert c.execute(text("SELECT app.next_first(CAST('2026-12-01 00:00+05' AS timestamptz))")).scalar() \
            == datetime(2026, 12, 1, tzinfo=TZ)


def test_month_math_in_tashkent_time_on_utc_database(admin_db):
    """Prod bazasi UTC da: 30-noyabr 19:00 UTC (= 1-dekabr Toshkent) + 1 oy = 1-yanvar Toshkent, 30-dekabr emas."""
    with admin_db.connect() as c:
        c.exec_driver_sql("SET TIME ZONE 'UTC'")
        q = lambda sql: c.execute(text(sql)).scalar()
        assert q("SELECT app.next_first(CAST('2026-12-15 20:24+05' AS timestamptz))") == datetime(2027, 1, 1, tzinfo=TZ)
        assert q("SELECT app.add_months_local(CAST('2026-12-01 00:00+05' AS timestamptz), 1)") == datetime(2027, 1, 1, tzinfo=TZ)
        assert q("SELECT app.add_months_local(CAST('2027-01-01 00:00+05' AS timestamptz), 2)") == datetime(2027, 3, 1, tzinfo=TZ)


def test_tz_example_188000(client, superadmin, admin_db, module_price):
    """Asosiy 70 000 + 2 filial (30%) 49 000 + Ombor 20 000 = 188 000 so'm/oy."""
    head = create_business(client, superadmin, modules=("booking", "inventory"))
    aligned = next_first(datetime.now(timezone.utc)) + timedelta(days=31)
    aligned = next_first(aligned)
    set_sub(client, superadmin, head, monthly_fee=70000, subscription_ends_at=aligned.isoformat())
    b1, b2 = branch(client, superadmin, head, "Yunusobod"), branch(client, superadmin, head, "Chilonzor")
    module_price("inventory", 20000)
    with admin_db.begin() as c:   # direktor sotib olgan modul (to'lov oqimi pastdagi testda)
        c.execute(text("UPDATE business_modules SET source = 'paid' WHERE business_id = :b AND module_code = 'inventory'"),
                  {"b": head["id"]})

    data = info(client, head["id"], head["owner"])
    lines = [(x["kind"], x["amount"], x["discount_pct"]) for x in data["lines"]]
    assert lines == [("base", 70000, 0), ("branch", 49000, 30), ("branch", 49000, 30), ("module", 20000, 0)]
    assert data["monthly_fee"] == 188000
    # Muddat 1-sanada: kunbay qism yo'q; 1 oy = 188 000 + filiallar faollashtirish qarzi
    one = next(p for p in data["packages"] if p["months"] == 1)
    assert one["prorate_amount"] == 0 and one["months_amount"] == 188000
    assert one["amount"] == 188000 + data["charges_total"] and data["charges_total"] > 0
    assert {c["business_id"] for c in data["charges"]} == {b1, b2}
    assert all(p["months"] != 0 for p in data["packages"])            # "faqat 1-sanagacha" varianti yo'q

    # Filial sahifasidan ham — o'sha tarmoq hisobi
    assert info(client, b1, head["owner"])["business_id"] == head["id"]

    # To'langach: tarmoqning hammasi bir xil muddat, qarzlar yopildi
    o = pay(client, head["id"], head["owner"], kind="renew", months=1)
    assert o["amount"] == one["amount"]
    want = next_first(aligned + timedelta(days=1))
    assert ends_of(admin_db, head["id"]) == ends_of(admin_db, b1) == ends_of(admin_db, b2) == want
    assert info(client, head["id"], head["owner"])["charges_total"] == 0


def test_activation_prorate_and_grace(client, superadmin, admin_db):
    """Yangi kompaniya: 1-sanagacha kunbay qarz, 1 kun muhlat; to'lanmasa yopiladi, to'lagach ochiladi."""
    phone = new_phone()
    r = client.post(SA_BIZ, headers=sa(superadmin), json={
        "name": "Yangi Salon", "slug": f"yangi-{phone[-7:]}", "category_id": 1, "lat": 41.3, "lng": 69.2,
        "owner_phone": phone, "owner_full_name": "Direktor", "modules": ["booking"], "billing_mode": "activation"})
    assert r.status_code == 201, r.text
    from tests.conftest import otp_login
    biz = {"id": r.json()["id"], "owner": otp_login(client, phone)}
    now = datetime.now(timezone.utc)
    grace_end = ends_of(admin_db, biz["id"])
    assert timedelta(hours=23) < grace_end - now <= timedelta(days=1)

    data = info(client, biz["id"], biz["owner"])
    assert data["charges_total"] == prorate(199000, now) and data["charges"][0]["kind"] == "activation"

    # Muhlat o'tdi — panel yopiladi (to'lov sahifasi qoladi)
    with admin_db.begin() as c:
        c.execute(text("UPDATE businesses SET subscription_ends_at = now() - interval '1 hour' WHERE id = :b"),
                  {"b": biz["id"]})
    me = client.get("/api/v1/auth/me", headers=auth_header(biz["owner"])).json()["memberships"][0]
    assert me["operational"] is False

    o = pay(client, biz["id"], biz["owner"], kind="charges")
    assert o["amount"] == data["charges_total"]
    assert ends_of(admin_db, biz["id"]) == next_first(now)
    me = client.get("/api/v1/auth/me", headers=auth_header(biz["owner"])).json()["memberships"][0]
    assert me["operational"] is True


def test_branch_activation_until_chain_end(client, superadmin, admin_db):
    head = create_business(client, superadmin)
    chain_end = next_first(next_first(datetime.now(timezone.utc)) + timedelta(days=40))   # ~2 oy oldinda, 1-sana
    set_sub(client, superadmin, head, monthly_fee=100000, subscription_ends_at=chain_end.isoformat())
    b = branch(client, superadmin, head)
    # 5 kun bepul imtiyoz (sql/064), keyin tarmoq muddatigacha kunbay
    with admin_db.connect() as c:
        expect = c.execute(text("SELECT app.prorate(70000, now() + interval '5 days', :e)"), {"e": chain_end}).scalar()
    data = info(client, head["id"], head["owner"])
    assert [(x["business_id"], x["amount"], x["kind"]) for x in data["charges"]] == [(b, expect, "branch")]
    left = ends_of(admin_db, b) - datetime.now(timezone.utc)
    assert timedelta(days=4, hours=23) < left <= timedelta(days=5)                      # imtiyoz
    pay(client, b, head["owner"], kind="charges")                                      # filial sahifasidan
    assert ends_of(admin_db, b) == chain_end and ends_of(admin_db, head["id"]) == chain_end


def test_paid_module_flow_cancel_resume_and_gift(client, superadmin, admin_db, module_price):
    head = create_business(client, superadmin, modules=("booking", "payroll"))      # payroll — Super Admin sovg'asi
    chain_end = next_first(datetime.now(timezone.utc) + timedelta(days=3))
    set_sub(client, superadmin, head, monthly_fee=100000, subscription_ends_at=chain_end.isoformat())
    b = branch(client, superadmin, head)
    module_price("inventory", 20000)
    module_price("payroll", 15000)

    data = info(client, head["id"], head["owner"])
    addons = {a["module_code"]: a for a in data["addons"]}
    assert addons["payroll"]["state"] == "gift"                       # sovg'a — pulga kirmaydi
    assert addons["inventory"]["state"] == "off"
    with admin_db.connect() as c:
        price_now = c.execute(text("SELECT app.prorate(20000, now(), :e)"), {"e": chain_end}).scalar()
    assert addons["inventory"]["price_now"] == max(price_now, 1)
    assert all(x["kind"] != "module" for x in data["lines"])

    o = pay(client, head["id"], head["owner"], kind="module", module_code="inventory")
    assert o["amount"] == max(price_now, 1)
    for biz_id in (head["id"], b):                                    # tarmoqning hamma filialida yoqildi
        with admin_db.connect() as c:
            assert c.execute(text("SELECT app.module_enabled(:b, 'inventory')"), {"b": biz_id}).scalar() is True
    data = info(client, head["id"], head["owner"])
    assert [x["amount"] for x in data["lines"] if x["kind"] == "module"] == [20000]
    assert {a["module_code"]: a["state"] for a in data["addons"]}["inventory"] == "active"

    # O'chirish — muddat oxirigacha ishlaydi, keyingi to'lovga kirmaydi; qayta yoqish — bepul
    url = f"/api/v1/businesses/{head['id']}/billing/addons/inventory"
    staff = add_member(client, head, "manager")
    assert client.post(f"{url}/cancel", headers=auth_header(staff["tokens"])).status_code == 403
    assert client.post(f"{url}/cancel", headers=auth_header(head["owner"])).status_code == 204
    data = info(client, head["id"], head["owner"])
    assert {a["module_code"]: a["state"] for a in data["addons"]}["inventory"] == "cancelling"
    assert all(x["kind"] != "module" for x in data["lines"])
    with admin_db.connect() as c:
        assert c.execute(text("SELECT app.module_enabled(:b, 'inventory')"), {"b": head["id"]}).scalar() is True
    assert client.post(f"{url}/resume", headers=auth_header(head["owner"])).status_code == 204
    assert [x["amount"] for x in info(client, head["id"], head["owner"])["lines"] if x["kind"] == "module"] == [20000]


def test_director_cannot_touch_modules_directly(client, superadmin):
    head = create_business(client, superadmin)
    from app.db.session import api_session
    uid = client.get("/api/v1/auth/me", headers=auth_header(head["owner"])).json()["user"]["id"]
    with api_session(uid) as db:
        with pytest.raises(Exception):
            db.execute(text("""INSERT INTO business_modules (business_id, module_code, enabled, source)
                               VALUES (:b, 'inventory', TRUE, 'paid')"""), {"b": head["id"]})
        db.rollback()


def test_superadmin_branch_discount_and_settings(client, superadmin):
    plans = client.get("/api/v1/superadmin/billing/plans", headers=sa(superadmin)).json()
    start = next(p for p in plans if p["name"] == "Start")
    assert start["branch_discount_pct"] == 30
    try:
        r = client.patch(f"/api/v1/superadmin/billing/plans/{start['id']}", headers=sa(superadmin),
                         json={"branch_discount_pct": 50})
        assert r.status_code == 200 and r.json()["branch_discount_pct"] == 50
        head = create_business(client, superadmin)
        branch(client, superadmin, head)
        lines = info(client, head["id"], head["owner"])["lines"]
        assert [x["amount"] for x in lines] == [199000, 199000 // 2]
    finally:
        client.patch(f"/api/v1/superadmin/billing/plans/{start['id']}", headers=sa(superadmin),
                     json={"branch_discount_pct": 30})
    r = client.put("/api/v1/superadmin/billing/settings", headers=sa(superadmin), json={"activation_grace_days": 3})
    assert r.status_code == 200 and r.json()["activation_grace_days"] == 3
    client.put("/api/v1/superadmin/billing/settings", headers=sa(superadmin), json={"activation_grace_days": 1})
    head = create_business(client, superadmin)
    assert client.put("/api/v1/superadmin/billing/settings", headers=auth_header(head["owner"]),
                      json={"activation_grace_days": 9}).status_code == 403
