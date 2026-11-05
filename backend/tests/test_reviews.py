"""Reyting va baholash: faqat real (yakunlangan) tashrif, bir marta, usta alohida, o'rtacha avtomatik,
direktor javobi, Super Admin moderatsiyasi, xizmatdan keyingi "Baholang" xabari, baza darajasidagi himoya."""
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.db.session import api_session
from tests.conftest import ADMIN_URL, DB_NAME, add_member, auth_header, create_business, new_phone, otp_login
from tests.test_appointments import book
from tests.test_schedule import day_from_today, new_master, new_service


@pytest.fixture(scope="module")
def salon(client, superadmin):
    biz = create_business(client, superadmin)
    s = new_service(client, biz, duration=30)
    return {"biz": biz, "service": s, "master": new_master(client, biz, s), "master2": new_master(client, biz, s)}


# Ish vaqti 09:00–18:00, tanaffus 13:00–14:00 (tests/test_schedule.py ALL_WEEK)
_clock = iter(f"{h:02d}:{m:02d}" for h in (9, 10, 11, 12, 14, 15, 16, 17) for m in (0, 30))


def visit(client, salon, customer, *, master="master", complete=True):
    """Mijoz bron qiladi, salon xizmatni boshlab yakunlaydi."""
    biz = salon["biz"]
    r = book(client, customer, salon[master], salon["service"], day_from_today(biz, 2), next(_clock))
    assert r.status_code == 201, r.text
    a = r.json()
    if complete:
        for st in ("in_progress", "completed"):
            r = client.patch(f"/api/v1/businesses/{biz['id']}/appointments/{a['id']}/status",
                             headers=auth_header(biz["owner"]), json={"status": st})
            assert r.status_code == 200, r.text
    return a


def review(client, tokens, appointment_id, **body):
    data = {"rating": 5, "cleanliness": 5, "service_quality": 5, **body}
    return client.post(f"/api/v1/appointments/{appointment_id}/review", headers=auth_header(tokens), json=data)


