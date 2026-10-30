"""Expo Push orqali bildirishnoma. Tokenlar mobil ilovada olinadi (POST /devices).

'alarm' kanali budilnik kabi: Android'da maksimal muhimlik va uzun ovoz (kanal ilovada yaratiladi),
iOS'da time-sensitive. Faqat javob kutilayotgan xabarlar shu kanaldan ketadi.

Android'da budilnikka ikkinchi, ko'rinmas xabar qo'shiladi: u ilovani fonda uyg'otadi va ilova
bloklangan ekranni egallaydi. Birinchi xabar zaxira: uyg'otish ishlamasa ham ovoz va bildirishnoma keladi.
"""
import httpx

EXPO_URL = "https://exp.host/--/api/v2/push/send"
ALARM_TYPES = {"appointment_reminder", "attendance_alert"}
ALARM_TTL_SECONDS = 1800


def build_messages(device: dict, row) -> list[dict]:
    alarm = row["type"] in ALARM_TYPES
    data = {**(row["data"] or {}), "type": row["type"], "notification_id": row["id"]}
    visible = {
        "to": device["token"],
        "title": row["title"],
        "body": row["body"],
        "data": data,
        "priority": "high",
        "channelId": "alarm" if alarm else "default",
        "sound": "alarm.wav" if alarm else "default",
    }
    if not alarm:
        return [visible]
    visible.update(interruptionLevel="time-sensitive", ttl=ALARM_TTL_SECONDS)
    if device["platform"] != "android":
        return [visible]
    wake = {
        "to": device["token"],
        "data": {**data, "title": row["title"], "body": row["body"]},
        "priority": "high",
        "ttl": ALARM_TTL_SECONDS,
        "_contentAvailable": True,
    }
    return [wake, visible]


def send(messages: list[dict]) -> list[dict]:
    """Javob: har bir xabar uchun ticket, tartib bir xil. 'ok' — Expo qabul qildi, telefonga yetgani emas."""
    r = httpx.post(EXPO_URL, json=messages, timeout=15)
    r.raise_for_status()
    return r.json()["data"]
