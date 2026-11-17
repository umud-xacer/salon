"""Mijoz segmentlari va ommaviy xabarlar (056_broadcasts.sql)."""
import datetime as dt
import os

import pytest
from sqlalchemy import create_engine, text

from app.db.session import worker_session
from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login
from tests.test_reception_mode import url

ADMIN = create_engine(os.environ["MIGRATION_DATABASE_URL"])


@pytest.fixture()
def world(client, superadmin):
    biz = create_business(client, superadmin, modules=("booking",))
    usta = add_member(client, biz, "staff")
    m = usta["member"]["id"]
    today = dt.date.today()
    people = {}
    with ADMIN.begin() as db:
        def person(key, *, app=True, gender=None, birth=None, visits=(), future=False, tag=None):
            user = otp_login(client, new_phone(), key) if app else None
            phone = user["user"]["phone"] if user else new_phone()
            cid = db.execute(text("""INSERT INTO business_clients (business_id, user_id, full_name, phone, gender, birth_date)
                                     VALUES (:b, :u, :n, :p, :g, :bd) RETURNING id"""),
                             {"b": biz["id"], "u": user["user"]["id"] if user else None, "n": key, "p": phone,
                              "g": gender, "bd": birth}).scalar()
            for days_ago in visits:
                db.execute(text("""INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status)
                                   VALUES (:b, :c, :m, now() - make_interval(days => :d),
                                           now() - make_interval(days => :d) + INTERVAL '1 hour', 'completed')"""),
                           {"b": biz["id"], "c": cid, "m": m, "d": days_ago})
            if future:
                db.execute(text("""INSERT INTO appointments (business_id, client_id, member_id, starts_at, ends_at, status)
                                   VALUES (:b, :c, :m, now() + INTERVAL '3 days', now() + INTERVAL '3 days 1 hour', 'confirmed')"""),
                           {"b": biz["id"], "c": cid, "m": m})
            if tag:
                db.execute(text("INSERT INTO client_internal (business_id, client_id, tags) VALUES (:b, :c, :t)"),
                           {"b": biz["id"], "c": cid, "t": [tag]})
            people[key] = {"client_id": cid, "user": user}
        person("Lola", gender="female", visits=(40,), tag="VIP")                          # 30 kun kelmagan ayol
        person("Bobur", gender="male", visits=(50,))                                      # 30 kun kelmagan erkak
        person("Kamola", gender="female", visits=(45,), future=True)                      # kelgusi broni bor
        person("Doimiy", visits=(5, 20, 40, 60))                                          # doimiy (4 tashrif)
        person("Yangi", visits=(3,))                                                      # yangi
        person("Ilovasiz", app=False, visits=(70,))                                       # ilovasiz
        person("Tugilgan", birth=(today + dt.timedelta(days=3)).replace(year=1995))       # 3 kundan keyin tug'ilgan kun
    return {"biz": biz, "usta": usta, "people": people}


def preview(client, biz, **q):
    r = client.get(url(biz, "segments/preview"), headers=auth_header(biz["owner"]), params=q)
    assert r.status_code == 200, r.text
    return r.json()


def test_segments(client, world):
    biz = world["biz"]
    p = preview(client, biz, kind="inactive", param=30)
    assert sorted(p["sample"]) == ["Bobur", "Ilovasiz", "Lola"]                       # Kamola — kelgusi broni bor
    assert "Kamola" not in p["sample"] and "Yangi" not in p["sample"]
    assert p["without_app"] == 1 and p["total"] == p["with_app"] + 1
    assert preview(client, biz, kind="inactive", param=30, gender="female")["sample"] == ["Lola"]
    assert preview(client, biz, kind="inactive", param=30, tag="vip")["sample"] == ["Lola"]
    assert preview(client, biz, kind="regular", param=3)["sample"] == ["Doimiy"]
    assert preview(client, biz, kind="new", param=30)["sample"] == ["Yangi"]
    assert preview(client, biz, kind="birthday", param=7)["sample"] == ["Tugilgan"]
    assert preview(client, biz, kind="all")["total"] == 7
    r = client.get(url(biz, "segments/preview"), headers=auth_header(biz["owner"]), params={"kind": "inactive", "param": 5})
    assert r.status_code == 422


