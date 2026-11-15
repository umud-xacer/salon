"""Filiallar (TZ 2026-11-15): asosiy kompaniya + filiallar, bitta direktor, panel va ilova uchun tarmoq ma'lumoti."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import add_member, auth_header, create_business, new_phone, otp_login

SA = "/api/v1/superadmin/businesses"


def add_service(client, biz):
    r = client.post(f"/api/v1/businesses/{biz['id']}/services", headers=auth_header(biz["owner"]),
                    json={"name": "Soch olish", "duration_min": 30, "price": 50000})
    assert r.status_code == 201, r.text


def create_branch(client, superadmin, parent, *, branch_name="Chilonzor filiali", lat=41.28, lng=69.20, **extra):
    slug = f"filial-{new_phone()[-7:]}"
    body = {"name": "Barber Lab", "slug": slug, "category_id": 1, "city": "Toshkent", "lat": lat, "lng": lng,
            "parent_id": parent["id"], "branch_name": branch_name, "modules": ["booking"], **extra}
    r = client.post(SA, headers=auth_header(superadmin), json=body)
    return r, slug


def sa_row(client, superadmin, biz_id):
    rows = client.get(SA, headers=auth_header(superadmin)).json()
    return next(b for b in rows if b["id"] == biz_id)


@pytest.fixture()
def chain(client, superadmin):
    parent = create_business(client, superadmin, name="Barber Lab")
    r, slug = create_branch(client, superadmin, parent)
    assert r.status_code == 201, r.text
    branch = {"id": r.json()["id"], "slug": slug, "owner": parent["owner"]}
    return parent, branch


def test_branch_gets_parent_owner_and_me_shows_chain(client, superadmin, chain):
    parent, branch = chain
    me = client.get("/api/v1/auth/me", headers=auth_header(parent["owner"])).json()
    by_id = {m["business_id"]: m for m in me["memberships"]}
    assert set(by_id) >= {parent["id"], branch["id"]}
    assert by_id[branch["id"]]["role"] == "owner"
    assert by_id[branch["id"]]["parent_id"] == parent["id"]
    assert by_id[branch["id"]]["chain_id"] == by_id[parent["id"]]["chain_id"] == parent["id"]
    assert by_id[branch["id"]]["branch_name"] == "Chilonzor filiali"
    assert by_id[branch["id"]]["chain_name"] == "Barber Lab"

    row = sa_row(client, superadmin, branch["id"])
    assert row["parent_id"] == parent["id"] and row["parent_name"] == "Barber Lab"
    assert sa_row(client, superadmin, parent["id"])["branch_count"] == 1


def test_one_level_only(client, superadmin, chain):
    _, branch = chain
    r, _ = create_branch(client, superadmin, branch)          # filialning filiali
    assert r.status_code == 409 and r.json()["detail"]["code"] == "branch_parent_invalid"


def test_parent_with_branches_cannot_become_branch(client, superadmin, chain):
    parent, _ = chain
    other = create_business(client, superadmin)
    # filiallari bor muassasa boshqasiga biriktirilmaydi (direktor farqi yoki baza triggeri)
    r = client.patch(f"{SA}/{parent['id']}", headers=auth_header(superadmin), json={"parent_id": other["id"]})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] in ("different_owner", "branch_has_children")


def test_trigger_blocks_nested_chain_at_db_level(client, superadmin, chain):
    parent, branch = chain
    other = create_business(client, superadmin)
    from tests.conftest import _admin, DB_NAME  # noqa: F401
    from sqlalchemy import create_engine
    eng = create_engine(_admin.set(database=DB_NAME))
    with pytest.raises(DBAPIError) as e1, eng.begin() as c:
        c.execute(text("UPDATE businesses SET parent_id = :o WHERE id = :p"), {"o": other["id"], "p": parent["id"]})
    assert "branch_has_children" in str(e1.value)
    with pytest.raises(DBAPIError) as e2, eng.begin() as c:
        c.execute(text("UPDATE businesses SET parent_id = :b WHERE id = :o"), {"b": branch["id"], "o": other["id"]})
    assert "branch_parent_is_branch" in str(e2.value)
    eng.dispose()


def test_director_cannot_change_parent(client, chain):
    parent, branch = chain
    r = client.patch(f"/api/v1/businesses/{branch['id']}/profile", headers=auth_header(parent["owner"]),
                     json={"branch_name": "Yunusobod filiali"})
    assert r.status_code == 200, r.text
    assert r.json()["branch_name"] == "Yunusobod filiali" and r.json()["parent_name"] == "Barber Lab"
    # parent_id direktor profil sxemasida yo'q — e'tiborsiz qoladi
    r = client.patch(f"/api/v1/businesses/{branch['id']}/profile", headers=auth_header(parent["owner"]),
                     json={"parent_id": None})
    assert r.status_code in (200, 422)
    me = client.get("/api/v1/auth/me", headers=auth_header(parent["owner"])).json()
    assert next(m for m in me["memberships"] if m["business_id"] == branch["id"])["parent_id"] == parent["id"]


def test_branches_are_isolated(client, superadmin, chain):
    """Filial A xodimi filial B ma'lumotini ko'rmaydi — har filial alohida."""
    parent, branch = chain
    staff = add_member(client, {"id": branch["id"], "owner": branch["owner"]}, "manager")
    r = client.get(f"/api/v1/businesses/{parent['id']}/services", headers=auth_header(staff["tokens"]))
    assert r.status_code in (403, 404)
    me = client.get("/api/v1/auth/me", headers=auth_header(staff["tokens"])).json()
    assert [m["business_id"] for m in me["memberships"]] == [branch["id"]]


def test_attach_and_detach_existing(client, superadmin):
    parent = create_business(client, superadmin, name="Smile Tarmoq")
    # Direktori boshqa odam bo'lgan muassasa — rad
    foreign = create_business(client, superadmin)
    r = client.patch(f"{SA}/{foreign['id']}", headers=auth_header(superadmin), json={"parent_id": parent["id"]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "different_owner"

    # Direktori yo'q muassasa biriktirilsa — asosiy direktor u yerga ham direktor bo'ladi
    lone = create_business(client, superadmin)
    from tests.conftest import _admin, DB_NAME
    from sqlalchemy import create_engine
    eng = create_engine(_admin.set(database=DB_NAME))
    with eng.begin() as c:
        c.execute(text("UPDATE business_members SET is_active = FALSE WHERE business_id = :b"), {"b": lone["id"]})
    eng.dispose()
    r = client.patch(f"{SA}/{lone['id']}", headers=auth_header(superadmin),
                     json={"parent_id": parent["id"], "branch_name": "Sergeli filiali"})
    assert r.status_code == 200, r.text
    assert r.json()["parent_id"] == parent["id"] and r.json()["branch_name"] == "Sergeli filiali"
    me = client.get("/api/v1/auth/me", headers=auth_header(parent["owner"])).json()
    assert any(m["business_id"] == lone["id"] and m["role"] == "owner" for m in me["memberships"])

    # Ajratish — yorliq ham olib tashlanadi
    r = client.patch(f"{SA}/{lone['id']}", headers=auth_header(superadmin), json={"parent_id": None})
    assert r.status_code == 200, r.text
    assert r.json()["parent_id"] is None and r.json()["branch_name"] is None


def test_owner_required_for_main_company(client, superadmin):
    r = client.post(SA, headers=auth_header(superadmin), json={
        "name": "Egasiz", "slug": f"egasiz-{new_phone()[-7:]}", "category_id": 1, "lat": 41.3, "lng": 69.2})
    assert r.status_code == 422


def test_catalog_shows_chain(client, superadmin, chain):
    parent, branch = chain
    add_service(client, parent)
    add_service(client, {"id": branch["id"], "owner": branch["owner"]})
    hidden, hidden_slug = create_branch(client, superadmin, parent, branch_name="Yangi filial")   # xizmatsiz — ilovada yo'q
    assert hidden.status_code == 201

    d = client.get(f"/api/v1/catalog/businesses/{branch['slug']}").json()
    assert d["branch_name"] == "Chilonzor filiali" and d["chain_name"] == "Barber Lab"
    assert d["branch_count"] == 2
    assert [b["slug"] for b in d["branches"]] == [parent["slug"]]

    p = client.get(f"/api/v1/catalog/businesses/{parent['slug']}").json()
    assert p["chain_name"] is None and p["branch_count"] == 2
    assert [b["slug"] for b in p["branches"]] == [branch["slug"]]
    assert p["branches"][0]["branch_name"] == "Chilonzor filiali"

    near = client.get("/api/v1/catalog/businesses/nearby",
                      params={"lat": 41.29, "lng": 69.22, "radius_m": 20000, "q": "Barber Lab"}).json()["items"]
    card = next(c for c in near if c["slug"] == branch["slug"])
    assert card["branch_name"] == "Chilonzor filiali" and card["branch_count"] == 2
    assert all(c["slug"] != hidden_slug for c in near)


def test_delete_parent_keeps_branches(client, superadmin, chain):
    parent, branch = chain
    name = sa_row(client, superadmin, parent["id"])["name"]
    r = client.request("DELETE", f"{SA}/{parent['id']}", headers=auth_header(superadmin), json={"confirm_name": name})
    assert r.status_code == 204, r.text
    row = sa_row(client, superadmin, branch["id"])
    assert row["parent_id"] is None
