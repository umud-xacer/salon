"""Telegram kirish botining webhooki. Telegram faqat sir sarlavha bilan chaqiradi (setWebhook secret_token).

Bot vazifasi bitta: ilovadan kelgan /start <nonce> dan keyin foydalanuvchining O'Z kontaktini olish.
Kontakt boshqa odamniki bo'lsa (contact.user_id != from.id) — rad etiladi.
"""
import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_auth_db
from app.core.config import get_settings
from app.services import auth_service, telegram_bot as tg

router = APIRouter(prefix="/telegram", tags=["telegram"])
log = logging.getLogger("telegram")

MSG = {
    "ask": "Chronix'ga kirish uchun pastdagi «📱 Raqamni yuborish» tugmasini bosing.\n\n"
           "Для входа в Chronix нажмите кнопку «📱 Отправить номер» ниже.",
    "expired": "Havola eskirgan. Chronix ilovasida qaytadan «Telegram orqali kirish» ni bosing.\n\n"
               "Ссылка устарела. Нажмите «Войти через Telegram» в приложении Chronix ещё раз.",
    "hello": "Salom! Bu Chronix ilovasiga kirish boti. Ilovada «Telegram orqali kirish» ni bosing.\n\n"
             "Здравствуйте! Это бот для входа в приложение Chronix. Нажмите «Войти через Telegram» в приложении.",
    "ok": "✅ Raqam tasdiqlandi. Chronix ilovasi yoki saytiga qayting — kirish avtomatik bo'ladi.\n\n"
          "✅ Номер подтверждён. Вернитесь в приложение или на сайт Chronix — вход выполнится автоматически.",
    "not_own": "Faqat o'zingizning raqamingizni tugma orqali yuboring.\n\n"
               "Отправьте, пожалуйста, свой номер с помощью кнопки.",
    "bad_phone": "Hozircha faqat O'zbekiston (+998) raqamlari qabul qilinadi.\n\n"
                 "Пока принимаются только номера Узбекистана (+998).",
    "no_request": "Kirish so'rovi topilmadi yoki eskirgan. Ilovada qaytadan «Telegram orqali kirish» ni bosing.\n\n"
                  "Запрос на вход не найден или устарел. Нажмите «Войти через Telegram» в приложении ещё раз.",
}


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_auth_db),
                  x_telegram_bot_api_secret_token: str | None = Header(default=None)):
    s = get_settings()
    secret = s.telegram_webhook_secret.get_secret_value() if s.telegram_webhook_secret else ""
    if not secret or not x_telegram_bot_api_secret_token \
            or not hmac.compare_digest(secret, x_telegram_bot_api_secret_token):
        raise HTTPException(403, detail={"code": "forbidden", "message": "Ruxsat yo'q"})
    try:
        update = await request.json()
    except ValueError:
        return {"ok": True}
    msg = update.get("message") if isinstance(update, dict) else None
    if not isinstance(msg, dict):
        return {"ok": True}
    chat = msg.get("chat") or {}
    sender = msg.get("from") or {}
    if chat.get("type") != "private" or not isinstance(sender.get("id"), int):
        return {"ok": True}
    chat_id, user_id = chat.get("id"), sender["id"]

    contact = msg.get("contact")
    text_ = msg.get("text") or ""
    if isinstance(contact, dict):
        name = " ".join(x for x in (contact.get("first_name"), contact.get("last_name")) if x) \
            or " ".join(x for x in (sender.get("first_name"), sender.get("last_name")) if x)
        result = auth_service.telegram_contact(db, user_id, contact.get("user_id"),
                                               str(contact.get("phone_number") or ""), name or "")
        markup = tg.REMOVE_KEYBOARD if result in ("ok", "no_request") else tg.CONTACT_KEYBOARD
        tg.send_message(chat_id, MSG[result], markup)
    elif text_.startswith("/start"):
        parts = text_.split(maxsplit=1)
        nonce = parts[1].strip() if len(parts) > 1 else ""
        if not nonce:
            tg.send_message(chat_id, MSG["hello"], tg.REMOVE_KEYBOARD)
        elif 16 <= len(nonce) <= 64 and auth_service.telegram_bind_chat(db, nonce, user_id, chat_id):
            tg.send_message(chat_id, MSG["ask"], tg.CONTACT_KEYBOARD)
        else:
            tg.send_message(chat_id, MSG["expired"], tg.REMOVE_KEYBOARD)
    else:
        tg.send_message(chat_id, MSG["hello"])
    return {"ok": True}
