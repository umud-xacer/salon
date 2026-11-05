"""Stomatologiya: bo'limli tavsiya xizmatlar va mutaxassisliklar (sql/029_dental_presets.sql)."""
from tests.conftest import auth_header, create_business
from tests.test_schedule import new_master

DENTAL_SECTIONS = ["Terapevtik davolash", "Gigiyena va tozalash", "Ortodontiya (breketlar)",
                   "Ortopediya (protezlash)", "Jarrohlik va implantatsiya", "Bolalar stomatologiyasi"]


def dental_id(client) -> int:
    cats = client.get("/api/v1/catalog/categories").json()
    return next(c["id"] for c in cats if c["slug"] == "dental")


def test_dental_presets_create_sections_once(client, superadmin):
    biz = create_business(client, superadmin, category_id=dental_id(client))
    h = auth_header(biz["owner"])
    url = f"/api/v1/businesses/{biz['id']}/service-presets"
    presets = client.get(url, headers=h).json()["presets"]
    assert len(presets) >= 20
    assert [s for s in dict.fromkeys(p["category"] for p in presets)] == DENTAL_SECTIONS

    # Avval ikkitasi, keyin qolgani — bo'lim ikki marta yaratilmaydi
    first = [p["name"] for p in presets if p["category"] == "Ortodontiya (breketlar)"][:2]
    assert len(client.post(url, headers=h, json={"names": first}).json()) == 2
    rest = [p["name"] for p in presets if p["name"] not in first]
    assert len(client.post(url, headers=h, json={"names": rest}).json()) == len(rest)

    cats = client.get(f"/api/v1/businesses/{biz['id']}/service-categories", headers=h).json()
    assert sorted(c["name"] for c in cats) == sorted(DENTAL_SECTIONS)
    services = client.get(f"/api/v1/businesses/{biz['id']}/services", headers=h).json()
    by_id = {c["id"]: c["name"] for c in cats}
    braces = next(s for s in services if s["name"].startswith("Breket o'rnatish"))
    assert by_id[braces["category_id"]] == "Ortodontiya (breketlar)"

    # Ilovada xizmatlar bo'limlar bo'yicha (shifokor bo'lsa ko'rinadi)
    new_master(client, biz, services[0])
    detail = client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()
    assert detail["kind"] == "clinic"
    assert {g["category_name"] for g in detail["service_groups"]} == set(DENTAL_SECTIONS)


def test_staff_titles_in_membership_and_editable(client, superadmin):
    biz = create_business(client, superadmin, category_id=dental_id(client))
    m = client.get("/api/v1/auth/me", headers=auth_header(biz["owner"])).json()["memberships"][0]
    assert m["business_kind"] == "clinic" and "Ortodont" in m["staff_titles"]

    sa = auth_header(superadmin)
    tid = dental_id(client)
    r = client.patch(f"/api/v1/superadmin/business-types/{tid}", headers=sa,
                     json={"staff_titles": ["  Ortodont ", "ortodont", "Implantolog", ""]})
    assert r.status_code == 200, r.text
    assert r.json()["staff_titles"] == ["Ortodont", "Implantolog"]
    assert client.patch(f"/api/v1/superadmin/business-types/{tid}", headers=sa,
                        json={"staff_titles": ["x" * 81]}).status_code == 422
    # Asl holatiga qaytarish (boshqa testlar uchun)
    full = ["Stomatolog-terapevt", "Gigiyenist", "Ortodont", "Ortoped-stomatolog",
            "Jarroh-stomatolog (implantolog)", "Bolalar stomatologi"]
    assert client.patch(f"/api/v1/superadmin/business-types/{tid}", headers=sa,
                        json={"staff_titles": full}).status_code == 200


WELLNESS_SECTIONS = ["Massaj turlari", "Sauna va hammom", "Tana parvarishi va detoks", "Kompleks paketlar"]


def test_wellness_spa_presets_sections(client, superadmin):
    cats = client.get("/api/v1/catalog/categories").json()
    spa = next(c for c in cats if c["slug"] == "spa")
    assert spa["name_uz"] == "Wellness & Spa"
    biz = create_business(client, superadmin, category_id=spa["id"])
    h = auth_header(biz["owner"])
    url = f"/api/v1/businesses/{biz['id']}/service-presets"
    presets = client.get(url, headers=h).json()["presets"]
    assert list(dict.fromkeys(p["category"] for p in presets)) == WELLNESS_SECTIONS
    names = {p["name"] for p in presets}
    for must in ("Klassik massaj", "Relaks massaji", "Sport massaji", "Bel va bo'yin massaji", "Yuz massaji",
                 "Fin saunasi", "Turk hammomi (hammam)", "Infraqizil sauna", "Tana skrabi", "Aromaterapiya",
                 "Juftliklar uchun paket (2 kishi)"):
        assert must in names, must
    assert len(client.post(url, headers=h, json={"names": [p["name"] for p in presets]}).json()) == len(presets)
    services = client.get(f"/api/v1/businesses/{biz['id']}/services", headers=h).json()
    new_master(client, biz, services[0])
    detail = client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()
    assert [g["category_name"] for g in detail["service_groups"]] == WELLNESS_SECTIONS
    m = client.get("/api/v1/auth/me", headers=h).json()["memberships"][0]
    assert m["business_type_name"] == "Wellness & Spa" and "Massajchi" in m["staff_titles"]
