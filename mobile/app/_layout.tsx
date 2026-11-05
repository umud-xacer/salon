import * as Notifications from 'expo-notifications';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, View } from 'react-native';

import { AnimatedSplash } from '../src/AnimatedSplash';
import { api, ApiError, Appointment, Notification as ApiNotification } from '../src/api';
import { AuthProvider, useAuth } from '../src/auth';
import { FavoritesProvider } from '../src/favorites';
import { cancelBookingReminder, syncBookingAlarms } from '../src/localReminders';
import {
  ACTION_ATTEND, ACTION_DECLINE, ALARM_TYPES, alarmKey, ensureNotificationPermission, openedAlarms, setupCategories,
  setupChannels,
} from '../src/notifications';
import { colors } from '../src/ui';
import { useOtaUpdates } from '../src/useOtaUpdates';

SplashScreen.preventAutoHideAsync().catch(() => {});

const POLL_MS = 20_000;

function openAlarm(router: ReturnType<typeof useRouter>, data: Record<string, unknown> = {}) {
  const type = String(data.type);
  if (!ALARM_TYPES.includes(type)) return;
  const key = type === 'test' ? String(data.notification_id) : alarmKey(type, data.appointment_id);
  if (openedAlarms.has(key)) return;
  openedAlarms.add(key);
  router.push({
    pathname: '/alarm',
    params: {
      type,
      appointmentId: String(data.appointment_id),
      notificationId: data.notification_id == null ? '' : String(data.notification_id),
    },
  });
}

// Bildirishnomadagi "Boraman" / "Bormayman" tugmasi
async function handleAction(router: ReturnType<typeof useRouter>, r: Notifications.NotificationResponse) {
  const data = r.notification.request.content.data ?? {};
  const id = Number(data.appointment_id);
  const key = alarmKey(String(data.type), data.appointment_id);
  await Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => {});
  if (r.actionIdentifier === ACTION_ATTEND || r.actionIdentifier === ACTION_DECLINE) {
    openedAlarms.add(key);                                       // shu bron uchun budilnik endi kerak emas
    try {
      if (r.actionIdentifier === ACTION_ATTEND) {
        await api(`/appointments/${id}/attend`, { method: 'POST' });
        Alert.alert('Rahmat!', 'Kelishingizni salonga bildirdik.');
      } else {
        await api(`/appointments/${id}/cancel`, { method: 'POST', body: { reason: 'Mijoz budilnikda "Bormayman" dedi' } });
        await cancelBookingReminder(id);
        Alert.alert('Bron bekor qilindi', 'Vaqt boshqa mijozlar uchun ochildi.');
      }
    } catch (e) {
      Alert.alert('Xatolik', e instanceof ApiError ? e.message : 'Internetni tekshirib, qayta urinib ko\'ring');
    }
    router.replace('/bookings');
    return;
  }
  openAlarm(router, data);
}

function Navigator() {
  const { me, ready } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  useOtaUpdates();

  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === 'login' || segments[0] === 'password' || segments[0] === 'register';
    if (!me && !onLogin) router.replace('/login');
    if (me && onLogin) router.replace('/');
  }, [me, ready, segments, router]);

  useEffect(() => {
    if (!me || Platform.OS === 'web') return;
    // Ilova ochiq paytda keldi
    const received = Notifications.addNotificationReceivedListener((n) =>
      openAlarm(router, n.request.content.data));
    // Bildirishnoma yoki undagi tugma bosildi (ilova fonda yoki yopiq edi)
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => { void handleAction(router, r); });
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      void handleAction(router, last);
      Notifications.clearLastNotificationResponse();
    }
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [me, router]);

  // Ilova ochiq paytda: serverdagi budilnik/ogohlantirishlarni tekshirish (push yetmasa ham ovoz chalinadi),
  // mijozda esa telefondagi budilniklarni bronlar bilan moslash
  useEffect(() => {
    if (!me || Platform.OS === 'web') return;
    let stopped = false;
    const check = async () => {
      if (stopped || AppState.currentState !== 'active') return;
      try {
        const items = await api<ApiNotification[]>('/notifications?unread=true&limit=50');
        const since = Date.now() - 2 * 60 * 60 * 1000;            // eski o'qilmaganlar budilnik chalmasin
        for (const n of items) {
          if (ALARM_TYPES.includes(n.type) && new Date(n.created_at).getTime() > since) {
            openAlarm(router, { ...(n.data ?? {}), type: n.type, notification_id: n.id });
          }
        }
      } catch {
        // tarmoq yo'q — keyingi safar
      }
    };
    const sync = () => {
      if (me.workspace !== 'client' || AppState.currentState !== 'active') return;
      api<Appointment[]>('/appointments/mine').then(syncBookingAlarms).catch(() => {});
    };
    void ensureNotificationPermission();
    void check();
    sync();
    const timer = setInterval(check, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void check();
        sync();
      }
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [me, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.background },
      headerShadowVisible: false,
      headerTitleStyle: { fontWeight: '700', color: colors.text },
      headerTintColor: colors.primary,
    }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ title: 'Kirish' }} />
      <Stack.Screen name="password" options={{ title: 'Parol bilan kirish' }} />
      <Stack.Screen name="register" options={{ title: 'Ro\'yxatdan o\'tish' }} />
      <Stack.Screen name="profile-edit" options={{ title: 'Shaxsiy ma\'lumotlar' }} />
      <Stack.Screen name="favorites" options={{ title: 'Sevimli salonlar' }} />
      <Stack.Screen name="settings" options={{ title: 'Sozlamalar' }} />
      <Stack.Screen name="change-password" options={{ title: 'Parolni almashtirish' }} />
      <Stack.Screen name="business/[slug]" options={{ title: 'Salon' }} />
      <Stack.Screen name="book" options={{ title: 'Vaqt tanlash' }} />
      <Stack.Screen name="alarm" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Budilnik bilan ochilganda kirish animatsiyasi kerak emas: ekran darhol ko'rinsin
  const [splash, setSplash] = useState(usePathname() !== '/alarm');
  const hideNative = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  const finish = useCallback(() => setSplash(false), []);

  useEffect(() => {
    setupChannels();
    setupCategories();
    if (!splash) hideNative();
  }, [splash, hideNative]);

  return (
    <AuthProvider>
      <FavoritesProvider>
        <Navigator />
      </FavoritesProvider>
      {splash && <AnimatedSplash onReady={hideNative} onDone={finish} />}
    </AuthProvider>
  );
}
