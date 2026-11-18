// API bilan aloqa. chronix.uz/api -> API (Caddy). Access token xotirada, refresh token localStorage'da.
const BASE = "/api/v1";
const REFRESH_KEY = "chronix.market.refresh";

let access: string | null = null;
let onSessionLost: () => void = () => {};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const setSessionLostHandler = (h: () => void) => { onSessionLost = h; };

function readRefresh(): string | null {
  try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
}
function writeRefresh(v: string | null) {
  try {
    if (v) localStorage.setItem(REFRESH_KEY, v);
    else localStorage.removeItem(REFRESH_KEY);
  } catch { /* saqlab bo'lmasa — sessiya faqat shu oynada */ }
}

export function storeSession(t: { access_token: string; refresh_token: string }) {
  access = t.access_token;
  writeRefresh(t.refresh_token);
}
export function clearSession() {
  access = null;
  writeRefresh(null);
}
export const hasRefresh = () => readRefresh() !== null;
export const refreshToken = () => readRefresh();

async function doRefresh(): Promise<boolean> {
  const token = readRefresh();
  if (!token) return false;
  const r = await fetch(`${BASE}/auth/refresh`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: token }),
  }).catch(() => null);
  if (!r) return false;
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) clearSession();
    return false;
  }
  storeSession(await r.json());
  return true;
}

let refreshing: Promise<boolean> | null = null;
export function refreshOnce(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = void>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = "GET", body } = opts;
  const send = () => fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let r: Response;
  try {
    r = await send();
    if (r.status === 401 && (access || readRefresh())) {
      if (await refreshOnce()) r = await send();
      else { clearSession(); onSessionLost(); }
    }
  } catch {
    throw new ApiError(0, "network", "Server bilan aloqa yo'q. Internetni tekshiring");
  }
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const d = data?.detail;
    if (d && typeof d === "object" && typeof d.message === "string") throw new ApiError(r.status, d.code ?? "error", d.message);
    if (Array.isArray(d) && typeof d[0]?.msg === "string") throw new ApiError(r.status, "validation", d[0].msg.replace(/^Value error, /, ""));
    throw new ApiError(r.status, "error", "So'rov bajarilmadi. Qayta urinib ko'ring");
  }
  return data as T;
}

// ─── Javob turlari (mobil ilova bilan bir xil) ───────────────────────────────
export type User = { id: number; phone: string; full_name: string; birth_date: string | null; gender: string | null };
export type LoginOut = { access_token: string; refresh_token: string; user: User; is_new: boolean };
export type Me = { user: User; workspace: "client" | "business" | "superadmin" };

export type Category = { id: number; slug: string; name_uz: string; name_ru?: string | null };

export type BusinessCard = {
  id: number; slug: string; name: string; category?: string; category_name: string;
  city: string | null; address: string | null; lat: number; lng: number; distance_m: number | null;
  rating_avg: number; rating_count: number; min_price: number | null; top_service: string | null;
  photos: string[]; is_open_now: boolean; branch_name?: string | null; chain_name?: string | null;
};

export type Service = { id: number; name: string; name_ru?: string | null; description: string | null; duration_min: number; price: number };
export type Staff = {
  member_id: number; full_name: string; title: string | null; bio?: string | null; photo_url?: string | null;
  rating_avg: number; rating_count: number; service_ids: number[];
};
export type Branch = { id: number; slug: string; name: string; branch_name: string | null; address: string | null; is_open_now: boolean };
export type BusinessDetail = {
  solo?: boolean;                 // yakka rejim: mutaxassis tanlanmaydi (062)
  id: number; slug: string; name: string; description: string | null; address: string | null; phone: string | null;
  photos: string[]; category?: string; category_name: string; kind?: "salon" | "pharmacy" | "clinic";
  rating_avg: number; rating_count: number; is_open_now: boolean; lat?: number; lng?: number;
  hours?: { weekday: number; opens_at: string; closes_at: string }[];
  service_groups: { category_id: number | null; category_name: string; services: Service[] }[];
  staff: Staff[]; branch_name?: string | null; chain_name?: string | null; branches?: Branch[];
};

export type Slot = { starts_at: string; ends_at: string; time: string };

export type PublicReview = {
  id: number; author: string; member_name: string | null; rating: number; comment: string | null;
  staff_rating: number | null; reply: string | null; created_at: string;
};
export type ReviewsOut = { summary: { count: number; rating_avg: number | null; distribution: Record<string, number> }; items: PublicReview[] };

export type HotSlot = {
  business_id: number; business_slug: string; business_name: string; category_name: string; distance_m: number | null;
  photo: string | null; service_id: number; service_name: string; member_id: number; member_name: string;
  starts_at: string; time: string; percent: number; price: number; final: number; ends_window: string;
};
export type Offer = { business_id: number; business_slug: string; business_name: string; code: string; title: string; percent: number; first_visit_only: boolean };

export type Quote = {
  price: number; percent: number; discount: number; final: number; source: "hot" | "promo" | "loyalty" | null;
  code_error: "promo_not_found" | "promo_used" | "promo_limit" | "promo_first_visit" | null;
};

export type Appointment = {
  id: number; business_name: string | null; business_slug: string | null; business_address: string | null;
  member_name: string | null; status: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
  starts_at: string; ends_at: string; total_price: number; discount?: number; services: string[];
};
