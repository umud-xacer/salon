// Face ID / barmoq izi bilan ilovani ochish. Token telefonda qoladi, biometriya faqat ilovani "qulflaydi".
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

import { t } from './i18n';
import { getItem, setItemAsync } from './secure';

const LOCK = 'chronix_bio_lock';
const ASKED = 'chronix_bio_asked';

const read = (key: string) => {
  try {
    return getItem(key) === '1';
  } catch {
    return false;
  }
};

export const bioLockEnabled = () => read(LOCK);
export const bioAsked = () => read(ASKED);
export const setBioAsked = () => setItemAsync(ASKED, '1').catch(() => {});
export const setBioLock = (on: boolean) => setItemAsync(LOCK, on ? '1' : '0').catch(() => {});

/** Qurilmada biometriya bor va sozlangan bo'lsa: 'face' | 'finger', aks holda null */
export async function bioKind(): Promise<'face' | 'finger' | null> {
  if (Platform.OS === 'web') return null;
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null;
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) ? 'face' : 'finger';
  } catch {
    return null;
  }
}

export async function bioCheck(): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: t("Chronix'ga kirish"),
      cancelLabel: t("Bekor qilish"),
      promptSubtitle: t("Shaxsingizni tasdiqlang"),
    });
    return r.success;
  } catch {
    return false;
  }
}
