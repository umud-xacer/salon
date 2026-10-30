import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { ChronixAlarmModule } from '../modules/chronix-alarm';
import { ALARM_TYPES } from './notifications';

const TASK = 'CHRONIX_ALARM';

// Ko'rinmas push ilovani fonda (yopiq bo'lsa ham) uyg'otadi. Ochiq ilovada budilnikni _layout ochadi.
TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data }) => {
  if ('actionIdentifier' in data || AppState.currentState === 'active' || !ChronixAlarmModule) return;
  const raw = data.data.dataString;
  if (!raw) return;
  const payload = JSON.parse(raw);
  if (!ALARM_TYPES.includes(payload.type)) return;
  const params = new URLSearchParams({
    type: payload.type,
    appointmentId: String(payload.appointment_id),
    notificationId: String(payload.notification_id),
  });
  await ChronixAlarmModule.show(payload.title, payload.body, `chronix://alarm?${params}`);
});

Notifications.registerTaskAsync(TASK).catch((e) => console.warn('Budilnik vazifasi ro\'yxatdan o\'tmadi', e));
