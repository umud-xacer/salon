"""Mijoz mobil ilovasida vaqtincha yashiriladigan muassasa turlari (Google Play, 2026-11-24).

Play shaxsiy hisobdan tibbiy funksiyali ilovani qabul qilmadi (faqat tashkilot hisobi). Shuning uchun mobil ilova
(1.0.3+) har so'rovda `X-Chronix-Client: mobile` sarlavhasini yuboradi va server shu so'rovlarda
MOBILE_HIDDEN_KINDS (standart "clinic" — stomatologiya, LOR, klinika) turidagi muassasalarni katalogdan chiqarmaydi.
Veb-sayt, panel va eski ilova (1.0.2) sarlavha yubormaydi — ular uchun hech narsa o'zgarmaydi.

Qaytarish: serverda MOBILE_HIDDEN_KINDS= (bo'sh) — yangi build kerak emas.

Qiymat ContextVar orqali sessiyaga uzatiladi: ApiSession har tranzaksiya boshida `app.hidden_kinds` ni o'rnatadi,
catalog._PUBLIC_WHERE uni o'qiydi; public_cache kaliti ham shu qiymatga bo'linadi (veb va mobil keshi aralashmaydi).
"""
from contextvars import ContextVar

from app.core.config import get_settings

HEADER = b"x-chronix-client"
hidden_kinds: ContextVar[tuple[str, ...]] = ContextVar("hidden_kinds", default=())


def kinds_for(client: str | None) -> tuple[str, ...]:
    if client != "mobile":
        return ()
    raw = get_settings().mobile_hidden_kinds
    return tuple(k.strip() for k in raw.split(",") if k.strip())


class ClientFilterMiddleware:
    """Toza ASGI middleware: ContextVar endpoint va sinxron dependency'larga (threadpool) o'tadi."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        client = next((v.decode("latin-1") for k, v in scope.get("headers", []) if k == HEADER), None)
        token = hidden_kinds.set(kinds_for(client))
        try:
            await self.app(scope, receive, send)
        finally:
            hidden_kinds.reset(token)
