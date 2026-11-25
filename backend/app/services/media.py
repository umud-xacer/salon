"""Yuklangan rasmlar. Fayl hech qachon asl holida saqlanmaydi: Pillow bilan ochiladi, kichraytiriladi va
WebP qilib qayta yoziladi. Shunda:
  - 3–10 MB lik telefon surati odatda 100–350 KB bo'lib qoladi (disk to'lmaydi, sahifa tez ochiladi);
  - EXIF (telefon joylashuvi) o'chadi, rasm niqobidagi boshqa fayl o'tmaydi.

Xotira (server 1 GB): JPEG ochilishidan oldin dekoderning o'zida kichraytiriladi (draft), bir vaqtda faqat bitta
rasm qayta ishlanadi (har API jarayonida), piksellar soni cheklangan, ish tugagach rasm darhol yopiladi.
`process_image()` umumiy — mahsulot, xizmat yoki avatar rasmlari qo'shilsa ham shu ishlatiladi.
"""
import io
import threading
import uuid
import warnings
from pathlib import Path

from PIL import Image, ImageOps

from app.core.config import get_settings

MAX_BYTES = 15 * 1024 * 1024
MAX_WIDTH = 1200                  # bundan keng rasm proporsiyasi saqlanib kichrayadi; kichigi kattalashtirilmaydi
MAX_HEIGHT = 2000                 # juda uzun (skrinshot) rasmlar uchun
QUALITY = 80
MAX_PIXELS = 50_000_000           # siqilgan "bomba" rasmlar xotirani to'ldirmasin (50 MP — zamonaviy telefon kamerasi)
MAX_PIXELS_LOSSLESS = 25_000_000  # PNG/WebP dekoderda kichraytirilmaydi: to'liq ochiladi (25 MP ~ 75 MB xotira)
ALLOWED = {"JPEG", "PNG", "WEBP"}
EXTENSION = ".webp"
THUMB_SUFFIX = "_t"               # xarita belgisi uchun kvadrat kichik nusxa: <nom>_t.webp (mobil xarita, sql catalog)
THUMB_SIZE = 128

# Bir vaqtda bitta rasm: ikkita katta rasm parallel ochilsa, 1 GB serverda xotira yetmay qolishi mumkin
_one_at_a_time = threading.Lock()


class BadImage(Exception):
    pass


def _root() -> Path:
    return Path(get_settings().media_dir).resolve()


def draft_size(size: tuple[int, int], rotated: bool = False, max_width: int = MAX_WIDTH,
               max_height: int = MAX_HEIGHT) -> tuple[int, int]:
    """JPEG dekoderidan so'raladigan eng kichik o'lcham — yakuniy rasm o'lchami (dekoder undan kichik bermaydi,
    1/2, 1/4, 1/8 dan mosini tanlaydi). rotated: EXIF bo'yicha rasm 90 gradusga buriladi (tik olingan surat)."""
    w, h = size
    scale = min(max_width / h, max_height / w) if rotated else min(max_width / w, max_height / h)
    scale = min(scale, 1.0)
    return max(1, round(w * scale)), max(1, round(h * scale))


