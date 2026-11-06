import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

import { t } from "./i18n";
export const ALARM_TYPES = ['appointment_reminder', 'attendance_alert', 'test'];

// Bildirishnomadagi tugmalar (Android va iOS)
export const BOOKING_CATEGORY = 'booking_alarm';
export const ACTION_ATTEND = 'attend';
export const ACTION_DECLINE = 'decline';

// Bitta budilnik bir necha yo'l bilan kelishi mumkin (telefondagi budilnik, push, to'liq ekran havolasi,
// ilova ichidagi tekshiruv): bron va tur bo'yicha ekran bir marta ochilsin
export const openedAlarms = new Set<string>();
export const alarmKey = (type: string, appointmentId: unknown) => `${type}:${String(appointmentId)}`;

let pushToken: string | null = null;

// Push holati Sozlamalarda ko'rsatiladi: ishlamasa foydalanuvchi va biz sababini ko'ramiz
export type PushStatus = 'ok' | 'denied' | 'unavailable' | 'error' | 'unknown';
export let pushStatus: PushStatus = 'unknown';
export let pushError: string | null = null;

// Ilova ochiq bo'lsa ovozni budilnik ekrani chaladi
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function setupChannels() {
  if (Platform.OS !== 'android') return;
  // Android kanal sozlamasini yaratilgandan keyin o'zgartirmaydi: ovozni almashtirsangiz, kanal id ham almashsin
  await Notifications.setNotificationChannelAsync('alarm', {
    name: t("Budilnik: bron eslatmalari"),
    importance: Notifications.AndroidImportance.MAX,
    sound: 'alarm.wav',
    enableVibrate: true,
    vibrationPattern: [0, 800, 400, 800, 400, 800],
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
  });
  await Notifications.setNotificationChannelAsync('default', {
    name: t("Bron xabarlari"),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

// Tugmalar ilovani ochadi: ilova yopiq bo'lsa ham javob aniq yetib boradi (fonda JS ishlamasligi mumkin)
export async function setupCategories() {
  if (Platform.OS === 'web') return;
  await Notifications.setNotificationCategoryAsync(BOOKING_CATEGORY, [
    { identifier: ACTION_ATTEND, buttonTitle: t("Boraman"), options: { opensAppToForeground: true } },
    { identifier: ACTION_DECLINE, buttonTitle: t("Bormayman"), options: { opensAppToForeground: true, isDestructive: true } },
  ]).catch(() => {});
}

// Bildirishnomaga ruxsat (push bo'lmasa ham telefondagi budilnik uchun kerak)
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: true },
  });
  return status === 'granted';
}

export async function registerForPush() {
  if (!Device.isDevice) return;
  if (!(await ensureNotificationPermission())) {
    pushStatus = 'denied';
    return;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    pushStatus = 'unavailable';
    pushError = t("EAS projectId yo'q");
    return;
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    pushToken = data;
    await api('/devices', { method: 'POST', body: { token: data, platform: Platform.OS } });
    pushStatus = 'ok';
    pushError = null;
  } catch (e) {
    // Android'da Firebase (google-services.json) sozlanmagan bo'lsa token olinmaydi.
    // Bunda ham telefondagi budilnik va ilova ichidagi tekshiruv ishlaydi.
    pushStatus = 'error';
    pushError = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

export async function unregisterPush() {
  if (pushToken) {
    await api('/devices', { method: 'DELETE', body: { token: pushToken, platform: Platform.OS } }).catch(() => {});
    pushToken = null;
  }
}
