"""Xodimlar tabeli va ish vaqti (060_timesheet.sql)."""
import datetime as dt
import os
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text

from tests.conftest import add_member, auth_header, create_business, new_phone
from tests.test_appointments import at
from tests.test_reception_mode import url
from tests.test_schedule import day_from_today, new_master, new_service

ADMIN = create_engine(os.environ["MIGRATION_DATABASE_URL"])
TZ = ZoneInfo("Asia/Tashkent")
ALL_WEEK = [{"weekday": d, "start_time": "09:00", "end_time": "18:00", "breaks": []} for d in range(1, 8)]


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "payroll"))


@pytest.fixture()
def staff(client, biz):
    service = new_service(client, biz, duration=60)
    return {"service": service, "m": new_master(client, biz, service, schedule=ALL_WEEK)}


def _d(x):
    return x if isinstance(x, dt.date) else dt.date.fromisoformat(x)


def owner(biz):
    return auth_header(biz["owner"])


def month_of(d: dt.date) -> str:
    return d.strftime("%Y-%m")


def cell(sheet, member_id, day):
    row = next(m for m in sheet["members"] if m["member_id"] == member_id)
    return next(c for c in row["cells"] if c["day"] == day.isoformat()), row


def past_day(n=3) -> dt.date:
    """Shu oy ichidagi o'tgan kun (oy boshida bo'lsak — o'tgan oy)."""
    return dt.datetime.now(TZ).date() - dt.timedelta(days=n)


def test_statuses_late_absent_and_codes(client, biz, staff):
    mid = staff["m"]["member"]["id"]
    d1, d2, d3 = past_day(3), past_day(4), past_day(5)
    h = owner(biz)
    # Kechikdi (09:40 — chegara 15 daq), to'liq ishladi, kelmadi (d3 — hech narsa)
    assert client.put(url(biz, f"timesheet/{mid}/{d1}"), headers=h, json={"check_in": "09:40", "check_out": "18:00"}).status_code == 200
    r = client.put(url(biz, f"timesheet/{mid}/{d2}"), headers=h, json={"check_in": "09:05", "check_out": "17:05"})
    assert r.status_code == 200, r.text
    c2 = next(c for c in r.json()["cells"] if c["day"] == d2.isoformat())
    assert c2["status"] == "work" and c2["worked_min"] == 480 and c2["code"] == "8s" and c2["source"] == "admin"
    sheet = client.get(url(biz, f"timesheet?month={month_of(d1)}"), headers=h).json()
    c1, _ = cell(sheet, mid, d1)
    assert c1["status"] == "late" and c1["late_min"] == 40 and c1["code"] == "K"
    if d3.month == d1.month:
        c3, row = cell(sheet, mid, d3)
        assert c3["status"] == "absent" and c3["code"] == "Y"
        assert row["totals"]["late_count"] >= 1 and row["totals"]["absent_days"] >= 1

    # Kechikish chegarasi 60 daqiqa bo'lsa — kechikmagan
    client.put(url(biz, "timesheet/settings"), headers=h, json={"late_grace_min": 60})
    c1, _ = cell(client.get(url(biz, f"timesheet?month={month_of(d1)}"), headers=h).json(), mid, d1)
    assert c1["status"] == "work"


def test_day_off_blocks_online_booking_and_custom_shift(client, biz, staff):
    mid, h = staff["m"]["member"]["id"], owner(biz)
    day = _d(day_from_today(biz, 2))
    slots = lambda: [s["time"] for s in client.get("/api/v1/catalog/slots", params={  # noqa: E731
        "member_id": mid, "service_id": staff["service"]["id"], "date": day.isoformat()}).json()["slots"]]
    assert "10:00" in slots()
    assert client.put(url(biz, f"timesheet/{mid}/{day}"), headers=h, json={"kind": "vacation"}).status_code == 200
    assert slots() == []                                                     # ta'til — onlayn bron yopiq
    client.put(url(biz, f"timesheet/{mid}/{day}"), headers=h, json={"kind": "work", "start_time": "14:00", "end_time": "17:00"})
    s = slots()
    assert s[0] == "14:00" and "10:00" not in s and "16:00" in s and "17:00" not in s
    client.put(url(biz, f"timesheet/{mid}/{day}"), headers=h, json={"kind": "auto"})
    assert "10:00" in slots()


