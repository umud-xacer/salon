"""Oylik: stavka, hisoblash, qo'lda tuzatish, tasdiqlash, to'lash, Kassaga tushishi, huquqlar, baza himoyasi."""
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business, new_phone
from tests.test_appointments import at
from tests.test_schedule import day_from_today, new_master, new_service


def month():
    return datetime.now(ZoneInfo("Asia/Tashkent")).strftime("%Y-%m")


def today():
    return datetime.now(ZoneInfo("Asia/Tashkent")).date().isoformat()


def url(biz, tail):
    return f"/api/v1/businesses/{biz['id']}/{tail}"


def owner(biz):
    return auth_header(biz["owner"])


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance", "payroll"))


@pytest.fixture()
def ctx(client, biz):
    service = new_service(client, biz, duration=60)
    return {"service": service, "master": new_master(client, biz, service), "day": day_from_today(biz, 1)}


def set_rate(client, biz, member_id, base=1_000_000, percent=30):
    r = client.put(url(biz, f"payroll/compensation/{member_id}"), headers=owner(biz),
                   json={"base_salary": base, "commission_percent": percent})
    assert r.status_code == 200, r.text
    return r.json()


def paid_visit(client, biz, ctx, clock="10:00"):
    h = owner(biz)
    a = client.post(url(biz, "reception/appointments"), headers=h, json={
        "service_id": ctx["service"]["id"], "member_id": ctx["master"]["member"]["id"],
        "starts_at": at(ctx["day"], clock), "client_name": "Dilshod Ergashev", "client_phone": new_phone()}).json()
    r = client.patch(url(biz, f"appointments/{a['id']}/status"), headers=h, json={"status": "in_progress"})
    assert r.status_code == 200, r.text
    r = client.post(url(biz, f"appointments/{a['id']}/payments"), headers=h,
                    json={"amount": a["total_price"], "method": "cash"})
    assert r.status_code == 201, r.text
    return a, r.json()["payments"][0]


def generate(client, biz):
    r = client.post(url(biz, "payroll/generate"), headers=owner(biz), json={"month": month()})
    assert r.status_code == 200, r.text
    return client.get(url(biz, f"payroll?month={month()}"), headers=owner(biz)).json()


def test_commission_from_paid_money(client, biz, ctx):
    set_rate(client, biz, ctx["master"]["member"]["id"], base=1_000_000, percent=30)
    a, _ = paid_visit(client, biz, ctx)
    data = generate(client, biz)
    row = data["items"][0]
    assert row["revenue"] == a["total_price"]
    assert row["commission"] == round(a["total_price"] * 0.3)
    assert row["total"] == 1_000_000 + row["commission"] and row["status"] == "draft"
    assert data["total"] == row["total"] and data["paid"] == 0


def test_refunded_payment_gives_no_commission(client, biz, ctx):
    set_rate(client, biz, ctx["master"]["member"]["id"], base=0, percent=50)
    _, payment = paid_visit(client, biz, ctx)
    r = client.post(url(biz, f"payments/{payment['id']}/refund"), headers=owner(biz), json={"reason": "Mijoz norozi"})
    assert r.status_code == 200, r.text
    row = generate(client, biz)["items"][0]
    assert row["revenue"] == 0 and row["commission"] == 0


def test_regenerate_keeps_bonus_and_skips_locked(client, biz, ctx):
    member = ctx["master"]["member"]["id"]
    set_rate(client, biz, member, base=1_000_000, percent=0)
    row = generate(client, biz)["items"][0]
    adj = url(biz, f"payroll/{row['id']}")
    r = client.put(adj, headers=owner(biz), json={"bonus": 50_000, "deductions": 20_000, "note": "Avans"})
    assert r.status_code == 200 and r.json()["total"] == 1_030_000

    set_rate(client, biz, member, base=2_000_000, percent=0)
    row = generate(client, biz)["items"][0]
    assert row["base_salary"] == 2_000_000 and row["bonus"] == 50_000 and row["note"] == "Avans"

    assert client.post(f"{adj}/approve", headers=owner(biz)).status_code == 200
    set_rate(client, biz, member, base=9_000_000, percent=0)
    assert generate(client, biz)["items"][0]["base_salary"] == 2_000_000

    r = client.put(adj, headers=owner(biz), json={"bonus": 1, "deductions": 0})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "payroll_locked"


def test_deductions_cannot_exceed_earnings(client, biz, ctx):
    set_rate(client, biz, ctx["master"]["member"]["id"], base=100_000, percent=0)
    row = generate(client, biz)["items"][0]
    r = client.put(url(biz, f"payroll/{row['id']}"), headers=owner(biz), json={"bonus": 0, "deductions": 100_001})
    assert r.status_code == 422


