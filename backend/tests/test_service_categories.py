"""Xizmat bo'limlari: nomini o'zgartirish, tartiblash, o'chirishda xizmatlarni ko'chirish (TZ 2026-11-07)."""
from tests.conftest import auth_header, create_business


def setup(client, superadmin):
    biz = create_business(client, superadmin)
    h = auth_header(biz["owner"])
    base = f"/api/v1/businesses/{biz['id']}"
    return biz, h, base


def svc(client, base, h, name, cat):
    r = client.post(f"{base}/services", headers=h, json={"name": name, "duration_min": 30, "price": 50000, "category_id": cat})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_appends_and_rename_keeps_order(client, superadmin):
    _, h, base = setup(client, superadmin)
    a = client.post(f"{base}/service-categories", headers=h, json={"name": "  Soch   xizmatlari "}).json()
    b = client.post(f"{base}/service-categories", headers=h, json={"name": "Tirnoq"}).json()
    assert a["name"] == "Soch xizmatlari" and b["sort_order"] == a["sort_order"] + 1
    # Faqat nom o'zgaradi — tartib joyida qoladi
    r = client.patch(f"{base}/service-categories/{b['id']}", headers=h, json={"name": "Manikyur va pedikyur"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Manikyur va pedikyur" and r.json()["sort_order"] == b["sort_order"]
    # Takroriy nom (katta-kichik harf farqsiz) — 409; bo'sh nom — 422
    assert client.patch(f"{base}/service-categories/{b['id']}", headers=h, json={"name": "soch XIZMATLARI"}).status_code == 409
    assert client.post(f"{base}/service-categories", headers=h, json={"name": "   "}).status_code == 422
    # O'z nomini qayta saqlash mumkin
    assert client.patch(f"{base}/service-categories/{b['id']}", headers=h, json={"name": "Manikyur va pedikyur"}).status_code == 200


def test_reorder_reflects_in_app(client, superadmin):
    biz, h, base = setup(client, superadmin)
    ids = [client.post(f"{base}/service-categories", headers=h, json={"name": n}).json()["id"] for n in ("A", "B", "C")]
    for i, cid in enumerate(ids):
        svc(client, base, h, f"Xizmat {i}", cid)
    r = client.put(f"{base}/service-categories/order", headers=h, json={"ids": [ids[2], ids[0], ids[1]]})
    assert r.status_code == 200, r.text
    assert [c["name"] for c in r.json()] == ["C", "A", "B"]
    assert [c["service_count"] for c in r.json()] == [1, 1, 1]
    # To'liq bo'lmagan ro'yxat yoki begona id — rad etiladi
    assert client.put(f"{base}/service-categories/order", headers=h, json={"ids": ids[:2]}).status_code == 422
    assert client.put(f"{base}/service-categories/order", headers=h, json={"ids": ids + [999999]}).status_code == 422
    # Mijoz ilovasida ham shu tartib (xizmatni ko'rsatish uchun usta kerak)
    from tests.test_schedule import new_master
    services = client.get(f"{base}/services", headers=h).json()
    new_master(client, biz, services[0])
    detail = client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()
    names = [g["category_name"] for g in detail["service_groups"]]
    assert names == [n for n in ["C", "A", "B"] if n in names]


def test_delete_moves_services(client, superadmin):
    _, h, base = setup(client, superadmin)
    old = client.post(f"{base}/service-categories", headers=h, json={"name": "Eski"}).json()
    new = client.post(f"{base}/service-categories", headers=h, json={"name": "Yangi"}).json()
    s1 = svc(client, base, h, "Birinchi", old["id"])
    s2 = svc(client, base, h, "Ikkinchi", new["id"])
    # O'ziga ko'chirib bo'lmaydi
    assert client.delete(f"{base}/service-categories/{old['id']}?move_to={old['id']}", headers=h).status_code == 422
    assert client.delete(f"{base}/service-categories/{old['id']}?move_to={new['id']}", headers=h).status_code == 204
    services = {s["id"]: s for s in client.get(f"{base}/services", headers=h).json()}
    assert services[s1["id"]]["category_id"] == new["id"]
    # move_to'siz — "Boshqa" guruhiga (xizmat o'chmaydi)
    assert client.delete(f"{base}/service-categories/{new['id']}", headers=h).status_code == 204
    services = {s["id"]: s for s in client.get(f"{base}/services", headers=h).json()}
    assert services[s1["id"]]["category_id"] is None and services[s2["id"]]["category_id"] is None
    assert client.delete(f"{base}/service-categories/{new['id']}", headers=h).status_code == 404


def test_foreign_business_categories_untouchable(client, superadmin):
    _, h, base = setup(client, superadmin)
    other, ho, obase = setup(client, superadmin)
    mine = client.post(f"{base}/service-categories", headers=h, json={"name": "Meniki"}).json()
    theirs = client.post(f"{obase}/service-categories", headers=ho, json={"name": "Ularniki"}).json()
    # Boshqa muassasa bo'limini o'zgartirish, o'chirish yoki ko'chirish manzili qilib bo'lmaydi
    assert client.patch(f"{base}/service-categories/{theirs['id']}", headers=h, json={"name": "X"}).status_code == 404
    assert client.delete(f"{base}/service-categories/{theirs['id']}", headers=h).status_code == 404
    assert client.delete(f"{base}/service-categories/{mine['id']}?move_to={theirs['id']}", headers=h).status_code == 404
    assert client.put(f"{base}/service-categories/order", headers=h, json={"ids": [mine["id"], theirs["id"]]}).status_code == 422
    assert client.get(f"{obase}/service-categories", headers=ho).json()[0]["name"] == "Ularniki"
