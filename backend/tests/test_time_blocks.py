"""Kalendarda vaqtni bloklash va blok turlari (049_time_blocks.sql)."""
import pytest

from tests.conftest import add_member, auth_header, create_business
from tests.test_appointments import at
from tests.test_reception_mode import book, ctx, url  # noqa: F401  (ctx — fixture)


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin, modules=("booking", "finance"))


def types(client, biz, tokens):
    r = client.get(url(biz, "block-types"), headers=auth_header(tokens))
    assert r.status_code == 200, r.text
    return {t["name"]: t for t in r.json()}


def block(client, biz, tokens, member, day, start, end, type_id=None, note=None):
    return client.post(url(biz, "time-blocks"), headers=auth_header(tokens), json={
        "member_id": member["member"]["id"], "type_id": type_id, "starts_at": at(day, start),
        "ends_at": at(day, end), "note": note})


def test_default_types_and_master_can_read_them(client, biz, ctx):
    t = types(client, biz, ctx["a"]["tokens"])
    assert t["Tushlik"]["duration_min"] == 60 and set(t) >= {"Tanaffus", "Tozalash", "Majlis", "Shaxsiy ish"}


def test_reception_blocks_lunch_and_booking_is_refused(client, biz, ctx):
    rec = add_member(client, biz, "receptionist")
    lunch = types(client, biz, rec["tokens"])["Tushlik"]
    r = block(client, biz, rec["tokens"], ctx["a"], ctx["day"], "10:00", "11:00", type_id=lunch["id"])
    assert r.status_code == 201, r.text
    assert r.json()["title"] == "Tushlik" and r.json()["is_block"] is True

    # Blok ichidagi vaqtga bron — yo'q; blokdan keyin — bor
    assert book(client, biz, ctx, rec["tokens"], ctx["a"], "10:30").status_code == 409
    assert book(client, biz, ctx, rec["tokens"], ctx["a"], "11:00").status_code == 201
    # Boshqa usta bloklanmagan
    assert book(client, biz, ctx, rec["tokens"], ctx["b"], "10:00").status_code == 201

    cal = client.get(url(biz, f"calendar?start={ctx['day']}"), headers=auth_header(rec["tokens"])).json()
    assert [(x["member_id"], x["title"]) for x in cal["blocks"]] == [(ctx["a"]["member"]["id"], "Tushlik")]


def test_block_over_booking_is_refused(client, biz, ctx):
    assert book(client, biz, ctx, biz["owner"], ctx["a"], "10:00").status_code == 201
    r = block(client, biz, biz["owner"], ctx["a"], ctx["day"], "10:30", "11:00", note="Majlis")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "time_conflict"


def test_master_blocks_only_own_time(client, biz, ctx):
    a, b = ctx["a"], ctx["b"]
    r = block(client, biz, a["tokens"], a, ctx["day"], "09:00", "09:30", note="Shifokorga")
    assert r.status_code == 201, r.text
    own_id = r.json()["id"]
    assert block(client, biz, a["tokens"], b, ctx["day"], "09:00", "09:30", note="x").status_code == 403
    other = block(client, biz, biz["owner"], b, ctx["day"], "09:00", "09:30", note="Majlis").json()
    assert client.delete(url(biz, f"time-blocks/{other['id']}"), headers=auth_header(a["tokens"])).status_code == 404
    assert client.delete(url(biz, f"time-blocks/{own_id}"), headers=auth_header(a["tokens"])).status_code == 204


def test_block_needs_type_or_note_and_max_12_hours(client, biz, ctx):
    assert block(client, biz, biz["owner"], ctx["a"], ctx["day"], "09:00", "09:30").status_code == 422
    r = client.post(url(biz, "time-blocks"), headers=auth_header(biz["owner"]), json={
        "member_id": ctx["a"]["member"]["id"], "note": "Uzun", "starts_at": at(ctx["day"], "06:00"),
        "ends_at": f"{ctx['day']}T23:00:00+05:00"})
    assert r.status_code == 422


def test_blocks_are_not_listed_as_vacations(client, biz, ctx):
    a = ctx["a"]
    block(client, biz, biz["owner"], a, ctx["day"], "09:00", "09:30", note="Tozalash")
    r = client.get(url(biz, f"members/{a['member']['id']}/time-off"), headers=auth_header(biz["owner"]))
    assert r.status_code == 200 and r.json() == []


def test_deleting_type_keeps_block_with_name(client, biz, ctx):
    owner = biz["owner"]
    meeting = types(client, biz, owner)["Majlis"]
    created = block(client, biz, owner, ctx["a"], ctx["day"], "09:00", "10:00", type_id=meeting["id"]).json()
    assert client.delete(url(biz, f"block-types/{meeting['id']}"), headers=auth_header(owner)).status_code == 204
    cal = client.get(url(biz, f"calendar?start={ctx['day']}"), headers=auth_header(owner)).json()
    kept = next(x for x in cal["blocks"] if x["id"] == created["id"])
    assert kept["title"] == "Majlis" and kept["type_id"] is None
    assert book(client, biz, ctx, owner, ctx["a"], "09:00").status_code == 409   # vaqt hamon band


def test_only_owner_edits_types(client, biz, ctx):
    rec = add_member(client, biz, "receptionist")
    assert client.post(url(biz, "block-types"), headers=auth_header(rec["tokens"]),
                       json={"name": "Dars"}).status_code == 403
    r = client.post(url(biz, "block-types"), headers=auth_header(biz["owner"]),
                    json={"name": " O'quv   darsi ", "duration_min": 90})
    assert r.status_code == 201 and r.json()["name"] == "O'quv darsi"
    r = client.put(url(biz, f"block-types/{r.json()['id']}"), headers=auth_header(biz["owner"]),
                   json={"name": "Dars", "duration_min": 45, "sort_order": 1})
    assert r.status_code == 200 and r.json()["duration_min"] == 45


def test_other_business_cannot_use_foreign_type_or_member(client, superadmin, biz, ctx):
    other = create_business(client, superadmin)
    foreign_type = types(client, biz, biz["owner"])["Tushlik"]["id"]
    r = client.post(f"/api/v1/businesses/{other['id']}/time-blocks", headers=auth_header(other["owner"]), json={
        "member_id": ctx["a"]["member"]["id"], "type_id": foreign_type,
        "starts_at": at(ctx["day"], "09:00"), "ends_at": at(ctx["day"], "10:00")})
    assert r.status_code == 404                     # tur boshqa muassasaniki
    r = client.post(f"/api/v1/businesses/{other['id']}/time-blocks", headers=auth_header(other["owner"]), json={
        "member_id": ctx["a"]["member"]["id"], "note": "x",
        "starts_at": at(ctx["day"], "09:00"), "ends_at": at(ctx["day"], "10:00")})
    assert r.status_code in (403, 422)              # boshqa muassasa xodimi — kompozit FK / RLS
