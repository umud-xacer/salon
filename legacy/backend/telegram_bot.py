"""
Telegram Bot Integration — Adminlarga bildirishnoma yuborish
"""
import httpx


async def send_telegram_message(bot_token: str, chat_id: str, text: str):
    """Telegram orqali xabar yuborish (async)."""
    if not bot_token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
            })
            return resp.status_code == 200
    except Exception:
        return False


def send_telegram_sync(bot_token: str, chat_id: str, text: str):
    """Telegram orqali xabar yuborish (sync — FastAPI background task)."""
    if not bot_token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        resp = httpx.post(url, json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
        }, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False


def format_new_booking(client_name, service, master, date, time, source):
    """Yangi bron uchun Telegram xabar formati."""
    src = "🤖 Bot" if source == "bot" else "👤 Admin"
    return (
        f"📅 <b>Yangi Bron!</b>\n\n"
        f"👤 Mijoz: <b>{client_name}</b>\n"
        f"💇 Xizmat: {service}\n"
        f"👩‍💼 Usta: {master or '—'}\n"
        f"📆 Sana: {date}\n"
        f"🕐 Vaqt: {time}\n"
        f"📲 Manba: {src}"
    )


def format_completed(client_name, service, master, price):
    """Yakunlangan xizmat uchun Telegram xabar formati."""
    return (
        f"✅ <b>Xizmat Yakunlandi!</b>\n\n"
        f"👤 Mijoz: {client_name}\n"
        f"💇 Xizmat: {service}\n"
        f"👩‍💼 Usta: {master or '—'}\n"
        f"💰 Tushum: <b>{int(price):,} so'm</b>"
    )


def format_no_show(client_name, service, time):
    """No-show uchun Telegram xabar formati."""
    return (
        f"❌ <b>Mijoz Kelmadi!</b>\n\n"
        f"👤 Mijoz: {client_name}\n"
        f"💇 Xizmat: {service}\n"
        f"🕐 Vaqt: {time}"
    )
