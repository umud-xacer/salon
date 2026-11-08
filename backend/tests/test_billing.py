"""Onlayn obuna to'lovi: Payme va Click webhook'lari, narxni baza hisoblashi, obuna uzayishi va panel ochilishi."""
import base64
import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import SecretStr
from sqlalchemy import text

from tests.conftest import add_member, auth_header, create_business

PAYME_KEY = "test-payme-key"
CLICK_SECRET = "test-click-secret"
CLICK_SERVICE = 777


@pytest.fixture(autouse=True)
def billing_keys(monkeypatch):
    from app.core.config import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "payme_merchant_id", "merchant123")
    monkeypatch.setattr(s, "payme_key", SecretStr(PAYME_KEY))
    monkeypatch.setattr(s, "click_service_id", CLICK_SERVICE)
    monkeypatch.setattr(s, "click_merchant_id", 555)
    monkeypatch.setattr(s, "click_secret_key", SecretStr(CLICK_SECRET))


def sa(superadmin):
    return auth_header(superadmin)


def set_sub(client, superadmin, biz, **body):
    r = client.patch(f"/api/v1/superadmin/businesses/{biz['id']}/subscription", headers=sa(superadmin), json=body)
    assert r.status_code == 200, r.text
    return r.json()


def order(client, biz, months=1, provider="payme"):
    r = client.post(f"/api/v1/businesses/{biz['id']}/billing/orders", headers=auth_header(biz["owner"]),
                    json={"months": months, "provider": provider})
    assert r.status_code == 201, r.text
    return r.json()


