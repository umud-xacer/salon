"""Qidiruv tizimlari uchun chronix.uz (2026-11-18).

* /seo/sitemap.xml — bosh sahifa, qidiruv, biznes va BARCHA ochiq salon sahifalari, ikki tilda (uz — /..., ru — /ru/...),
  hreflang bog'lanishi bilan. Caddy chronix.uz/sitemap.xml ni shu yerga yo'naltiradi.
* /seo/render?path=... — o'sha SPA index.html, lekin <head> va #root ichi sahifaga mos: sarlavha, tavsif, kanonik,
  hreflang, Open Graph, JSON-LD (LocalBusiness) va sahifaning asosiy matni (salon nomi, manzil, xizmatlar va narxlar).
  Google JavaScript'ni kutmasdan mazmunni ko'radi; brauzerda React #root ni o'zi chizib oladi.
  Caddy bu yo'lni faqat sahifa manzillari uchun chaqiradi; API ishlamasa — oddiy index.html beriladi.
Faqat ochiq katalog ma'lumoti (get_public_db, RLS) — yopiq ma'lumot bu yerga tushmaydi. Barcha matn HTML-ekranlanadi.
"""
import html
import json
import os
import re
from datetime import timezone

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_public_db
from app.api.v1.catalog import _PUBLIC_WHERE, _business_detail
from app.core.cache import public_cache, ttl
from app.core.config import get_settings

router = APIRouter(prefix="/seo", tags=["seo"])

SCHEMA_TYPE = {"beauty_salon": "BeautySalon", "barbershop": "HairSalon", "dental": "Dentist",
               "ent": "MedicalClinic", "spa": "DaySpa"}
_INDEX: dict = {"mtime": None, "html": ""}

TXT = {
    "uz": {
        "home_title": "Chronix — salon, barber, stomatologiya va SPA'ga onlayn bron",
        "home_desc": "Toshkentdagi go'zallik salonlari, barbershoplar, stomatologiya va SPA markazlarini toping: haqiqiy "
                     "sharhlar, narxlar va bo'sh vaqtlar. Bir necha soniyada onlayn bron qiling.",
        "home_h1": "Toshkentda salon, barber, stomatologiya va SPA'ga onlayn bron",
        "search_title": "Salon va xizmatlarni qidirish — Chronix",
        "search_desc": "Toshkentdagi salonlar, barbershoplar, stomatologiya va SPA: xaritada, reyting va narxlar bo'yicha.",
        "biz_title": "Chronix biznes uchun — onlayn bron, kalendar, kassa va ombor",
        "biz_desc": "Salon, klinika va SPA uchun tizim: onlayn bron, kalendar, kassa, ombor va oylik hisob-kitob. "
                    "Mijozlar sizni chronix.uz va ilovada topadi.",
        "biz_h1": "Salon, klinika va SPA'ni bitta tizimda boshqaring",
        "salons": "Muassasalar", "services": "Xizmatlar", "address": "Manzil", "hours": "Ish vaqti",
        "reviews": "{n} ta sharh", "book": "Onlayn bron", "from": "{p} so'm", "sum": "so'm",
        "salon_desc": "{name} — {cat}{where}. {rating}Xizmatlar: {services}. Chronix'da onlayn bron qiling.",
        "rating": "Reyting {avg} ({n} ta sharh). ",
        "days": ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"],
        "closed": "Yopiq", "city": "Toshkent",
    },
    "ru": {
        "home_title": "Chronix — онлайн-запись в салоны, барбершопы, стоматологии и SPA Ташкента",
        "home_desc": "Найдите салоны красоты, барбершопы, стоматологии и SPA Ташкента: реальные отзывы, цены и "
                     "свободное время. Онлайн-запись за несколько секунд.",
        "home_h1": "Онлайн-запись в салоны, барбершопы, стоматологии и SPA Ташкента",
        "search_title": "Поиск салонов и услуг — Chronix",
        "search_desc": "Салоны, барбершопы, стоматологии и SPA Ташкента: на карте, по рейтингу и ценам.",
        "biz_title": "Chronix для бизнеса — онлайн-запись, календарь, касса и склад",
        "biz_desc": "Система для салонов, клиник и SPA: онлайн-запись, календарь, касса, склад и расчёт зарплаты. "
                    "Клиенты находят вас на chronix.uz и в приложении.",
        "biz_h1": "Управляйте салоном, клиникой и SPA в одной системе",
        "salons": "Заведения", "services": "Услуги", "address": "Адрес", "hours": "Часы работы",
        "reviews": "{n} отзывов", "book": "Онлайн-запись", "from": "{p} сум", "sum": "сум",
        "salon_desc": "{name} — {cat}{where}. {rating}Услуги: {services}. Онлайн-запись на Chronix.",
        "rating": "Рейтинг {avg} ({n} отзывов). ",
        "days": ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
        "closed": "Закрыто", "city": "Ташкент",
    },
}


