// Panel analitikasi (055_app_analytics.sql): qaysi bo'limlar ochilyapti. To'plab, har 20 soniyada yoki
// sahifa yopilayotganda yuboriladi. Shaxsiy ma'lumot yo'q — faqat yo'l (raqamlar :id bilan almashtiriladi).
import { api, json } from "./api/client";

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
  api("/events", { ...json("POST", { anon_id: anonId(), platform: "panel", events }), keepalive: true }).catch(() => {});
}

export function track(name: string, props?: Record<string, unknown>) {
  queue.push({ name, props, at: new Date().toISOString() });
  if (queue.length >= 20) flush();
  else if (!timer) timer = setTimeout(flush, 20_000);
}

export const normalizePath = (path: string) => path.replace(/\/\d+(?=\/|$)/g, "/:id").slice(0, 120);

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
}
