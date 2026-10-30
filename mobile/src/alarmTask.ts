import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { SalonAlarmModule } from '../modules/salon-alarm';
import { ALARM_TYPES } from './notifications';

const TASK = 'SALON_ALARM';

// Ko'rinmas push ilovani fonda (yopiq bo'lsa ham) uyg'otadi. Ochiq ilovada budilnikni _layout ochadi.
TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data }) => {
  if ('actionIdentifier' in data || AppState.currentState === 'active' || !SalonAlarmModule) return;
  const raw = data.data.dataString;
  if (!raw) return;
  const payload = JSON.parse(raw);
  if (!ALARM_TYPES.includes(payload.type)) return;
  const params = new URLSearchParams({
    type: payload.type,
    appointmentId: String(payload.appointment_id),
    notificationId: String(payload.notification_id),
  });
  await SalonAlarmModule.show(payload.title, payload.body, `salon://alarm?${params}`);
});

Notifications.registerTaskAsync(TASK).catch((e) => console.warn('Budilnik vazifasi ro\'yxatdan o\'tmadi', e));
