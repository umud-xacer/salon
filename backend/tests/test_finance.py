"""Kassa: to'lov, ortiqcha to'lov, qaytarish, kunlik hisob, xarajatlar, huquqlar va baza himoyasi."""
import os
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text

from tests.conftest import add_member, auth_header, create_business, new_phone
from tests.test_appointments import at
from tests.test_schedule import day_from_today, new_master, new_service


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance"))


@pytest.fixture()
def ctx(client, biz):
    service = new_service(client, biz, duration=60)
    return {"service": service, "master": new_master(client, biz, service), "day": day_from_today(biz, 1),
            "rec": add_member(client, biz, "receptionist")}


def h(ctx):
    return auth_header(ctx["rec"]["tokens"])


def url(biz, tail):
    return f"/api/v1/businesses/{biz['id']}/{tail}"


def book(client, biz, ctx, clock="10:00", status="in_progress"):
    r = client.post(url(biz, "reception/appointments"), headers=h(ctx), json={
        "service_id": ctx["service"]["id"], "member_id": ctx["master"]["member"]["id"],
        "starts_at": at(ctx["day"], clock), "client_name": "Dilshod Ergashev", "client_phone": new_phone()})
    assert r.status_code == 201, r.text
    a = r.json()
    if status != "confirmed":
        r = client.patch(url(biz, f"appointments/{a['id']}/status"), headers=h(ctx), json={"status": status})
        assert r.status_code == 200, r.text
    return a


def pay(client, biz, ctx, appointment, amount, method="cash", headers=None):
    return client.post(url(biz, f"appointments/{appointment['id']}/payments"), headers=headers or h(ctx),
                       json={"amount": amount, "method": method})


def today():
    return datetime.now(ZoneInfo("Asia/Tashkent")).date().isoformat()


def test_partial_payments_up_to_price(client, biz, ctx):
    a = book(client, biz, ctx)
    price = a["total_price"]
    r = pay(client, biz, ctx, a, price - 1000)
    assert r.status_code == 201, r.text
    assert r.json()["paid"] == price - 1000 and r.json()["due"] == 1000

    r = pay(client, biz, ctx, a, 2000, "card")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "overpaid"

    r = pay(client, biz, ctx, a, 1000, "card")
    assert r.json()["due"] == 0 and len(r.json()["payments"]) == 2
    assert r.json()["payments"][0]["received_by_name"]


def test_prepayment_before_arrival_but_not_after_cancel(client, biz, ctx):
    a = book(client, biz, ctx, status="confirmed")
    r = pay(client, biz, ctx, a, 1000)
    assert r.status_code == 201 and r.json()["payable"] and r.json()["paid"] == 1000

    b = book(client, biz, ctx, "12:00", status="confirmed")
    assert client.post(f"/api/v1/appointments/{b['id']}/cancel", headers=h(ctx), json={}).status_code == 200
    r = pay(client, biz, ctx, b, 1000)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_payable"
    assert client.get(url(biz, f"appointments/{b['id']}/payments"), headers=h(ctx)).json()["payable"] is False


