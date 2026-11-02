"""Ombor: mahsulotlar, harakatlar, sanoq, kam qoldiq ogohlantirishi, huquqlar va baza himoyasi."""
import threading

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "inventory"))


def url(biz, tail):
    return f"/api/v1/businesses/{biz['id']}/{tail}"


def owner(biz):
    return auth_header(biz["owner"])


def uid(client, tokens):
    return client.get("/api/v1/auth/me", headers=auth_header(tokens)).json()["user"]["id"]


def move(client, biz, product, kind, qty, headers=None, **extra):
    return client.post(url(biz, f"products/{product['id']}/movements"), headers=headers or owner(biz),
                       json={"type": kind, "qty": qty, **extra})


def new_product(client, biz, name="Shampun", min_qty=10, stock=0, **extra):
    r = client.post(url(biz, "products"), headers=owner(biz),
                    json={"name": name, "unit": "ml", "cost_price": 100, "min_qty": min_qty, **extra})
    assert r.status_code == 201, r.text
    p = r.json()
    if stock:
        p = move(client, biz, p, "purchase", stock).json()
    return p


def low_alerts(client, tokens):
    r = client.get("/api/v1/notifications", headers=auth_header(tokens))
    assert r.status_code == 200, r.text
    return [n for n in r.json() if n["type"] == "low_stock"]


def test_purchase_and_outflows_change_stock(client, biz):
    p = new_product(client, biz, stock=100)
    assert p["current_qty"] == 100
    assert move(client, biz, p, "usage", 25.5).json()["current_qty"] == 74.5
    r = move(client, biz, p, "write_off", 4.5, note="Muddati o'tgan")
    assert r.status_code == 201 and r.json()["current_qty"] == 70

    rows = client.get(url(biz, f"stock-movements?product_id={p['id']}"), headers=owner(biz)).json()
    assert [(m["type"], m["qty"]) for m in rows] == [("write_off", -4.5), ("usage", -25.5), ("purchase", 100)]
    assert rows[0]["created_by_name"] and rows[0]["note"] == "Muddati o'tgan"


def test_cannot_use_more_than_stock(client, biz):
    p = new_product(client, biz, stock=5)
    r = move(client, biz, p, "usage", 6)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "insufficient_stock"


def test_invalid_inputs_rejected(client, biz):
    p = new_product(client, biz, stock=5)
    assert move(client, biz, p, "usage", 0).status_code == 422
    assert move(client, biz, p, "usage", -1).status_code == 422
    assert move(client, biz, p, "usage", 1.2345).status_code == 422
    assert move(client, biz, p, "adjustment", 1).status_code == 422
    assert move(client, biz, p, "write_off", 1).status_code == 422       # sabab yo'q


