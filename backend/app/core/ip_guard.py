"""API himoya qatlami: shubhali IP yoki qurilmani vaqtincha bloklash (2026-11-18).

Kim hisoblanadi (brauzer MAC manzilini bermaydi — shuning uchun IP + token + User-Agent):
  * Kirmagan so'rov     — kalit ("ip", IP). Bitta IP ortida ko'p mobil mijoz bo'lishi mumkin (operator NAT),
                          shuning uchun chegara yuqori.
  * Kirgan foydalanuvchi — kalit ("user", foydalanuvchi, IP). Bitta ofis IP'si ortidagi xodimlar bir-birini
                          bloklamaydi; bloklansa — faqat shu foydalanuvchi shu IP'dan.
Blok sabablari (oyna ichida):
  * rate   — daqiqasiga ortiq so'rov (anonim / foydalanuvchi alohida chegara);
  * errors — daqiqasiga ortiq 4xx javob (skanerlash, buzuq bot);
  * auth   — kirish/kod/parol tiklashda 10 daqiqada ortiq muvaffaqiyatsiz urinish (parol taxmin qilish).
Blok muddati — ip_block_minutes (standart 10), keyin o'zi ochiladi. Javob: 429 + Retry-After.
Bloklanmaydi: Telegram webhook, Payme/Click chaqiruvlari, /health, oq ro'yxat (IP_ALLOWLIST).
Har bir blok audit_logs ga (entity_type = 'security') yoziladi. Holat API jarayoni xotirasida (1 jarayon;
qayta ishga tushsa bloklar tozalanadi — 10 daqiqalik blok uchun yetarli).
"""
import asyncio
import json
import logging
import time
from collections import deque
from dataclasses import dataclass, field

from app.core.config import get_settings

log = logging.getLogger("ip_guard")

EXEMPT_PREFIXES = ("/api/v1/telegram/webhook", "/api/v1/billing/payme", "/api/v1/billing/click", "/health")
AUTH_FAIL_PREFIXES = ("/api/v1/auth/login", "/api/v1/auth/otp/verify", "/api/v1/auth/2fa/verify",
                      "/api/v1/auth/password/reset")


@dataclass
class _Counter:
    window: float = 0.0
    requests: int = 0
    errors: int = 0
    auth_window: float = 0.0
    auth_fails: int = 0
    recent: deque = field(default_factory=lambda: deque(maxlen=8))   # oxirgi so'rovlar (audit uchun)


@dataclass
class Block:
    key: tuple
    ip: str
    user_id: int | None
    reason: str
    until: float
    since: float
    user_agent: str


class IpGuard:
    def __init__(self):
        self.counters: dict[tuple, _Counter] = {}
        self.blocks: dict[tuple, Block] = {}
        self._last_sweep = time.monotonic()
        self.audit_hook = None                                # (action, ip, user_id, details) -> None

    # ── holat ──
    def blocked(self, key: tuple) -> Block | None:
        b = self.blocks.get(key)
        if b is None:
            return None
        if b.until <= time.monotonic():
            del self.blocks[key]
            return None
        return b

    def unblock(self, ip: str) -> int:
        keys = [k for k, b in self.blocks.items() if b.ip == ip]
        for k in keys:
            del self.blocks[k]
            self.counters.pop(k, None)
        return len(keys)

    def reset(self) -> None:
        self.counters.clear()
        self.blocks.clear()

    def active(self) -> list[Block]:
        now = time.monotonic()
        return [b for b in self.blocks.values() if b.until > now]

    # ── hisob ──
    def record(self, key: tuple, ip: str, user_id: int | None, path: str, status: int, user_agent: str) -> Block | None:
        s = get_settings()
        now = time.monotonic()
        c = self.counters.get(key)
        if c is None:
            c = self.counters[key] = _Counter(window=now, auth_window=now)
        if now - c.window >= 60:
            c.window, c.requests, c.errors = now, 0, 0
        if now - c.auth_window >= 600:
            c.auth_window, c.auth_fails = now, 0
        c.requests += 1
        if 400 <= status < 500 and status != 429:
            c.errors += 1
        if status in (401, 403, 429) and path.startswith(AUTH_FAIL_PREFIXES):
            c.auth_fails += 1
        c.recent.append(f"{status} {path[:120]}")
        limit = s.ip_user_rpm if user_id else s.ip_anon_rpm
        reason = ("rate" if c.requests > limit else
                  "errors" if c.errors > s.ip_errors_per_min else
                  "auth" if c.auth_fails > s.ip_auth_failures else None)
        self._sweep(now)
        if reason is None:
            return None
        b = Block(key=key, ip=ip, user_id=user_id, reason=reason, until=now + s.ip_block_minutes * 60,
                  since=time.time(), user_agent=user_agent[:200])
        self.blocks[key] = b
        details = {"ip": ip, "reason": reason, "minutes": s.ip_block_minutes, "user_agent": b.user_agent,
                   "requests_per_min": c.requests, "errors_per_min": c.errors, "auth_fails_10min": c.auth_fails,
                   "recent": list(c.recent), "scope": "user" if user_id else "ip"}
        self.counters.pop(key, None)
        log.warning("IP blok: %s", json.dumps(details, ensure_ascii=False))
        if self.audit_hook:
            self.audit_hook("ip_block", ip, user_id, details)
        return b

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < 60:
            return
        self._last_sweep = now
        for k in [k for k, c in self.counters.items() if now - c.window > 120 and now - c.auth_window > 660]:
            del self.counters[k]
        for k in [k for k, b in self.blocks.items() if b.until <= now]:
            del self.blocks[k]


