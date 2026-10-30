import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

export const ALARM_TYPES = ['appointment_reminder', 'attendance_alert'];

let pushToken: string | null = null;

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
    name: 'Budilnik: bron eslatmalari',
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
    name: 'Bron xabarlari',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function registerForPush() {
  if (!Device.isDevice) return;
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: true },
  });
  if (status !== 'granted') return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('EAS projectId yo\'q: "npx eas init" bajaring, push token olinmadi');
    return;
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  pushToken = data;
  await api('/devices', { method: 'POST', body: { token: data, platform: Platform.OS } });
}

export async function unregisterPush() {
  if (pushToken) {
    await api('/devices', { method: 'DELETE', body: { token: pushToken, platform: Platform.OS } }).catch(() => {});
    pushToken = null;
  }
}
