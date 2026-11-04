// Bron qilingan zahoti telefonning o'ziga eslatma qo'yiladi: internet bo'lmasa ham 1 soat qolganda chiqadi.
// 30 daqiqa qolgandagi budilnik ("Tasdiqlayman / Bormayman") serverdan push bilan keladi.
import * as Notifications from 'expo-notifications';

const LEAD_MS = 60 * 60 * 1000;
const id = (appointmentId: number) => `booking-${appointmentId}`;

export async function scheduleBookingReminder(appointmentId: number, startsAt: string, place: string) {
  const at = new Date(new Date(startsAt).getTime() - LEAD_MS);
  if (at.getTime() <= Date.now() + 60_000) return;                  // 1 soatdan kam qolgan bo'lsa — kerak emas
  await cancelBookingReminder(appointmentId);
  const time = new Date(startsAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  await Notifications.scheduleNotificationAsync({
    identifier: id(appointmentId),
    content: {
      title: 'Broningizga 1 soat qoldi',
      body: `${place}, soat ${time}. 30 daqiqa qolganda tasdiqlashni so'raymiz.`,
      data: { type: 'local_booking_reminder', appointment_id: appointmentId },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'default' },
  }).catch(() => {});
}

export async function cancelBookingReminder(appointmentId: number) {
  await Notifications.cancelScheduledNotificationAsync(id(appointmentId)).catch(() => {});
}
