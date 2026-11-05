"""W7 Super Admin: obuna to'lovlari tarixi va platforma statistikasi."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.session import api_session
from tests.conftest import auth_header, create_business, otp_login, new_phone


def renew(client, superadmin, biz, **body):
    return client.post(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/renew",
                       headers=auth_header(superadmin), json=body)


def stats(client, superadmin):
    r = client.get("/api/v1/superadmin/stats", headers=auth_header(superadmin))
    assert r.status_code == 200, r.text
    return r.json()


def test_renew_records_payment_history(client, superadmin):
    biz = create_business(client, superadmin)
    r = renew(client, superadmin, biz, days=30, amount=150000, method="card", note="  Noyabr  ")
    assert r.status_code == 200, r.text
    ends = r.json()["subscription_ends_at"]
    assert renew(client, superadmin, biz, days=7, method="free").status_code == 200

    r = client.get(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/payments", headers=auth_header(superadmin))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert [x["days"] for x in rows] == [7, 30]
    first = rows[1]
    assert first["amount"] == 150000 and first["method"] == "card" and first["note"] == "Noyabr"
    assert first["ends_at"][:16] == ends[:16] and first["created_by_name"] == "Super Admin"
    assert first["business_name"] == f"Salon {biz['slug']}"

    # Avvalgi chaqiruv (summasiz) ham ishlaydi
    assert renew(client, superadmin, biz, days=1).status_code == 200


def test_renew_validation(client, superadmin):
    biz = create_business(client, superadmin)
    assert renew(client, superadmin, biz, days=30, amount=1000, method="free").status_code == 422
    assert renew(client, superadmin, biz, days=30, amount=-1).status_code == 422
    assert renew(client, superadmin, biz, days=30, method="bitcoin").status_code == 422
    assert renew(client, superadmin, biz, days=30, note="x" * 301).status_code == 422


def test_payment_history_is_superadmin_and_owner_only(client, superadmin):
    biz = create_business(client, superadmin)
    assert renew(client, superadmin, biz, days=30, amount=99000).status_code == 200
    stranger = otp_login(client, new_phone())
    assert client.get("/api/v1/superadmin/stats", headers=auth_header(stranger)).status_code == 403
    assert client.get(f"/api/v1/superadmin/businesses/{biz['id']}/subscription/payments",
                      headers=auth_header(stranger)).status_code == 403
    # Baza darajasida: direktor o'z tarixini o'qiydi, yozolmaydi, o'chirolmaydi; begona salonniki ko'rinmaydi
    other = create_business(client, superadmin)
    assert renew(client, superadmin, other, days=30, amount=1).status_code == 200
    with api_session(biz["owner"]["user"]["id"]) as db:
        seen = db.execute(text("SELECT business_id FROM subscription_payments")).scalars().all()
        assert set(seen) == {biz["id"]}
        with pytest.raises(DBAPIError):
            db.execute(text("INSERT INTO subscription_payments (business_id, business_name, days, ends_at) "
                            "VALUES (:b, 'x', 365, now())"), {"b": biz["id"]})
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("UPDATE subscription_payments SET amount = 0"))
        db.rollback()
    with api_session(stranger["user"]["id"]) as db:
        assert db.execute(text("SELECT count(*) FROM subscription_payments")).scalar() == 0


def test_payments_survive_business_deletion(client, superadmin, database):
    biz = create_business(client, superadmin)
    assert renew(client, superadmin, biz, days=30, amount=50000).status_code == 200
    r = client.request("DELETE", f"/api/v1/superadmin/businesses/{biz['id']}", headers=auth_header(superadmin),
                       json={"confirm_name": f"Salon {biz['slug']}"})
    assert r.status_code == 204, r.text
    s = stats(client, superadmin)
    kept = [p for p in s["recent_payments"] if p["business_name"] == f"Salon {biz['slug']}"]
    assert kept and kept[0]["business_id"] is None and kept[0]["amount"] == 50000


def test_stats_shape_and_counts(client, superadmin):
    before = stats(client, superadmin)
    biz = create_business(client, superadmin)
    assert renew(client, superadmin, biz, days=3, amount=70000, method="transfer").status_code == 200
    blocked = create_business(client, superadmin)
    assert client.patch(f"/api/v1/superadmin/businesses/{blocked['id']}/status", headers=auth_header(superadmin),
                        json={"status": "blocked"}).status_code == 204

    s = stats(client, superadmin)
    assert s["businesses_total"] == before["businesses_total"] + 2
    assert s["businesses_blocked"] == before["businesses_blocked"] + 1
    assert s["businesses_operational"] + s["businesses_suspended"] + s["businesses_blocked"] == s["businesses_total"]
    assert s["revenue_this_month"] == before["revenue_this_month"] + 70000
    assert len(s["revenue_monthly"]) == 12 and s["revenue_monthly"][-1]["amount"] == s["revenue_this_month"]
    assert len(s["daily"]) == 30
    assert any(e["id"] == biz["id"] for e in s["expiring_soon"])          # 3 kunda tugaydi
    assert s["clients_total"] + s["staff_total"] == s["users_total"]
    assert sum(t["count"] for t in s["by_type"]) == s["businesses_total"]
    assert s["recent_payments"][0]["amount"] == 70000
