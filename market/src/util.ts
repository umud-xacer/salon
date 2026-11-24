import { useSyncExternalStore } from "react";
import { lang, t } from "./i18n";

export const money = (v: number) => t("{a} so'm", { a: Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ") });

export function distanceText(m: number | null | undefined) {
  if (m == null) return "";
  const km = lang === "ru" ? "км" : "km", mm = lang === "ru" ? "м" : "m";
  if (m > 50000) return `>50 ${km}`;
  return m < 1000 ? `${Math.round(m / 10) * 10} ${mm}` : `${(m / 1000).toFixed(1).replace(".", ",")} ${km}`;
}

export function durationText(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? t("{a} soat", { a: h }) : "", m ? t("{a} daq", { a: m }) : ""].filter(Boolean).join(" ");
}

const WEEKDAYS = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"].map((x) => t(x));
const WD_SHORT = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"].map((x) => t(x));
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"].map((x) => t(x));
export const weekdayName = (iso1to7: number) => WEEKDAYS[iso1to7 - 1] ?? "";

/** Toshkent vaqti bo'yicha "YYYY-MM-DD" */
export function tashkentDay(d = new Date()) {
  return new Date(d.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}
export function nextDays(n: number) {
  const out: { iso: string; wd: string; day: number; month: string }[] = [];
  const base = new Date(`${tashkentDay()}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    out.push({ iso: d.toISOString().slice(0, 10), wd: WD_SHORT[(d.getUTCDay() + 6) % 7], day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] });
  }
  return out;
}
export function dateLong(iso: string) {
  const d = new Date(new Date(iso).getTime() + 5 * 3600 * 1000);
  return `${d.getUTCDate()}${lang === "ru" ? " " : "-"}${MONTHS[d.getUTCMonth()]}, ${WD_SHORT[(d.getUTCDay() + 6) % 7]}`;
}
export function timeOf(iso: string) {
  return new Date(new Date(iso).getTime() + 5 * 3600 * 1000).toISOString().slice(11, 16);
}

// ─── Joylashuv (standart: Toshkent markazi) ────────────────────────────────
export type Coords = { lat: number; lng: number; label: string; precise: boolean };
const DEFAULT: Coords = { lat: 41.3111, lng: 69.2797, label: "Toshkent", precise: false };
let current: Coords = (() => {
  try {
    const v = JSON.parse(localStorage.getItem("chronix.loc") ?? "null");
    if (v && typeof v.lat === "number") return v as Coords;
  } catch { /* yo'q */ }
  return DEFAULT;
})();
const listeners = new Set<() => void>();
export function setLocation(c: Coords) {
  current = c;
  try { localStorage.setItem("chronix.loc", JSON.stringify(c)); } catch { /* yo'q */ }
  listeners.forEach((l) => l());
}
export const useLocation2 = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);

export function locateMe(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("no-geo"));
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const c = { lat: p.coords.latitude, lng: p.coords.longitude, label: "Mening joylashuvim", precise: true };
        setLocation(c);
        resolve(c);
      },
      reject,
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}

// Yaqinda ko'rilganlar (shu brauzerda)
export function addRecent(slug: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem("chronix.recent") ?? "[]");
    localStorage.setItem("chronix.recent", JSON.stringify([slug, ...list.filter((s) => s !== slug)].slice(0, 10)));
  } catch { /* yo'q */ }
}
export function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem("chronix.recent") ?? "[]"); } catch { return []; }
}

export const BIZ_URL = "/biznes";
export const PANEL_URL = "https://www.chronix.uz/";
/** Direktorning o'zi ro'yxatdan o'tishi (panel, 5 kunlik bepul sinov) */
export const SIGNUP_URL = "https://www.chronix.uz/royxatdan-otish";
