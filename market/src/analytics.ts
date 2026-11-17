// chronix.uz analitikasi (055_app_analytics.sql): sahifalar, qidiruv, bron va navbat.
// sahifa yopilayotganda yuboriladi. Shaxsiy ma'lumot yo'q.
import { api } from "./api";

type Ev = { name: string; props?: Record<string, unknown>; at: string };

const ANON_KEY = "chronix.anon";
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function anonId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0) return;
  const events = queue.splice(0, 50);
  api("/events", { method: "POST", body: { anon_id: anonId(), platform: "market", events } }).catch(() => {});
}

export function track(name: string, props?: Record<string, unknown>) {
  queue.push({ name, props, at: new Date().toISOString() });
  if (queue.length >= 20) flush();
  else if (!timer) timer = setTimeout(flush, 20_000);
}

export const normalizePath = (path: string) => path.replace(/^\/s\/[^/]+/, "/s/:slug").replace(/\/\d+(?=\/|$)/g, "/:id").slice(0, 120);

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
}

// Hududiy analitika (061): sessiya boshida hudud. Koordinata faqat brauzerda ruxsat OLDINDAN berilgan bo'lsa
// (so'ralmaydi), aks holda server IP bo'yicha taxminiy shaharni aniqlaydi. 15 daqiqada ko'pi bilan bir marta.
const PING_KEY = "chronix.locping";
export async function locationPing(withGps: boolean) {
  try {
    const last = Number(localStorage.getItem(PING_KEY) || 0);
    if (Date.now() - last < 15 * 60_000) return;
    localStorage.setItem(PING_KEY, String(Date.now()));
  } catch {
    return;
  }
  let coords: { latitude: number; longitude: number } | null = null;
  if (withGps && navigator.permissions && navigator.geolocation) {
    try {
      const st = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      if (st.state === "granted") {
        coords = await new Promise((res) => navigator.geolocation.getCurrentPosition(
          (p) => res({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => res(null),
          { maximumAge: 600_000, timeout: 5000 }));
      }
    } catch {
      coords = null;
    }
  }
  const body = { device_id: anonId(), platform: "market", ...(coords ?? {}) };
  api("/analytics/location-ping", { method: "POST", body }).catch(() => {});
}