def test_concurrent_usage_never_goes_negative(client, biz):
    p = new_product(client, biz, stock=3)
    results = []
    threads = [threading.Thread(target=lambda: results.append(move(client, biz, p, "usage", 1).status_code))
               for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [201] * 3 + [409] * 3
    assert client.get(url(biz, "products"), headers=owner(biz)).json()[0]["current_qty"] == 0


def test_count_records_difference(client, biz):
    p = new_product(client, biz, stock=50)
    count = url(biz, f"products/{p['id']}/count")
    r = client.post(count, headers=owner(biz), json={"counted": 47.5, "note": "Oy sanog'i"})
    assert r.status_code == 201 and r.json()["current_qty"] == 47.5
    r = client.post(count, headers=owner(biz), json={"counted": 47.5, "note": "Yana sanoq"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_difference"
    rows = client.get(url(biz, f"stock-movements?product_id={p['id']}"), headers=owner(biz)).json()
    assert rows[0]["type"] == "adjustment" and rows[0]["qty"] == -2.5


def test_low_stock_list_and_summary(client, biz):
    low = new_product(client, biz, "Bo'yoq", min_qty=10, stock=8)
    new_product(client, biz, "Krem", min_qty=10, stock=30)
    new_product(client, biz, "Sochiq", min_qty=0)                        # chegara yo'q: ogohlantirilmaydi

    rows = client.get(url(biz, "products?show=low"), headers=owner(biz)).json()
    assert [r["id"] for r in rows] == [low["id"]] and rows[0]["is_low"] is True

    s = client.get(url(biz, "inventory/summary"), headers=owner(biz)).json()
    assert s["products"] == 3 and s["low_count"] == 1 and s["low"][0]["id"] == low["id"]
    assert s["stock_value"] == (8 + 30) * 100


def test_alert_only_on_crossing_threshold_and_only_to_managers(client, biz):
    manager = add_member(client, biz, "manager")
    usta = add_member(client, biz, "staff")
    p = new_product(client, biz, min_qty=10, stock=20)

    assert move(client, biz, p, "usage", 5).status_code == 201           # 15: chegaradan yuqori
    assert low_alerts(client, biz["owner"]) == []

    move(client, biz, p, "usage", 7)                                     # 8: chegaradan o'tdi
    move(client, biz, p, "usage", 1)                                     # 7: takror xabar yo'q
    alerts = low_alerts(client, biz["owner"])
    assert len(alerts) == 1 and "Shampun: 8 ml" in alerts[0]["body"]
    assert alerts[0]["data"] == {"product_id": p["id"]}
    assert len(low_alerts(client, manager["tokens"])) == 1
    assert low_alerts(client, usta["tokens"]) == []

    move(client, biz, p, "purchase", 20)                                 # to'ldirildi, qaytadan kamayadi
    move(client, biz, p, "usage", 18)
    assert len(low_alerts(client, biz["owner"])) == 2


def test_roles(client, biz):
    p = new_product(client, biz, stock=5)
    rec = auth_header(add_member(client, biz, "receptionist")["tokens"])
    usta = auth_header(add_member(client, biz, "staff")["tokens"])
    for h in (rec, usta):
        assert client.get(url(biz, "products"), headers=h).status_code == 403
        assert client.get(url(biz, "inventory/summary"), headers=h).status_code == 403
        assert move(client, biz, p, "purchase", 1, headers=h).status_code == 403

    manager = auth_header(add_member(client, biz, "manager")["tokens"])
    assert move(client, biz, p, "purchase", 1, headers=manager).status_code == 201


def test_module_off_blocks_inventory(client, superadmin):
    biz = create_business(client, superadmin, modules=("booking",))
    assert client.get(url(biz, "products"), headers=owner(biz)).status_code == 403


def test_other_business_product_is_invisible(client, superadmin, biz):
    p = new_product(client, biz, stock=5)
    other = create_business(client, superadmin, modules=("booking", "inventory"))
    assert move(client, other, p, "usage", 1).status_code == 404
    r = client.put(url(other, f"products/{p['id']}"), headers=owner(other), json={"name": "Boshqa"})
    assert r.status_code == 404
    assert client.get(url(other, f"stock-movements?product_id={p['id']}"), headers=owner(other)).json() == []


def test_hidden_product_keeps_history_and_blocks_moves(client, biz):
    p = new_product(client, biz, stock=5)
    r = client.put(url(biz, f"products/{p['id']}"), headers=owner(biz),
                   json={"name": p["name"], "unit": "ml", "is_active": False})
    assert r.status_code == 200 and r.json()["current_qty"] == 5
    assert client.get(url(biz, "products"), headers=owner(biz)).json() == []
    assert len(client.get(url(biz, "products?show=inactive"), headers=owner(biz)).json()) == 1
    r = move(client, biz, p, "purchase", 1)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "product_inactive"


def test_duplicate_name_and_sku_rejected(client, biz):
    new_product(client, biz, "Shampun", sku="A-1")
    assert client.post(url(biz, "products"), headers=owner(biz), json={"name": "shampun"}).status_code == 409
    r = client.post(url(biz, "products"), headers=owner(biz), json={"name": "Boshqa", "sku": "A-1"})
    assert r.status_code == 409


def sqlstate(e):
    return e.value.orig.sqlstate


def test_db_blocks_forged_stock(client, biz):
    p = new_product(client, biz, stock=10)
    b, pid = biz["id"], p["id"]
    insert = f"INSERT INTO stock_movements (business_id, product_id, type, qty) VALUES ({b}, {pid}"
    cases = [
        (f"INSERT INTO products (business_id, name, current_qty) VALUES ({b}, 'Soxta', 999)", "42501"),
        (f"UPDATE products SET current_qty = 999 WHERE id = {pid}", "42501"),
        (f"DELETE FROM products WHERE id = {pid}", "42501"),
        (f"DELETE FROM stock_movements WHERE product_id = {pid}", "42501"),
        (f"UPDATE stock_movements SET qty = 1 WHERE product_id = {pid}", "42501"),
        (f"{insert}, 'purchase', -1)", "23514"),
        (f"{insert}, 'usage', 5)", "23514"),
        (f"{insert}, 'to_staff', -1)", "23514"),
    ]
    db = api_session(uid(client, biz["owner"]))
    try:
        for sql, state in cases:
            with pytest.raises(DBAPIError) as e:
                db.execute(text(sql))
            assert sqlstate(e) == state, sql
            db.rollback()
    finally:
        db.close()


def test_author_cannot_be_forged(client, biz):
    p = new_product(client, biz)
    manager = add_member(client, biz, "manager")
    owner_id = uid(client, biz["owner"])
    db = api_session(uid(client, manager["tokens"]))
    try:
        created = db.scalar(text("""
            INSERT INTO stock_movements (business_id, product_id, type, qty, created_by, created_at)
            VALUES (:b, :p, 'purchase', 1, :o, '2020-01-01') RETURNING created_by
        """), {"b": biz["id"], "p": p["id"], "o": owner_id})
        db.commit()
        assert created != owner_id
    finally:
        db.close()


def test_master_usage_stops_when_module_off(client, superadmin, biz):
    usta = add_member(client, biz, "staff")
    p = new_product(client, biz, stock=10)
    sql = text("INSERT INTO stock_movements (business_id, product_id, type, qty, member_id) "
               "VALUES (:b, :p, 'usage', -1, :m)")
    params = {"b": biz["id"], "p": p["id"], "m": usta["member"]["id"]}
    db = api_session(uid(client, usta["tokens"]))
    try:
        db.execute(sql, params)
        db.commit()
    finally:
        db.close()

    r = client.put(f"/api/v1/superadmin/businesses/{biz['id']}/modules/inventory", headers=auth_header(superadmin),
                   json={"enabled": False})
    assert r.status_code == 204
    db = api_session(uid(client, usta["tokens"]))
    try:
        with pytest.raises(DBAPIError) as e:
            db.execute(sql, params)
        assert sqlstate(e) == "42501"
    finally:
        db.close()
