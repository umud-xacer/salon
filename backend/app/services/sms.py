"""SMS faqat ikki holatda: telefonni tasdiqlash (OTP) va parolni tiklash.

Eskiz.uz: kirish tokeni ~30 kun yashaydi, xotirada saqlanadi, 401 kelsa bir marta yangilanadi.
Matnlar Eskiz'da moderatsiyadan o'tgan shablonlarga aynan mos bo'lishi kerak (SMS_*_TEMPLATE).
"""
import logging
import threading

import httpx

from app.core.config import get_settings

log = logging.getLogger("sms")

ESKIZ_URL = "https://notify.eskiz.uz/api"
TIMEOUT_SECONDS = 10

_token: str | None = None
_lock = threading.Lock()


class SmsError(Exception):
    pass


def _login() -> str:
    s = get_settings()
    if s.eskiz_email is None or s.eskiz_password is None:
        raise SmsError("ESKIZ_EMAIL / ESKIZ_PASSWORD o'rnatilmagan")
    r = httpx.post(f"{ESKIZ_URL}/auth/login", timeout=TIMEOUT_SECONDS,
                   data={"email": s.eskiz_email, "password": s.eskiz_password.get_secret_value()})
    if r.status_code != 200:
        raise SmsError(f"Eskiz login: HTTP {r.status_code}")
    return r.json()["data"]["token"]


def _post_sms(token: str, phone: str, message: str) -> httpx.Response:
    return httpx.post(f"{ESKIZ_URL}/message/sms/send", timeout=TIMEOUT_SECONDS,
                      headers={"Authorization": f"Bearer {token}"},
                      data={"mobile_phone": phone.lstrip("+"), "message": message, "from": get_settings().eskiz_from})


def _send_eskiz(phone: str, message: str) -> None:
    global _token
    try:
        with _lock:
            if _token is None:
                _token = _login()
            token = _token
        r = _post_sms(token, phone, message)
        if r.status_code == 401:
            with _lock:
                _token = token = _login()
            r = _post_sms(token, phone, message)
    except httpx.HTTPError as e:
        raise SmsError(f"Eskiz bilan aloqa yo'q: {type(e).__name__}") from e
    if r.status_code != 200:
        # Javob matni yozilmaydi: unda SMS matni, ya'ni kod bo'lishi mumkin
        raise SmsError(f"Eskiz rad etdi: HTTP {r.status_code}")


def _send(phone: str, message: str) -> None:
    if get_settings().sms_provider == "console":
        log.warning("SMS %s -> %s (dev rejim, SMS yuborilmadi)", phone, message)
        return
    _send_eskiz(phone, message)


def send_otp(phone: str, code: str) -> None:
    _send(phone, get_settings().sms_otp_template.format(code=code))


def send_password_reset(phone: str, code: str) -> None:
    _send(phone, get_settings().sms_reset_template.format(code=code))
