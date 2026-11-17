import * as Notifications from 'expo-notifications';
import { screenPath, track } from '../src/analytics';
import { Stack, usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Text, View } from 'react-native';

import { AnimatedSplash } from '../src/AnimatedSplash';
import { api, ApiError, Appointment, Notification as ApiNotification } from '../src/api';
import { AuthProvider, useAuth } from '../src/auth';
import { AuthGateProvider } from '../src/authGate';
import { FavoritesProvider } from '../src/favorites';
import { cancelBookingReminder, syncBookingAlarms } from '../src/localReminders';
import {
  ACTION_ATTEND, ACTION_DECLINE, ALARM_TYPES, alarmKey, ensureNotificationPermission, openedAlarms, setupCategories,
  setupChannels,
} from '../src/notifications';
import { bioCheck, bioLockEnabled } from '../src/biometric';
import { ThemeProvider, useTheme } from '../src/theme';
import { Button, font, Icon } from '../src/ui';
import { StatusBar } from 'expo-status-bar';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { prepareStartupSound } from '../src/startupSound';
import { useOtaUpdates } from '../src/useOtaUpdates';

import { t } from "../src/i18n";
SplashScreen.preventAutoHideAsync().catch(() => {});
// Ochilish ovozi fayli splash animatsiyasidan oldin yuklanib tursin (animatsiya paytida faqat play)
prepareStartupSound();

const POLL_MS = 60_000;          // budilnikning o'zi telefonda rejalashtirilgan; bu faqat qo'shimcha tekshiruv

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
        Alert.alert(t("Rahmat!"), t("Kelishingizni salonga bildirdik."));
      } else {
        await api(`/appointments/${id}/cancel`, { method: 'POST', body: { reason: t("Mijoz budilnikda \"Bormayman\" dedi") } });
        await cancelBookingReminder(id);
        Alert.alert(t("Bron bekor qilindi"), t("Vaqt boshqa mijozlar uchun ochildi."));
      }
    } catch (e) {
      Alert.alert(t("Xatolik"), e instanceof ApiError ? e.message : t("Internetni tekshirib, qayta urinib ko'ring"));
    }
    router.replace('/bookings');
    return;
  }
  if (data.type === 'review_request' || data.action === 'review') {
    router.push({ pathname: '/review', params: { appointmentId: String(data.appointment_id) } });
    return;
  }
  if (typeof data.type === 'string' && data.type.startsWith('promo_') && typeof data.slug === 'string') {
    router.push({ pathname: '/business/[slug]', params: { slug: data.slug } });
    return;
  }
  openAlarm(router, data);
}

const AUTH_SCREENS = ['login', 'otp', 'password', 'telegram-wait'];
const SETUP_SCREENS = { profile: 'onboarding', biometric: 'biometric' } as const;

/** Face ID yoqilgan bo'lsa: ilova ochilganda (va fondan qaytganda) shaxs tasdiqlanadi */
function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { c } = useTheme();
  const tryUnlock = useCallback(async () => {
    if (await bioCheck()) onUnlock();
  }, [onUnlock]);
  useEffect(() => {
    void tryUnlock();
  }, [tryUnlock]);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', backgroundColor: c.bg,
      justifyContent: 'center', padding: 32, gap: 18 }}>
      <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="scan-outline" size={46} color={c.accent} />
      </View>
      <Text style={{ color: c.text, fontSize: 24, ...font('700') }}>{t("Chronix qulflangan")}</Text>
      <View style={{ alignSelf: 'stretch' }}>
        <Button title={t("Ochish")} icon="lock-open-outline" onPress={() => { void tryUnlock(); }} />
      </View>
    </View>
  );
}

