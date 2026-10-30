"""Fon jarayoni: bron eslatmalari va ustaga ogohlantirishlar.

    python -m app.worker          # har daqiqada ishlaydi
    python -m app.worker --once   # bir marta (cron yoki tekshiruv uchun)

app_worker roli bilan ulanadi: jadvallarni o'qiy olmaydi, faqat sql/006_reminders.sql dagi funksiyalarni chaqiradi.
"""
import argparse
import hashlib
import logging
import secrets
import time

from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import worker_session
from app.services import sms

log = logging.getLogger("worker")

INTERVAL_SECONDS = 60


def send_reminders() -> int:
    """Har bir eslatma alohida tranzaksiyada: yarim yo'lda to'xtasa, yuborilganlari qayta ketmaydi."""
    s = get_settings()
    count = 0
    while True:
        with worker_session() as db:
            row = db.execute(text("SELECT * FROM app.next_due_reminder(:lead)"),
                             {"lead": s.reminder_lead_minutes}).mappings().first()
            if row is None:
                return count
            token = secrets.token_urlsafe(16)
            message = (f"{row['business_name']}: broningiz {row['slot_time']} da. Borasizmi? "
                       f"Tasdiqlang: {s.public_base_url}/r/{token}")
            try:
                sms.send_sms(row["phone"], message)
                delivered = True
            except Exception:
                log.exception("SMS yuborilmadi, bron %s", row["appointment_id"])
                delivered = False
            db.execute(text("SELECT app.record_reminder(:id, :h, :d)"),
                       {"id": row["appointment_id"], "h": hashlib.sha256(token.encode()).hexdigest(), "d": delivered})
            db.commit()
            count += 1


def raise_alerts() -> int:
    with worker_session() as db:
        count = db.scalar(text("SELECT app.raise_attendance_alerts(:m)"),
                          {"m": get_settings().reminder_response_minutes})
        db.commit()
        return count


def run_once() -> dict:
    return {"reminders": send_reminders(), "alerts": raise_alerts()}


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    if parser.parse_args().once:
        print(run_once())
        return
    while True:
        try:
            result = run_once()
            if any(result.values()):
                log.info("%s", result)
        except Exception:
            log.exception("Worker xatosi")             # baza vaqtincha o'chsa ham jarayon to'xtamasin
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
