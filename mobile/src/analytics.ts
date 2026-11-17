// Ilova analitikasi (server: 055_app_analytics.sql): qaysi ekran va tugmalar ishlatilyapti, nima qidirilyapti.
// Hodisalar navbatda to'planadi va har 30 soniyada, 20 tasi yig'ilganda yoki ilova fonga o'tganda yuboriladi.
// Shaxsiy ma'lumot yuborilmaydi: hodisa nomi + kichik props. Qurilma — tasodifiy anon_id (telefonda saqlanadi).
// Analitika hech qachon ilovani buzmasligi kerak: barcha xatolar yutiladi.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { api } from './api';

type Ev = { name: string; props?: Record<string, string | number | boolean | null>; at: string };

const ANON_KEY = 'chronix.anon';
let anon: string | null = null;
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;

async function anonId(): Promise<string> {
  if (anon) return anon;
  try {
    anon = await SecureStore.getItemAsync(ANON_KEY);
    if (!anon) {
      anon = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
      await SecureStore.setItemAsync(ANON_KEY, anon);
    }
  } catch {
    anon = anon ?? '';
  }
  return anon;
}

export async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (sending || queue.length === 0) return;
  sending = true;
  const events = queue.splice(0, 50);
  try {
    await api('/events', { method: 'POST', body: {
      anon_id: await anonId(), platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android',
      app_version: Constants.expoConfig?.version ?? null, events,
    } });
  } catch {
    // Internet yo'q yoki server javob bermadi — yo'qotamiz (analitika uchun muhim emas)
  } finally {
    sending = false;
  }
}

export function track(name: string, props?: Ev['props']) {
  try {
    queue.push({ name, props, at: new Date().toISOString() });
    if (queue.length > 200) queue = queue.slice(-200);
    if (queue.length >= 20) void flush();
    else if (!timer) timer = setTimeout(() => void flush(), 30_000);
  } catch {
    // e'tiborsiz
  }
}

/** Expo Router yo'li: dinamik qismlar ([slug]) nom bilan, aniq salon nomi emas */
export const screenPath = (segments: string[]) => `/${segments.join('/')}`.slice(0, 120);

AppState.addEventListener('change', (s) => { if (s !== 'active') void flush(); });
