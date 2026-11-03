"""Super Admin muassasani butunlay o'chiradi: barcha bog'liq ma'lumot, fayllar; tasdiq nomi, huquqlar."""
import io
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.config import get_settings
from app.db.session import api_session
from tests.conftest import add_member, auth_header, create_business, otp_login
from tests.test_finance import book, ctx, pay, today, url  # noqa: F401  (ctx — fixture)


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance", "inventory", "payroll"))


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (60, 40), (10, 20, 30)).save(buf, "PNG")
    return buf.getvalue()


def delete(client, superadmin, biz_id, name):
    return client.request("DELETE", f"/api/v1/superadmin/businesses/{biz_id}", headers=auth_header(superadmin),
                          json={"confirm_name": name})


def name_of(client, superadmin, biz_id):
    rows = client.get("/api/v1/superadmin/businesses", headers=auth_header(superadmin)).json()
    return next(b["name"] for b in rows if b["id"] == biz_id)


def test_delete_with_all_data(client, superadmin, biz, ctx):
    owner = auth_header(biz["owner"])
    a = book(client, biz, ctx, "10:00", status="completed")
    p = pay(client, biz, ctx, a, a["total_price"]).json()["payments"][0]
    client.post(url(biz, f"payments/{p['id']}/refund"), headers=owner, json={"reason": "Sinov"})
    client.post(url(biz, "expenses"), headers=owner, json={"amount": 5000, "spent_at": today()})
    prod = client.post(url(biz, "products"), headers=owner,
                       json={"name": "Shampun", "unit": "dona", "cost_price": 1000, "sale_price": 2000, "min_qty": 1})
    assert prod.status_code == 201, prod.text
    mv = client.post(url(biz, f"products/{prod.json()['id']}/movements"), headers=owner,
                     json={"type": "purchase", "qty": 5, "unit_cost": 1000})
    assert mv.status_code == 201, mv.text
    photo = client.post(url(biz, "photos/upload"), headers=owner, files={"file": ("a.png", png(), "image/png")})
    assert photo.status_code == 201
    folder = Path(get_settings().media_dir).resolve() / "business" / str(biz["id"])
    assert folder.is_dir()
    customer = otp_login(client, "+998977770001")
    client.put(f"/api/v1/me/favorites/{biz['id']}", headers=auth_header(customer))

    name = name_of(client, superadmin, biz["id"])
    r = delete(client, superadmin, biz["id"], name)
    assert r.status_code == 204, r.text

    assert all(b["id"] != biz["id"] for b in
               client.get("/api/v1/superadmin/businesses", headers=auth_header(superadmin)).json())
    assert not folder.exists()
    assert client.get(f"/api/v1/catalog/businesses/{biz['slug']}").status_code == 404
    # Direktor endi bu salonga kira olmaydi, lekin foydalanuvchi hisobi o'zi qoladi
    me = client.get("/api/v1/auth/me", headers=owner)
    assert me.status_code == 200 and all(m["business_id"] != biz["id"] for m in me.json()["memberships"])
    with api_session(superadmin["user"]["id"]) as db:
        for table in ("appointments", "payments", "expenses", "products", "stock_movements", "business_members"):
            assert db.scalar(text(f"SELECT count(*) FROM {table} WHERE business_id = :b"), {"b": biz["id"]}) == 0
        log = db.execute(text("SELECT changes FROM audit_logs WHERE action = 'delete' AND entity_type = 'business' "
                              "AND entity_id = :b"), {"b": biz["id"]}).scalar()
        assert log["name"] == name                     # kim nimani o'chirgani Super Admin jurnalida qoladi


def test_wrong_confirm_name_keeps_business(client, superadmin, biz):
    r = delete(client, superadmin, biz["id"], "boshqa nom")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "confirm_mismatch"
    assert any(b["id"] == biz["id"] for b in client.get("/api/v1/superadmin/businesses",
                                                         headers=auth_header(superadmin)).json())


def test_only_superadmin_deletes(client, superadmin, biz):
    name = name_of(client, superadmin, biz["id"])
    manager = add_member(client, biz, "manager")
    for tokens in (biz["owner"], manager["tokens"]):
        r = client.request("DELETE", f"/api/v1/superadmin/businesses/{biz['id']}", headers=auth_header(tokens),
                           json={"confirm_name": name})
        assert r.status_code == 403
    assert delete(client, superadmin, 999999, "x").status_code == 404


def test_owner_cannot_delete_via_database(biz):
    """Baza darajasida ham: direktor o'z biznesini o'chira olmaydi."""
    with api_session(biz["owner"]["user"]["id"]) as db:
        with pytest.raises(DBAPIError):
            db.execute(text("DELETE FROM businesses WHERE id = :b"), {"b": biz["id"]})
        db.rollback()
        with pytest.raises(DBAPIError) as e:
            db.execute(text("SELECT app.delete_business(:b)"), {"b": biz["id"]})
        assert e.value.orig.sqlstate == "42501"
