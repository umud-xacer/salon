// Onlayn yangilanish (EAS Update). JS va dizayn o'zgarishlari yangi APK'siz keladi.
// Yuklab olingan versiya keyingi ochilishda o'z-o'zidan ishlaydi. Foydalanuvchi xohlasa, darhol qo'llaydi:
// ish paytida (bron yoki budilnik ekranida) ilova kutilmaganda qayta yuklanmaydi.
import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';

const CHECK_EVERY_MS = 30 * 60 * 1000;
const BUSY_SCREENS = ['/alarm', '/book'];

export function useOtaUpdates() {
  const pathname = usePathname();
  const screen = useRef(pathname);
  screen.current = pathname;
  const lastCheck = useRef(0);
  const asked = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    const check = async () => {
      const now = Date.now();
      if (asked.current || now - lastCheck.current < CHECK_EVERY_MS) return;
      lastCheck.current = now;
      try {
        const { isAvailable } = await Updates.checkForUpdateAsync();
        if (!isAvailable) return;
        const { isNew } = await Updates.fetchUpdateAsync();
        if (!isNew || BUSY_SCREENS.includes(screen.current)) return;
        asked.current = true;
        Alert.alert('Yangilanish tayyor', "Ilovaning yangi versiyasi yuklab olindi.", [
          { text: 'Keyinroq', style: 'cancel' },
          { text: 'Yangilash', onPress: () => { Updates.reloadAsync().catch(() => {}); } },
        ]);
      } catch {
        // Internet yo'q yoki server javob bermadi: keyingi safar yana tekshiriladi
        lastCheck.current = 0;
      }
    };

    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, []);
}
