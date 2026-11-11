"""Ikki tilli tizim: xizmat va bo'limlarning ruscha nomi, tavsiyalardagi ruscha nomlar (sql/036)."""
from tests.conftest import auth_header, create_business
from tests.test_schedule import new_master


def cat_id(client, slug):
    return next(c["id"] for c in client.get("/api/v1/catalog/categories").json() if c["slug"] == slug)


def test_presets_carry_russian_names(client, superadmin):
    biz = create_business(client, superadmin, category_id=cat_id(client, "ent"))
    h = auth_header(biz["owner"])
    base = f"/api/v1/businesses/{biz['id']}"
    data = client.get(f"{base}/service-presets", headers=h).json()
    assert data["category_name_ru"].startswith("ЛОР")
    presets = data["presets"]
    assert all(p["name_ru"] and p["category_ru"] for p in presets), "har bir Lor tavsiyasida ruscha nom bor"
    client.post(f"{base}/service-presets", headers=h, json={"names": [p["name"] for p in presets]})
    services = client.get(f"{base}/services", headers=h).json()
    audio = next(s for s in services if s["name"].startswith("Eshitish"))
    assert audio["name_ru"] == "Проверка слуха (аудиометрия)"
    cats = {c["name"]: c for c in client.get(f"{base}/service-categories", headers=h).json()}
    assert cats["Quloq muolajalari"]["name_ru"] == "Процедуры для уха"
    # Ilovada: xizmat va bo'lim ruscha nomi bilan
    new_master(client, biz, services[0])
    detail = client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()
    assert detail["category_name_ru"].startswith("ЛОР")
    g = next(x for x in detail["service_groups"] if x["category_name"] == "Konsultatsiya va diagnostika")
    assert g["category_name_ru"] == "Консультация и диагностика"
    assert all(s["name_ru"] for s in g["services"])


def test_manual_russian_name_set_and_clear(client, superadmin):
    biz = create_business(client, superadmin)
    h = auth_header(biz["owner"])
    base = f"/api/v1/businesses/{biz['id']}"
    cat = client.post(f"{base}/service-categories", headers=h, json={"name": "Soch", "name_ru": "  Волосы  "}).json()
    assert cat["name_ru"] == "Волосы"
    r = client.post(f"{base}/services", headers=h, json={"name": "Soch olish", "name_ru": "Стрижка", "duration_min": 30,
                                                           "price": 50000, "category_id": cat["id"]})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert r.json()["name_ru"] == "Стрижка"
    # Bo'sh qator — ruscha nom o'chadi, o'zbekcha qoladi
    r = client.patch(f"{base}/services/{sid}", headers=h, json={"name_ru": "  "})
    assert r.status_code == 200 and r.json()["name_ru"] is None and r.json()["name"] == "Soch olish"
    r = client.patch(f"{base}/service-categories/{cat['id']}", headers=h, json={"name_ru": ""})
    assert r.status_code == 200 and r.json()["name_ru"] is None and r.json()["name"] == "Soch"
    # Faqat nom o'zgarsa, ruscha nom joyida qoladi
    client.patch(f"{base}/service-categories/{cat['id']}", headers=h, json={"name_ru": "Волосы"})
    r = client.patch(f"{base}/service-categories/{cat['id']}", headers=h, json={"name": "Soch xizmatlari"})
    assert r.json()["name_ru"] == "Волосы"
    assert client.post(f"{base}/services", headers=h, json={"name": "Uzun", "name_ru": "x" * 121, "duration_min": 30,
                                                            "price": 1}).status_code == 422


def test_booking_shows_russian_service_name(client, superadmin):
    """Bronda xizmat nomi o'sha paytdagi (o'zbekcha) nusxa; ruscha ilova/panel uchun services_ru ham keladi."""
    from tests.test_appointments import book, customer
    from tests.test_schedule import day_from_today
    biz = create_business(client, superadmin)
    h = auth_header(biz["owner"])
    base = f"/api/v1/businesses/{biz['id']}"
    with_ru = client.post(f"{base}/services", headers=h, json={"name": "Soch olish", "name_ru": "Стрижка",
                                                               "duration_min": 30, "price": 50000}).json()
    plain = client.post(f"{base}/services", headers=h, json={"name": "Soqol", "duration_min": 30, "price": 30000}).json()
    day = day_from_today(biz, 2)
    tokens = customer(client)
    r = book(client, tokens, new_master(client, biz, with_ru), with_ru, day, "10:00")
    assert r.status_code == 201, r.text
    assert r.json()["services"] == ["Soch olish"] and r.json()["services_ru"] == ["Стрижка"]
    r = book(client, tokens, new_master(client, biz, plain), plain, day, "11:00")
    assert r.status_code == 201, r.text
    assert r.json()["services"] == ["Soqol"] and r.json()["services_ru"] == ["Soqol"]      # ruschasi yo'q — o'zbekchasi