def test_concurrent_payments_never_exceed_price(client, biz, ctx):
    a = book(client, biz, ctx)
    results = []
    threads = [threading.Thread(target=lambda: results.append(pay(client, biz, ctx, a, a["total_price"]).status_code))
               for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [201] + [409] * 5
    data = client.get(url(biz, f"appointments/{a['id']}/payments"), headers=h(ctx)).json()
    assert data["paid"] == a["total_price"]


def test_refund_needs_permission_and_frees_debt(client, biz, ctx):
    a = book(client, biz, ctx)
    payment = pay(client, biz, ctx, a, a["total_price"]).json()["payments"][0]
    refund = url(biz, f"payments/{payment['id']}/refund")

    assert client.post(refund, headers=h(ctx), json={"reason": "Mijoz norozi"}).status_code == 403

    owner = auth_header(biz["owner"])
    assert client.post(refund, headers=owner, json={"reason": "  "}).status_code == 422
    r = client.post(refund, headers=owner, json={"reason": "Mijoz norozi"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "refunded" and r.json()["refund_reason"] == "Mijoz norozi"

    r = client.post(refund, headers=owner, json={"reason": "Yana bir marta"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_refunded"

    data = client.get(url(biz, f"appointments/{a['id']}/payments"), headers=h(ctx)).json()
    assert data["paid"] == 0 and data["due"] == a["total_price"]


def test_cash_day_totals_and_unpaid(client, biz, ctx):
    a = book(client, biz, ctx, "10:00")
    b = book(client, biz, ctx, "12:00")
    price = a["total_price"]
    owner = auth_header(biz["owner"])
    pay(client, biz, ctx, a, price, "cash")
    second = pay(client, biz, ctx, b, 1000, "card").json()["payments"][0]
    client.post(url(biz, f"payments/{second['id']}/refund"), headers=owner, json={"reason": "Xato yozildi"})
    r = client.post(url(biz, "expenses"), headers=owner,
                    json={"amount": 5000, "spent_at": today(), "note": "Choy"})
    assert r.status_code == 201, r.text

    d = client.get(url(biz, f"cash/day?date={today()}"), headers=owner).json()
    assert d["income"] == price + 1000 and d["refunds"] == 1000
    assert d["expenses"] == 5000 and d["net"] == price - 5000
    assert {m["method"]: (m["income"], m["refunds"]) for m in d["methods"]} == {"cash": (price, 0), "card": (1000, 1000)}
    assert len(d["payments"]) == 2

    # Bronlar ertangi kunda: qarz o'sha kunda ko'rinadi
    d2 = client.get(url(biz, f"cash/day?date={ctx['day']}"), headers=owner).json()
    assert [u["id"] for u in d2["unpaid"]] == [b["id"]] and d2["unpaid"][0]["due"] == price


def test_expense_totals_hidden_without_finance_view(client, biz, ctx):
    member = ctx["rec"]["member"]["id"]
    owner = auth_header(biz["owner"])
    r = client.put(url(biz, f"members/{member}/permissions/finance.view"), headers=owner, json={"granted": False})
    assert r.status_code == 204, r.text
    d = client.get(url(biz, f"cash/day?date={ctx['day']}"), headers=h(ctx))
    assert d.status_code == 200 and d.json()["expenses"] is None and d.json()["net"] is None
    assert client.get(url(biz, "expense-categories"), headers=h(ctx)).status_code == 403


def test_master_has_no_cash_access(client, biz, ctx):
    a = book(client, biz, ctx)
    master = auth_header(ctx["master"]["tokens"])
    assert pay(client, biz, ctx, a, 1000, headers=master).status_code == 403
    assert client.get(url(biz, f"cash/day?date={ctx['day']}"), headers=master).status_code == 403
    assert client.get(url(biz, f"appointments/{a['id']}/payments"), headers=master).status_code == 403


def test_finance_module_off_blocks_cash(client, superadmin):
    biz = create_business(client, superadmin, modules=("booking",))
    r = client.get(url(biz, "cash/day?date=2026-11-02"), headers=auth_header(biz["owner"]))
    assert r.status_code == 403


def test_other_business_appointment_is_invisible(client, superadmin, biz, ctx):
    a = book(client, biz, ctx)
    other = create_business(client, superadmin, modules=("booking", "finance"))
    h2 = auth_header(other["owner"])
    r = client.post(url(other, f"appointments/{a['id']}/payments"), headers=h2, json={"amount": 1000, "method": "cash"})
    assert r.status_code == 404
    assert client.get(url(other, f"appointments/{a['id']}/payments"), headers=h2).status_code == 404


def test_bonus_method_rejected(client, biz, ctx):
    a = book(client, biz, ctx)
    assert pay(client, biz, ctx, a, 1000, "bonus").status_code == 422


def test_expense_crud_and_category_delete(client, biz, ctx):
    owner = auth_header(biz["owner"])
    cat = client.post(url(biz, "expense-categories"), headers=owner, json={"name": "Ijara"}).json()
    assert client.post(url(biz, "expense-categories"), headers=owner, json={"name": "ijara"}).status_code == 409

    body = {"category_id": cat["id"], "amount": 100000, "spent_at": "2026-11-02", "note": "Noyabr"}
    e = client.post(url(biz, "expenses"), headers=h(ctx), json=body).json()
    assert e["category_name"] == "Ijara" and e["created_by_name"]

    r = client.put(url(biz, f"expenses/{e['id']}"), headers=owner, json={**body, "amount": 90000})
    assert r.json()["amount"] == 90000 and r.json()["created_by_name"] == e["created_by_name"]

    assert client.delete(url(biz, f"expense-categories/{cat['id']}"), headers=owner).status_code == 204
    listing = client.get(url(biz, "expenses?date_from=2026-11-01&date_to=2026-11-30"), headers=owner).json()
    assert listing["total"] == 90000 and listing["items"][0]["category_id"] is None

    assert client.delete(url(biz, f"expenses/{e['id']}"), headers=owner).status_code == 204
    assert client.delete(url(biz, f"expenses/{e['id']}"), headers=owner).status_code == 404


def test_foreign_expense_category_rejected(client, superadmin, biz, ctx):
    other = create_business(client, superadmin, modules=("booking", "finance"))
    cat = client.post(url(other, "expense-categories"), headers=auth_header(other["owner"]), json={"name": "Ijara"}).json()
    r = client.post(url(biz, "expenses"), headers=auth_header(biz["owner"]),
                    json={"category_id": cat["id"], "amount": 1000, "spent_at": "2026-11-02"})
    assert r.status_code == 422


def _as_user(user_id):
    from app.db.session import api_session
    return api_session(user_id)


def _user_id(client, tokens):
    return client.get("/api/v1/auth/me", headers=auth_header(tokens)).json()["user"]["id"]


def test_db_blocks_direct_payment_writes(client, biz, ctx):
    a = book(client, biz, ctx)
    payment = pay(client, biz, ctx, a, 1000).json()["payments"][0]
    db = _as_user(_user_id(client, biz["owner"]))     # hatto direktor ham
    try:
        for sql in (f"UPDATE payments SET amount = 1 WHERE id = {payment['id']}",
                    f"DELETE FROM payments WHERE id = {payment['id']}",
                    f"INSERT INTO payments (business_id, amount, method) VALUES ({biz['id']}, 1, 'cash')"):
            with pytest.raises(Exception) as e:
                db.execute(text(sql))
            assert "permission denied" in str(e.value)
            db.rollback()
    finally:
        db.close()


def test_expense_author_and_audit_cannot_be_forged(client, biz, ctx):
    owner = auth_header(biz["owner"])
    e = client.post(url(biz, "expenses"), headers=h(ctx), json={"amount": 7000, "spent_at": "2026-11-02"}).json()
    uid = _user_id(client, biz["owner"])
    db = _as_user(uid)
    try:
        db.execute(text("UPDATE expenses SET created_by = :u WHERE id = :e"), {"u": uid, "e": e["id"]})
        db.commit()
        assert db.scalar(text("SELECT created_by FROM expenses WHERE id = :e"), {"e": e["id"]}) != uid
    finally:
        db.close()
    assert client.delete(url(biz, f"expenses/{e['id']}"), headers=owner).status_code == 204

    engine = create_engine(os.environ["MIGRATION_DATABASE_URL"])
    with engine.connect() as c:
        changes = c.scalar(text("""
            SELECT changes FROM audit_logs WHERE entity_type = 'expense' AND entity_id = :e AND action = 'delete'
        """), {"e": e["id"]})
    engine.dispose()
    assert changes["amount"] == 7000
