"""chronix.uz qidiruv tizimlari uchun: sitemap va sahifalarni oldindan tayyorlash (app/api/v1/seo.py)."""
import json
import re

import pytest

from app.core.config import get_settings
from tests.conftest import auth_header, create_business
from tests.test_schedule import url

INDEX = """<!doctype html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <title>Chronix — salon, barber, stomatologiya va SPA'ga onlayn bron</title>
  <meta name="description" content="Eski tavsif" />
  <link rel="canonical" href="https://chronix.uz/" />
  <meta property="og:title" content="Chronix — onlayn bron" />
  <meta property="og:description" content="Eski" />
  <meta property="og:url" content="https://chronix.uz/" />
  <meta property="og:image" content="https://chronix.uz/og-image.jpg" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/index-abc.js"></script>
</body>
</html>
"""


@pytest.fixture()
def index_file(tmp_path, monkeypatch):
    f = tmp_path / "index.html"
    f.write_text(INDEX, encoding="utf-8")
    monkeypatch.setattr(get_settings(), "market_index_path", str(f))
    return f


@pytest.fixture()
def salon(client, superadmin):
    biz = create_business(client, superadmin, name="Gul & <Salon>")
    r = client.post(url(biz, "services"), headers=auth_header(biz["owner"]),
                    json={"name": "Soch olish", "name_ru": "Стрижка", "duration_min": 60, "price": 120000})
    assert r.status_code == 201, r.text
    r = client.patch(url(biz, "profile"), headers=auth_header(biz["owner"]),
                     json={"address": "Chilonzor 5", "description": "Eng yaxshi \"salon\" </script>"})
    assert r.status_code == 200, r.text
    return biz


def render(client, path):
    r = client.get("/api/v1/seo/render", params={"path": path})
    return r, r.text


def jsonld(page: str) -> list[dict]:
    return [json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S)]


def test_salon_page_has_meta_content_and_schema(client, index_file, salon):
    r, page = render(client, f"/s/{salon['slug']}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "<title>Gul &amp; &lt;Salon&gt; — " in page and "| Chronix</title>" in page
    assert f'<link rel="canonical" href="https://chronix.uz/s/{salon["slug"]}" />' in page
    assert f'hreflang="ru" href="https://chronix.uz/ru/s/{salon["slug"]}"' in page
    assert "<script>" not in page.split('<div id="root">')[1].split("</div>")[0]     # nom va tavsif ekranlangan
    assert '<script type="module" src="/assets/index-abc.js"></script>' in page   # SPA o'z joyida
    assert "120 000 so&#x27;m" in page and "Chilonzor 5" in page
    ld = jsonld(page)
    biz = next(x for x in ld if x["@type"] != "BreadcrumbList")
    assert biz["name"] == "Gul & <Salon>" and biz["address"]["streetAddress"] == "Chilonzor 5"
    assert biz["hasOfferCatalog"]["itemListElement"][0]["price"] == 120000
    assert "</script>" not in page.split('application/ld+json">')[1].split("</script>")[0]


def test_russian_version_and_home(client, index_file, salon):
    r, page = render(client, f"/ru/s/{salon['slug']}")
    assert r.status_code == 200 and '<html lang="ru"' in page and r.headers["content-language"] == "ru"
    assert f'<link rel="canonical" href="https://chronix.uz/ru/s/{salon["slug"]}" />' in page
    assert "120 000 сум" in page and "Услуги" in page
    r, page = render(client, "/ru")
    assert "Онлайн-запись" in page and f'href="https://chronix.uz/ru/s/{salon["slug"]}"' in page
    r, page = render(client, "/")
    assert f'href="https://chronix.uz/s/{salon["slug"]}"' in page
    assert any(x["@type"] == "WebSite" for x in jsonld(page))


def test_unknown_and_private_pages_not_indexed(client, index_file, salon):
    r, page = render(client, "/s/bunday-salon-yoq-123")
    assert r.status_code == 404 and 'content="noindex"' in page
    r, page = render(client, f"/s/{salon['slug']}/bron")
    assert r.status_code == 200 and 'content="noindex"' in page


def test_sitemap_lists_salons_in_both_languages(client, salon):
    r = client.get("/api/v1/seo/sitemap.xml")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml")
    xml = r.text
    assert f"<loc>https://chronix.uz/s/{salon['slug']}</loc>" in xml
    assert f"<loc>https://chronix.uz/ru/s/{salon['slug']}</loc>" in xml
    assert "<loc>https://chronix.uz/ru</loc>" in xml and 'hreflang="x-default"' in xml
