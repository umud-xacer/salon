"""Aksiyalar: bo'sh soatlarga chegirma (Hot Slots), promokodlar, sodiqlik dasturi (sql/045_promotions.sql).

Chegirmani faqat baza hisoblaydi; bir bronga eng katta bitta chegirma; huquqlar va RLS.
"""
import pytest
from sqlalchemy import text

from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login
from tests.test_appointments import at, book
from tests.test_schedule import day_from_today, new_master, new_service, url

ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
LONG_DAY = [{"weekday": d, "start_time": "00:00", "end_time": "23:55"} for d in range(1, 8)]


def customer(client) -> dict:
    return otp_login(client, new_phone(), "Mijoz Sodiq")


def rule(client, biz, **extra):
    body = {"title": "Ertalabki soatlar", "percent": 20, "weekdays": ALL_DAYS, "time_from": "10:00",
            "time_to": "12:00", **extra}
    r = client.post(url(biz, "promo-rules"), headers=auth_header(biz["owner"]), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def code(client, biz, **extra):
    body = {"code": f"K{new_phone()[-6:]}", "title": "Bahor aksiyasi", "percent": 15, **extra}
    r = client.post(url(biz, "promo-codes"), headers=auth_header(biz["owner"]), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def complete(biz, appointment_id):
    with api_session(biz["owner"]["user"]["id"]) as db:
        db.execute(text("UPDATE appointments SET status = 'completed' WHERE id = :a"), {"a": appointment_id})
        db.commit()


@pytest.fixture()
def shop(client, superadmin):
    biz = create_business(client, superadmin)
    s = new_service(client, biz, duration=60)
    return {"biz": biz, "service": s, "master": new_master(client, biz, s), "day": day_from_today(biz, 1)}


def test_hot_rule_discount_only_inside_window(client, shop):
    biz, s, m, day = shop["biz"], shop["service"], shop["master"], shop["day"]
    rule(client, biz)
    c = customer(client)

    inside = book(client, c, m, s, day, "10:00")
    assert inside.status_code == 201, inside.text
    assert inside.json()["total_price"] == 50000 and inside.json()["discount"] == 10000
    assert inside.json()["discount_source"] == "hot"

    outside = book(client, c, m, s, day, "15:00")
    assert outside.status_code == 201, outside.text
    assert outside.json()["discount"] == 0 and outside.json()["discount_source"] is None

    # Oxirgi chegara kirmaydi: 12:00 dan boshlangan bron chegirmasiz
    assert book(client, c, m, s, day, "12:00").json()["discount"] == 0


def test_rule_for_other_service_and_inactive_rule_do_not_apply(client, shop):
    biz, s, m, day = shop["biz"], shop["service"], shop["master"], shop["day"]
    other = new_service(client, biz)
    rule(client, biz, service_ids=[other["id"]])
    r = rule(client, biz, percent=30)
    h = auth_header(biz["owner"])
    body = {k: r[k] for k in ("title", "percent", "weekdays", "time_from", "time_to", "service_ids")} | {"is_active": False}
    assert client.put(url(biz, f"promo-rules/{r['id']}"), headers=h, json=body).status_code == 200
    assert book(client, customer(client), m, s, day, "10:00").json()["discount"] == 0


def test_quote_matches_booking(client, shop):
    biz, s, m, day = shop["biz"], shop["service"], shop["master"], shop["day"]
    rule(client, biz, percent=25)
    c = customer(client)
    q = client.post("/api/v1/appointments/quote", headers=auth_header(c), json={
        "member_id": m["member"]["id"], "service_id": s["id"], "starts_at": at(day, "11:00")})
    assert q.status_code == 200, q.text
    assert q.json() == {"price": 50000, "percent": 25, "discount": 12500, "final": 37500, "source": "hot",
                        "code_error": None}
    assert book(client, c, m, s, day, "11:00").json()["discount"] == 12500


def test_promo_code_once_per_client_limit_and_errors(client, shop):
    biz, s, m, day = shop["biz"], shop["service"], shop["master"], shop["day"]
    pc = code(client, biz, code="bahor15", max_uses=1)
    assert pc["code"] == "BAHOR15"
    c1, c2 = customer(client), customer(client)

    bad = book(client, c1, m, s, day, "15:00", promo_code="YOQKOD")
    assert bad.status_code == 409 and bad.json()["detail"]["code"] == "promo_not_found"
    assert client.get("/api/v1/appointments/mine", headers=auth_header(c1)).json() == []   # bron yozilmadi

    ok = book(client, c1, m, s, day, "15:00", promo_code="bahor15")
    assert ok.status_code == 201, ok.text
    assert ok.json()["discount"] == 7500 and ok.json()["discount_source"] == "promo"

    again = book(client, c1, m, s, day, "16:00", promo_code="BAHOR15")
    assert again.status_code == 409 and again.json()["detail"]["code"] == "promo_used"
    limit = book(client, c2, m, s, day, "16:00", promo_code="BAHOR15")
    assert limit.status_code == 409 and limit.json()["detail"]["code"] == "promo_limit"
    q = client.post("/api/v1/appointments/quote", headers=auth_header(c2), json={
        "member_id": m["member"]["id"], "service_id": s["id"], "starts_at": at(day, "16:00"), "promo_code": "BAHOR15"})
    assert q.json()["code_error"] == "promo_limit" and q.json()["percent"] == 0

    # Bekor qilingan bron promokodni bo'shatadi
    assert client.post(f"/api/v1/appointments/{ok.json()['id']}/cancel", headers=auth_header(c1), json={}).status_code == 200
    assert book(client, c2, m, s, day, "16:00", promo_code="BAHOR15").status_code == 201

    used = client.get(url(biz, "promo-codes"), headers=auth_header(biz["owner"])).json()
    assert used[0]["uses"] == 1


def test_biggest_discount_wins_and_code_not_consumed(client, shop):
    biz, s, m, day = shop["biz"], shop["service"], shop["master"], shop["day"]
    rule(client, biz, percent=20)
    code(client, biz, code="KICHIK10", percent=10)
    c = customer(client)
    r = book(client, c, m, s, day, "10:00", promo_code="KICHIK10")
    assert r.status_code == 201 and r.json()["discount_source"] == "hot" and r.json()["discount"] == 10000
    with api_session(biz["owner"]["user"]["id"]) as db:
        assert db.scalar(text("SELECT promo_code_id FROM appointments WHERE id = :a"), {"a": r.json()["id"]}) is None
    assert book(client, c, m, s, day, "15:00", promo_code="KICHIK10").json()["discount_source"] == "promo"


def test_first_visit_only_code(client, shop):
    biz, s, m, day = shop["biz"], shop["service"], shop["master"], shop["day"]
    code(client, biz, code="YANGI20", percent=20, first_visit_only=True)
    c = customer(client)
    first = book(client, c, m, s, day, "15:00")
    complete(biz, first.json()["id"])
    r = book(client, c, m, s, day, "16:00", promo_code="YANGI20")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "promo_first_visit"
    assert book(client, customer(client), m, s, day, "16:00", promo_code="YANGI20").status_code == 201


def test_loyalty_reward_after_n_completed_visits(client, shop):
    biz, s, m, day = shop["biz"], shop["service"], shop["master"], shop["day"]
    r = client.put(url(biz, "loyalty"), headers=auth_header(biz["owner"]),
                   json={"visits_required": 2, "reward_percent": 50})
    assert r.status_code == 200, r.text
    c = customer(client)
    for clock in ("09:00", "11:00"):
        a = book(client, c, m, s, day, clock)
        assert a.json()["discount"] == 0
        complete(biz, a.json()["id"])

    mine = client.get("/api/v1/me/loyalty", headers=auth_header(c)).json()
    assert mine == [{"business_id": biz["id"], "business_slug": biz["slug"], "business_name": mine[0]["business_name"],
                     "visits": 2, "required": 2, "percent": 50, "ready": True}]

    reward = book(client, c, m, s, day, "15:00")
    assert reward.json()["discount"] == 25000 and reward.json()["discount_source"] == "loyalty"
    # Mukofot ishlatildi: seriya qaytadan boshlanadi
    assert client.get("/api/v1/me/loyalty", headers=auth_header(c)).json()[0]["visits"] == 0
    assert book(client, c, m, s, day, "16:00").json()["discount"] == 0


def test_reschedule_recomputes_hot_discount(client, shop):
    biz, s, m, day = shop["biz"], shop["service"], shop["master"], shop["day"]
    rule(client, biz)
    c = customer(client)
    a = book(client, c, m, s, day, "10:00").json()
    r = client.post(f"/api/v1/appointments/{a['id']}/reschedule", headers=auth_header(c),
                    json={"starts_at": at(day, "15:00")})
    assert r.status_code == 200, r.text
    assert r.json()["discount"] == 0 and r.json()["discount_source"] is None


def test_permissions_and_rls(client, superadmin, shop):
    biz = shop["biz"]
    rule(client, biz)
    code(client, biz)
    staff = add_member(client, biz, "staff")
    outsider = create_business(client, superadmin)
    for who in (staff["tokens"], outsider["owner"]):
        assert client.get(url(biz, "promo-rules"), headers=auth_header(who)).status_code == 403
        assert client.post(url(biz, "promo-codes"), headers=auth_header(who),
                           json={"code": "XAKER99", "title": "Xaker", "percent": 90}).status_code == 403
    c = customer(client)
    with api_session(c["user"]["id"]) as db:
        assert db.scalar(text("SELECT count(*) FROM promo_rules")) == 0
        assert db.scalar(text("SELECT count(*) FROM promo_codes")) == 0
        with pytest.raises(Exception):
            db.execute(text("SELECT app.hot_percent(:b, 1, now())"), {"b": biz["id"]})


def test_duplicate_code_and_validation(client, shop):
    biz = shop["biz"]
    code(client, biz, code="TAKROR1")
    h = auth_header(biz["owner"])
    dup = client.post(url(biz, "promo-codes"), headers=h, json={"code": "takror1", "title": "Yana", "percent": 10})
    assert dup.status_code == 409
    assert client.post(url(biz, "promo-codes"), headers=h,
                       json={"code": "bo'sh joy", "title": "Yomon", "percent": 10}).status_code == 422
    assert client.post(url(biz, "promo-rules"), headers=h, json={
        "title": "Teskari", "percent": 20, "weekdays": [1], "time_from": "12:00", "time_to": "10:00"}).status_code == 422
    assert client.post(url(biz, "promo-rules"), headers=h, json={
        "title": "Ko'p", "percent": 95, "weekdays": [1], "time_from": "10:00", "time_to": "12:00"}).status_code == 422


def test_hot_slots_and_offers_in_app(client, superadmin):
    biz = create_business(client, superadmin, lat=41.35, lng=69.35)
    s = new_service(client, biz, duration=30)
    m = new_master(client, biz, s, schedule=LONG_DAY)
    rule(client, biz, title="Kun bo'yi", percent=30, time_from="00:00", time_to="23:59")
    code(client, biz, code="SOVGA25", percent=25, is_public=True)
    code(client, biz, code="YASHIRIN", percent=40)

    hot = client.get("/api/v1/catalog/hot-slots", params={"lat": 41.35, "lng": 69.35, "radius_m": 2000})
    assert hot.status_code == 200, hot.text
    items = [x for x in hot.json() if x["business_id"] == biz["id"]]
    assert len(items) == 1
    h = items[0]
    assert h["service_id"] == s["id"] and h["member_id"] == m["member"]["id"]
    assert h["percent"] == 30 and h["price"] == 50000 and h["final"] == 35000

    # Hot Slots dagi vaqt haqiqatan chegirma bilan bron qilinadi
    c = customer(client)
    r = client.post("/api/v1/appointments", headers=auth_header(c), json={
        "member_id": h["member_id"], "service_id": h["service_id"], "starts_at": h["starts_at"]})
    assert r.status_code == 201, r.text
    assert r.json()["discount"] == 15000

    offers = client.get("/api/v1/catalog/offers", params={"lat": 41.35, "lng": 69.35, "radius_m": 2000}).json()
    codes = [o["code"] for o in offers if o["business_id"] == biz["id"]]
    assert codes == ["SOVGA25"]