def public(client, salon, **params):
    r = client.get(f"/api/v1/catalog/businesses/{salon['biz']['slug']}/reviews", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_completion_sends_review_request_and_only_real_visit_can_be_rated(client, salon):
    customer = otp_login(client, new_phone(), "Malika Karimova")
    pending = visit(client, salon, customer, complete=False)
    assert review(client, customer, pending["id"]).status_code == 409             # hali yakunlanmagan

    a = visit(client, salon, customer)
    inbox = client.get("/api/v1/notifications?unread=true", headers=auth_header(customer)).json()
    req = [n for n in inbox if n["type"] == "review_request" and n["data"]["appointment_id"] == a["id"]]
    assert len(req) == 1 and "mamnun" in req[0]["title"]

    mine = client.get("/api/v1/appointments/mine?upcoming=false", headers=auth_header(customer)).json()
    assert next(x for x in mine if x["id"] == a["id"])["can_review"] is True

    stranger = otp_login(client, new_phone())
    assert review(client, stranger, a["id"]).status_code == 404                   # begona bron

    r = review(client, customer, a["id"], rating=4, cleanliness=5, service_quality=3, comment="  Yaxshi  ",
               staff_rating=5, staff_comment="Jasur zo'r usta")
    assert r.status_code == 201, r.text
    again = review(client, customer, a["id"])
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_reviewed"

    # "Baholang" xabari o'qilgan bo'ldi, bron endi baholanmaydi
    inbox = client.get("/api/v1/notifications?unread=true", headers=auth_header(customer)).json()
    assert not [n for n in inbox if n["type"] == "review_request" and n["data"]["appointment_id"] == a["id"]]
    mine = client.get("/api/v1/appointments/mine?upcoming=false", headers=auth_header(customer)).json()
    row = next(x for x in mine if x["id"] == a["id"])
    assert row["can_review"] is False and row["review_rating"] == 4 and row["review_staff_rating"] == 5


def test_validation(client, salon):
    customer = otp_login(client, new_phone())
    a = visit(client, salon, customer)
    for bad in ({"rating": 0}, {"rating": 6}, {"cleanliness": None}, {"staff_rating": 7}, {"comment": "x" * 2001}):
        assert review(client, customer, a["id"], **bad).status_code == 422, bad


def test_expired_after_30_days(client, salon):
    customer = otp_login(client, new_phone())
    a = visit(client, salon, customer)
    engine = create_engine(ADMIN_URL.rsplit("/", 1)[0] + f"/{DB_NAME}")
    with engine.begin() as c:
        c.execute(text("ALTER TABLE appointments DISABLE TRIGGER USER"))
        c.execute(text("UPDATE appointments SET completed_at = now() - interval '31 days' WHERE id = :a"), {"a": a["id"]})
        c.execute(text("ALTER TABLE appointments ENABLE TRIGGER USER"))
    engine.dispose()
    r = review(client, customer, a["id"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "review_expired"


def test_averages_staff_separately_and_public_view(client, superadmin):
    biz = create_business(client, superadmin)
    s = new_service(client, biz, duration=30)
    salon = {"biz": biz, "service": s, "master": new_master(client, biz, s), "master2": new_master(client, biz, s)}
    c1, c2, c3 = (otp_login(client, new_phone(), n) for n in ("Dilnoza Aliyeva", "Sardor", "Kamola Rustamova"))
    assert review(client, c1, visit(client, salon, c1)["id"], rating=5, staff_rating=4).status_code == 201
    assert review(client, c2, visit(client, salon, c2)["id"], rating=4, cleanliness=3, staff_rating=2).status_code == 201
    # Ustaga baho bermasa ham bo'ladi — usta o'rtachasiga kirmaydi
    assert review(client, c3, visit(client, salon, c3, master="master2")["id"], rating=3).status_code == 201

    detail = client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()
    assert detail["rating_avg"] == 4.0 and detail["rating_count"] == 3
    staff = {m["member_id"]: m for m in detail["staff"]}
    m1, m2 = salon["master"]["member"]["id"], salon["master2"]["member"]["id"]
    assert (staff[m1]["rating_avg"], staff[m1]["rating_count"]) == (3.0, 2)
    assert (staff[m2]["rating_avg"], staff[m2]["rating_count"]) == (0.0, 0)

    p = public(client, salon)
    assert p["summary"]["count"] == 3 and p["summary"]["rating_avg"] == 4.0 and p["summary"]["cleanliness_avg"] == 4.3
    assert p["summary"]["distribution"] == {"5": 1, "4": 1, "3": 1, "2": 0, "1": 0}
    authors = {x["author"] for x in p["items"]}
    assert authors == {"Dilnoza A.", "Sardor", "Kamola R."}                       # telefon va to'liq familiya yo'q
    assert all("phone" not in x for x in p["items"])
    only_m1 = public(client, salon, member_id=m1)["items"]
    assert len(only_m1) == 2 and {x["staff_rating"] for x in only_m1} == {4, 2}

    # Super Admin: statistika va ro'yxatda reyting
    stats = client.get("/api/v1/superadmin/stats", headers=auth_header(superadmin)).json()
    assert stats["reviews_total"] >= 3 and stats["rating_avg"] is not None
    assert any(r["id"] == biz["id"] for r in stats["rating_top"] + stats["rating_low"])
    row = next(b for b in client.get("/api/v1/superadmin/businesses", headers=auth_header(superadmin)).json()
               if b["id"] == biz["id"])
    assert row["rating_avg"] == 4.0 and row["rating_count"] == 3

    # Moderatsiya: yashirilgan baho o'rtachaga ham, ommaviy ro'yxatga ham kirmaydi
    low = next(x for x in p["items"] if x["rating"] == 3)
    assert client.patch(f"/api/v1/superadmin/reviews/{low['id']}", headers=auth_header(superadmin),
                        json={"is_hidden": True}).status_code == 204
    assert client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()["rating_avg"] == 4.5
    assert low["id"] not in {x["id"] for x in public(client, salon)["items"]}
    # Direktor yashirilganini ham ko'radi (belgisi bilan)
    own = client.get(f"/api/v1/businesses/{biz['id']}/reviews", headers=auth_header(biz["owner"])).json()
    assert own["total"] == 3 and next(x for x in own["items"] if x["id"] == low["id"])["is_hidden"] is True
    assert client.patch(f"/api/v1/superadmin/reviews/{low['id']}", headers=auth_header(biz["owner"]),
                        json={"is_hidden": False}).status_code == 403


def test_director_replies_staff_cannot(client, superadmin, salon):
    biz = salon["biz"]
    customer = otp_login(client, new_phone(), "Javohir")
    a = visit(client, salon, customer)
    rid = review(client, customer, a["id"], rating=2, comment="Kutib qoldim").json()["id"]
    url = f"/api/v1/businesses/{biz['id']}/reviews/{rid}/reply"

    rec = add_member(client, biz, "receptionist")
    assert client.put(url, headers=auth_header(rec["tokens"]), json={"reply": "Uzr"}).status_code == 403
    assert client.get(f"/api/v1/businesses/{biz['id']}/reviews", headers=auth_header(rec["tokens"])).status_code == 403

    r = client.put(url, headers=auth_header(biz["owner"]), json={"reply": "  Uzr so'raymiz, tuzatamiz  "})
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["reply"] == "Uzr so'raymiz, tuzatamiz" and got["reply_at"] and got["replied_by_name"] == "Salon Egasi"
    assert got["client_name"] == "Javohir"
    pub = next(x for x in public(client, salon)["items"] if x["id"] == rid)
    assert pub["reply"] == "Uzr so'raymiz, tuzatamiz"

    lst = client.get(f"/api/v1/businesses/{biz['id']}/reviews", headers=auth_header(biz["owner"]),
                     params={"unanswered": True}).json()
    assert rid not in {x["id"] for x in lst["items"]}
    r = client.put(url, headers=auth_header(biz["owner"]), json={"reply": ""})       # javobni olib tashlash
    assert r.status_code == 200 and r.json()["reply"] is None and r.json()["reply_at"] is None

    # Boshqa salon direktori bu bahoga tegolmaydi
    other = create_business(client, superadmin)
    assert client.put(f"/api/v1/businesses/{other['id']}/reviews/{rid}/reply", headers=auth_header(other["owner"]),
                      json={"reply": "x"}).status_code == 404


def test_database_blocks_fake_and_edited_reviews(client, salon):
    biz = salon["biz"]
    customer = otp_login(client, new_phone())
    done = visit(client, salon, customer)
    open_ = visit(client, salon, customer, complete=False)
    rid = review(client, customer, done["id"], rating=1).json()["id"]

    with api_session(customer["user"]["id"]) as db:
        # To'g'ridan-to'g'ri yozish (yakunlanmagan bronga ham, boshqasiga ham) yopiq
        with pytest.raises(DBAPIError):
            db.execute(text("INSERT INTO reviews (business_id, appointment_id, user_id, rating) VALUES (:b, :a, :u, 5)"),
                       {"b": biz["id"], "a": open_["id"], "u": customer["user"]["id"]})
        db.rollback()
        assert db.execute(text("UPDATE reviews SET rating = 5 WHERE id = :id"), {"id": rid}).rowcount == 0
        db.rollback()
    with api_session(biz["owner"]["user"]["id"]) as db:
        # Direktor bahoni o'zgartira olmaydi, o'chira olmaydi, yashira olmaydi
        for sql in ("UPDATE reviews SET rating = 5 WHERE id = :id", "UPDATE reviews SET is_hidden = true WHERE id = :id",
                    "UPDATE reviews SET staff_rating = 5 WHERE id = :id"):
            with pytest.raises(DBAPIError):
                db.execute(text(sql), {"id": rid})
            db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("DELETE FROM reviews WHERE id = :id"), {"id": rid})
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("UPDATE businesses SET rating_avg = 5 WHERE id = :b"), {"b": biz["id"]})
        db.rollback()


def test_master_sees_own_rating(client, salon):
    biz = salon["biz"]
    customer = otp_login(client, new_phone(), "Shoxrux Toshev")
    a = visit(client, salon, customer)
    assert review(client, customer, a["id"], staff_rating=3, staff_comment="O'rtacha").status_code == 201
    url = f"/api/v1/businesses/{biz['id']}/reviews/mine"
    r = client.get(url, headers=auth_header(salon["master"]["tokens"]))
    assert r.status_code == 200, r.text
    d = r.json()
    assert any(x["staff_comment"] == "O'rtacha" for x in d["items"]) and d["summary"]["count"] >= 1
    assert all("client_phone" not in x for x in d["items"])
    other = salon["master2"]["tokens"]
    assert not any(x["id"] for x in client.get(url, headers=auth_header(other)).json()["items"]
                   if x["staff_comment"] == "O'rtacha")
    assert client.get(url, headers=auth_header(customer)).status_code == 403