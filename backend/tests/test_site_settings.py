"""Sayt sozlamalari (footer): ochiq o'qish, faqat Super Admin o'zgartiradi, noto'g'ri havola o'tmaydi (sql/068)."""
from sqlalchemy import text

from app.db.session import api_session
from tests.conftest import auth_header, create_business

FULL = {"telegram_url": "https://t.me/chronix_uz", "instagram_url": "https://instagram.com/chronix.uz",
        "youtube_url": "", "play_url": "https://play.google.com/store/apps/details?id=uz.chronix.app",
        "appstore_url": "", "phone": "+998 20 003 55 99", "email": "info@chronix.uz",
        "address_uz": "Toshkent, Chilonzor", "address_ru": "Ташкент, Чиланзар",
        "work_hours_uz": "Du–Sha 9:00–18:00", "work_hours_ru": "Пн–Сб 9:00–18:00", "about_uz": "", "about_ru": ""}


def test_public_read_and_superadmin_update(client, superadmin):
    r = client.get("/api/v1/site/settings")
    assert r.status_code == 200 and r.json()["telegram_url"].startswith("https://t.me/")
    r = client.put("/api/v1/superadmin/site-settings", headers=auth_header(superadmin), json=FULL)
    assert r.status_code == 200, r.text
    assert r.json()["instagram_url"] == FULL["instagram_url"]
    # Sayt darhol yangisini ko'radi (kesh tozalanadi)
    pub = client.get("/api/v1/site/settings").json()
    assert pub["play_url"] == FULL["play_url"] and pub["youtube_url"] == ""


def test_bad_links_rejected(client, superadmin):
    for field, bad in [("instagram_url", "javascript:alert(1)"), ("telegram_url", "http://t.me/x"),
                       ("play_url", 'https://x.uz/"><script>'), ("phone", "abc"), ("email", "yoq")]:
        r = client.put("/api/v1/superadmin/site-settings", headers=auth_header(superadmin), json={**FULL, field: bad})
        assert r.status_code == 422, (field, r.text)


def test_only_superadmin(client, superadmin):
    biz = create_business(client, superadmin)
    r = client.put("/api/v1/superadmin/site-settings", headers=auth_header(biz["owner"]), json=FULL)
    assert r.status_code == 403
    assert client.put("/api/v1/superadmin/site-settings", json=FULL).status_code == 401
    # Bazada ham: direktor to'g'ridan-to'g'ri SQL bilan o'zgartira olmaydi (RLS — 0 qator)
    with api_session(biz["owner"]["user"]["id"]) as db:
        n = db.execute(text("UPDATE site_settings SET instagram_url = 'https://evil.example'")).rowcount
        db.commit()
    assert n == 0
    with api_session(None) as db:
        assert db.execute(text("SELECT instagram_url FROM site_settings")).scalar() != "https://evil.example"