def test_plan_range_weekdays(client, biz, staff):
    mid, h = staff["m"]["member"]["id"], owner(biz)
    start = _d(day_from_today(biz, 1))
    r = client.post(url(biz, "timesheet/plan"), headers=h, json={
        "member_ids": [mid], "date_from": start.isoformat(), "date_to": (start + dt.timedelta(days=6)).isoformat(),
        "kind": "day_off", "weekdays": [6, 7]})
    assert r.status_code == 204, r.text
    with ADMIN.connect() as c:
        days = c.execute(text("SELECT day FROM staff_days WHERE member_id = :m ORDER BY day"), {"m": mid}).scalars().all()
    assert len(days) == 2 and all(d.isoweekday() in (6, 7) for d in days)


def test_self_check_in_out_and_permissions(client, biz, staff):
    tok = auth_header(staff["m"]["tokens"])
    me = client.get(url(biz, "attendance/me"), headers=tok)
    assert me.status_code == 200 and me.json()["today"]["status"] in ("today", "off")
    assert client.post(url(biz, "attendance/check-out"), headers=tok).json()["detail"]["code"] == "not_checked_in"
    r = client.post(url(biz, "attendance/check-in"), headers=tok)
    assert r.status_code == 200 and r.json()["today"]["check_in"]
    assert client.post(url(biz, "attendance/check-in"), headers=tok).json()["detail"]["code"] == "already_checked_in"
    # Xodim tabelni ko'rmaydi va o'zi vaqtni soxtalashtira olmaydi
    assert client.get(url(biz, "timesheet?month=2026-11"), headers=tok).status_code == 403
    mid = staff["m"]["member"]["id"]
    assert client.put(url(biz, f"timesheet/{mid}/2026-11-01"), headers=tok, json={"check_in": "08:00"}).status_code == 403
    other = add_member(client, biz, "staff")
    assert client.post(url(biz, "attendance/check-in"), headers=auth_header(other["tokens"])).status_code == 200


def test_export_xlsx(client, biz, staff):
    r = client.get(url(biz, "timesheet/export?month=2026-11"), headers=owner(biz))
    assert r.status_code == 200 and r.content[:2] == b"PK"
    assert "tabel-2026-11.xlsx" in r.headers["content-disposition"]


def test_payroll_daily_rate_and_penalties(client, biz, staff):
    mid, h = staff["m"]["member"]["id"], owner(biz)
    d1, d2 = past_day(3), past_day(4)
    if d1.month != d2.month:
        pytest.skip("oy chegarasi")
    r = client.put(url(biz, f"payroll/compensation/{mid}"), headers=h, json={
        "base_salary": 0, "commission_percent": 0, "pay_type": "daily", "daily_rate": 200000,
        "late_penalty": 20000, "absence_penalty": 50000})
    assert r.status_code == 200, r.text and r.json()["pay_type"] == "daily"
    client.put(url(biz, f"timesheet/{mid}/{d1}"), headers=h, json={"check_in": "10:00", "check_out": "18:00"})   # kechikdi
    client.put(url(biz, f"timesheet/{mid}/{d2}"), headers=h, json={"check_in": "09:00", "check_out": "18:00"})
    month = month_of(d1)
    assert client.post(url(biz, "payroll/generate"), headers=h, json={"month": month}).status_code == 200
    p = next(x for x in client.get(url(biz, f"payroll?month={month}"), headers=h).json()["items"] if x["member_id"] == mid)
    sheet = client.get(url(biz, f"timesheet?month={month}"), headers=h).json()
    _, row = cell(sheet, mid, d1)
    t = row["totals"]
    assert p["pay_type"] == "daily" and p["worked_days"] == t["worked_days"] == 2
    assert p["late_count"] == 1 and p["absent_days"] == t["absent_days"]
    expected_pen = min(2 * 200000, 20000 + t["absent_days"] * 50000)
    assert p["penalties"] == expected_pen and p["base_salary"] == 2 * 200000 - expected_pen
