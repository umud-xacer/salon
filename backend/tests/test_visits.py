"""Tashrif qatorlari, bo'limma-bo'lim chek, foiz taqsimoti, avanslar, tezkor qabul va ularning baza himoyasi."""
import calendar
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business, new_phone
from tests.test_appointments import at
from tests.test_schedule import day_from_today, new_master

ALWAYS = [{"weekday": d, "start_time": "00:00", "end_time": "23:59", "breaks": []} for d in range(1, 8)]


def now():
    return datetime.now(ZoneInfo("Asia/Tashkent"))


def month():
    return now().strftime("%Y-%m")


def next_month():
    first = now().date().replace(day=1)
    following = date(first.year + first.month // 12, first.month % 12 + 1, 1)
    return following.strftime("%Y-%m")


def url(biz, tail):
    return f"/api/v1/businesses/{biz['id']}/{tail}"


def owner(biz):
    return auth_header(biz["owner"])


def service(client, biz, name, price, category=None):
    r = client.post(url(biz, "services"), headers=owner(biz),
                    json={"name": name, "duration_min": 30, "price": price, "category_id": category})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance", "payroll"))


@pytest.fixture()
def ctx(client, biz):
    """Shifokor ko'rik qiladi, laborant tahlil; rentgen — muassasa hisobiga."""
    cats = {n: client.post(url(biz, "service-categories"), headers=owner(biz), json={"name": n}).json()["id"]
            for n in ("Ko'rik", "Laboratoriya")}
    exam = service(client, biz, "Ko'rik", 100_000, cats["Ko'rik"])
    blood = service(client, biz, "Qon tahlili", 60_000, cats["Laboratoriya"])
    xray = service(client, biz, "Rentgen", 40_000)
    return {"cats": cats, "exam": exam, "blood": blood, "xray": xray,
            "doctor": new_master(client, biz, exam, schedule=ALWAYS), "lab": add_member(client, biz, "staff"),
            "rec": add_member(client, biz, "receptionist"), "day": day_from_today(biz, 1)}


def rec(ctx):
    return auth_header(ctx["rec"]["tokens"])


def visit(client, biz, ctx, clock="10:00"):
    r = client.post(url(biz, "reception/appointments"), headers=rec(ctx), json={
        "service_id": ctx["exam"]["id"], "member_id": ctx["doctor"]["member"]["id"],
        "starts_at": at(ctx["day"], clock), "client_name": "Dilshod Ergashev", "client_phone": new_phone()})
    assert r.status_code == 201, r.text
    return r.json()


def add_line(client, biz, ctx, a, svc, **extra):
    return client.post(url(biz, f"appointments/{a['id']}/lines"), headers=rec(ctx),
                       json={"service_id": ctx[svc]["id"], **extra})


def full_visit(client, biz, ctx):
    """Ko'rik (shifokor) + tahlil (laborant) + rentgen (muassasa) = 200 000."""
    a = visit(client, biz, ctx)
    assert add_line(client, biz, ctx, a, "blood", member_id=ctx["lab"]["member"]["id"]).status_code == 201
    r = add_line(client, biz, ctx, a, "xray", house=True)
    assert r.status_code == 201, r.text
    return a, r.json()


def pay(client, biz, ctx, a, amount):
    r = client.post(url(biz, f"appointments/{a['id']}/payments"), headers=rec(ctx),
                    json={"amount": amount, "method": "cash"})
    assert r.status_code == 201, r.text
    return r.json()


def set_rate(client, biz, member, base, percent):
    r = client.put(url(biz, f"payroll/compensation/{member['member']['id']}"), headers=owner(biz),
                   json={"base_salary": base, "commission_percent": percent})
    assert r.status_code == 200, r.text


def generate(client, biz):
    r = client.post(url(biz, "payroll/generate"), headers=owner(biz), json={"month": month()})
    assert r.status_code == 200, r.text
    data = client.get(url(biz, f"payroll?month={month()}"), headers=owner(biz)).json()
    return {row["member_id"]: row for row in data["items"]}


# ─── Qatorlar ────────────────────────────────────────────────────────────────

def test_lines_add_performer_and_total(client, biz, ctx):
    a, data = full_visit(client, biz, ctx)
    assert data["total"] == 200_000
    lines = {line["service_name"]: line for line in data["lines"]}
    assert lines["Ko'rik"]["member_id"] == ctx["doctor"]["member"]["id"]
    assert lines["Qon tahlili"]["member_id"] == ctx["lab"]["member"]["id"] and lines["Qon tahlili"]["member_name"]
    assert lines["Rentgen"]["house"] and lines["Rentgen"]["member_id"] is None
    assert lines["Qon tahlili"]["category_name"] == "Laboratoriya" and lines["Rentgen"]["category_id"] is None

    booking = client.get(f"/api/v1/appointments/{a['id']}", headers=rec(ctx)).json()
    assert booking["total_price"] == 200_000 and len(booking["services"]) == 3


def test_line_removal_rules(client, biz, ctx):
    a, data = full_visit(client, biz, ctx)
    by_name = {line["service_name"]: line["id"] for line in data["lines"]}
    pay(client, biz, ctx, a, 150_000)

    base = url(biz, f"appointments/{a['id']}/lines")
    r = client.delete(f"{base}/{by_name['Qon tahlili']}", headers=rec(ctx))     # 140 000 < to'langan 150 000
    assert r.status_code == 409 and r.json()["detail"]["code"] == "line_not_removable"
    r = client.delete(f"{base}/{by_name['Rentgen']}", headers=rec(ctx))
    assert r.status_code == 200 and r.json()["total"] == 160_000 and len(r.json()["lines"]) == 2
    assert client.delete(f"{base}/{by_name['Rentgen']}", headers=rec(ctx)).status_code == 404

    single = visit(client, biz, ctx, "12:00")
    only = client.get(url(biz, f"appointments/{single['id']}/lines"), headers=rec(ctx)).json()["lines"][0]["id"]
    r = client.delete(url(biz, f"appointments/{single['id']}/lines/{only}"), headers=rec(ctx))
    assert r.status_code == 409                                                 # oxirgi xizmat qoladi


def test_lines_validation_and_closed_visit(client, superadmin, biz, ctx):
    a = visit(client, biz, ctx)
    assert add_line(client, biz, ctx, a, "blood", member_id=999_999).status_code == 404
    other = create_business(client, superadmin, modules=("booking",))
    foreign = service(client, other, "Begona xizmat", 1000)
    r = client.post(url(biz, f"appointments/{a['id']}/lines"), headers=rec(ctx), json={"service_id": foreign["id"]})
    assert r.status_code == 404

    assert client.post(f"/api/v1/appointments/{a['id']}/cancel", headers=rec(ctx), json={}).status_code == 200
    r = add_line(client, biz, ctx, a, "blood")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_changeable"


def test_lines_permissions(client, superadmin, biz, ctx):
    a = visit(client, biz, ctx)
    doctor = auth_header(ctx["doctor"]["tokens"])
    lines = url(biz, f"appointments/{a['id']}/lines")
    assert client.post(lines, headers=doctor, json={"service_id": ctx["blood"]["id"]}).status_code == 403
    assert client.get(lines, headers=doctor).status_code == 403
    assert client.get(url(biz, f"appointments/{a['id']}/receipt"), headers=doctor).status_code == 403

    stranger = create_business(client, superadmin, modules=("booking", "finance"))
    h = owner(stranger)
    assert client.get(url(stranger, f"appointments/{a['id']}/lines"), headers=h).status_code == 404
    assert client.get(url(stranger, f"appointments/{a['id']}/receipt"), headers=h).status_code == 404
    r = client.post(url(stranger, f"appointments/{a['id']}/lines"), headers=h, json={"service_id": ctx["blood"]["id"]})
    assert r.status_code == 404


def test_db_blocks_direct_line_writes(client, biz, ctx):
    """Narx yoki ijrochini soxtalashtirib bo'lmaydi: hatto direktor ham qatorni to'g'ridan-to'g'ri yoza olmaydi."""
    a, data = full_visit(client, biz, ctx)
    line = data["lines"][0]["id"]
    db = api_session(biz["owner"]["user"]["id"])
    try:
        for sql in (f"UPDATE appointment_services SET price = 1 WHERE id = {line}",
                    f"UPDATE appointment_services SET member_id = {biz['owner_member_id']} WHERE id = {line}",
                    f"DELETE FROM appointment_services WHERE id = {line}",
                    f"INSERT INTO appointment_services (business_id, appointment_id, service_id, service_name, price,"
                    f" duration_min) VALUES ({biz['id']}, {a['id']}, {ctx['blood']['id']}, 'x', 1, 30)"):
            with pytest.raises(DBAPIError) as e:
                db.execute(text(sql))
            assert e.value.orig.sqlstate == "42501"
            db.rollback()
    finally:
        db.close()


# ─── Chek ────────────────────────────────────────────────────────────────────

def test_receipt_grouped_by_category(client, biz, ctx):
    a, _ = full_visit(client, biz, ctx)
    pay(client, biz, ctx, a, 150_000)
    r = client.get(url(biz, f"appointments/{a['id']}/receipt"), headers=rec(ctx))
    assert r.status_code == 200, r.text
    d = r.json()
    assert [(s["name"], s["subtotal"]) for s in d["sections"]] == [
        ("Ko'rik", 100_000), ("Laboratoriya", 60_000), (None, 40_000)]
    assert d["sections"][1]["lines"][0]["member_id"] == ctx["lab"]["member"]["id"]
    assert (d["subtotal"], d["total"], d["paid"], d["due"]) == (200_000, 200_000, 150_000, 50_000)
    assert d["payments"][0]["method"] == "cash" and d["client_name"] == "Dilshod Ergashev" and d["business_name"]


# ─── Foiz taqsimoti ──────────────────────────────────────────────────────────

def test_commission_split_by_performer(client, biz, ctx):
    set_rate(client, biz, ctx["doctor"], 0, 30)
    set_rate(client, biz, ctx["lab"], 0, 10)
    a, _ = full_visit(client, biz, ctx)
    pay(client, biz, ctx, a, 200_000)
    rows = generate(client, biz)
    doctor, lab = rows[ctx["doctor"]["member"]["id"]], rows[ctx["lab"]["member"]["id"]]
    assert (doctor["revenue"], doctor["commission"], doctor["clients"]) == (100_000, 30_000, 1)
    assert (lab["revenue"], lab["commission"], lab["clients"]) == (60_000, 6_000, 1)     # rentgen — hech kimga


def test_partial_payment_is_split_proportionally(client, biz, ctx):
    set_rate(client, biz, ctx["doctor"], 0, 30)
    set_rate(client, biz, ctx["lab"], 0, 10)
    a, _ = full_visit(client, biz, ctx)
    pay(client, biz, ctx, a, 100_000)                                            # yarmi to'landi
    rows = generate(client, biz)
    assert rows[ctx["doctor"]["member"]["id"]]["revenue"] == 50_000
    assert rows[ctx["lab"]["member"]["id"]]["revenue"] == 30_000


# ─── Avanslar ────────────────────────────────────────────────────────────────

def advance(client, biz, member, amount, headers=None, note=None):
    return client.post(url(biz, "payroll/advances"), headers=headers or owner(biz),
                       json={"member_id": member["member"]["id"], "amount": amount, "note": note})


def advances(client, biz, m=None):
    return client.get(url(biz, f"payroll/advances?month={m or month()}"), headers=owner(biz)).json()


def expenses_today(client, biz):
    d = now().date().isoformat()
    return client.get(url(biz, f"expenses?date_from={d}&date_to={d}"), headers=owner(biz)).json()


def test_advance_goes_to_cash_and_is_deducted(client, biz, ctx):
    set_rate(client, biz, ctx["doctor"], 1_000_000, 0)
    r = advance(client, biz, ctx["doctor"], 200_000, note="Oila sharoiti")
    assert r.status_code == 201, r.text
    assert r.json()["settled"] is False and r.json()["carried"] is False and r.json()["created_by_name"]

    e = expenses_today(client, biz)
    assert e["total"] == 200_000 and e["items"][0]["category_name"] == "Avans"
    assert "Oila sharoiti" in e["items"][0]["note"]

    row = generate(client, biz)[ctx["doctor"]["member"]["id"]]
    assert row["advances"] == 200_000 and row["total"] == 800_000

    # Qoralama turganda berilgan yana bir avans darhol ko'rinadi
    advance(client, biz, ctx["doctor"], 50_000)
    listing = client.get(url(biz, f"payroll?month={month()}"), headers=owner(biz)).json()
    assert listing["items"][0]["advances"] == 250_000 and listing["total"] == 750_000
    assert advances(client, biz)["open_total"] == 250_000

    base = url(biz, f"payroll/{row['id']}")
    assert client.post(f"{base}/approve", headers=owner(biz)).status_code == 200
    r = client.post(f"{base}/pay", headers=owner(biz))
    assert r.status_code == 200 and r.json()["total"] == 750_000
    assert expenses_today(client, biz)["total"] == 1_000_000                     # 250 000 avans + 750 000 oylik

    listing = advances(client, biz)
    assert listing["open_total"] == 0 and all(i["settled"] for i in listing["items"])
    r = client.delete(url(biz, f"payroll/advances/{listing['items'][0]['id']}"), headers=owner(biz))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "advance_settled"


def test_cancelled_advance_removes_expense(client, biz, ctx):
    set_rate(client, biz, ctx["doctor"], 500_000, 0)
    a = advance(client, biz, ctx["doctor"], 100_000).json()
    row = generate(client, biz)[ctx["doctor"]["member"]["id"]]
    assert row["advances"] == 100_000

    assert client.delete(url(biz, f"payroll/advances/{a['id']}"), headers=owner(biz)).status_code == 204
    assert client.delete(url(biz, f"payroll/advances/{a['id']}"), headers=owner(biz)).status_code == 404
    assert expenses_today(client, biz)["total"] == 0 and advances(client, biz)["items"] == []
    listing = client.get(url(biz, f"payroll?month={month()}"), headers=owner(biz)).json()
    assert listing["items"][0]["advances"] == 0 and listing["items"][0]["total"] == 500_000


def test_advance_above_salary_carries_over(client, biz, ctx):
    set_rate(client, biz, ctx["doctor"], 100_000, 0)
    assert advance(client, biz, ctx["doctor"], 300_000).status_code == 201
    row = generate(client, biz)[ctx["doctor"]["member"]["id"]]
    assert row["advances"] == 100_000 and row["total"] == 0                      # oylik manfiy bo'lmaydi

    r = client.post(url(biz, f"payroll/{row['id']}/approve"), headers=owner(biz))
    assert r.status_code == 200 and r.json()["advances"] == 100_000

    carried = advances(client, biz, next_month())
    assert carried["open_total"] == 200_000
    assert [(i["amount"], i["carried"], i["settled"]) for i in carried["items"]] == [(200_000, True, False)]
    assert expenses_today(client, biz)["total"] == 300_000                       # pul bir marta chiqqan


def test_advance_permissions_and_validation(client, superadmin, biz, ctx):
    for who in (ctx["rec"], ctx["doctor"], add_member(client, biz, "manager")):
        h = auth_header(who["tokens"])
        assert advance(client, biz, ctx["doctor"], 1000, headers=h).status_code == 403
        assert client.get(url(biz, f"payroll/advances?month={month()}"), headers=h).status_code == 403

    assert advance(client, biz, ctx["doctor"], 0).status_code == 422
    assert client.post(url(biz, "payroll/advances"), headers=owner(biz),
                       json={"member_id": 999_999, "amount": 1000}).status_code == 404

    other = create_business(client, superadmin, modules=("booking", "finance", "payroll"))
    assert advance(client, other, ctx["doctor"], 1000).status_code == 404        # begona xodim
    a = advance(client, biz, ctx["doctor"], 1000).json()
    assert client.delete(url(other, f"payroll/advances/{a['id']}"), headers=owner(other)).status_code == 404


def test_db_protects_advances(client, biz, ctx):
    """payroll_advances: yozish faqat funksiyalar orqali; xodim faqat o'zinikini, begona hech narsani ko'rmaydi."""
    advance(client, biz, ctx["doctor"], 70_000)
    advance(client, biz, ctx["lab"], 30_000)
    doctor_id = ctx["doctor"]["member"]["id"]

    db = api_session(biz["owner"]["user"]["id"])
    try:
        assert db.scalar(text("SELECT count(*) FROM payroll_advances WHERE business_id = :b"), {"b": biz["id"]}) == 2
        for sql in ("UPDATE payroll_advances SET amount = 1",
                    "DELETE FROM payroll_advances",
                    f"INSERT INTO payroll_advances (business_id, member_id, amount, given_on) "
                    f"VALUES ({biz['id']}, {doctor_id}, 1, current_date)"):
            with pytest.raises(DBAPIError) as e:
                db.execute(text(sql))
            assert e.value.orig.sqlstate == "42501"
            db.rollback()
    finally:
        db.close()

    with api_session(ctx["doctor"]["tokens"]["user"]["id"]) as db:
        assert db.execute(text("SELECT member_id, amount FROM payroll_advances")).all() == [(doctor_id, 70_000)]
        with pytest.raises(DBAPIError) as e:
            db.execute(text("SELECT app.give_advance(:b, :m, 1000)"), {"b": biz["id"], "m": doctor_id})
        assert e.value.orig.sqlstate == "42501"
    with api_session(ctx["rec"]["tokens"]["user"]["id"]) as db:
        assert db.scalar(text("SELECT count(*) FROM payroll_advances")) == 0


# ─── Tezkor qabul ────────────────────────────────────────────────────────────

def walk_in(client, biz, ctx, member=None, tokens=None, **extra):
    body = {"service_id": ctx["exam"]["id"], "client_name": "Yo'lovchi Mijoz", "client_phone": new_phone(), **extra}
    if member:
        body["member_id"] = member["member"]["id"]
    return client.post(url(biz, "reception/walk-in"), headers=auth_header(tokens or ctx["rec"]["tokens"]), json=body)


def options(client, biz, ctx):
    r = client.get(url(biz, "reception/walk-in"), headers=rec(ctx), params={"service_id": ctx["exam"]["id"]})
    assert r.status_code == 200, r.text
    return {o["member_id"]: o for o in r.json()}


def test_walk_in_takes_free_specialist_now(client, biz, ctx):
    doctor = ctx["doctor"]["member"]["id"]
    before = options(client, biz, ctx)
    assert before[doctor]["free"] and before[doctor]["on_shift"] and before[doctor]["price"] == 100_000

    r = walk_in(client, biz, ctx)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["member_id"] == doctor and a["status"] == "in_progress" and a["total_price"] == 100_000
    assert abs((datetime.fromisoformat(a["starts_at"]) - now()).total_seconds()) < 120

    after = options(client, biz, ctx)
    assert after[doctor]["free"] is False and after[doctor]["busy_until"]
    r = walk_in(client, biz, ctx)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "nobody_free"

    # Kelgan zahoti to'lov va chek
    assert pay(client, biz, ctx, a, 100_000)["due"] == 0
    assert client.get(url(biz, f"appointments/{a['id']}/receipt"), headers=rec(ctx)).json()["paid"] == 100_000


def test_walk_in_any_staff_picks_least_busy(client, biz, ctx):
    second = new_master(client, biz, ctx["exam"], schedule=ALWAYS)
    visit(client, biz, ctx)                                                      # shifokorda ertaga bron — bugun teng
    first = walk_in(client, biz, ctx).json()
    other = walk_in(client, biz, ctx).json()
    assert {first["member_id"], other["member_id"]} == {ctx["doctor"]["member"]["id"], second["member"]["id"]}
    assert walk_in(client, biz, ctx).status_code == 409
    assert walk_in(client, biz, ctx, member=second).status_code == 409           # tanlangan mutaxassis band


def test_walk_in_validation_and_permissions(client, superadmin, biz, ctx):
    assert walk_in(client, biz, ctx, tokens=ctx["doctor"]["tokens"]).status_code == 403
    assert walk_in(client, biz, ctx, client_phone="123").status_code == 422
    assert walk_in(client, biz, ctx, service_id=999_999).status_code == 404
    assert walk_in(client, biz, ctx, member=ctx["lab"]).status_code == 409        # bu xizmatni bajarmaydi
    stranger = create_business(client, superadmin)
    assert walk_in(client, biz, ctx, tokens=stranger["owner"]).status_code == 403
    r = client.get(url(biz, "reception/walk-in"), headers=auth_header(ctx["doctor"]["tokens"]),
                   params={"service_id": ctx["exam"]["id"]})
    assert r.status_code == 403


# ─── Hisobot ─────────────────────────────────────────────────────────────────

def test_report_revenue_by_category(client, biz, ctx):
    a = walk_in(client, biz, ctx).json()
    assert add_line(client, biz, ctx, a, "blood", member_id=ctx["lab"]["member"]["id"]).status_code == 201
    assert add_line(client, biz, ctx, a, "xray", house=True).status_code == 201
    r = client.patch(url(biz, f"appointments/{a['id']}/status"), headers=rec(ctx), json={"status": "completed"})
    assert r.status_code == 200, r.text

    d = now().date().isoformat()
    r = client.get(url(biz, f"reports?date_from={d}&date_to={d}"), headers=owner(biz))
    assert r.status_code == 200, r.text
    assert [(c["name"], c["count"], c["revenue"]) for c in r.json()["categories"]] == [
        ("Ko'rik", 1, 100_000), ("Laboratoriya", 1, 60_000), (None, 1, 40_000)]
    assert client.get(url(biz, f"reports/export.xlsx?date_from={d}&date_to={d}"), headers=owner(biz)).status_code == 200
