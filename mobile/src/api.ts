import * as SecureStore from 'expo-secure-store';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8001';
const BASE = `${API_URL}/api/v1`;

const ACCESS = 'access_token';
const REFRESH = 'refresh_token';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type Tokens = { access_token: string; refresh_token: string };

let access: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: () => void = () => {};

export function setSessionLostHandler(handler: () => void) {
  onSessionLost = handler;
}

export async function saveTokens(t: Tokens) {
  access = t.access_token;
  await SecureStore.setItemAsync(ACCESS, t.access_token);
  await SecureStore.setItemAsync(REFRESH, t.refresh_token);
}

export async function clearTokens() {
  access = null;
  await SecureStore.deleteItemAsync(ACCESS);
  await SecureStore.deleteItemAsync(REFRESH);
}

export async function loadTokens(): Promise<boolean> {
  access = await SecureStore.getItemAsync(ACCESS);
  return access !== null;
}

export const getRefreshToken = () => SecureStore.getItemAsync(REFRESH);

// Refresh token bir martalik: bir vaqtda kelgan so'rovlar bitta yangilashni kutadi
function refreshOnce(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const refresh_token = await getRefreshToken();
      if (!refresh_token) return false;
      const r = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token }),
      });
      if (!r.ok) return false;
      await saveTokens(await r.json());
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

type Options = { method?: string; body?: unknown };

export async function api<T = void>(path: string, { method = 'GET', body }: Options = {}): Promise<T> {
  const send = () =>
    fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let r: Response;
  try {
    r = await send();
    if (r.status === 401 && access) {
      if (await refreshOnce()) {
        r = await send();
      } else {
        await clearTokens();
        onSessionLost();
      }
    }
  } catch {
    throw new ApiError(0, 'network', "Server bilan aloqa yo'q");
  }

  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const detail = data?.detail;
    const message = typeof detail?.message === 'string' ? detail.message : "Ma'lumot noto'g'ri";
    throw new ApiError(r.status, detail?.code ?? 'error', message);
  }
  return data as T;
}

// ─── Javob turlari ──────────────────────────────────────────────────────────
export type User = { id: number; phone: string; full_name: string };
export type LoginOut = Tokens & { user: User; is_new: boolean };
export type Me = { user: User; workspace: 'client' | 'business' | 'superadmin' };

export type BusinessCard = {
  id: number;
  slug: string;
  name: string;
  category_name: string;
  address: string | null;
  distance_m: number | null;
  rating_avg: number;
  rating_count: number;
  min_price: number | null;
  is_open_now: boolean;
};

export type Service = { id: number; name: string; description: string | null; duration_min: number; price: number };
export type Staff = { member_id: number; full_name: string; title: string | null; rating_avg: number; service_ids: number[] };
export type BusinessDetail = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  category_name: string;
  rating_avg: number;
  rating_count: number;
  is_open_now: boolean;
  service_groups: { category_id: number | null; category_name: string; services: Service[] }[];
  staff: Staff[];
};

export type Slot = { starts_at: string; ends_at: string; time: string };

export type Appointment = {
  id: number;
  business_name: string | null;
  member_id: number;
  member_name: string | null;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  starts_at: string;
  ends_at: string;
  total_price: number;
  services: string[];
  service_ids: number[];
  attendance: 'reminded' | 'confirmed' | 'no_response' | null;
  needs_contact: boolean;
};

export type Notification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: { appointment_id?: number; action?: string } | null;
  read_at: string | null;
  created_at: string;
};
