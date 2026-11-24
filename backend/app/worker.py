"""Fon jarayoni: bron eslatmalari, ustaga ogohlantirishlar va push yuborish.

    python -m app.worker          # har daqiqada ishlaydi
    python -m app.worker --once   # bir marta (cron yoki tekshiruv uchun)

app_worker roli bilan ulanadi: jadvallarni o'qiy olmaydi, faqat eslatma va push funksiyalarini chaqiradi.
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


def expire_subscriptions() -> int:
    with worker_session() as db:
        count = db.scalar(text("SELECT app.expire_subscriptions()"))
        db.commit()
        return count


def expire_pending() -> int:
    """Salon tasdiqlamagan bronlar: muddati yoki bron vaqti o'tsa — bekor, vaqt bo'shaydi (sql/030)."""
    with worker_session() as db:
        count = db.scalar(text("SELECT app.expire_pending_appointments()"))
        db.commit()
        return count


def create_reminders() -> int:
    with worker_session() as db:
        count = db.scalar(text("SELECT app.create_due_reminders(:lead)"),
                          {"lead": get_settings().reminder_lead_minutes})
        db.commit()
        return count


def raise_alerts() -> int:
    with worker_session() as db:
        count = db.scalar(text("SELECT app.raise_attendance_alerts(:m)"),
                          {"m": get_settings().reminder_alert_before_minutes})
        db.commit()
        return count


def scan_waitlist() -> int:
    """Kutish ro'yxati: bo'shagan vaqtlarni navbatdagilarga taklif qilish (sql/052)."""
    with worker_session() as db:
        count = db.scalar(text("SELECT app.waitlist_scan()"))
        db.commit()
        return count


def auto_messages() -> int:
    """Tug'ilgan kun, sharh so'rash, qaytarish (sql/054, 069). Bildirishnoma push bilan ketadi;
    Telegram bog'langan mijozga bot orqali ham; ilovasiz mijozga — SMS (AUTO_SMS_ENABLED va muassasa yoqqan bo'lsa)."""
    s = get_settings()
    with worker_session() as db:
        rows = db.execute(text("SELECT * FROM app.auto_messages_scan(NULL, now(), :sms)"),
                          {"sms": s.auto_sms_enabled}).mappings().all()
        db.commit()
    for r in rows:
        if r["phone"]:
            from app.services import sms
            try:
                sms.send_text(r["phone"], r["body"])
            except sms.SmsForeign:
                log.info("Avto-xabar SMS: xorijiy raqam, yuborilmadi")
            except Exception:
                log.exception("Avto-xabar SMS yuborilmadi")
        elif r["chat_id"] and s.telegram_login_enabled:
            from app.services import telegram_bot
            try:
                telegram_bot.send_message(r["chat_id"], r["title"] + "\n\n" + r["body"])
            except Exception:
                log.exception("Telegram xabari yuborilmadi")
    return len(rows)


def broadcast_telegram() -> int:
    """Ommaviy xabarlarning Telegram navbati (sql/056): bir aylanishda 50 tadan."""
    if not get_settings().telegram_login_enabled:
        return 0
    from app.services import telegram_bot
    with worker_session() as db:
        rows = db.execute(text("SELECT * FROM app.next_broadcast_telegram()")).mappings().all()
        db.commit()
    for r in rows:
        try:
            telegram_bot.send_message(r["chat_id"], f"{r['business_name']}\n\n{r['title']}\n{r['body']}")
        except Exception:
            log.exception("Telegram (ommaviy xabar) yuborilmadi")
    return len(rows)


GEO_PER_CYCLE = 15        # Nominatim: sekundiga 1 ta — bir aylanishda ~17 soniya


def resolve_locations(force: bool = False) -> int:
    """Hududiy analitika (sql/061): keshda yo'q nuqtalarni viloyat/shahar/tumanga o'giradi va yozuvlarni to'ldiradi.
    Tarmoq xatosida to'xtaydi (keyingi aylanishda qayta urinadi); nuqta umuman aniqlanmasa — 'failed' bo'lib qoladi."""
    from app.services import geo_analytics, nominatim
    if get_settings().env == "test" and not force:     # testlar tashqi xizmatga so'rov yubormasin
        return 0
    with worker_session() as db:
        pending = db.execute(text("SELECT * FROM app.geo_pending(:n)"), {"n": GEO_PER_CYCLE}).all()
    done = 0
    for lat, lng in pending:
        try:
            region, city, district = geo_analytics.resolve(float(lat), float(lng))
        except nominatim.AddressUnavailable:
            log.warning("Nominatim javob bermadi, keyingi aylanishda qayta urinamiz")
            break
        with worker_session() as db:
            db.execute(text("SELECT app.geo_resolve(CAST(:a AS numeric), CAST(:b AS numeric), :r, :c, :d)"),
                       {"a": lat, "b": lng, "r": region, "c": city, "d": district})
            db.commit()
        done += 1
    return done


def purge_events() -> int:
    """Analitika: 180 kundan eski hodisalar (sql/055)."""
    with worker_session() as db:
        count = db.scalar(text("SELECT app.purge_app_events()"))
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
            messages = [m for device in row["devices"] for m in push.build_messages(device, row)]
            if messages:
                try:
                    tickets = push.send(messages)
                    delivered = any(t["status"] == "ok" for t in tickets)
                    dead = list({m["to"] for m, t in zip(messages, tickets)
                                 if t.get("details", {}).get("error") == "DeviceNotRegistered"})
                except Exception:
                    log.exception("Push yuborilmadi, xabar %s", row["id"])
            db.execute(text("SELECT app.mark_pushed(:id, :d, CAST(:dead AS text[]))"),
                       {"id": row["id"], "d": delivered, "dead": dead})
            db.commit()
            count += 1


# ─── O'zi ro'yxatdan o'tgan muassasaning 5 kunlik sinovi (sql/070_business_signup.sql) ──────────
# "Kun" = TRIAL_DAY_SECONDS (sinov uchun qisqartirish mumkin). Sinov boshidan:
#   2 kun o'tgach (3-kun):  hali kirmagan bo'lsa — SMS eslatma (TRIAL_SMS_ENABLED)
#   3 kun o'tgach (4-kun):  kirmagan / bo'limlar to'ldirilmagan / ilovada ko'rinmaydi — Telegram ogohlantirishi
#   sinov tugagach (6-kun): hammasi bajarilgan — oylik obunaga; bo'lmasa muassasa o'chiriladi
# TRIAL_DRY_RUN=true (standart): hech narsa yuborilmaydi va o'chirilmaydi — faqat jurnalga "dry_run" bilan yoziladi.
_MISSING = {"logged_in": "panelga kirish", "services": "xizmatlar", "staff": "xizmat ko'rsatadigan mutaxassis",
            "hours": "ish vaqti", "location": "xaritadagi manzil", "visible": "ilovada ko'rinish"}


def _trial_mark(business_id: int, kind: str, dry: bool, details: dict) -> None:
    import json
    with worker_session() as db:
        db.execute(text("SELECT app.trial_mark(:b, :k, :d, CAST(:x AS jsonb))"),
                   {"b": business_id, "k": kind, "d": dry, "x": json.dumps(details, ensure_ascii=False)})
        db.commit()


def trial_watch() -> int:
    from datetime import datetime, timedelta, timezone
    import json

    from app.services import media, sms, telegram_bot
    s = get_settings()
    dry, day = s.trial_dry_run, timedelta(seconds=s.trial_day_seconds)
    now = datetime.now(timezone.utc)
    with worker_session() as db:
        rows = [dict(r) for r in db.execute(text("SELECT * FROM app.trial_list()")).mappings()]
    done = 0
    for r in rows:
        b, ready = r["business_id"], r["readiness"] or {}
        elapsed = now - r["trial_started_at"]
        missing = [v for k, v in _MISSING.items() if not ready.get(k)]
        try:
            # 3-kun: SMS — faqat umuman kirmagan bo'lsa
            if elapsed >= 2 * day and not ready.get("logged_in") and r["sms_day3_at"] is None:
                text_ = (f"Chronix: «{r['name']}» uchun bepul sinov davom etmoqda. Panelga kiring va xizmatlarni "
                         f"qo'shing: {s.business_panel_url}")
                info = {"phone": r["owner_phone"], "sent": False}
                if not dry and s.trial_sms_enabled:
                    try:
                        sms.send_text(r["owner_phone"], text_)
                        info["sent"] = True
                    except Exception as e:                       # SmsError, chet el raqami va h.k.
                        info["error"] = str(e)[:200]
                elif not s.trial_sms_enabled:
                    info["skipped"] = "TRIAL_SMS_ENABLED=false"
                _trial_mark(b, "sms_day3", dry, info)
                done += 1
            # 4-kun: Telegram — kirmagan, bo'limlar to'liq emas yoki ilovada ko'rinmaydi
            if elapsed >= 3 * day and missing and r["tg_day4_at"] is None:
                left = max(0, (r["trial_ends_at"] - now).days + 1)
                text_ = (f"⚠️ «{r['name']}» — bepul sinov tugashiga {left} kun qoldi.\n\n"
                         f"Muassasangiz Chronix ilovasida mijozlarga ko'rinishi uchun qo'shing: {', '.join(missing)}.\n"
                         f"Sinov oxirigacha to'ldirilmasa, muassasa avtomatik o'chiriladi.\n{s.business_panel_url}")
                info = {"chat": bool(r["owner_chat"]), "missing": missing, "sent": False}
                if not dry and r["owner_chat"]:
                    info["sent"] = telegram_bot.send_message(r["owner_chat"], text_)
                _trial_mark(b, "tg_day4", dry, info)
                done += 1
            # Sinov tugadi
            if now >= r["trial_ends_at"]:
                ok = bool(ready.get("logged_in") and ready.get("all_filled") and ready.get("visible"))
                if dry:
                    if r["end_dry_at"] is None:
                        _trial_mark(b, "converted" if ok else "deleted", True, {"readiness": ready, "missing": missing})
                        done += 1
                    continue
                with worker_session() as db:
                    if ok:
                        db.execute(text("SELECT app.trial_convert(:b)"), {"b": b})
                        deleted = False
                    else:
                        deleted = db.scalar(text("SELECT app.trial_delete(:b, CAST(:x AS jsonb))"),
                                            {"b": b, "x": json.dumps({"readiness": ready, "missing": missing},
                                                                     ensure_ascii=False)})
                    db.commit()
                if deleted:
                    media.delete_business_folder(b)
                    if r["owner_chat"]:
                        telegram_bot.send_message(r["owner_chat"], f"«{r['name']}» bepul sinov muddati tugadi va "
                                                  "talablar bajarilmagani uchun o'chirildi. Qayta ro'yxatdan o'tishingiz "
                                                  f"mumkin: {s.business_panel_url}")
                elif ok and r["owner_chat"]:
                    telegram_bot.send_message(r["owner_chat"], f"🎉 «{r['name']}» sinovdan muvaffaqiyatli o'tdi! "
                                              f"Endi oylik obuna amal qiladi — to'lovni panelning «Obuna» bo'limida "
                                              f"qilishingiz mumkin.\n{s.business_panel_url}")
                done += 1
        except Exception:
            log.exception("Sinov tekshiruvi xatosi: muassasa %s", b)
    return done


def run_once() -> dict:
    expired = expire_subscriptions()
    auto_cancelled = expire_pending()      # eslatmadan oldin: bekor bo'lgan bronga eslatma ketmasin
    reminders = create_reminders()
    waitlist = scan_waitlist()            # pushdan oldin: taklif xabari shu aylanishda ketsin
    auto = auto_messages()
    trials = trial_watch()
    purge_events()
    resolve_locations()
    broadcast_telegram()
    pushes = send_pushes()                 # yetkazilmagan eslatma shu aylanishda ogohlantirishga aylansin
    alerts = raise_alerts()
    return {"expired": expired, "auto_cancelled": auto_cancelled, "reminders": reminders, "waitlist": waitlist, "auto": auto, "trials": trials, "alerts": alerts,
            "pushes": pushes + send_pushes()}


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
