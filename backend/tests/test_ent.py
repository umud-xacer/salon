"""Lor (Otorinolaringologiya): klinika ish tartibi, 5 bo'lim / 18 tavsiya xizmat, mutaxassisliklar (sql/035)."""
from tests.conftest import auth_header, create_business
from tests.test_schedule import new_master

ENT_SECTIONS = ["Konsultatsiya va diagnostika", "Burun va yondosh bo'shliqlar", "Tomoq va halqum",
                "Quloq muolajalari", "Kichik jarrohlik va muolajalar"]
ENT_TITLES = ["Lor-shifokor (otorinolaringolog, kattalar)", "Bolalar Lor-shifokori (pediatrik otorinolaringolog)",
              "Lor-jarroh (burun, tomoq, quloq)", "Audiolog / Surdolog (eshitish mutaxassisi)"]


def ent(client) -> dict:
    return next(c for c in client.get("/api/v1/catalog/categories").json() if c["slug"] == "ent")


def test_ent_type_is_clinic_with_doctor_wording(client, superadmin):
    t = ent(client)
    assert t["name_uz"] == "Lor (Otorinolaringologiya)"
    biz = create_business(client, superadmin, category_id=t["id"])
    m = client.get("/api/v1/auth/me", headers=auth_header(biz["owner"])).json()["memberships"][0]
    # Klinika tartibi: panel "Shifokor" deydi (staff_word bo'sh — standart), "Usta" emas
    assert m["business_kind"] == "clinic" and m["staff_word"] is None
    assert m["staff_titles"] == ENT_TITLES
    assert m["business_type_name"] == "Lor (Otorinolaringologiya)"


def test_ent_presets_18_in_5_sections(client, superadmin):
    biz = create_business(client, superadmin, category_id=ent(client)["id"])
    h = auth_header(biz["owner"])
    url = f"/api/v1/businesses/{biz['id']}/service-presets"
    presets = client.get(url, headers=h).json()["presets"]
    assert len(presets) == 18
    assert list(dict.fromkeys(p["category"] for p in presets)) == ENT_SECTIONS
    assert all(15 <= p["duration_min"] <= 60 for p in presets)
    names = {p["name"] for p in presets}
    for must in ("Birlamchi Lor ko'rigi va maslahati", "Eshitish qobiliyatini tekshirish (audiometriya)",
                 'Burun bo\'shlig\'ini dori bilan yuvish ("Kukushka" usuli)', "Burun qonashini to'xtatish (tamponada)"):
        assert must in names, must

    # Bir bosishda hammasi — har biri o'z bo'limiga tushadi
    assert len(client.post(url, headers=h, json={"names": [p["name"] for p in presets]}).json()) == 18
    cats = client.get(f"/api/v1/businesses/{biz['id']}/service-categories", headers=h).json()
    assert sorted(c["name"] for c in cats) == sorted(ENT_SECTIONS)
    services = client.get(f"/api/v1/businesses/{biz['id']}/services", headers=h).json()
    by_id = {c["id"]: c["name"] for c in cats}
    ear = next(s for s in services if s["name"].startswith("Quloq tiqinini"))
    assert by_id[ear["category_id"]] == "Quloq muolajalari"

    # Direktor vaqtni o'zgartira oladi
    r = client.patch(f"/api/v1/businesses/{biz['id']}/services/{ear['id']}", headers=h, json={"duration_min": 40})
    assert r.status_code == 200 and r.json()["duration_min"] == 40

    # Ilovada: klinika, xizmatlar bo'limlar bo'yicha
    new_master(client, biz, services[0])
    detail = client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()
    assert detail["kind"] == "clinic"
    assert [g["category_name"] for g in detail["service_groups"]] == ENT_SECTIONS
