"""'Mijoz keldi' belgisi va bekor qilish sabablari (048_arrival_cancel_reasons.sql)."""
import pytest

from tests.conftest import add_member, auth_header, create_business
from tests.test_reception_mode import book, ctx, url  # noqa: F401  (ctx — fixture)


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance"))


def arrived(client, biz, tokens, appointment_id, value=True):
    return client.post(url(biz, f"appointments/{appointment_id}/arrived"), headers=auth_header(tokens),
                       json={"arrived": value})


# ─── Mijoz keldi ─────────────────────────────────────────────────────────────
def test_reception_marks_arrived_and_pending_becomes_confirmed(client, biz, ctx):
    rec = add_member(client, biz, "receptionist")
    appt = book(client, biz, ctx, biz["owner"], ctx["a"]).json()
    assert appt["arrived_at"] is None

    r = arrived(client, biz, rec["tokens"], appt["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["arrived_at"] is not None
    assert body["status"] == "confirmed"          # 'pending' qolsa avtomatik bekor qilinardi

    # Qayta bosish vaqtni o'zgartirmaydi; olib tashlash mumkin
    assert arrived(client, biz, rec["tokens"], appt["id"]).json()["arrived_at"] == body["arrived_at"]
    r = arrived(client, biz, rec["tokens"], appt["id"], False)
    assert r.json()["arrived_at"] is None and r.json()["status"] == "confirmed"


def test_arrival_kept_when_visit_starts(client, biz, ctx):
    appt = book(client, biz, ctx, biz["owner"], ctx["a"]).json()
    first = arrived(client, biz, biz["owner"], appt["id"]).json()["arrived_at"]
    r = client.patch(url(biz, f"appointments/{appt['id']}/status"), headers=auth_header(biz["owner"]),
                     json={"status": "in_progress"})
    assert r.status_code == 200, r.text
    assert r.json()["arrived_at"] == first        # kelgan vaqt boshlangan vaqt bilan almashmaydi


def test_master_marks_only_own_booking(client, biz, ctx):
    a, b = ctx["a"], ctx["b"]
    own = book(client, biz, ctx, biz["owner"], a, "10:00").json()
    other = book(client, biz, ctx, biz["owner"], b, "12:00").json()
    assert arrived(client, biz, a["tokens"], own["id"]).status_code == 200
    assert arrived(client, biz, a["tokens"], other["id"]).status_code == 404


def test_cannot_mark_cancelled_booking(client, biz, ctx):
    appt = book(client, biz, ctx, biz["owner"], ctx["a"]).json()
    client.post(f"/api/v1/appointments/{appt['id']}/cancel", headers=auth_header(biz["owner"]), json={"reason": "x"})
    assert arrived(client, biz, biz["owner"], appt["id"]).status_code == 409


def test_other_business_cannot_mark(client, superadmin, biz, ctx):
    appt = book(client, biz, ctx, biz["owner"], ctx["a"]).json()
    stranger = create_business(client, superadmin)
    r = client.post(f"/api/v1/businesses/{stranger['id']}/appointments/{appt['id']}/arrived",
                    headers=auth_header(stranger["owner"]), json={"arrived": True})
    assert r.status_code == 404


# ─── Bekor qilish sabablari ──────────────────────────────────────────────────
def test_new_business_gets_default_reasons(client, biz):
    r = client.get(url(biz, "cancel-reasons"), headers=auth_header(biz["owner"]))
    assert r.status_code == 200, r.text
    names = [x["name"] for x in r.json()]
    assert "Mijozning rejasi o'zgardi" in names and len(names) == 5


def test_owner_manages_reasons_reception_only_reads(client, biz):
    rec = add_member(client, biz, "receptionist")
    r = client.post(url(biz, "cancel-reasons"), headers=auth_header(biz["owner"]),
                    json={"name": "  Ob-havo   yomon ", "sort_order": 5})
    assert r.status_code == 201, r.text
    reason = r.json()
    assert reason["name"] == "Ob-havo yomon"
    # Bir xil nom ikki marta — yo'q
    assert client.post(url(biz, "cancel-reasons"), headers=auth_header(biz["owner"]),
                       json={"name": "Ob-havo yomon"}).status_code == 409

    # Qabulxona ro'yxatni ko'radi, lekin o'zgartira olmaydi
    names = [x["name"] for x in client.get(url(biz, "cancel-reasons"), headers=auth_header(rec["tokens"])).json()]
    assert names[0] == "Ob-havo yomon"            # sort_order bo'yicha
    assert client.post(url(biz, "cancel-reasons"), headers=auth_header(rec["tokens"]),
                       json={"name": "Boshqa"}).status_code == 403
    assert client.delete(url(biz, f"cancel-reasons/{reason['id']}"),
                         headers=auth_header(rec["tokens"])).status_code == 403

    r = client.put(url(biz, f"cancel-reasons/{reason['id']}"), headers=auth_header(biz["owner"]),
                   json={"name": "Yomg'ir", "sort_order": 1})
    assert r.status_code == 200 and r.json()["name"] == "Yomg'ir"
    assert client.delete(url(biz, f"cancel-reasons/{reason['id']}"),
                         headers=auth_header(biz["owner"])).status_code == 204


def test_master_cannot_read_reasons(client, biz, ctx):
    assert client.get(url(biz, "cancel-reasons"), headers=auth_header(ctx["a"]["tokens"])).status_code == 403


def test_reasons_isolated_between_businesses(client, superadmin, biz):
    other = create_business(client, superadmin)
    own = client.get(url(biz, "cancel-reasons"), headers=auth_header(biz["owner"])).json()
    # Boshqa salon egasi bu salon sababini o'zgartira olmaydi (RLS: qator ko'rinmaydi)
    r = client.put(f"/api/v1/businesses/{other['id']}/cancel-reasons/{own[0]['id']}",
                   headers=auth_header(other["owner"]), json={"name": "Buzildi"})
    assert r.status_code == 404
    assert client.get(f"/api/v1/businesses/{biz['id']}/cancel-reasons",
                      headers=auth_header(other["owner"])).status_code == 403


def test_report_groups_cancellations_by_reason(client, biz, ctx):
    owner = biz["owner"]
    for clock, reason in (("10:00", "Mijoz kasal bo'lib qoldi"), ("11:00", "Mijoz kasal bo'lib qoldi"),
                          ("12:00", "Xato yozilgan"), ("15:00", None)):
        r = book(client, biz, ctx, owner, ctx["a"], clock)
        assert r.status_code == 201, (clock, r.text)
        appt = r.json()
        c = client.post(f"/api/v1/appointments/{appt['id']}/cancel", headers=auth_header(owner), json={"reason": reason})
        assert c.status_code == 200, c.text
    r = client.get(url(biz, f"reports?date_from={ctx['day']}&date_to={ctx['day']}"), headers=auth_header(owner))
    assert r.status_code == 200, r.text
    rows = {x["reason"]: x["count"] for x in r.json()["cancel_reasons"]}
    assert rows == {"Mijoz kasal bo'lib qoldi": 2, "Xato yozilgan": 1, None: 1}
