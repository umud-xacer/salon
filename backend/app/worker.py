"""Fon jarayoni: bron eslatmalari, ustaga ogohlantirishlar va push yuborish.

    python -m app.worker          # har daqiqada ishlaydi
    python -m app.worker --once   # bir marta (cron yoki tekshiruv uchun)

app_worker roli bilan ulanadi: jadvallarni o'qiy olmaydi, faqat sql/007_push.sql dagi funksiyalarni chaqiradi.
"""
import argparse
import logging
import time

from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import worker_session
from app.services import push

log = logging.getLogger("worker")

INTERVAL_SECONDS = 60


def create_reminders() -> int:
    with worker_session() as db:
        count = db.scalar(text("SELECT app.create_due_reminders(:lead)"),
                          {"lead": get_settings().reminder_lead_minutes})
        db.commit()
        return count


def raise_alerts() -> int:
    with worker_session() as db:
        count = db.scalar(text("SELECT app.raise_attendance_alerts(:m)"),
                          {"m": get_settings().reminder_response_minutes})
        db.commit()
        return count


def send_pushes() -> int:
    """Har bir xabar alohida tranzaksiyada: yarim yo'lda to'xtasa, yuborilganlari qayta ketmaydi."""
    count = 0
    while True:
        with worker_session() as db:
            row = db.execute(text("SELECT * FROM app.next_push()")).mappings().first()
            if row is None:
                return count
            delivered, dead = False, []
            if row["tokens"]:
                try:
                    tickets = push.send([push.build_message(t, row) for t in row["tokens"]])
                    delivered = any(t["status"] == "ok" for t in tickets)
                    dead = [token for token, t in zip(row["tokens"], tickets)
                            if t.get("details", {}).get("error") == "DeviceNotRegistered"]
                except Exception:
                    log.exception("Push yuborilmadi, xabar %s", row["id"])
            db.execute(text("SELECT app.mark_pushed(:id, :d, CAST(:dead AS text[]))"),
                       {"id": row["id"], "d": delivered, "dead": dead})
            db.commit()
            count += 1


def run_once() -> dict:
    reminders = create_reminders()
    pushes = send_pushes()                 # yetkazilmagan eslatma shu aylanishda ogohlantirishga aylansin
    alerts = raise_alerts()
    return {"reminders": reminders, "alerts": alerts, "pushes": pushes + send_pushes()}


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
