"""Anketalar va mijoz/bemor kartalari (058_forms.sql)."""
import io

import pytest
from PIL import Image

from tests.conftest import add_member, auth_header, create_business, new_phone
from tests.test_reception_mode import url


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking",))


def png(color="red", size=(60, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def new_client(client, biz, name="Bemor Anketa"):
    r = client.post(url(biz, "clients"), headers=auth_header(biz["owner"]), json={"full_name": name, "phone": new_phone()})
    assert r.status_code == 201, r.text
    return r.json()


TEMPLATE = {"title": "Stomatologiya kartasi", "require_signature": True, "fields": [
    {"label": "Shikoyat", "type": "textarea", "required": True},
    {"label": "Allergiya bormi?", "type": "boolean", "required": True, "alert_values": ["true"], "alert_label": "Allergiya"},
    {"label": "Kasalliklar", "type": "checkbox", "options": ["Diabet", "Yurak", "Yo'q"], "alert_values": ["Diabet", "Yurak"],
     "alert_label": "Surunkali kasallik"},
    {"label": "Og'riq darajasi", "type": "number"},
    {"label": "Rentgen", "type": "file"},
]}


def test_template_crud_presets_and_permissions(client, biz):
    owner = auth_header(biz["owner"])
    r = client.post(url(biz, "forms"), headers=owner, json=TEMPLATE)
    assert r.status_code == 201, r.text
    t = r.json()
    assert [f["type"] for f in t["fields"]] == ["textarea", "boolean", "checkbox", "number", "file"]
    assert t["fields"][2]["alert_values"] == ["Diabet", "Yurak"]
    bad = {**TEMPLATE, "fields": [{"label": "Tanlov", "type": "radio", "options": []}]}
    assert client.post(url(biz, "forms"), headers=owner, json=bad).status_code == 422

    p = client.post(url(biz, "forms/from-preset?preset=dental"), headers=owner)
    assert p.status_code == 201 and p.json()["title"] == "Stomatologiya bemor kartasi"
    assert any(f["alert_label"] == "Qandli diabet" for f in p.json()["fields"])
    assert {x["key"] for x in client.get(url(biz, "forms/presets"), headers=owner).json()} == {"dental", "cosmetology", "spa"}

    upd = client.put(url(biz, f"forms/{t['id']}"), headers=owner, json={**TEMPLATE, "title": "Yangi nom", "fields": TEMPLATE["fields"][:2]})
    assert upd.status_code == 200 and upd.json()["title"] == "Yangi nom" and len(upd.json()["fields"]) == 2

    staff = add_member(client, biz, "staff")
    assert client.post(url(biz, "forms"), headers=auth_header(staff["tokens"]), json=TEMPLATE).status_code == 403
    rec = add_member(client, biz, "receptionist")
    assert client.get(url(biz, "forms"), headers=auth_header(rec["tokens"])).status_code == 200          # to'ldirish uchun o'qiydi
    assert client.post(url(biz, "forms"), headers=auth_header(rec["tokens"]), json=TEMPLATE).status_code == 403


def test_fill_validate_alerts_signature_and_timeline(client, biz):
    owner = auth_header(biz["owner"])
    t = client.post(url(biz, "forms"), headers=owner, json=TEMPLATE).json()
    f = {x["label"]: str(x["id"]) for x in t["fields"]}
    c = new_client(client, biz)
    base = url(biz, f"clients/{c['id']}")

    # Majburiy savol va noto'g'ri qiymatlar
    r = client.post(f"{base}/forms", headers=owner, json={"template_id": t["id"], "answers": {f["Allergiya bormi?"]: True}})
    assert r.status_code == 422 and "Shikoyat" in r.json()["detail"]["message"]
    r = client.post(f"{base}/forms", headers=owner, json={"template_id": t["id"], "answers": {
        f["Shikoyat"]: "Tish og'riydi", f["Allergiya bormi?"]: True, f["Kasalliklar"]: ["Saraton"]}})
    assert r.status_code == 422

    up = client.post(f"{base}/files", headers=owner, files={"file": ("x.png", png(), "image/png")}, data={"caption": "Rentgen"})
    assert up.status_code == 201, up.text
    fid = up.json()["id"]
    r = client.post(f"{base}/forms", headers=owner, json={"template_id": t["id"], "answers": {
        f["Shikoyat"]: "  Tish og'riydi ", f["Allergiya bormi?"]: True, f["Kasalliklar"]: ["Diabet"],
        f["Og'riq darajasi"]: 7, f["Rentgen"]: [fid]}})
    assert r.status_code == 201, r.text
    s = r.json()
    assert sorted(s["alerts"]) == ["Allergiya", "Surunkali kasallik"]
    assert s["answers"][f["Shikoyat"]] == "Tish og'riydi" and s["answers"][f["Allergiya bormi?"]] == "true"

    # Mijoz kartasida ogohlantirish
    row = next(x for x in client.get(url(biz, "clients"), headers=owner).json() if x["id"] == c["id"])
    assert sorted(row["medical_alerts"]) == ["Allergiya", "Surunkali kasallik"]

    # Imzo bir marta; javob o'zgarmaydi
    sg = client.post(f"{base}/forms/{s['id']}/signature", headers=owner, files={"file": ("s.png", png("black"), "image/png")})
    assert sg.status_code == 200 and sg.json()["signed_at"]
    again = client.post(f"{base}/forms/{s['id']}/signature", headers=owner, files={"file": ("s.png", png(), "image/png")})
    assert again.status_code == 409

    img = client.get(f"{base}/files/{fid}", headers=owner)
    assert img.status_code == 200 and img.headers["content-type"] == "image/webp" and "no-store" in img.headers["cache-control"]
    assert client.get(f"{base}/files/{fid}").status_code == 401

    # Yangi anketa (xavfsiz javoblar) — eski ogohlantirish shu shablon uchun yangilanadi
    client.post(f"{base}/forms", headers=owner, json={"template_id": t["id"], "answers": {
        f["Shikoyat"]: "Nazorat", f["Allergiya bormi?"]: False, f["Kasalliklar"]: ["Yo'q"]}})
    row = next(x for x in client.get(url(biz, "clients"), headers=owner).json() if x["id"] == c["id"])
    assert row["medical_alerts"] == []

    tl = client.get(f"{base}/timeline", headers=owner).json()
    assert {x["kind"] for x in tl} >= {"form", "file"}
    assert len(client.get(f"{base}/forms", headers=owner).json()) == 2


def test_alerts_reach_calendar_and_master(client, biz):
    from tests.test_schedule import day_from_today, new_master, new_service
    from tests.test_appointments import at
    owner = auth_header(biz["owner"])
    t = client.post(url(biz, "forms"), headers=owner, json=TEMPLATE).json()
    f = {x["label"]: str(x["id"]) for x in t["fields"]}
    service = new_service(client, biz, duration=60)
    master = new_master(client, biz, service)
    day = day_from_today(biz, 1)
    r = client.post(url(biz, "reception/appointments"), headers=owner, json={
        "member_id": master["member"]["id"], "service_id": service["id"], "starts_at": at(day, "10:00"),
        "client_name": "Ogohlantirish Mijoz", "client_phone": new_phone()})
    assert r.status_code == 201, r.text
    a = r.json()
    client_id = next(x["id"] for x in client.get(url(biz, "clients"), headers=owner).json() if x["full_name"] == "Ogohlantirish Mijoz")
    client.post(url(biz, f"clients/{client_id}/forms"), headers=owner, json={"template_id": t["id"], "answers": {
        f["Shikoyat"]: "x", f["Allergiya bormi?"]: True}})
    mine = client.get(url(biz, f"appointments?date={day}"), headers=auth_header(master["tokens"])).json()
    assert next(x for x in mine if x["id"] == a["id"])["client_medical"] == ["Allergiya"]


def test_isolation_between_businesses(client, biz, superadmin):
    owner = auth_header(biz["owner"])
    t = client.post(url(biz, "forms"), headers=owner, json=TEMPLATE).json()
    c = new_client(client, biz)
    fid = client.post(url(biz, f"clients/{c['id']}/files"), headers=owner,
                      files={"file": ("x.png", png(), "image/png")}).json()["id"]
    other = create_business(client, superadmin, modules=("booking",))
    o = auth_header(other["owner"])
    assert client.get(url(other, f"clients/{c['id']}/files/{fid}"), headers=o).status_code == 404
    assert client.get(url(biz, f"clients/{c['id']}/files/{fid}"), headers=o).status_code == 403
    oc = new_client(client, other)
    r = client.post(url(other, f"clients/{oc['id']}/forms"), headers=o, json={"template_id": t["id"], "answers": {}})
    assert r.status_code == 404                                                # boshqa muassasa shabloni
    staff = add_member(client, biz, "staff")
    assert client.get(url(biz, f"clients/{c['id']}/forms"), headers=auth_header(staff["tokens"])).status_code == 403
