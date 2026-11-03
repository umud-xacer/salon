"""Rahbar bergan boshlang'ich parol: yaratishda berish, ko'rish, o'z paroliga o'tganda yo'qolishi, huquqlar."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core import secretbox
from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business, new_phone

SA_CREATE = "/api/v1/superadmin/businesses"


def login(client, phone, password):
    return client.post("/api/v1/auth/login", json={"phone": phone, "password": password})


def members_url(biz_id, tail=""):
    return f"/api/v1/businesses/{biz_id}/members{tail}"


def create_with_owner_password(client, superadmin, password="Boshlang1ch2026"):
    phone = new_phone()
    r = client.post(SA_CREATE, headers=auth_header(superadmin), json={
        "name": "Parolli Salon", "slug": f"parol-{phone[-7:]}", "category_id": 1, "lat": 41.3, "lng": 69.2,
        "owner_phone": phone, "owner_full_name": "Direktor Bir", "owner_password": password})
    assert r.status_code == 201, r.text
    return r.json(), phone


def test_superadmin_sets_owner_password_on_create_and_sees_it(client, superadmin):
    biz, phone = create_with_owner_password(client, superadmin)
    sa = auth_header(superadmin)
    r = client.get(members_url(biz["id"], f"/{biz['owner_member_id']}/password"), headers=sa)
    assert r.status_code == 200, r.text
    assert r.json()["password"] == "Boshlang1ch2026" and r.json()["status"] == "temporary"

    # Direktor shu parol bilan kiradi va o'z parolini qo'yadi
    r = login(client, phone, "Boshlang1ch2026")
    assert r.status_code == 200, r.text
    owner = r.json()
    assert owner["user"]["must_change_password"] is True
    r = client.post("/api/v1/auth/password", headers=auth_header(owner),
                    json={"old_password": "Boshlang1ch2026", "new_password": "OzimningParolim77"})
    assert r.status_code == 204, r.text

    r = client.get(members_url(biz["id"], f"/{biz['owner_member_id']}/password"), headers=sa).json()
    assert r["password"] is None and r["status"] == "own"          # o'z paroli hech kimga ko'rinmaydi


def test_create_does_not_overwrite_existing_own_password(client, superadmin):
    _, phone = create_with_owner_password(client, superadmin)
    owner = login(client, phone, "Boshlang1ch2026").json()
    client.post("/api/v1/auth/password", headers=auth_header(owner),
                json={"old_password": "Boshlang1ch2026", "new_password": "OzimningParolim77"})
    r = client.post(SA_CREATE, headers=auth_header(superadmin), json={
        "name": "Ikkinchi", "slug": f"ikki-{phone[-7:]}", "category_id": 1, "lat": 41.3, "lng": 69.2,
        "owner_phone": phone, "owner_full_name": "Direktor Bir", "owner_password": "Boshqa2026parol"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "has_own_password"
    assert login(client, phone, "OzimningParolim77").status_code == 200


def test_weak_initial_password_rejected(client, superadmin):
    phone = new_phone()
    r = client.post(SA_CREATE, headers=auth_header(superadmin), json={
        "name": "Zaif", "slug": f"zaif-{phone[-7:]}", "category_id": 1, "lat": 41.3, "lng": 69.2,
        "owner_phone": phone, "owner_full_name": "Direktor", "owner_password": "123"})
    assert r.status_code == 422


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin)


def test_director_adds_staff_with_password_and_resets(client, biz):
    h = auth_header(biz["owner"])
    phone = new_phone()
    r = client.post(members_url(biz["id"]), headers=h, json={
        "phone": phone, "full_name": "Usta Bir", "role": "staff", "password": "UstaParol2026"})
    assert r.status_code == 201, r.text
    member = r.json()
    assert member["password_status"] == "temporary"
    view = members_url(biz["id"], f"/{member['id']}/password")
    assert client.get(view, headers=h).json()["password"] == "UstaParol2026"

    staff = login(client, phone, "UstaParol2026").json()
    client.post("/api/v1/auth/password", headers=auth_header(staff),
                json={"old_password": "UstaParol2026", "new_password": "UstaningOzi99"})
    assert client.get(view, headers=h).json() == {"password": None, "status": "own",
                                                  "changed_at": client.get(view, headers=h).json()["changed_at"]}

    # Rahbar yangi parol beradi — yana ko'rinadi, eski parol ishlamaydi
    assert client.post(view, headers=h, json={"new_password": "YangiBerilgan55"}).status_code == 204
    assert client.get(view, headers=h).json()["password"] == "YangiBerilgan55"
    assert login(client, phone, "UstaningOzi99").status_code == 401


def test_who_can_view(client, superadmin, biz):
    staff = add_member(client, biz, "staff")
    other = add_member(client, biz, "receptionist")
    client.post(members_url(biz["id"], f"/{staff['member']['id']}/password"), headers=auth_header(biz["owner"]),
                json={"new_password": "Berilgan2026ab"})
    view = members_url(biz["id"], f"/{staff['member']['id']}/password")
    assert client.get(view, headers=auth_header(other["tokens"])).status_code == 403          # hamkasb
    # Parol berilgach xodimning eski sessiyasi yopilgan; yangi parol bilan kirsa ham o'zinikini ko'ra olmaydi
    assert client.get(view, headers=auth_header(staff["tokens"])).status_code == 401
    fresh = login(client, staff["member"]["phone"], "Berilgan2026ab").json()
    assert client.get(view, headers=auth_header(fresh)).status_code == 403
    stranger = create_business(client, superadmin)
    assert client.get(view, headers=auth_header(stranger["owner"])).status_code == 403        # boshqa salon
    owner_view = members_url(biz["id"], f"/{biz['owner_member_id']}/password")
    assert client.get(owner_view, headers=auth_header(biz["owner"])).status_code == 403      # direktor o'zinikini
    assert client.get(view).status_code == 401


def test_viewing_is_audited(client, biz):
    staff = add_member(client, biz, "staff")
    h = auth_header(biz["owner"])
    client.post(members_url(biz["id"], f"/{staff['member']['id']}/password"), headers=h,
                json={"new_password": "Berilgan2026ab"})
    client.get(members_url(biz["id"], f"/{staff['member']['id']}/password"), headers=h)
    with api_session(biz["owner"]["user"]["id"]) as db:
        actions = db.scalars(text("SELECT action FROM audit_logs WHERE business_id = :b AND entity_id = :m "
                                  "ORDER BY id"), {"b": biz["id"], "m": staff["member"]["id"]}).all()
    assert actions[-2:] == ["password_set", "password_viewed"]


def test_column_not_readable_directly(biz):
    """Shifrlangan ustunni API roli to'g'ridan-to'g'ri o'qiy olmaydi — faqat himoyalangan funksiya orqali."""
    with api_session(biz["owner"]["user"]["id"]) as db:
        with pytest.raises(DBAPIError) as e:
            db.execute(text("SELECT issued_password_enc FROM users"))
        assert e.value.orig.sqlstate == "42501"


def test_sealed_value_bound_to_member():
    token = secretbox.seal("Maxfiy2026", 7)
    assert secretbox.open_sealed(token, 7) == "Maxfiy2026"
    assert secretbox.open_sealed(token, 8) is None                 # boshqa xodimga ko'chirib bo'lmaydi
    assert secretbox.open_sealed("v1.buzilgan", 7) is None
    assert "Maxfiy2026" not in token
