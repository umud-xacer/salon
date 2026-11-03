"""Kichik maxfiy matnlarni (rahbar bergan vaqtinchalik parol) shifrlash.

AES-256-GCM. Kalit JWT sirridan HKDF bilan alohida maqsad uchun chiqariladi: bazada kalit yo'q,
baza o'g'irlansa ham matn ochilmaydi. Har bir shifr qaysi xodimga tegishli ekaniga bog'langan (AAD) —
bir xodimning shifrini boshqasiga ko'chirib bo'lmaydi.
"""
import base64
import os
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings

_VERSION = "v1"


@lru_cache
def _aead() -> AESGCM:
    secret = get_settings().jwt_secret.get_secret_value().encode()
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"chronix", info=b"issued-password/v1").derive(secret)
    return AESGCM(key)


def seal(plain: str, member_id: int) -> str:
    nonce = os.urandom(12)
    ct = _aead().encrypt(nonce, plain.encode(), f"member:{member_id}".encode())
    return f"{_VERSION}.{base64.urlsafe_b64encode(nonce + ct).decode()}"


def open_sealed(token: str, member_id: int) -> str | None:
    """Ochib bo'lmasa (kalit almashgan yoki ma'lumot buzilgan) — None."""
    try:
        version, body = token.split(".", 1)
        if version != _VERSION:
            return None
        raw = base64.urlsafe_b64decode(body)
        return _aead().decrypt(raw[:12], raw[12:], f"member:{member_id}".encode()).decode()
    except (ValueError, InvalidTag):
        return None