def test_pay_requires_approval_and_lands_in_expenses(client, biz, ctx):
    set_rate(client, biz, ctx["master"]["member"]["id"], base=700_000, percent=0)
    row = generate(client, biz)["items"][0]
    base = url(biz, f"payroll/{row['id']}")
    r = client.post(f"{base}/pay", headers=owner(biz))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "payroll_not_approved"

    assert client.post(f"{base}/approve", headers=owner(biz)).status_code == 200
    r = client.post(f"{base}/pay", headers=owner(biz))
    assert r.status_code == 200 and r.json()["status"] == "paid" and r.json()["paid_at"]

    r = client.post(f"{base}/pay", headers=owner(biz))
    assert r.status_code == 409

    d = today()
    e = client.get(url(biz, f"expenses?date_from={d}&date_to={d}"), headers=owner(biz)).json()
    assert e["total"] == 700_000 and e["items"][0]["category_name"] == "Oylik"
    assert client.get(url(biz, f"cash/day?date={d}"), headers=owner(biz)).json()["expenses"] == 700_000


def test_concurrent_pay_creates_one_expense(client, biz, ctx):
    set_rate(client, biz, ctx["master"]["member"]["id"], base=500_000, percent=0)
    row = generate(client, biz)["items"][0]
    base = url(biz, f"payroll/{row['id']}")
    client.post(f"{base}/approve", headers=owner(biz))
    codes = []
    threads = [threading.Thread(target=lambda: codes.append(client.post(f"{base}/pay", headers=owner(biz)).status_code))
               for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(codes) == [200] + [409] * 4
    d = today()
    assert client.get(url(biz, f"expenses?date_from={d}&date_to={d}"), headers=owner(biz)).json()["total"] == 500_000


def test_staff_sees_only_own_approved(client, biz, ctx):
    member = ctx["master"]["member"]["id"]
    other = new_master(client, biz, ctx["service"])
    set_rate(client, biz, member, base=300_000, percent=0)
    set_rate(client, biz, other["member"]["id"], base=400_000, percent=0)
    rows = {r["member_id"]: r for r in generate(client, biz)["items"]}
    h = auth_header(ctx["master"]["tokens"])
    assert client.get(url(biz, "my-payroll"), headers=h).json() == []            # qoralama yashirin

    client.post(url(biz, f"payroll/{rows[member]['id']}/approve"), headers=owner(biz))
    client.post(url(biz, f"payroll/{rows[other['member']['id']]['id']}/approve"), headers=owner(biz))
    mine = client.get(url(biz, "my-payroll"), headers=h).json()
    assert [r["member_id"] for r in mine] == [member]


def test_roles_and_tenancy(client, superadmin, biz, ctx):
    member = ctx["master"]["member"]["id"]
    set_rate(client, biz, member)
    row = generate(client, biz)["items"][0]
    for role in ("manager", "receptionist", "staff"):
        h = auth_header(add_member(client, biz, role)["tokens"])
        assert client.get(url(biz, f"payroll?month={month()}"), headers=h).status_code == 403
        assert client.post(url(biz, "payroll/generate"), headers=h, json={"month": month()}).status_code == 403
        assert client.get(url(biz, "payroll/compensation"), headers=h).status_code == 403
        assert client.post(url(biz, f"payroll/{row['id']}/approve"), headers=h).status_code == 403

    other = create_business(client, superadmin, modules=("booking", "payroll"))
    h = owner(other)
    assert client.post(url(other, f"payroll/{row['id']}/approve"), headers=h).status_code == 404
    r = client.put(url(other, f"payroll/compensation/{member}"), headers=h,
                   json={"base_salary": 1, "commission_percent": 1})
    assert r.status_code == 404


def test_module_off(client, superadmin):
    biz = create_business(client, superadmin, modules=("booking",))
    assert client.get(url(biz, f"payroll?month={month()}"), headers=owner(biz)).status_code == 403


def test_invalid_input(client, biz, ctx):
    assert client.post(url(biz, "payroll/generate"), headers=owner(biz), json={"month": "2026-13"}).status_code == 422
    assert client.get(url(biz, "payroll?month=abc"), headers=owner(biz)).status_code == 422
    r = client.put(url(biz, f"payroll/compensation/{ctx['master']['member']['id']}"), headers=owner(biz),
                   json={"base_salary": 0, "commission_percent": 101})
    assert r.status_code == 422


def test_db_blocks_direct_writes(client, biz, ctx):
    set_rate(client, biz, ctx["master"]["member"]["id"], base=100_000, percent=0)
    row = generate(client, biz)["items"][0]
    uid = client.get("/api/v1/auth/me", headers=owner(biz)).json()["user"]["id"]
    db = api_session(uid)
    try:
        for sql in (f"UPDATE payrolls SET bonus = 999 WHERE id = {row['id']}",
                    f"DELETE FROM payrolls WHERE id = {row['id']}",
                    f"INSERT INTO payrolls (business_id, member_id, period_start, period_end) "
                    f"VALUES ({biz['id']}, {row['member_id']}, '2020-01-01', '2020-01-31')"):
            with pytest.raises(DBAPIError) as e:
                db.execute(text(sql))
            assert e.value.orig.sqlstate == "42501"
            db.rollback()
    finally:
        db.close()
