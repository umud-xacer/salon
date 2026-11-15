"""Qabulxona rejimi (TZ 2026-11-15): oddiy xodim huquqi muassasada Administrator bor-yo'qligiga qarab.

A) Administrator bor — xodim bron yarata olmaydi, to'lov ololmaydi (direktor alohida huquq bergan bo'lsa ham).
B) Administrator yo'q — xodim faqat o'ziga bron qo'shadi va faqat o'z mijozidan to'lov oladi.
"""
import pytest

from tests.conftest import add_member, auth_header, create_business, new_phone
from tests.test_appointments import at
from tests.test_schedule import day_from_today, new_master, new_service


def url(biz, path):
    return f"/api/v1/businesses/{biz['id']}/{path}"


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance"))


@pytest.fixture()
def ctx(client, biz):
    service = new_service(client, biz, duration=60)
    return {"service": service, "a": new_master(client, biz, service), "b": new_master(client, biz, service),
            "day": day_from_today(biz, 1)}


def book(client, biz, ctx, tokens, member, clock="10:00"):
    body = {"service_id": ctx["service"]["id"], "starts_at": at(ctx["day"], clock),
            "client_name": "Mijoz Sinov", "client_phone": new_phone()}
    if member is not None:
        body["member_id"] = member["member"]["id"]
    return client.post(url(biz, "reception/appointments"), headers=auth_header(tokens), json=body)


def pay(client, biz, tokens, appointment_id, amount=10000):
    return client.post(url(biz, f"appointments/{appointment_id}/payments"), headers=auth_header(tokens),
                       json={"amount": amount, "method": "cash"})


def perms(client, tokens, biz):
    me = client.get("/api/v1/auth/me", headers=auth_header(tokens)).json()
    m = next(x for x in me["memberships"] if x["business_id"] == biz["id"])
    return m["has_reception"], set(m["permissions"])


# ─── B: Administrator yo'q ─────────────────────────────────────────────────
def test_without_reception_staff_books_and_takes_payment_for_self_only(client, biz, ctx):
    a, b = ctx["a"], ctx["b"]
    has_rec, p = perms(client, a["tokens"], biz)
    assert has_rec is False
    assert {"appointments.manage_own", "payments.accept_own"} <= p
    assert "appointments.manage" not in p and "payments.accept" not in p

    # O'ziga — mumkin
    r = book(client, biz, ctx, a["tokens"], a)
    assert r.status_code == 201, r.text
    own = r.json()
    assert own["member_id"] == a["member"]["id"]
    # O'z bronidagi mijoz ismi ko'rinadi, boshqa xodimning mijozi esa ro'yxatga umuman tushmaydi
    mine = client.get(url(biz, f"appointments?date={ctx['day']}"), headers=auth_header(a["tokens"])).json()
    assert [x["client_name"] for x in mine] == ["Mijoz Sinov"]
    assert mine[0]["client_phone"] is None                     # telefon ustaga ko'rinmaydi (eski qoida)
    # Boshqa xodimga yoki "istalgan" — yo'q
    assert book(client, biz, ctx, a["tokens"], b, "12:00").status_code == 403
    assert book(client, biz, ctx, a["tokens"], None, "13:00").status_code == 403

    # O'z mijozidan to'lov — mumkin, to'lovlar ro'yxatini ko'radi
    r = pay(client, biz, a["tokens"], own["id"])
    assert r.status_code == 201, r.text
    assert r.json()["paid"] == 10000
    assert client.get(url(biz, f"appointments/{own['id']}/payments"),
                      headers=auth_header(a["tokens"])).json()["paid"] == 10000

    # Boshqa xodim mijozidan — yo'q
    other = book(client, biz, ctx, biz["owner"], b, "15:00").json()
    assert pay(client, biz, a["tokens"], other["id"]).status_code == 403