def payme(client, method, params, key=PAYME_KEY):
    auth = base64.b64encode(f"Paycom:{key}".encode()).decode()
    r = client.post("/api/v1/billing/payme", headers={"Authorization": f"Basic {auth}"},
                    json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    assert r.status_code == 200, r.text
    return r.json()


def now_ms():
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def membership(client, tokens):
    return client.get("/api/v1/auth/me", headers=auth_header(tokens)).json()["memberships"][0]


def expired_business(client, superadmin):
    biz = create_business(client, superadmin)
    set_sub(client, superadmin, biz, subscription_ends_at=(datetime.now(timezone.utc) - timedelta(days=2)).isoformat())
    assert membership(client, biz["owner"])["operational"] is False
    return biz


# ─── Direktor sahifasi ──────────────────────────────────────────────────────
def test_owner_sees_billing_when_expired_staff_does_not(client, superadmin):
    biz = expired_business(client, superadmin)
    staff = add_member(client, biz, "staff", actor=superadmin)
    set_sub(client, superadmin, biz, monthly_fee=300000)

    r = client.get(f"/api/v1/businesses/{biz['id']}/billing", headers=auth_header(biz["owner"]))
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["operational"] is False and info["days_left"] < 0 and info["monthly_fee"] == 300000
    assert {p["months"]: p["amount"] for p in info["packages"]} == {1: 300000, 3: 900000, 6: 1800000, 12: 3600000}
    assert info["providers"] == {"payme": True, "click": True}

    assert client.get(f"/api/v1/businesses/{biz['id']}/billing", headers=auth_header(staff["tokens"])).status_code == 403
    r = client.post(f"/api/v1/businesses/{biz['id']}/billing/orders", headers=auth_header(staff["tokens"]),
                    json={"months": 1, "provider": "payme"})
    assert r.status_code == 403


def test_package_discount_and_pay_urls(client, superadmin):
    biz = create_business(client, superadmin)
    r = client.put("/api/v1/superadmin/billing/packages/12", headers=sa(superadmin),
                   json={"months": 12, "discount_pct": 10, "is_active": True})
    assert r.status_code == 200, r.text
    try:
        o = order(client, biz, months=12)
        assert o["amount"] == 199000 * 12 * 90 // 100 and o["status"] == "created"
        decoded = base64.b64decode(o["pay_url"].rsplit("/", 1)[1]).decode()
        assert f"ac.order_id={o['id']}" in decoded and f"a={o['amount'] * 100}" in decoded
        c = order(client, biz, months=1, provider="click")
        assert "my.click.uz" in c["pay_url"] and f"transaction_param={c['id']}" in c["pay_url"]
    finally:
        client.put("/api/v1/superadmin/billing/packages/12", headers=sa(superadmin),
                   json={"months": 12, "discount_pct": 0, "is_active": True})


def test_amount_is_set_by_database_not_by_request(client, superadmin):
    biz = create_business(client, superadmin)
    from app.db.session import api_session
    me = client.get("/api/v1/auth/me", headers=auth_header(biz["owner"])).json()["user"]["id"]
    with api_session(me) as db:
        row = db.execute(text("""INSERT INTO billing_orders (business_id, months, amount, provider, status)
                                 VALUES (:b, 3, 1, 'payme', 'paid') RETURNING amount, status"""),
                         {"b": biz["id"]}).one()
        assert row.amount == 199000 * 3 and row.status == "created"
        # Holatni ilova o'zgartira olmaydi — faqat to'lov funksiyalari
        with pytest.raises(Exception) as e:
            db.execute(text("UPDATE billing_orders SET status = 'paid' WHERE business_id = :b"), {"b": biz["id"]})
        assert "permission denied" in str(e.value)
        db.rollback()
        with pytest.raises(Exception) as e:
            db.execute(text("SELECT app.billing_apply(1, 'payme')"))
        assert "permission denied" in str(e.value)
        db.rollback()
        with pytest.raises(Exception) as e:
            db.execute(text("UPDATE businesses SET monthly_fee = 1 WHERE id = :b"), {"b": biz["id"]})
        assert "business_field_forbidden" in str(e.value)
        db.rollback()


def test_other_business_owner_cannot_order(client, superadmin):
    a, b = create_business(client, superadmin), create_business(client, superadmin)
    r = client.post(f"/api/v1/businesses/{a['id']}/billing/orders", headers=auth_header(b["owner"]),
                    json={"months": 1, "provider": "payme"})
    assert r.status_code == 403


def test_blocked_business_cannot_pay(client, superadmin):
    biz = create_business(client, superadmin)
    assert client.patch(f"/api/v1/superadmin/businesses/{biz['id']}/status", headers=sa(superadmin),
                        json={"status": "blocked"}).status_code == 204
    r = client.post(f"/api/v1/businesses/{biz['id']}/billing/orders", headers=auth_header(biz["owner"]),
                    json={"months": 1, "provider": "payme"})
    assert r.status_code == 403


def test_disabled_provider_is_refused(client, superadmin, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "payme_key", None)
    biz = create_business(client, superadmin)
    r = client.post(f"/api/v1/businesses/{biz['id']}/billing/orders", headers=auth_header(biz["owner"]),
                    json={"months": 1, "provider": "payme"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "provider_disabled"


# ─── Payme ──────────────────────────────────────────────────────────────────
def test_payme_full_flow_unlocks_expired_panel(client, superadmin):
    biz = expired_business(client, superadmin)
    o = order(client, biz, months=3)
    tiyin = o["amount"] * 100
    account = {"order_id": str(o["id"])}

    assert payme(client, "CheckPerformTransaction", {"amount": tiyin, "account": account})["result"] == {"allow": True}
    created = payme(client, "CreateTransaction", {"id": "pm-1", "time": now_ms(), "amount": tiyin, "account": account})
    assert created["result"]["state"] == 1
    again = payme(client, "CreateTransaction", {"id": "pm-1", "time": now_ms(), "amount": tiyin, "account": account})
    assert again["result"]["transaction"] == created["result"]["transaction"]      # takroriy so'rov — o'sha tranzaksiya

    done = payme(client, "PerformTransaction", {"id": "pm-1"})["result"]
    assert done["state"] == 2 and done["perform_time"] > 0
    assert payme(client, "PerformTransaction", {"id": "pm-1"})["result"]["perform_time"] == done["perform_time"]

    m = membership(client, biz["owner"])
    assert m["operational"] is True
    ends = datetime.fromisoformat(m["subscription_ends_at"].replace("Z", "+00:00"))
    assert timedelta(days=88) < ends - datetime.now(timezone.utc) < timedelta(days=93)   # hozirdan 3 oy

    info = client.get(f"/api/v1/businesses/{biz['id']}/billing", headers=auth_header(biz["owner"])).json()
    assert info["orders"][0]["status"] == "paid"
    pays = client.get(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/payments", headers=sa(superadmin)).json()
    assert pays[0]["method"] == "payme" and pays[0]["amount"] == o["amount"]

    check = payme(client, "CheckTransaction", {"id": "pm-1"})["result"]
    assert check["state"] == 2 and check["cancel_time"] == 0
    assert payme(client, "CancelTransaction", {"id": "pm-1", "reason": 5})["error"]["code"] == -31007
    # To'langan buyurtmaga ikkinchi to'lov yo'q
    assert payme(client, "CheckPerformTransaction", {"amount": tiyin, "account": account})["error"]["code"] == -31051
    stmt = payme(client, "GetStatement", {"from": now_ms() - 60_000, "to": now_ms() + 60_000})["result"]["transactions"]
    assert any(t["id"] == "pm-1" and t["state"] == 2 and t["account"]["order_id"] == str(o["id"]) for t in stmt)


def test_payme_renew_keeps_remaining_days(client, superadmin):
    biz = create_business(client, superadmin)
    ends = datetime.now(timezone.utc) + timedelta(days=10)
    set_sub(client, superadmin, biz, subscription_ends_at=ends.isoformat())
    o = order(client, biz, months=1)
    acc = {"order_id": str(o["id"])}
    payme(client, "CreateTransaction", {"id": "pm-keep", "time": now_ms(), "amount": o["amount"] * 100, "account": acc})
    payme(client, "PerformTransaction", {"id": "pm-keep"})
    got = datetime.fromisoformat(membership(client, biz["owner"])["subscription_ends_at"].replace("Z", "+00:00"))
    assert timedelta(days=38) < got - datetime.now(timezone.utc) < timedelta(days=42)    # 10 kun + 1 oy


def test_payme_errors(client, superadmin):
    biz = create_business(client, superadmin)
    o = order(client, biz)
    acc = {"order_id": str(o["id"])}
    tiyin = o["amount"] * 100
    assert payme(client, "CheckPerformTransaction", {"amount": tiyin, "account": acc}, key="wrong")["error"]["code"] == -32504
    assert payme(client, "CheckPerformTransaction", {"amount": tiyin + 100, "account": acc})["error"]["code"] == -31001
    assert payme(client, "CheckPerformTransaction", {"amount": tiyin, "account": {"order_id": "999999"}})["error"]["code"] == -31050
    assert payme(client, "PerformTransaction", {"id": "no-such"})["error"]["code"] == -31003
    assert payme(client, "Unknown", {})["error"]["code"] == -32601
    # Click buyurtmasini Payme to'lay olmaydi
    c = order(client, biz, provider="click")
    assert payme(client, "CheckPerformTransaction", {"amount": c["amount"] * 100,
                                                     "account": {"order_id": str(c["id"])}})["error"]["code"] == -31050
    # Bitta buyurtmaga ikkinchi faol tranzaksiya — band
    payme(client, "CreateTransaction", {"id": "pm-a", "time": now_ms(), "amount": tiyin, "account": acc})
    busy = payme(client, "CreateTransaction", {"id": "pm-b", "time": now_ms(), "amount": tiyin, "account": acc})
    assert busy["error"]["code"] == -31052


def test_payme_cancel_before_perform(client, superadmin):
    biz = create_business(client, superadmin)
    o = order(client, biz)
    acc = {"order_id": str(o["id"])}
    payme(client, "CreateTransaction", {"id": "pm-c", "time": now_ms(), "amount": o["amount"] * 100, "account": acc})
    r = payme(client, "CancelTransaction", {"id": "pm-c", "reason": 3})["result"]
    assert r["state"] == -1 and r["cancel_time"] > 0
    assert payme(client, "CancelTransaction", {"id": "pm-c", "reason": 3})["result"]["cancel_time"] == r["cancel_time"]
    assert payme(client, "PerformTransaction", {"id": "pm-c"})["error"]["code"] == -31008
    assert payme(client, "CheckTransaction", {"id": "pm-c"})["result"]["reason"] == 3


def test_payme_transaction_expires_after_12_hours(client, superadmin):
    biz = create_business(client, superadmin)
    o = order(client, biz)
    acc = {"order_id": str(o["id"])}
    payme(client, "CreateTransaction", {"id": "pm-old", "time": now_ms(), "amount": o["amount"] * 100, "account": acc})
    # 12 soat o'tganini taqlid qilish: jadval egasi sifatida vaqtni orqaga suramiz
    from sqlalchemy import create_engine
    from app.core.config import get_settings
    owner = create_engine(get_settings().migration_database_url)
    with owner.begin() as c:
        c.execute(text("UPDATE payment_transactions SET create_time = create_time - 43300000 WHERE ext_id = 'pm-old'"))
    owner.dispose()
    assert payme(client, "PerformTransaction", {"id": "pm-old"})["error"]["code"] == -31008
    assert payme(client, "CheckTransaction", {"id": "pm-old"})["result"]["state"] == -1


# ─── Click ──────────────────────────────────────────────────────────────────
def click_form(o, action, ext="click-1", prepare_id=None, amount=None, error=0, secret=CLICK_SECRET):
    form = {"click_trans_id": ext, "service_id": str(CLICK_SERVICE), "click_paydoc_id": "1",
            "merchant_trans_id": str(o["id"]), "amount": f"{amount if amount is not None else o['amount']}.00",
            "action": str(action), "error": str(error), "error_note": "", "sign_time": "2026-11-09 10:00:00"}
    parts = [form["click_trans_id"], form["service_id"], secret, form["merchant_trans_id"]]
    if prepare_id is not None:
        form["merchant_prepare_id"] = str(prepare_id)
        parts.append(form["merchant_prepare_id"])
    parts += [form["amount"], form["action"], form["sign_time"]]
    form["sign_string"] = hashlib.md5("".join(parts).encode()).hexdigest()
    return form


def test_click_full_flow(client, superadmin):
    biz = expired_business(client, superadmin)
    o = order(client, biz, months=6, provider="click")

    bad = client.post("/api/v1/billing/click/prepare", data=click_form(o, 0, secret="wrong")).json()
    assert bad["error"] == -1
    wrong = client.post("/api/v1/billing/click/prepare", data=click_form(o, 0, ext="click-x", amount=1000)).json()
    assert wrong["error"] == -2

    prep = client.post("/api/v1/billing/click/prepare", data=click_form(o, 0)).json()
    assert prep["error"] == 0 and prep["merchant_prepare_id"]
    done = client.post("/api/v1/billing/click/complete",
                       data=click_form(o, 1, prepare_id=prep["merchant_prepare_id"])).json()
    assert done["error"] == 0 and done["merchant_confirm_id"] == prep["merchant_prepare_id"]
    assert membership(client, biz["owner"])["operational"] is True

    twice = client.post("/api/v1/billing/click/complete",
                        data=click_form(o, 1, prepare_id=prep["merchant_prepare_id"])).json()
    assert twice["error"] == -4
    unknown = client.post("/api/v1/billing/click/complete", data=click_form(o, 1, prepare_id=999999)).json()
    assert unknown["error"] == -6
    pays = client.get(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/payments", headers=sa(superadmin)).json()
    assert [p["method"] for p in pays].count("click") == 1


def test_click_failed_payment_cancels(client, superadmin):
    biz = create_business(client, superadmin)
    o = order(client, biz, provider="click")
    prep = client.post("/api/v1/billing/click/prepare", data=click_form(o, 0, ext="click-f")).json()
    r = client.post("/api/v1/billing/click/complete",
                    data=click_form(o, 1, ext="click-f", prepare_id=prep["merchant_prepare_id"], error=-5017)).json()
    assert r["error"] == -9
    info = client.get(f"/api/v1/businesses/{biz['id']}/billing", headers=auth_header(biz["owner"])).json()
    assert info["orders"][0]["status"] == "created"           # buyurtma ochiq qoladi, qayta to'lash mumkin


def test_paid_business_appears_in_catalog_again(client, superadmin):
    from app.db.session import api_session
    biz = expired_business(client, superadmin)
    visible = "SELECT count(*) FROM businesses WHERE id = :b"
    with api_session(None) as db:
        assert db.scalar(text(visible), {"b": biz["id"]}) == 0           # ilovada yashirin
    o = order(client, biz, provider="click")
    prep = client.post("/api/v1/billing/click/prepare", data=click_form(o, 0, ext="click-cat")).json()
    client.post("/api/v1/billing/click/complete", data=click_form(o, 1, ext="click-cat", prepare_id=prep["merchant_prepare_id"]))
    with api_session(None) as db:
        assert db.scalar(text(visible), {"b": biz["id"]}) == 1


# ─── Tariflar (Super Admin narxlarni boshqaradi) ─────────────────────────────
def test_plans_seeded_and_new_business_gets_first_plan(client, superadmin):
    plans = client.get("/api/v1/superadmin/billing/plans", headers=sa(superadmin)).json()
    names = {p["name"]: p["monthly_fee"] for p in plans}
    assert names["Start"] == 199000 and names["Biznes"] == 399000
    biz = create_business(client, superadmin)
    row = next(b for b in client.get("/api/v1/superadmin/businesses", headers=sa(superadmin)).json() if b["id"] == biz["id"])
    assert row["plan_name"] == "Start" and row["monthly_fee"] == 199000


def test_assign_plan_custom_price_and_apply_plan_change(client, superadmin):
    r = client.post("/api/v1/superadmin/billing/plans", headers=sa(superadmin),
                    json={"name": "Sinov tarif", "monthly_fee": 250000, "sort_order": 50})
    assert r.status_code == 201, r.text
    plan = r.json()
    assert client.post("/api/v1/superadmin/billing/plans", headers=sa(superadmin),
                       json={"name": "sinov TARIF", "monthly_fee": 1}).status_code == 409

    a, b = create_business(client, superadmin), create_business(client, superadmin)
    row = set_sub(client, superadmin, a, plan_id=plan["id"])
    assert row["plan_id"] == plan["id"] and row["monthly_fee"] == 250000
    set_sub(client, superadmin, b, plan_id=plan["id"])
    row = set_sub(client, superadmin, b, monthly_fee=180000)          # maxsus narx — tarifdan chiqadi
    assert row["plan_id"] is None and row["monthly_fee"] == 180000

    # Narx o'zgarsa, qo'llanmaguncha muassasalar eski narxda qoladi
    r = client.patch(f"/api/v1/superadmin/billing/plans/{plan['id']}", headers=sa(superadmin), json={"monthly_fee": 300000})
    assert r.status_code == 200 and r.json()["monthly_fee"] == 300000 and r.json()["updated_businesses"] is None
    info = client.get(f"/api/v1/businesses/{a['id']}/billing", headers=auth_header(a["owner"])).json()
    assert info["monthly_fee"] == 250000
    r = client.patch(f"/api/v1/superadmin/billing/plans/{plan['id']}", headers=sa(superadmin),
                     json={"apply_to_businesses": True})
    assert r.json()["updated_businesses"] == 1 and r.json()["business_count"] == 1
    info = client.get(f"/api/v1/businesses/{a['id']}/billing", headers=auth_header(a["owner"])).json()
    assert info["monthly_fee"] == 300000 and info["packages"][0]["amount"] == 300000
    info = client.get(f"/api/v1/businesses/{b['id']}/billing", headers=auth_header(b["owner"])).json()
    assert info["monthly_fee"] == 180000                               # maxsus narxga tegilmadi


def test_only_superadmin_manages_plans(client, superadmin):
    biz = create_business(client, superadmin)
    owner = auth_header(biz["owner"])
    assert client.get("/api/v1/superadmin/billing/plans", headers=owner).status_code == 403
    assert client.post("/api/v1/superadmin/billing/plans", headers=owner, json={"name": "X", "monthly_fee": 1}).status_code == 403
    from app.db.session import api_session
    me = client.get("/api/v1/auth/me", headers=owner).json()["user"]["id"]
    with api_session(me) as db:
        assert db.execute(text("SELECT count(*) FROM billing_plans")).scalar() == 0      # RLS: ko'rinmaydi
        with pytest.raises(Exception) as e:
            db.execute(text("UPDATE businesses SET plan_id = NULL WHERE id = :b"), {"b": biz["id"]})
        assert "business_field_forbidden" in str(e.value)
        db.rollback()
