"""Yuklangan rasmlar. Fayl hech qachon asl holida saqlanmaydi: Pillow bilan ochiladi, kichraytiriladi va
JPEG qilib qayta yoziladi. Shunda EXIF (telefon joylashuvi) o'chadi, rasm niqobidagi boshqa fayl o'tmaydi."""
import io
import uuid
import warnings
from pathlib import Path

from PIL import Image, ImageOps

from app.core.config import get_settings

MAX_BYTES = 8 * 1024 * 1024
MAX_SIDE = 1600
MAX_PIXELS = 40_000_000           # siqilgan "bomba" rasmlar xotirani to'ldirmasin
ALLOWED = {"JPEG", "PNG", "WEBP"}


class BadImage(Exception):
    pass


def _root() -> Path:
    return Path(get_settings().media_dir).resolve()


def save_business_photo(business_id: int, data: bytes) -> str:
    """Rasmni tekshirib saqlaydi va ochiq URL qaytaradi."""
    if len(data) > MAX_BYTES:
        raise BadImage("Rasm 8 MB dan katta bo'lmasin")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            probe = Image.open(io.BytesIO(data))
            if probe.format not in ALLOWED:
                raise BadImage("Faqat JPG, PNG yoki WEBP rasm")
            probe.verify()
            image = Image.open(io.BytesIO(data))
            image.load()
    except BadImage:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise BadImage("Rasm o'lchami juda katta")
    except Exception:
        raise BadImage("Fayl rasm emas yoki buzilgan")

    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))

    name = f"{uuid.uuid4().hex}.jpg"
    folder = _root() / "business" / str(business_id)
    folder.mkdir(parents=True, exist_ok=True)
    image.save(folder / name, "JPEG", quality=85, optimize=True)
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
