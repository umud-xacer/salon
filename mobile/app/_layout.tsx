import * as Notifications from 'expo-notifications';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AnimatedSplash } from '../src/AnimatedSplash';
import { AuthProvider, useAuth } from '../src/auth';
import { ALARM_TYPES, openedAlarms, setupChannels } from '../src/notifications';

SplashScreen.preventAutoHideAsync().catch(() => {});

function openAlarm(router: ReturnType<typeof useRouter>, data: Record<string, unknown> = {}) {
  const id = String(data.notification_id);
  if (!ALARM_TYPES.includes(String(data.type)) || openedAlarms.has(id)) return;
  openedAlarms.add(id);
  router.push({
    pathname: '/alarm',
    params: {
      type: String(data.type),
      appointmentId: String(data.appointment_id),
      notificationId: id,
    },
  });
}

function Navigator() {
  const { me, ready } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === 'login' || segments[0] === 'password';
    if (!me && !onLogin) router.replace('/login');
    if (me && onLogin) router.replace('/');
  }, [me, ready, segments, router]);

  useEffect(() => {
    if (!me) return;
    // Ilova ochiq paytda keldi
    const received = Notifications.addNotificationReceivedListener((n) =>
      openAlarm(router, n.request.content.data));
    // Bildirishnoma bosildi (ilova fonda yoki yopiq edi)
    const tapped = Notifications.addNotificationResponseReceivedListener((r) =>
      openAlarm(router, r.notification.request.content.data));
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      openAlarm(router, last.notification.request.content.data);
      Notifications.clearLastNotificationResponse();
    }
    return () => {
      received.remove();
      tapped.remove();
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
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ title: 'Kirish' }} />
      <Stack.Screen name="password" options={{ title: 'Parol bilan kirish' }} />
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
    if (!splash) hideNative();
  }, [splash, hideNative]);

  return (
    <AuthProvider>
      <Navigator />
      {splash && <AnimatedSplash onReady={hideNative} onDone={finish} />}
    </AuthProvider>
  );
}
