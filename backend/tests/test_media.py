"""Salon rasmlarini yuklash: rasm qayta yoziladi, EXIF o'chadi, huquqlar, fayl tozalanishi."""
import io
from pathlib import Path

import pytest
from PIL import Image

from app.core.config import get_settings
from app.services import media
from tests.conftest import add_member, auth_header, create_business


def png(size=(1200, 900), color=(21, 101, 245)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def jpeg_with_gps() -> bytes:
    image = Image.new("RGB", (300, 200), (200, 50, 50))
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (41.0, 18.0, 40.0)}           # GPSInfo
    exif[0x010F] = "SecretPhone"                              # Make
    buf = io.BytesIO()
    image.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def disk_path(url: str) -> Path:
    base = get_settings().media_base_url.rstrip("/") + "/"
    return Path(get_settings().media_dir).resolve() / url[len(base):]


@pytest.fixture()
def biz(client, superadmin):
    return create_business(client, superadmin)


def upload(client, biz, data, name="rasm.png", headers=None, content_type="image/png"):
    return client.post(f"/api/v1/businesses/{biz['id']}/photos/upload", headers=headers or auth_header(biz["owner"]),
                       files={"file": (name, data, content_type)})


def test_upload_resizes_and_strips_metadata(client, biz):
    r = upload(client, biz, png((3000, 1500)))
    assert r.status_code == 201, r.text
    url = r.json()["url"]
    assert url.startswith("https://") and url.endswith(".webp")
    with Image.open(disk_path(url)) as saved:
        assert saved.format == "WEBP" and saved.size == (1200, 600)        # proporsiya saqlanadi

    r = upload(client, biz, jpeg_with_gps(), "gps.jpg", content_type="image/jpeg")
    assert r.status_code == 201, r.text
    with Image.open(disk_path(r.json()["url"])) as saved:
        exif = saved.getexif()
        assert 0x8825 not in exif and 0x010F not in exif

    photos = client.get(f"/api/v1/businesses/{biz['id']}/photos", headers=auth_header(biz["owner"])).json()
    assert [p["sort_order"] for p in photos] == [0, 1]


def test_photo_visible_in_catalog(client, biz):
    upload(client, biz, png())
    client.post(f"/api/v1/businesses/{biz['id']}/services", headers=auth_header(biz["owner"]),
                json={"name": "Soch olish", "duration_min": 30, "price": 50000})
    card = client.get(f"/api/v1/catalog/businesses/{biz['slug']}").json()
    assert len(card["photos"]) == 1


@pytest.mark.parametrize("data, name", [
    (b"<?php echo 1; ?>", "shell.php"),
    (b"GIF89a" + b"\x00" * 50, "fake.jpg"),
    (b"\x89PNG\r\n\x1a\n" + b"\x00" * 40, "broken.png"),
])
def test_rejects_non_images(client, biz, data, name):
    r = upload(client, biz, data, name)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "bad_image"
    assert client.get(f"/api/v1/businesses/{biz['id']}/photos", headers=auth_header(biz["owner"])).json() == []


def test_rejects_too_large(client, biz):
    r = upload(client, biz, b"\xff\xd8" + b"0" * (media.MAX_BYTES + 10), "katta.jpg")
    assert r.status_code == 422


def test_permissions(client, superadmin, biz):
    staff = add_member(client, biz, "staff")
    assert upload(client, biz, png(), headers=auth_header(staff["tokens"])).status_code == 403
    other = create_business(client, superadmin)
    assert upload(client, biz, png(), headers=auth_header(other["owner"])).status_code == 403
    assert client.post(f"/api/v1/businesses/{biz['id']}/photos/upload", files={"file": ("a.png", png())}).status_code == 401


def test_delete_removes_file(client, biz):
    r = upload(client, biz, png())
    photo, path = r.json(), disk_path(r.json()["url"])
    assert path.is_file()
    h = auth_header(biz["owner"])
    assert client.delete(f"/api/v1/businesses/{biz['id']}/photos/{photo['id']}", headers=h).status_code == 204
    assert not path.exists()