guard = IpGuard()


def _write_audit(action: str, ip: str, user_id: int | None, details: dict) -> None:
    """Audit yozuvi alohida oqimda (so'rovni kutdirmaydi). Xato bo'lsa — faqat log."""
    from sqlalchemy import text

    from app.db.session import api_session

    def run():
        try:
            with api_session(None) as db:
                db.execute(text("SELECT app.log_security_event(:a, :ip, :u, CAST(:d AS jsonb))"),
                           {"a": action, "ip": ip, "u": user_id, "d": json.dumps(details, ensure_ascii=False)})
                db.commit()
        except Exception:                                   # noqa: BLE001
            log.exception("Xavfsizlik auditini yozib bo'lmadi")

    try:
        asyncio.get_running_loop().run_in_executor(None, run)
    except RuntimeError:
        run()


guard.audit_hook = _write_audit


def _user_from_headers(headers: list[tuple[bytes, bytes]]) -> int | None:
    from app.core.security import decode_access_token
    for k, v in headers:
        if k == b"authorization" and v[:7].lower() == b"bearer ":
            try:
                return decode_access_token(v[7:].decode("latin-1")).user_id
            except Exception:                                # noqa: BLE001 — yaroqsiz token = anonim
                return None
    return None


class IpGuardMiddleware:
    """ASGI qatlami: bloklangan kalit — darhol 429; aks holda javob holatini hisoblaydi."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        s = get_settings()
        if scope["type"] != "http" or not s.ip_guard_enabled:
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        ip = (scope.get("client") or ("?", 0))[0]
        if path.startswith(EXEMPT_PREFIXES) or ip in s.ip_allowlist:
            return await self.app(scope, receive, send)
        headers = scope.get("headers") or []
        user_id = _user_from_headers(headers)
        key = ("user", user_id, ip) if user_id else ("ip", ip)
        b = guard.blocked(key)
        if b is not None:
            left = max(1, int(b.until - time.monotonic()))
            body = json.dumps({"detail": {"code": "ip_blocked", "message":
                               f"Juda ko'p so'rov yoki xato urinish. {max(1, round(left / 60))} daqiqadan keyin "
                               "qayta urinib ko'ring"}}, ensure_ascii=False).encode()
            await send({"type": "http.response.start", "status": 429,
                        "headers": [(b"content-type", b"application/json"), (b"retry-after", str(left).encode()),
                                    (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        ua = next((v.decode("latin-1", "replace") for k, v in headers if k == b"user-agent"), "")
        status = {"code": 500}

        async def capture(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, capture)
        finally:
            guard.record(key, ip, user_id, path, status["code"], ua)
