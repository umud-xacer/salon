"""Hisobotlar: pul, bronlar, xizmatlar, xodimlar, mijozlar, kunlik qatorlar, Excel eksport va huquqlar."""
import io
from datetime import date, timedelta

import pytest
from openpyxl import load_workbook

from tests.conftest import auth_header, create_business
from tests.test_finance import book, ctx, pay, today, url  # noqa: F401  (ctx — fixture)


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance"))


def report(client, biz, f, t, headers=None):
    return client.get(url(biz, "reports"), headers=headers or auth_header(biz["owner"]),
                      params={"date_from": f, "date_to": t})


def test_report_totals(client, biz, ctx):
    owner = auth_header(biz["owner"])
    a = book(client, biz, ctx, "10:00", status="completed")
    b = book(client, biz, ctx, "12:00", status="completed")
    c = book(client, biz, ctx, "14:00", status="confirmed")
    assert client.post(f"/api/v1/appointments/{c['id']}/cancel", headers=owner,
                       json={"reason": "Mijoz kelolmaydi"}).status_code == 200
    book(client, biz, ctx, "16:00", status="no_show")
    price = a["total_price"]
    pay(client, biz, ctx, a, price, "cash")
    second = pay(client, biz, ctx, b, price, "card").json()["payments"][0]
    client.post(url(biz, f"payments/{second['id']}/refund"), headers=owner, json={"reason": "Xato"})
    client.post(url(biz, "expenses"), headers=owner, json={"amount": 7000, "spent_at": today(), "note": "Choy"})

    f, t = today(), str(ctx["day"])                 # bugun (to'lovlar) + ertaga (bronlar)
    r = report(client, biz, f, t)
    assert r.status_code == 200, r.text
    d = r.json()
    m = d["money"]
    assert (m["income"], m["refunds"], m["expenses"]) == (2 * price, price, 7000)
    assert m["net_income"] == price and m["profit"] == price - 7000 and m["prev_profit"] == 0
    assert {x["method"]: (x["income"], x["refunds"]) for x in d["methods"]} == {"cash": (price, 0), "card": (price, price)}
    assert d["expenses_by_category"] == [{"name": "Toifasiz", "amount": 7000}]

    bk = d["bookings"]
    assert bk["total"] == 4 and bk["completed"] == 2 and bk["by_status"]["cancelled"] == 1
    assert bk["by_status"]["no_show"] == 1 and bk["cancel_rate"] == 25.0
    assert bk["completed_revenue"] == 2 * price and bk["avg_check"] == price
    assert d["services"] == [{"name": ctx["service"]["name"], "name_ru": None, "count": 2, "revenue": 2 * price}]

    (staff,) = d["staff"]
    assert (staff["bookings"], staff["completed"], staff["no_show"], staff["revenue"]) == (3, 2, 1, 2 * price)
    # Har bir bron yangi telefon bilan — 3 ta (bekor qilingan hisobga olinmaydi) yangi mijoz
    assert d["clients"] == {"total": 3, "new": 3, "returning": 0}

    days = {x["date"]: x for x in d["daily"]}
    assert len(d["daily"]) == (date.fromisoformat(t) - date.fromisoformat(f)).days + 1
    assert days[f]["income"] == 2 * price and days[f]["refunds"] == price and days[f]["expenses"] == 7000
    assert days[t]["bookings"] == 3


def test_previous_period_comparison(client, biz, ctx):
    owner = auth_header(biz["owner"])
    yesterday = (date.fromisoformat(today()) - timedelta(days=1)).isoformat()
    client.post(url(biz, "expenses"), headers=owner, json={"amount": 3000, "spent_at": yesterday})
    m = report(client, biz, today(), today()).json()["money"]
    assert m["prev_profit"] == -3000 and m["profit"] == 0


def test_period_validation(client, biz):
    assert report(client, biz, "2026-02-10", "2026-02-01").status_code == 422
    assert report(client, biz, "2025-01-01", "2026-01-02").status_code == 422     # 367 kun
    assert report(client, biz, "2025-01-01", "2026-01-01").status_code == 200     # 366 kun — mumkin


def test_permissions(client, superadmin, biz, ctx):
    master = auth_header(ctx["master"]["tokens"])
    assert report(client, biz, today(), today(), master).status_code == 403
    other = create_business(client, superadmin, modules=("booking", "finance"))
    assert report(client, biz, today(), today(), auth_header(other["owner"])).status_code == 403
    no_finance = create_business(client, superadmin, modules=("booking",))
    assert report(client, no_finance, today(), today()).status_code == 403
    assert client.get(url(biz, "reports"), params={"date_from": today(), "date_to": today()}).status_code == 401


def test_excel_export(client, biz, ctx):
    a = book(client, biz, ctx, "10:00", status="completed")
    pay(client, biz, ctx, a, a["total_price"], "cash")
    # Formula injection: nom '=' bilan boshlansa ham matn bo'lib qolishi kerak
    owner = auth_header(biz["owner"])
    client.post(url(biz, "expense-categories"), headers=owner, json={"name": "=HYPERLINK(\"x\")"})
    cat = client.get(url(biz, "expense-categories"), headers=owner).json()[0]
    client.post(url(biz, "expenses"), headers=owner, json={"amount": 1000, "spent_at": today(), "category_id": cat["id"]})

    r = client.get(url(biz, "reports/export.xlsx"), headers=owner,
                   params={"date_from": today(), "date_to": ctx["day"]})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert f'hisobot_{today()}_{ctx["day"]}.xlsx' in r.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Umumiy", "Kunlar", "Xizmatlar", "Xodimlar", "Xarajatlar", "To'lovlar"]
    assert wb["Xizmatlar"]["A2"].value == ctx["service"]["name"]
    cell = wb["Xarajatlar"]["A2"]
    assert cell.value == '=HYPERLINK("x")' and cell.data_type == "s"
    assert wb["To'lovlar"].max_row == 2


def test_excel_needs_permission(client, biz, ctx):
    r = client.get(url(biz, "reports/export.xlsx"), headers=auth_header(ctx["master"]["tokens"]),
                   params={"date_from": today(), "date_to": today()})
    assert r.status_code == 403
