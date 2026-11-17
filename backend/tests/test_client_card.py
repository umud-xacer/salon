"""Mijoz kartochkasi: tug'ilgan kun, jins, manba, teglar, ogohlantirish, allergiya, eslatmalar (050)."""
import pytest

from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login
from tests.test_reception_mode import book, ctx, url  # noqa: F401  (ctx — fixture)


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance"))


def new_client(client, biz, tokens=None, **extra):
    r = client.post(url(biz, "clients"), headers=auth_header(tokens or biz["owner"]),
                    json={"full_name": "Kartochka Mijoz", "phone": new_phone(), **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_with_full_card(client, biz):
    c = new_client(client, biz, birth_date="1995-03-08", gender="female", source="instagram",
                   tags=["VIP", " vip ", "Doimiy  mijoz"], alert="Kech qoladi", allergies="Ammiak bo'yoq",
                   notes="Birinchi eslatma")
    assert c["birth_date"] == "1995-03-08" and c["gender"] == "female" and c["source"] == "instagram"
    assert c["tags"] == ["VIP", "Doimiy mijoz"]               # takror va bo'sh joylar tozalandi
    assert c["alert"] == "Kech qoladi" and c["allergies"] == "Ammiak bo'yoq"
    assert c["notes_count"] == 1


def test_validation(client, biz):
    h = auth_header(biz["owner"])
    base = {"full_name": "Xato", "phone": new_phone()}
    assert client.post(url(biz, "clients"), headers=h, json={**base, "birth_date": "2999-01-01"}).status_code == 422
    assert client.post(url(biz, "clients"), headers=h, json={**base, "gender": "x"}).status_code == 422
    assert client.post(url(biz, "clients"), headers=h, json={**base, "source": "tv"}).status_code == 422
    assert client.post(url(biz, "clients"), headers=h, json={**base, "tags": ["a"] * 1 + [str(i) for i in range(11)]}
                       ).status_code == 422
    assert client.post(url(biz, "clients"), headers=h, json={**base, "tags": ["x" * 31]}).status_code == 422


def test_patch_updates_and_clears_fields(client, biz):
    c = new_client(client, biz, tags=["VIP"], alert="Diqqat")
    r = client.patch(url(biz, f"clients/{c['id']}"), headers=auth_header(biz["owner"]),
                     json={"gender": "male", "tags": ["Yangi"], "alert": None, "allergies": "Lateks"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["gender"] == "male" and body["tags"] == ["Yangi"] and body["alert"] is None
    assert body["allergies"] == "Lateks" and body["full_name"] == "Kartochka Mijoz"   # boshqa maydonlar o'zgarmadi


def test_tag_filter_and_tag_list(client, biz):
    vip = new_client(client, biz, tags=["VIP"])
    new_client(client, biz, tags=["vip", "Talaba"])
    new_client(client, biz)
    h = auth_header(biz["owner"])
    ids = [c["id"] for c in client.get(url(biz, "clients?tag=Vip"), headers=h).json()]
    assert len(ids) == 2 and vip["id"] in ids
    tags = {t["tag"].lower(): t["count"] for t in client.get(url(biz, "clients/tags"), headers=h).json()}
    assert tags == {"vip": 2, "talaba": 1}


def test_notes_timeline_and_delete_rules(client, biz):
    rec = add_member(client, biz, "receptionist")
    c = new_client(client, biz)
    notes_url = url(biz, f"clients/{c['id']}/notes")
    r = client.post(notes_url, headers=auth_header(rec["tokens"]), json={"body": "Qahva yoqtiradi"})
    assert r.status_code == 201, r.text
    rec_note = r.json()
    assert rec_note["author"] and rec_note["can_delete"] is True
    owner_note = client.post(notes_url, headers=auth_header(biz["owner"]), json={"body": "Chegirma berildi"}).json()

    listed = client.get(notes_url, headers=auth_header(rec["tokens"])).json()
    assert [n["body"] for n in listed] == ["Chegirma berildi", "Qahva yoqtiradi"]   # yangisi tepada
    assert {n["id"]: n["can_delete"] for n in listed} == {owner_note["id"]: False, rec_note["id"]: True}

    # Qabulxona direktor eslatmasini o'chira olmaydi; direktor istalganini o'chiradi
    assert client.delete(f"{notes_url}/{owner_note['id']}", headers=auth_header(rec["tokens"])).status_code == 404
    assert client.delete(f"{notes_url}/{rec_note['id']}", headers=auth_header(biz["owner"])).status_code == 204


def test_master_sees_alert_only_on_own_booking(client, biz, ctx):
    owner = biz["owner"]
    a, b = ctx["a"], ctx["b"]
    own = book(client, biz, ctx, owner, a, "10:00").json()
    other = book(client, biz, ctx, owner, b, "12:00").json()
    client_id = next(c["id"] for c in client.get(url(biz, "clients"), headers=auth_header(owner)).json()
                     if c["full_name"] == "Mijoz Sinov")
    for appt in (own, other):
        cid = next(c["id"] for c in client.get(url(biz, f"clients?q={appt['client_phone'][4:]}"),
                                                headers=auth_header(owner)).json())
        client.patch(url(biz, f"clients/{cid}"), headers=auth_header(owner),
                     json={"alert": "Diqqat", "allergies": "Ammiak"})
    assert client_id

    mine = client.get(url(biz, f"appointments?date={ctx['day']}"), headers=auth_header(a["tokens"])).json()
    assert [(x["client_alert"], x["client_allergies"]) for x in mine] == [("Diqqat", "Ammiak")]
    # Usta mijozlar bazasini ochib ko'ra olmaydi
    assert client.get(url(biz, "clients"), headers=auth_header(a["tokens"])).status_code == 403
    # Qabulxona kalendarida hammasi ko'rinadi
    cal = client.get(url(biz, f"calendar?start={ctx['day']}"), headers=auth_header(owner)).json()
    assert {x["client_alert"] for x in cal["appointments"]} == {"Diqqat"}


def test_customer_never_sees_internal_card(client, biz, ctx):
    """Ilovadagi mijoz o'z bronini ko'radi, lekin salon yozgan ogohlantirish/allergiyani emas."""
    owner = biz["owner"]
    phone = new_phone()
    customer = otp_login(client, phone, "Ilova Mijoz")
    r = client.post("/api/v1/appointments", headers=auth_header(customer), json={
        "member_id": ctx["a"]["member"]["id"], "service_id": ctx["service"]["id"],
        "starts_at": f"{ctx['day']}T15:00:00+05:00"})
    assert r.status_code == 201, r.text
    cid = next(c["id"] for c in client.get(url(biz, f"clients?q={phone[4:]}"), headers=auth_header(owner)).json())
    client.patch(url(biz, f"clients/{cid}"), headers=auth_header(owner),
                 json={"alert": "Muammoli mijoz", "tags": ["Qora ro'yxat"]})
    mine = client.get("/api/v1/appointments/mine", headers=auth_header(customer)).json()
    assert mine and all(x["client_alert"] is None and x["client_allergies"] is None for x in mine)


def test_other_business_cannot_touch_card(client, superadmin, biz):
    c = new_client(client, biz, alert="Maxfiy")
    other = create_business(client, superadmin)
    r = client.patch(f"/api/v1/businesses/{other['id']}/clients/{c['id']}", headers=auth_header(other["owner"]),
                     json={"alert": "Buzildi"})
    assert r.status_code == 404
    r = client.post(f"/api/v1/businesses/{other['id']}/clients/{c['id']}/notes", headers=auth_header(other["owner"]),
                    json={"body": "x"})
    assert r.status_code == 404
