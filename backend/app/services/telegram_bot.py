"""Telegram Bot API: kirish botining xabarlari va webhook o'rnatish. Token faqat serverda."""
import logging

import httpx

from app.core.config import get_settings

log = logging.getLogger("telegram")
API = "https://api.telegram.org"


class TelegramError(Exception):
    pass


def _call(method: str, payload: dict) -> dict:
    s = get_settings()
    if s.telegram_bot_token is None:
        raise TelegramError("bot token sozlanmagan")
    url = f"{API}/bot{s.telegram_bot_token.get_secret_value()}/{method}"
    try:
        r = httpx.post(url, json=payload, timeout=10)
    except httpx.HTTPError as e:
        raise TelegramError(f"{method}: tarmoq xatosi {type(e).__name__}") from None
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code != 200 or not data.get("ok"):
        raise TelegramError(f"{method}: {r.status_code} {data.get('description', '')}")
    return data.get("result") or {}


def send_message(chat_id: int, text: str, reply_markup: dict | None = None) -> bool:
    """Xatoni yutadi (log) — foydalanuvchiga javob yuborilmasa ham kirish jarayoni buzilmasin.
    False — yuborilmadi (masalan, foydalanuvchi botni bloklagan)."""
    payload: dict = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    try:
        _call("sendMessage", payload)
        return True
    except TelegramError as e:
        log.warning("Telegram xabari yuborilmadi: %s", e)
        return False


def set_webhook(url: str) -> dict:
    s = get_settings()
    secret = s.telegram_webhook_secret.get_secret_value() if s.telegram_webhook_secret else None
    if not secret:
        raise TelegramError("TELEGRAM_WEBHOOK_SECRET sozlanmagan")
    return _call("setWebhook", {"url": url, "secret_token": secret, "allowed_updates": ["message"],
                                "drop_pending_updates": True})


CONTACT_KEYBOARD = {
    "keyboard": [[{"text": "📱 Raqamni yuborish / Отправить номер", "request_contact": True}]],
    "resize_keyboard": True,
    "one_time_keyboard": True,
}
REMOVE_KEYBOARD = {"remove_keyboard": True}
