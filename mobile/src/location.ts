// Mijoz joylashuvi: bosh sahifa, xarita va qidiruv bir xil nuqtadan foydalanadi (bir marta so'raladi).
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { api } from './api';
import { t } from './i18n';
import { setLastLocation } from './lastLocation';

export type Point = { latitude: number; longitude: number };
export const TASHKENT: Point = { latitude: 41.3111, longitude: 69.2797 };

type State = { coords: Point; me: Point | null; place: string };
let state: State = { coords: TASHKENT, me: null, place: t("Toshkent") };
let started = false;
const listeners = new Set<(s: State) => void>();

const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
};

async function resolvePlace(p: Point) {
  const found = await api<{ district: string | null; region: string | null }>(
    `/geo/address?lat=${p.latitude}&lng=${p.longitude}`).catch(() => null);
  set({ place: found?.district ?? found?.region ?? t("Joylashuvingiz") });
}

/** Joylashuvni yangidan olish ("Mening joyim" tugmasi). Ruxsat yo'q bo'lsa null */
export async function locate(): Promise<Point | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const { coords: c } = await Location.getCurrentPositionAsync({});
  const p = { latitude: c.latitude, longitude: c.longitude };
  setLastLocation(p);
  set({ coords: p, me: p });
  void resolvePlace(p);
  return p;
}

export function useMyLocation() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    if (!started) {
      started = true;
      locate().catch(() => {});          // joylashuv yo'q bo'lsa Toshkent markazidan qidiriladi
    }
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}