def test_send_broadcast_limits_and_inbox(client, world):
    biz, people = world["biz"], world["people"]
    body = {"kind": "inactive", "param": 30, "gender": "female", "title": "Sizni sog'indik!", "body": "Bu hafta 15% chegirma."}
    r = client.post(url(biz, "broadcasts"), headers=auth_header(biz["owner"]), json=body)
    assert r.status_code == 201, r.text
    b = r.json()
    assert (b["matched"], b["sent_app"], b["skipped_recent"]) == (1, 1, 0)
    inbox = client.get("/api/v1/notifications", headers=auth_header(people["Lola"]["user"])).json()
    got = [n for n in inbox if n["type"] == "promo_broadcast"]
    assert len(got) == 1 and got[0]["body"] == "Bu hafta 15% chegirma." and got[0]["data"]["slug"] == biz["slug"]

    # 72 soat ichida o'sha mijozga qayta yuborilmaydi
    r = client.post(url(biz, "broadcasts"), headers=auth_header(biz["owner"]), json={**body, "gender": None})
    assert r.json()["skipped_recent"] == 1 and r.json()["sent_app"] == 1              # Lola o'tkazildi, Bobur oldi
    assert client.post(url(biz, "broadcasts"), headers=auth_header(biz["owner"]), json={**body, "kind": "all", "param": None, "gender": None}).status_code == 201
    r = client.post(url(biz, "broadcasts"), headers=auth_header(biz["owner"]), json={**body, "kind": "all", "param": None, "gender": None})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "broadcast_limit"     # kuniga 3 ta
    hist = client.get(url(biz, "broadcasts"), headers=auth_header(biz["owner"])).json()
    assert len(hist) == 3 and hist[0]["segment"]["kind"] == "all"


def test_permissions_and_rls(client, world, superadmin):
    biz = world["biz"]
    staff = auth_header(world["usta"]["tokens"])
    assert client.get(url(biz, "segments/preview"), headers=staff).status_code == 403
    assert client.post(url(biz, "broadcasts"), headers=staff, json={"title": "aa", "body": "bb"}).status_code == 403
    client.post(url(biz, "broadcasts"), headers=auth_header(biz["owner"]), json={"title": "Salom", "body": "Matn"})
    from app.db.session import api_session
    other = create_business(client, superadmin, modules=("booking",))
    with api_session(other["owner"]["user"]["id"]) as db:
        assert db.execute(text("SELECT count(*) FROM broadcasts WHERE business_id = :b"), {"b": biz["id"]}).scalar() == 0
        with pytest.raises(Exception):
            db.execute(text("SELECT * FROM app.segment_clients(:b, 'all', 0, NULL, NULL)"), {"b": biz["id"]})


def test_telegram_queue_for_worker(client, world):
    biz, people = world["biz"], world["people"]
    with ADMIN.begin() as db:
        db.execute(text("INSERT INTO user_identities (user_id, provider, subject, chat_id) VALUES (:u, 'telegram', :s, 777001)"),
                   {"u": people["Yangi"]["user"]["user"]["id"], "s": f"tg{people['Yangi']['client_id']}"})
    r = client.post(url(biz, "broadcasts"), headers=auth_header(biz["owner"]),
                    json={"kind": "new", "param": 30, "title": "Yangi xizmat", "body": "Endi pedikyur ham bor"})
    assert r.json()["sent_telegram"] == 1
    with worker_session() as db:
        rows = db.execute(text("SELECT * FROM app.next_broadcast_telegram()")).mappings().all()
        db.commit()
    mine = [x for x in rows if x["chat_id"] == 777001]
    assert len(mine) == 1 and mine[0]["title"] == "Yangi xizmat" and mine[0]["business_name"]
    with worker_session() as db:
        again = db.execute(text("SELECT * FROM app.next_broadcast_telegram()")).mappings().all()
    assert not [x for x in again if x["chat_id"] == 777001]                              # qayta yuborilmaydi
