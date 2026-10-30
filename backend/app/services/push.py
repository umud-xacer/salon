"""Expo Push orqali bildirishnoma. Tokenlar mobil ilovada olinadi (POST /devices).

'alarm' kanali budilnik kabi: Android'da maksimal muhimlik va uzun ovoz (kanal ilovada yaratiladi),
iOS'da time-sensitive. Faqat javob kutilayotgan xabarlar shu kanaldan ketadi.
"""
import httpx

EXPO_URL = "https://exp.host/--/api/v2/push/send"
ALARM_TYPES = {"appointment_reminder", "attendance_alert"}
ALARM_TTL_SECONDS = 1800


def build_message(token: str, row) -> dict:
    alarm = row["type"] in ALARM_TYPES
    message = {
        "to": token,
        "title": row["title"],
        "body": row["body"],
        "data": {**(row["data"] or {}), "type": row["type"], "notification_id": row["id"]},
        "priority": "high",
        "channelId": "alarm" if alarm else "default",
        "sound": "alarm.wav" if alarm else "default",
    }
    if alarm:
        message.update(interruptionLevel="time-sensitive", ttl=ALARM_TTL_SECONDS)
    return message


def send(messages: list[dict]) -> list[dict]:
    """Javob: har bir xabar uchun ticket, tartib bir xil. 'ok' — Expo qabul qildi, telefonga yetgani emas."""
    r = httpx.post(EXPO_URL, json=messages, timeout=15)
    r.raise_for_status()
    return r.json()["data"]
