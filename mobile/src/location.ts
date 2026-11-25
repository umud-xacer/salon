// Mijoz joylashuvi: bosh sahifa, xarita va qidiruv bir xil nuqtadan foydalanadi (bir marta so'raladi).
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { api } from './api';
import { t } from './i18n';
import { distanceM, setLastLocation } from './lastLocation';
import * as SecureStore from './secure';
import { afterSplash } from './startup';

// Oxirgi joylashuv telefonda saqlanadi: keyingi ochilishda bosh sahifa darhol shu hudud bo'yicha yuklanadi
// (avval Toshkent, keyin GPS kelgach qayta yuklash bo'lmaydi). Hudud nomi ham.
const SAVED_KEY = 'chronix.last_place';
function saved(): { p: { latitude: number; longitude: number }; place: string } | null {
  try {
    const raw = SecureStore.getItem(SAVED_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.lat === 'number' && typeof v.lng === 'number'
      ? { p: { latitude: v.lat, longitude: v.lng }, place: String(v.place ?? '') } : null;
  } catch {
    return null;
  }
}
const save = (p: { latitude: number; longitude: number }, place: string) => {
  SecureStore.setItemAsync(SAVED_KEY, JSON.stringify({ lat: p.latitude, lng: p.longitude, place })).catch(() => {});
};

export type Point = { latitude: number; longitude: number };
export const TASHKENT: Point = { latitude: 41.3111, longitude: 69.2797 };

type State = { coords: Point; me: Point | null; place: string };
const initial = saved();
let state: State = initial ? { coords: initial.p, me: null, place: initial.place || t("Joylashuvingiz") }
  : { coords: TASHKENT, me: null, place: t("Toshkent") };
let started = false;
const listeners = new Set<(s: State) => void>();

const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
};

async function resolvePlace(p: Point) {
  const found = await api<{ district: string | null; region: string | null }>(
    `/geo/address?lat=${p.latitude}&lng=${p.longitude}`).catch(() => null);
  const place = found?.district ?? found?.region ?? t("Joylashuvingiz");
  set({ place });
  save(p, place);
}

/** Yangi nuqta: 500 m dan kam siljigan bo'lsa ro'yxatlar qayta yuklanmaydi (faqat "men" belgisi yangilanadi) */
function moveTo(p: Point) {
  setLastLocation(p);
  const far = distanceM(state.coords, p.latitude, p.longitude) > 500;
  set(far ? { coords: p, me: p } : { me: p });
  if (far || !state.me) void resolvePlace(p);
}

/** Joylashuvni yangidan olish ("Mening joyim" tugmasi). Ruxsat yo'q bo'lsa null */
export async function locate(): Promise<Point | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  // Avval oxirgi ma'lum nuqta (bir zumda), keyin aniq joy — Balanced: GPS'ni uzoq kutmaydi
  const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
  if (last) moveTo({ latitude: last.coords.latitude, longitude: last.coords.longitude });
  const { coords: c } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const p = { latitude: c.latitude, longitude: c.longitude };
  moveTo(p);
  return p;
}

/** Ruxsat ALLAQACHON berilgan bo'lsa joylashuvni jimgina yangilaydi (so'rov oynasi chiqmaydi). Aks holda null */
export async function locateIfAllowed(): Promise<Point | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    // Avval oxirgi ma'lum nuqta (bir zumda), keyin aniq joylashuv
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
    if (last && !state.me) moveTo({ latitude: last.coords.latitude, longitude: last.coords.longitude });
    return await locate();
  } catch {
    return null;
  }
}

export function useMyLocation() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    if (!started) {
      started = true;
      // Ruxsat allaqachon bor — darhol (oyna chiqmaydi); yo'q bo'lsa so'rov oynasi animatsiyadan keyin
      Location.getForegroundPermissionsAsync()
        .then(({ status }) => {
          if (status === 'granted') locate().catch(() => {});
          else afterSplash(() => { locate().catch(() => {}); }, 300);
        })
        .catch(() => {});              // joylashuv yo'q bo'lsa saqlangan joy yoki Toshkent markazidan qidiriladi
    }
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}