def test_limit_does_not_leave_orphan_files(client, biz):
    for _ in range(20):
        assert upload(client, biz, png((50, 50))).status_code == 201
    folder = Path(get_settings().media_dir).resolve() / "business" / str(biz["id"])
    before = len(list(folder.iterdir()))
    r = upload(client, biz, png((50, 50)))
    assert r.status_code == 422
    assert len(list(folder.iterdir())) == before


def photo(size, fmt="JPEG", quality=95, mode="RGB") -> bytes:
    """Telefon suratiga o'xshash: silliq o'tishlar + mayda shovqin (bir xil rangli rasm siqishni ko'rsatmaydi)."""
    w, h = size
    base = Image.radial_gradient("L").resize((w, h)).convert("RGB")
    noise = Image.effect_noise((w, h), 28).convert("RGB")
    image = Image.blend(base, noise, 0.35)
    if mode == "RGBA":
        image.putalpha(Image.linear_gradient("L").resize((w, h)))
    buf = io.BytesIO()
    image.save(buf, fmt, **({"quality": quality} if fmt != "PNG" else {}))
    return buf.getvalue()


def test_big_phone_photo_is_compressed(client, biz):
    """12 MP surat (bir necha MB) 1200 px kenglikdagi WebP bo'lib, kamida 10 barobar kichrayadi."""
    original = photo((4000, 3000))
    assert len(original) > 2 * 1024 * 1024
    r = upload(client, biz, original, "telefon.jpg", content_type="image/jpeg")
    assert r.status_code == 201, r.text
    path = disk_path(r.json()["url"])
    with Image.open(path) as saved:
        assert saved.format == "WEBP" and saved.size == (1200, 900)
    assert path.stat().st_size < len(original) / 10 and path.stat().st_size < 400 * 1024


def test_small_image_is_not_upscaled_and_alpha_survives(client, biz):
    r = upload(client, biz, photo((640, 480), "PNG", mode="RGBA"))
    assert r.status_code == 201, r.text
    with Image.open(disk_path(r.json()["url"])) as saved:
        assert saved.size == (640, 480) and saved.mode == "RGBA"


def test_portrait_orientation_from_exif_is_applied(client, biz):
    image = Image.new("RGB", (800, 400), (10, 120, 200))
    exif = Image.Exif()
    exif[0x0112] = 6                                          # telefon tik ushlab olingan: 90 gradusga burilgan
    buf = io.BytesIO()
    image.save(buf, "JPEG", exif=exif)
    r = upload(client, biz, buf.getvalue(), "tik.jpg", content_type="image/jpeg")
    with Image.open(disk_path(r.json()["url"])) as saved:
        assert saved.size == (400, 800) and 0x0112 not in saved.getexif()


def test_huge_png_is_rejected_before_decoding():
    """25 MP dan katta PNG ochilmasdan rad etiladi: to'liq ochilsa, xotirani to'ldiradi."""
    buf = io.BytesIO()
    Image.new("L", (6000, 5000)).save(buf, "PNG")             # 30 MP, fayl o'zi kichik
    with pytest.raises(media.BadImage):
        media.process_image(buf.getvalue())


def test_jpeg_is_decoded_at_reduced_size():
    """Xotira nazorati: 12 MP JPEG to'liq (4000x3000) emas, dekoderning o'zida kichraytirib ochiladi."""
    with Image.open(io.BytesIO(photo((4000, 3000)))) as image:
        image.draft("RGB", media.draft_size(image.size))
        assert image.size == (2000, 1500)                     # xotira 4 barobar kam
    assert media.draft_size((8000, 6000)) == (1200, 900)      # 48 MP: dekoder 1/4 da ochadi
    assert media.draft_size((4000, 3000), rotated=True) == (1600, 1200)   # burilgach 1200x1600 bo'ladi
    assert media.draft_size((800, 600)) == (800, 600)         # kichik rasm o'z holicha


def test_app_info_public(client):
    r = client.get("/api/v1/catalog/app-info")
    assert r.status_code == 200 and set(r.json()) == {"support_phone", "support_telegram", "yandex_maps_key", "yandex_maps_panel_key"}