def test_my_slots_and_my_clients(client, biz, ctx):
    a = ctx["a"]
    r = client.get(url(biz, "my-slots"), headers=auth_header(a["tokens"]),
                   params={"service_id": ctx["service"]["id"], "date": str(ctx["day"])})
    assert r.status_code == 200, r.text
    assert r.json()["member_id"] == a["member"]["id"] and r.json()["slots"]

    assert book(client, biz, ctx, a["tokens"], a).status_code == 201
    assert book(client, biz, ctx, biz["owner"], ctx["b"], "11:00").status_code == 201   # boshqa xodim mijozi
    clients = client.get(url(biz, "my-clients"), headers=auth_header(a["tokens"])).json()
    assert [c["full_name"] for c in clients] == ["Mijoz Sinov"]
    assert clients[0]["phone"] is None
    assert clients[0]["next_visit"] is not None


# ─── A: Administrator bor ──────────────────────────────────────────────────
def test_with_reception_staff_is_locked(client, biz, ctx):
    a = ctx["a"]
    own = book(client, biz, ctx, a["tokens"], a).json()           # hali qabulxona yo'q — o'ziga yozdi
    rec = add_member(client, biz, "receptionist")

    has_rec, p = perms(client, a["tokens"], biz)
    assert has_rec is True
    assert not ({"appointments.manage_own", "payments.accept_own"} & p)

    assert book(client, biz, ctx, a["tokens"], a, "14:00").status_code == 403
    assert pay(client, biz, a["tokens"], own["id"]).status_code == 403
    assert client.get(url(biz, "my-slots"), headers=auth_header(a["tokens"]),
                      params={"service_id": ctx["service"]["id"], "date": str(ctx["day"])}).status_code == 403
    # O'z bronlari, holat belgilash va mijozlari — qoladi
    assert client.get(url(biz, f"appointments?date={ctx['day']}"), headers=auth_header(a["tokens"])).status_code == 200
    r = client.patch(url(biz, f"appointments/{own['id']}/status"), headers=auth_header(a["tokens"]),
                     json={"status": "in_progress"})
    assert r.status_code == 200, r.text
    assert client.get(url(biz, "my-clients"), headers=auth_header(a["tokens"])).status_code == 200

    # Qabulxona hammasini qiladi
    assert book(client, biz, ctx, rec["tokens"], ctx["b"], "16:00").status_code == 201
    assert pay(client, biz, rec["tokens"], own["id"]).status_code == 201


def test_reception_overrides_explicit_grant(client, biz, ctx):
    """Direktor xodimga alohida bron/kassa huquqini bergan bo'lsa ham, qabulxona bor paytda u ishlamaydi."""
    a = ctx["a"]
    for code in ("appointments.manage", "appointments.view_all", "payments.accept"):
        r = client.put(url(biz, f"members/{a['member']['id']}/permissions/{code}"), headers=auth_header(biz["owner"]),
                       json={"granted": True})
        assert r.status_code == 204, r.text
    assert book(client, biz, ctx, a["tokens"], ctx["b"]).status_code == 201       # qabulxonasiz — huquq ishlaydi

    rec = add_member(client, biz, "receptionist")
    assert book(client, biz, ctx, a["tokens"], ctx["b"], "12:00").status_code == 403

    # Administrator o'chirilsa — B rejimga qaytadi
    r = client.patch(url(biz, f"members/{rec['member']['id']}"), headers=auth_header(biz["owner"]),
                     json={"is_active": False})
    assert r.status_code == 200, r.text
    assert book(client, biz, ctx, a["tokens"], ctx["b"], "12:00").status_code == 201


def test_owner_and_manager_unaffected_by_reception(client, biz, ctx):
    add_member(client, biz, "receptionist")
    manager = add_member(client, biz, "manager")
    assert book(client, biz, ctx, biz["owner"], ctx["a"]).status_code == 201
    appt = book(client, biz, ctx, manager["tokens"], ctx["b"], "12:00")
    assert appt.status_code == 201
    assert pay(client, biz, manager["tokens"], appt.json()["id"]).status_code == 201