function Navigator() {
  const { me, ready, setup } = useAuth();
  const { c, dark } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const nav = useRootNavigationState();
  const [locked, setLocked] = useState(bioLockEnabled);
  useOtaUpdates();

  // Analitika: ilova ochildi va qaysi ekran ko'rildi (salon nomi emas — "[slug]" ko'rinishida)
  useEffect(() => { track('app_open'); }, []);
  const path = screenPath(segments as string[]);
  useEffect(() => { track('screen', { path }); }, [path]);

  // "Lazy auth": mehmon ilovani erkin ko'radi (majburiy kirish yo'q). Kirgandan so'ng kirish/sozlash ekranlari
  // yopiladi va foydalanuvchi qaysi ekrandan (salon, bron oynasi...) kirishga o'tgan bo'lsa, o'shanga qaytadi.
  useEffect(() => {
    if (!ready || !me) return;
    const here = segments[0] as string | undefined;
    const routes = nav?.routes ?? [];
    const trailing = (names: string[]) => {
      let n = 0;
      for (let i = routes.length - 1; i >= 0 && names.includes(routes[i].name); i--) n++;
      return n;
    };
    const setupNames = Object.values(SETUP_SCREENS) as string[];
    const leave = (n: number) => {
      if (n > 0 && routes.length > n) router.dismiss(n);
      else router.replace('/');
    };
    if (AUTH_SCREENS.includes(here ?? '')) {
      const n = trailing(AUTH_SCREENS);
      if (setup) {
        if (n > 1 && routes.length > n) router.dismiss(n - 1);
        router.replace(`/${SETUP_SCREENS[setup]}`);
      } else {
        leave(n);
      }
    } else if (setup && here !== SETUP_SCREENS[setup]) {
      if (setupNames.includes(here ?? '')) router.replace(`/${SETUP_SCREENS[setup]}`);
      else router.push(`/${SETUP_SCREENS[setup]}`);
    } else if (!setup && setupNames.includes(here ?? '')) {
      leave(trailing(setupNames));
    }
  }, [me, ready, setup, segments, nav, router]);

  // Fondan qaytganda qayta qulflash (Face ID yoqilgan bo'lsa)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' && bioLockEnabled()) setLocked(true);
    });
    return () => sub.remove();
  }, []);

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
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <StatusBar style={dark ? 'light' : 'dark'} />
    <Stack screenOptions={{
      headerStyle: { backgroundColor: c.bg },
      headerShadowVisible: false,
      headerTitleStyle: { fontWeight: '800', color: c.text },
      headerTintColor: c.text,
      contentStyle: { backgroundColor: c.bg },
      animation: 'slide_from_right',
    }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="otp" options={{ headerShown: false }} />
      <Stack.Screen name="telegram-wait" options={{ headerShown: false }} />
      <Stack.Screen name="delete-account" options={{ title: t("Hisobni o'chirish") }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="biometric" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="password" options={{ title: t("Parol bilan kirish") }} />
      <Stack.Screen name="search" options={{ headerShown: false, animation: 'fade_from_bottom' }} />
      <Stack.Screen name="inbox" options={{ title: t("Bildirishnomalar") }} />
      <Stack.Screen name="bonuses" options={{ title: t("Bonuslarim") }} />
      <Stack.Screen name="profile-edit" options={{ title: t("Shaxsiy ma'lumotlar") }} />
      <Stack.Screen name="favorites" options={{ title: t("Sevimli salonlar") }} />
      <Stack.Screen name="settings" options={{ title: t("Sozlamalar") }} />
      <Stack.Screen name="change-password" options={{ title: t("Parolni almashtirish") }} />
      <Stack.Screen name="business/[slug]" options={{ headerShown: false }} />
      <Stack.Screen name="book" options={{ headerShown: false, presentation: 'transparentModal', animation: 'fade' }} />
      <Stack.Screen name="review" options={{ title: t("Xizmatni baholash") }} />
      <Stack.Screen name="alarm" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
    </Stack>
    {me && locked && <LockScreen onUnlock={() => setLocked(false)} />}
    </View>
  );
}

export default function RootLayout() {
  // Budilnik bilan ochilganda kirish animatsiyasi kerak emas: ekran darhol ko'rinsin
  const [splash, setSplash] = useState(usePathname() !== '/alarm');
  // Shrift ilova bilan birga keladi; yuklashda xato bo'lsa — tizim shrifti bilan ochiladi
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const hideNative = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  const finish = useCallback(() => setSplash(false), []);

  useEffect(() => {
    setupChannels();
    setupCategories();
    if (!splash) hideNative();
  }, [splash, hideNative]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGateProvider>
          <FavoritesProvider>
            <Navigator />
          </FavoritesProvider>
        </AuthGateProvider>
        {splash && <AnimatedSplash onReady={hideNative} onDone={finish} />}
      </AuthProvider>
    </ThemeProvider>
  );
}