def process_image(data: bytes, *, max_width: int = MAX_WIDTH, max_height: int = MAX_HEIGHT,
                  quality: int = QUALITY) -> bytes:
    """Rasmni tekshiradi, kichraytiradi va WebP baytlarini qaytaradi. Rasm emas/buzilgan bo'lsa — BadImage."""
    if len(data) > MAX_BYTES:
        raise BadImage(f"Rasm {MAX_BYTES // (1024 * 1024)} MB dan katta bo'lmasin")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with _one_at_a_time:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as probe:
                    if probe.format not in ALLOWED:
                        raise BadImage("Faqat JPG, PNG yoki WEBP rasm")
                    if probe.format != "JPEG" and probe.width * probe.height > MAX_PIXELS_LOSSLESS:
                        raise BadImage("Rasm o'lchami juda katta")
                    probe.verify()                       # buzilgan yoki soxta fayl shu yerda ushlanadi
                image = Image.open(io.BytesIO(data))     # verify()dan keyin fayl qayta ochilishi shart
                try:
                    # JPEG: dekoder rasmni darhol 1/2, 1/4 yoki 1/8 o'lchamda ochadi — 48 MP surat uchun
                    # xotira 140 MB o'rniga ~9–35 MB.
                    rotated = image.format == "JPEG" and image.getexif().get(0x0112) in (5, 6, 7, 8)
                    image.draft("RGB", draft_size(image.size, rotated, max_width, max_height))
                    image.load()
                    fixed = ImageOps.exif_transpose(image)          # telefon suratining yo'nalishi
                    has_alpha = fixed.mode in ("RGBA", "LA") or "transparency" in fixed.info
                    result = fixed.convert("RGBA" if has_alpha else "RGB")
                    result.thumbnail((max_width, max_height), Image.LANCZOS)   # faqat kichraytiradi
                    out = io.BytesIO()
                    # exif va icc berilmaydi: joylashuv va qurilma ma'lumoti faylga o'tmaydi
                    result.save(out, "WEBP", quality=quality, method=4)
                    return out.getvalue()
                finally:
                    image.close()
        except BadImage:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise BadImage("Rasm o'lchami juda katta")
        except Exception:
            raise BadImage("Fayl rasm emas yoki buzilgan")


def make_thumb(webp: bytes) -> bytes:
    """Saqlangan (allaqachon tekshirilgan, kichraytirilgan) rasmdan markazdan kesilgan 128x128 WebP."""
    with _one_at_a_time, Image.open(io.BytesIO(webp)) as image:
        image.load()
        has_alpha = image.mode in ("RGBA", "LA")
        square = ImageOps.fit(image.convert("RGBA" if has_alpha else "RGB"), (THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
        out = io.BytesIO()
        square.save(out, "WEBP", quality=72, method=4)
        return out.getvalue()


def thumb_path(path: Path) -> Path:
    return path.with_name(path.stem + THUMB_SUFFIX + path.suffix)


def save_business_photo(business_id: int, data: bytes) -> str:
    """Rasmni tekshirib saqlaydi (va xarita uchun kichik nusxasini) va ochiq URL qaytaradi."""
    optimized = process_image(data)
    name = f"{uuid.uuid4().hex}{EXTENSION}"
    folder = _root() / "business" / str(business_id)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(optimized)
    try:
        thumb_path(folder / name).write_bytes(make_thumb(optimized))
    except Exception:          # kichik nusxa bo'lmasa xarita belgisi yo'nalish ikonkasiga tushadi
        pass
    return f"{get_settings().media_base_url.rstrip('/')}/business/{business_id}/{name}"


def delete_business_folder(business_id: int) -> None:
    """Muassasa o'chirilganda uning barcha rasmlari."""
    import shutil

    folder = (_root() / "business" / str(int(business_id))).resolve()
    if folder.parent == (_root() / "business").resolve() and folder.is_dir():
        shutil.rmtree(folder, ignore_errors=True)


def delete_by_url(url: str) -> None:
    """Faqat o'zimiz saqlagan fayl o'chiriladi, yo'l papkadan tashqariga chiqa olmaydi."""
    base = get_settings().media_base_url.rstrip("/") + "/"
    if not url.startswith(base):
        return
    path = (_root() / url[len(base):]).resolve()
    if _root() in path.parents and path.is_file():
        path.unlink()
        thumb_path(path).unlink(missing_ok=True)


def backfill_thumbs() -> tuple[int, int]:
    """Kichik nusxasi yo'q eski rasmlar uchun yaratadi (bir martalik: `python -m app.cli make-thumbs`)."""
    made = failed = 0
    base = _root() / "business"
    if not base.is_dir():
        return 0, 0
    for path in sorted(base.glob(f"*/*{EXTENSION}")):
        if path.stem.endswith(THUMB_SUFFIX) or thumb_path(path).exists():
            continue
        try:
            thumb_path(path).write_bytes(make_thumb(path.read_bytes()))
            made += 1
        except Exception:
            failed += 1
    return made, failed
