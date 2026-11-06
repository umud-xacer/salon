// Telefonning o'zida qo'yiladigan eslatmalar: internet va push bo'lmasa ham o'z vaqtida chalinadi.
//   1 soat qolganda — oddiy eslatma.
//   30 daqiqa qolganda — BUDILNIK: "alarm" kanali (alarm.wav, eng yuqori muhimlik, "Bezovta qilmang" ham
//   to'xtatmaydi, bloklangan ekranda ko'rinadi), "Boraman" / "Bormayman" tugmalari bilan. Bosilsa, budilnik
//   ekrani ochiladi va tugma bosilmaguncha ovoz takrorlanadi.
// Server ham 30 daqiqada push yuboradi; ikkalasi kelsa, ekran bir marta ochiladi (alarmKey).
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { Appointment } from './api';
import { BOOKING_CATEGORY } from './notifications';

import { t } from "./i18n";
const HOUR_MS = 60 * 60 * 1000;
const ALARM_MS = 30 * 60 * 1000;
const reminderId = (appointmentId: number) => `booking-${appointmentId}`;
const alarmId = (appointmentId: number) => `alarm-${appointmentId}`;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });

export async function scheduleBookingReminder(appointmentId: number, startsAt: string, place: string) {
  if (Platform.OS === 'web') return;
  await cancelBookingReminder(appointmentId);
  const start = new Date(startsAt).getTime();
  const time = timeOf(startsAt);

  const remindAt = start - HOUR_MS;
  if (remindAt > Date.now() + 60_000) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminderId(appointmentId),
      content: {
        title: t("Broningizga 1 soat qoldi"),
        body: t("{a}, soat {b}. 30 daqiqa qolganda budilnik chalinadi.", { a: place, b: time }),
        data: { type: 'local_booking_reminder', appointment_id: appointmentId },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: remindAt, channelId: 'default' },
    }).catch(() => {});
  }

  // Bron 30 daqiqadan kam qolganda qilingan bo'lsa — budilnik kerak emas (mijoz hozirgina tanladi)
  const alarmAt = start - ALARM_MS;
  if (alarmAt > Date.now() + 30_000) {
    await Notifications.scheduleNotificationAsync({
      identifier: alarmId(appointmentId),
      content: {
        title: t("Broningizga 30 daqiqa qoldi — soat {a}", { a: time }),
        body: t("{a}. Borasizmi?", { a: place }),
        sound: 'alarm.wav',
        vibrate: [0, 800, 400, 800, 400, 800],
        priority: Notifications.AndroidNotificationPriority.MAX,
        sticky: true,
        autoDismiss: true,
        categoryIdentifier: BOOKING_CATEGORY,
        interruptionLevel: 'timeSensitive',
        data: { type: 'appointment_reminder', appointment_id: appointmentId, local: true },
      },
      // Aniq vaqt (budilnik soati kabi). Ruxsat bo'lmasa Android taxminiy vaqtga o'tadi
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: alarmAt, channelId: 'alarm', delivery: 'alarmClock' },
    }).catch(() => {});
  }
}

export async function cancelBookingReminder(appointmentId: number) {
  await Notifications.cancelScheduledNotificationAsync(reminderId(appointmentId)).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(alarmId(appointmentId)).catch(() => {});
}

// Telefondagi budilniklarni serverdagi bronlar bilan moslash: boshqa qurilmada yoki qabulxonada qilingan bronlar
// ham budilnik oladi; bekor qilingan / tasdiqlangan / o'tgan bronlarniki o'chadi.
export async function syncBookingAlarms(appointments: Appointment[]) {
  if (Platform.OS === 'web') return;
  const active = appointments.filter((a) =>
    (a.status === 'pending' || a.status === 'confirmed') && a.attendance !== 'confirmed'
    && new Date(a.starts_at).getTime() > Date.now());
  const keep = new Set(active.flatMap((a) => [reminderId(a.id), alarmId(a.id)]));

  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  const have = new Set(scheduled.map((n) => n.identifier));
  for (const n of scheduled) {
    if (/^(booking|alarm)-\d+$/.test(n.identifier) && !keep.has(n.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
  }
  for (const a of active) {
    if (!have.has(alarmId(a.id)) || !have.has(reminderId(a.id))) {
      await scheduleBookingReminder(a.id, a.starts_at, a.business_name ?? t("Salon"));
    }
  }
}

// Sozlamalardagi sinov: 10 soniyadan keyin haqiqiy budilnik kanalida chalinadi (ilovani yopib sinash mumkin)
export async function scheduleTestAlarm(seconds = 10) {
  await Notifications.scheduleNotificationAsync({
    identifier: 'alarm-test',
    content: {
      title: t("Budilnik sinovi"),
      body: t("Ovoz va tebranish ishlayapti. Bosing — budilnik ekrani ochiladi."),
      sound: 'alarm.wav',
      vibrate: [0, 800, 400, 800],
      priority: Notifications.AndroidNotificationPriority.MAX,
      data: { type: 'test', appointment_id: 0, notification_id: `test-${Date.now()}` },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: 'alarm' },
  });
}
