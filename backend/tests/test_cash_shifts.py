"""Kassa smenasi (057_cash_shifts.sql): ochish, tushum, kirim/chiqim, yopish va farq, huquqlar."""
from tests.conftest import auth_header
from tests.test_finance import biz, book, ctx, h, pay, url  # noqa: F401  (fixture'lar)


def test_full_shift_cycle(client, biz, ctx):
    rec = h(ctx)
    assert client.get(url(biz, "cash/shift/current"), headers=rec).json() is None
    r = client.post(url(biz, "cash/shift/move"), headers=rec, json={"kind": "in", "amount": 1000, "note": "Mayda pul"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_open_shift"

    r = client.post(url(biz, "cash/shift/open"), headers=rec, json={"opening_cash": 200_000})
    assert r.status_code == 201, r.text
    assert r.json()["is_open"] and r.json()["expected_cash"] == 200_000
    r = client.post(url(biz, "cash/shift/open"), headers=rec, json={"opening_cash": 1})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "shift_already_open"

    a1, a2 = book(client, biz, ctx, "10:00"), book(client, biz, ctx, "12:00")
    assert pay(client, biz, ctx, a1, a1["total_price"], "cash").status_code == 201
    card = pay(client, biz, ctx, a2, a2["total_price"], "card")
    assert card.status_code == 201
    client.post(url(biz, "cash/shift/move"), headers=rec, json={"kind": "out", "amount": 50_000, "note": "Inkassatsiya"})
    client.post(url(biz, "cash/shift/move"), headers=rec, json={"kind": "in", "amount": 10_000, "note": "Mayda pul"})

    cur = client.get(url(biz, "cash/shift/current"), headers=rec).json()
    methods = {m["method"]: m["income"] for m in cur["methods"]}
    assert methods == {"cash": a1["total_price"], "card": a2["total_price"]}
    expected = 200_000 + a1["total_price"] - 50_000 + 10_000
    assert cur["expected_cash"] == expected and cur["cash_in"] == 10_000 and cur["cash_out"] == 50_000
    assert [m["note"] for m in cur["movements"]] == ["Mayda pul", "Inkassatsiya"]

    r = client.post(url(biz, "cash/shift/close"), headers=rec, json={"counted_cash": expected - 5_000, "note": "5 ming kam"})
    assert r.status_code == 200, r.text
    closed = r.json()
    assert not closed["is_open"] and closed["difference"] == -5_000 and closed["income"] == a1["total_price"] + a2["total_price"]

    # Yopilgandan keyin qaytarish — yopilgan smena hisoboti o'zgarmaydi (surat)
    pid = card.json()["payments"][0]["id"]
    assert client.post(url(biz, f"payments/{pid}/refund"), headers=auth_header(biz["owner"]),
                       json={"reason": "Xato"}).status_code == 200
    again = client.get(url(biz, f"cash/shifts/{closed['id']}"), headers=rec).json()
    assert again["income"] == closed["income"] and again["expected_cash"] == expected
    hist = client.get(url(biz, "cash/shifts"), headers=auth_header(biz["owner"])).json()
    assert hist[0]["id"] == closed["id"] and hist[0]["counted_cash"] == expected - 5_000
    assert client.get(url(biz, "cash/shift/current"), headers=rec).json() is None


def test_shift_permissions(client, biz, ctx):
    master = auth_header(ctx["master"]["tokens"])
    assert client.post(url(biz, "cash/shift/open"), headers=master, json={"opening_cash": 0}).status_code == 403
    assert client.get(url(biz, "cash/shift/current"), headers=master).status_code == 403
    assert client.post(url(biz, "cash/shift/open"), headers=h(ctx), json={"opening_cash": -1}).status_code == 422
    assert client.post(url(biz, "cash/shift/open"), headers=h(ctx), json={"opening_cash": 0}).status_code == 201
    r = client.post(url(biz, "cash/shift/move"), headers=h(ctx), json={"kind": "out", "amount": 1000, "note": " "})
    assert r.status_code == 422
