"""SMS yuborish. Hozircha faqat 'console' (dev/test). Eskiz.uz keyingi bosqichda qo'shiladi."""
import logging

from app.core.config import get_settings

log = logging.getLogger("sms")


def send_sms(phone: str, message: str) -> None:
    provider = get_settings().sms_provider
    if provider == "console":
        log.warning("SMS %s -> %s (dev rejim, SMS yuborilmadi)", phone, message)
        return
    raise NotImplementedError(f"SMS provayder '{provider}' hali ulanmagan")


def send_otp(phone: str, code: str) -> None:
    provider = get_settings().sms_provider
    if provider == "console":
        log.warning("OTP %s -> %s (dev rejim, SMS yuborilmadi)", phone, code)
        return
    raise NotImplementedError(f"SMS provayder '{provider}' hali ulanmagan")