def esc(v) -> str:
    return html.escape("" if v is None else str(v), quote=True)


def _money(v: int) -> str:
    return f"{int(v):,}".replace(",", " ")


def _index_html() -> str:
    """SPA index.html (market-dist API konteyneriga faqat o'qish uchun ulangan). Fayl yangilansa — qayta o'qiladi."""
    path = get_settings().market_index_path
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return ""
    if _INDEX["mtime"] != mtime:
        with open(path, encoding="utf-8") as f:
            _INDEX.update(mtime=mtime, html=f.read())
    return _INDEX["html"]


def _split(path: str) -> tuple[str, str]:
    """'/ru/s/abc' -> ('ru', '/s/abc'); '/' -> ('uz', '/')."""
    m = re.match(r"^/ru(?=/|$)(.*)$", path)
    if m:
        return "ru", m.group(1) or "/"
    return "uz", path or "/"


def _url(lang: str, plain: str) -> str:
    site = get_settings().site_url.rstrip("/")
    if lang == "ru":
        return f"{site}/ru{'' if plain == '/' else plain}"
    return f"{site}{plain}"


def _pick(lang: str, uz, ru) -> str:
    return (ru if lang == "ru" and ru else uz) or ""


def _render(page: str, *, lang: str, plain: str, title: str, desc: str, image: str | None, body: str,
            jsonld: list[dict], noindex: bool = False) -> str:
    """index.html ga sahifa ma'lumotini joylash. index.html topilmasa — minimal sahifa."""
    head_extra = [
        f'<link rel="alternate" hreflang="uz" href="{esc(_url("uz", plain))}" />',
        f'<link rel="alternate" hreflang="ru" href="{esc(_url("ru", plain))}" />',
        f'<link rel="alternate" hreflang="x-default" href="{esc(_url("uz", plain))}" />',
        f'<meta property="og:locale" content="{"ru_RU" if lang == "ru" else "uz_UZ"}" />',
    ]
    if noindex:
        head_extra.append('<meta name="robots" content="noindex" />')
    for item in jsonld:
        # </script> va HTML izohlari JSON ichida ishlamasin
        data = json.dumps(item, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        head_extra.append(f'<script type="application/ld+json">{data}</script>')
    canonical = _url(lang, plain)
    out = page or ('<!doctype html><html lang="uz"><head><meta charset="UTF-8" /><title></title></head>'
                   '<body><div id="root"></div></body></html>')
    out = re.sub(r'<html lang="[a-z]+"', f'<html lang="{lang}"', out, count=1)
    out = re.sub(r"<title>.*?</title>", f"<title>{esc(title)}</title>", out, count=1, flags=re.S)

    def meta(attr: str, key: str, value: str) -> None:
        nonlocal out
        pat = re.compile(rf'<meta {attr}="{re.escape(key)}" content="[^"]*" />')
        tag = f'<meta {attr}="{key}" content="{esc(value)}" />'
        out = pat.sub(lambda _m: tag, out, count=1) if pat.search(out) else out.replace("</head>", f"  {tag}\n</head>", 1)

    meta("name", "description", desc)
    meta("property", "og:title", title)
    meta("property", "og:description", desc)
    meta("property", "og:url", canonical)
    if image:
        meta("property", "og:image", image)
    out = re.sub(r'<link rel="canonical" href="[^"]*" />', lambda _m: f'<link rel="canonical" href="{esc(canonical)}" />', out, count=1)
    if 'rel="canonical"' not in out:
        out = out.replace("</head>", f'  <link rel="canonical" href="{esc(canonical)}" />\n</head>', 1)
    out = out.replace("</head>", "  " + "\n  ".join(head_extra) + "\n</head>", 1)
    out = out.replace('<div id="root"></div>', f'<div id="root">{body}</div>', 1)
    return out


def _public_salons(db: Session, limit: int = 1000) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT b.slug, b.name, b.branch_name, b.address, b.updated_at, c.name_uz AS cat, c.name_ru AS cat_ru
          FROM businesses b JOIN business_categories c ON c.id = b.category_id
         WHERE {_PUBLIC_WHERE}
         ORDER BY b.rating_avg DESC, b.id
         LIMIT :n"""), {"n": limit}).mappings().all()
    return [dict(r) for r in rows]


def _home(db: Session, lang: str, plain: str, page: str) -> str:
    T = TXT[lang]
    salons = _public_salons(db, 200)
    items = "".join(
        f'<li><a href="{esc(_url(lang, "/s/" + s["slug"]))}">{esc(s["name"])}'
        f'{(" · " + esc(s["branch_name"])) if s["branch_name"] else ""}</a> — {esc(_pick(lang, s["cat"], s["cat_ru"]))}'
        f'{(", " + esc(s["address"])) if s["address"] else ""}</li>' for s in salons)
    body = (f'<main><h1>{esc(T["home_h1"])}</h1><p>{esc(T["home_desc"])}</p>'
            f'<h2>{esc(T["salons"])}</h2><ul>{items}</ul></main>')
    site = get_settings().site_url.rstrip("/")
    jsonld = [
        {"@context": "https://schema.org", "@type": "WebSite", "name": "Chronix", "url": _url(lang, "/"),
         "inLanguage": lang, "potentialAction": {"@type": "SearchAction",
                                                 "target": f"{_url(lang, '/qidiruv')}?q={{search_term_string}}",
                                                 "query-input": "required name=search_term_string"}},
        {"@context": "https://schema.org", "@type": "Organization", "name": "Chronix", "url": site,
         "logo": f"{site}/logo.svg", "telephone": "+998200035599"},
    ]
    return _render(page, lang=lang, plain=plain, title=T["home_title"], desc=T["home_desc"],
                   image=f"{site}/og-image.jpg", body=body, jsonld=jsonld)


def _salon(db: Session, lang: str, plain: str, slug: str, page: str) -> tuple[str, int]:
    T = TXT[lang]
    try:
        b = public_cache.get_or_set(("business", slug), ttl(), lambda: _business_detail(db, slug))
    except Exception:                                        # noqa: BLE001 — 404 (topilmadi)
        return _render(page, lang=lang, plain=plain, title="Chronix", desc=T["home_desc"], image=None,
                       body="", jsonld=[], noindex=True), 404
    cat = _pick(lang, b.category_name, b.category_name_ru)
    name = b.name + (f" · {b.branch_name}" if b.branch_name else "")
    services = [s for g in b.service_groups for s in g.services]
    svc_names = ", ".join(_pick(lang, s.name, s.name_ru) for s in services[:6])
    where = f", {b.address}" if b.address else ""
    rating = T["rating"].format(avg=f"{b.rating_avg:.1f}", n=b.rating_count) if b.rating_count else ""
    desc = T["salon_desc"].format(name=name, cat=cat, where=where, rating=rating, services=svc_names or "—")[:300]
    title = f"{name} — {cat} | Chronix"
    hours = {h.weekday: h for h in b.hours}
    hours_li = "".join(
        f"<li>{esc(T['days'][d - 1])}: "
        f"{esc(f'{str(hours[d].opens_at)[:5]}–{str(hours[d].closes_at)[:5]}') if d in hours else esc(T['closed'])}</li>"
        for d in range(1, 8))
    svc_li = "".join(
        f"<li>{esc(_pick(lang, s.name, s.name_ru))} — {esc(T['from'].format(p=_money(s.price)))}</li>" for s in services)
    body = (f'<main><h1>{esc(name)}</h1><p>{esc(cat)}{(" · " + esc(b.address)) if b.address else ""}</p>'
            + (f'<p>★ {b.rating_avg:.1f} · {esc(T["reviews"].format(n=b.rating_count))}</p>' if b.rating_count else "")
            + (f"<p>{esc(b.description)}</p>" if b.description else "")
            + f'<h2>{esc(T["services"])}</h2><ul>{svc_li}</ul>'
            + f'<h2>{esc(T["hours"])}</h2><ul>{hours_li}</ul>'
            + f'<p><a href="{esc(_url(lang, f"/s/{b.slug}/bron"))}">{esc(T["book"])}</a></p></main>')
    url = _url(lang, plain)
    ld: dict = {"@context": "https://schema.org", "@type": SCHEMA_TYPE.get(b.category, "HealthAndBeautyBusiness"),
                "name": name, "url": url, "inLanguage": lang,
                "address": {"@type": "PostalAddress", "streetAddress": b.address or "", "addressLocality": b.city or T["city"],
                            "addressCountry": "UZ"}}
    if b.photos:
        ld["image"] = b.photos[:5]
    if b.phone:
        ld["telephone"] = b.phone
    if b.description:
        ld["description"] = b.description[:500]
    if b.lat is not None and b.lng is not None:
        ld["geo"] = {"@type": "GeoCoordinates", "latitude": b.lat, "longitude": b.lng}
    if b.rating_count:
        ld["aggregateRating"] = {"@type": "AggregateRating", "ratingValue": round(b.rating_avg, 1),
                                 "reviewCount": b.rating_count, "bestRating": 5, "worstRating": 1}
    days_en = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    if hours:
        ld["openingHoursSpecification"] = [
            {"@type": "OpeningHoursSpecification", "dayOfWeek": days_en[d - 1],
             "opens": str(h.opens_at)[:5], "closes": str(h.closes_at)[:5]} for d, h in sorted(hours.items())]
    if services:
        prices = [s.price for s in services]
        ld["priceRange"] = f"{_money(min(prices))}–{_money(max(prices))} UZS"
        ld["hasOfferCatalog"] = {"@type": "OfferCatalog", "name": T["services"], "itemListElement": [
            {"@type": "Offer", "price": s.price, "priceCurrency": "UZS",
             "itemOffered": {"@type": "Service", "name": _pick(lang, s.name, s.name_ru)}} for s in services[:30]]}
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Chronix", "item": _url(lang, "/")},
        {"@type": "ListItem", "position": 2, "name": cat, "item": f"{_url(lang, '/qidiruv')}?category={b.category}"},
        {"@type": "ListItem", "position": 3, "name": name, "item": url}]}
    return _render(page, lang=lang, plain=plain, title=title, desc=desc, image=(b.photos[0] if b.photos else None),
                   body=body, jsonld=[ld, crumbs]), 200


@router.get("/render", include_in_schema=False)
def render(path: str = Query("/", max_length=300), db: Session = Depends(get_public_db)):
    page = _index_html()
    lang, plain = _split(path.split("?")[0])
    plain = plain.rstrip("/") or "/"

    def build() -> tuple[str, int]:
        T = TXT[lang]
        site = get_settings().site_url.rstrip("/")
        if plain == "/":
            return _home(db, lang, plain, page), 200
        if plain == "/qidiruv":
            return _render(page, lang=lang, plain=plain, title=T["search_title"], desc=T["search_desc"],
                           image=f"{site}/og-image.jpg", body=f"<main><h1>{esc(T['search_title'])}</h1></main>", jsonld=[]), 200
        if plain == "/biznes":
            return _render(page, lang=lang, plain=plain, title=T["biz_title"], desc=T["biz_desc"],
                           image=f"{site}/og-image.jpg", body=f"<main><h1>{esc(T['biz_h1'])}</h1><p>{esc(T['biz_desc'])}</p></main>",
                           jsonld=[]), 200
        m = re.fullmatch(r"/s/([a-z0-9-]{1,140})", plain)
        if m:
            return _salon(db, lang, plain, m.group(1), page)
        # Bron oynasi va boshqa ilova sahifalari — indekslanmaydi, SPA o'zi chizadi
        return _render(page, lang=lang, plain=plain, title=TXT[lang]["home_title"], desc=T["home_desc"], image=None,
                       body="", jsonld=[], noindex=True), 200

    body, status = public_cache.get_or_set(("seo", path.split("?")[0], _INDEX["mtime"]), ttl(10), build)
    return Response(body, status_code=status, media_type="text/html; charset=utf-8",
                    headers={"Cache-Control": "no-cache", "Content-Language": lang})


@router.get("/sitemap.xml", include_in_schema=False)
def sitemap(db: Session = Depends(get_public_db)):
    def build() -> str:
        pages: list[tuple[str, str | None, str, str]] = [("/", None, "daily", "1.0"), ("/qidiruv", None, "daily", "0.8"),
                                                         ("/biznes", None, "weekly", "0.7")]
        for s in _public_salons(db):
            updated = s["updated_at"].astimezone(timezone.utc).date().isoformat() if s["updated_at"] else None
            pages.append((f"/s/{s['slug']}", updated, "daily", "0.9"))
        parts = ['<?xml version="1.0" encoding="UTF-8"?>',
                 '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
        for plain, lastmod, freq, prio in pages:
            for lang in ("uz", "ru"):
                parts.append("  <url>")
                parts.append(f"    <loc>{esc(_url(lang, plain))}</loc>")
                for alt in ("uz", "ru"):
                    parts.append(f'    <xhtml:link rel="alternate" hreflang="{alt}" href="{esc(_url(alt, plain))}" />')
                parts.append(f'    <xhtml:link rel="alternate" hreflang="x-default" href="{esc(_url("uz", plain))}" />')
                if lastmod:
                    parts.append(f"    <lastmod>{lastmod}</lastmod>")
                parts.append(f"    <changefreq>{freq}</changefreq>")
                parts.append(f"    <priority>{prio}</priority>")
                parts.append("  </url>")
        parts.append("</urlset>")
        return "\n".join(parts) + "\n"

    xml = public_cache.get_or_set(("sitemap",), ttl(10), build)
    return Response(xml, media_type="application/xml", headers={"Cache-Control": "public, max-age=600"})
