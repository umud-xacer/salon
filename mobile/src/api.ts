import * as SecureStore from './secure';

import { t } from "./i18n";
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
        // Server mobil ilovada vaqtincha yashirilgan turlarni (klinikalar) katalogdan chiqarmaydi — backend client_filter.py
        'X-Chronix-Client': 'mobile',
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
    throw new ApiError(0, 'network', t("Server bilan aloqa yo'q"));
  }

  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const detail = data?.detail;
    const message = typeof detail?.message === 'string' ? detail.message : t("Ma'lumot noto'g'ri");
    throw new ApiError(r.status, detail?.code ?? 'error', message);
  }
  return data as T;
}

// ─── Javob turlari ──────────────────────────────────────────────────────────
export type User = {
  id: number;
  phone: string;
  full_name: string;
  birth_date: string | null;
  gender: 'male' | 'female' | null;
  backup_phone?: string | null;           // zaxira aloqa raqami (eski server yubormasa — undefined)
  phone_confirmed_at?: string | null;     // oxirgi marta "raqamim hamon shu" deb tasdiqlagan
};
export type LoginOut = Tokens & { user: User; is_new: boolean };
export type Me = { user: User; workspace: 'client' | 'business' | 'superadmin' };

export type BusinessCard = {
  id: number;
  slug: string;
  name: string;
  category?: string;                    // yo'nalish slug'i
  category_name: string;
  category_name_ru?: string | null;
  city: string | null;
  address: string | null;
  lat: number;
  lng: number;
  distance_m: number | null;
  rating_avg: number;
  rating_count: number;
  min_price: number | null;
  top_service: string | null;
  photos: string[];
  is_open_now: boolean;
  // Tarmoq: filial yorlig'i, asosiy kompaniya nomi (filial bo'lsa), ilovadagi filiallar soni (o'zi bilan)
  branch_name?: string | null;
  chain_name?: string | null;
  branch_count?: number;
  promo_percent?: number | null;        // xarita: bugungi eng katta aksiya, %
  logo_url?: string | null;
  map_image?: string | null;            // xarita belgisi: logo yoki birinchi rasmning 128px nusxasi (eski serverda yo'q)
};

export type Branch = {
  id: number;
  slug: string;
  name: string;
  branch_name: string | null;
  city: string | null;
  address: string | null;
  lat: number;
  lng: number;
  rating_avg: number;
  rating_count: number;
  is_open_now: boolean;
};

export type Category = { id: number; slug: string; name_uz: string; name_ru?: string | null };

export type Service = { id: number; name: string; name_ru?: string | null; description: string | null; duration_min: number; price: number };
export type Staff = {
  member_id: number; full_name: string; title: string | null; bio?: string | null; photo_url?: string | null;
  rating_avg: number; rating_count: number; service_ids: number[];
};
export type BusinessDetail = {
  solo?: boolean;                       // yakka rejim: mutaxassis tanlanmaydi (062)
  id: number;
  slug: string;
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  photos: string[];
  category?: string;
  category_name: string;
  category_name_ru?: string | null;
  kind?: 'salon' | 'pharmacy' | 'clinic';
  rating_avg: number;
  rating_count: number;
  is_open_now: boolean;
  lat?: number;
  lng?: number;
  hours?: { weekday: number; opens_at: string; closes_at: string }[];
  service_groups: { category_id: number | null; category_name: string; category_name_ru?: string | null; services: Service[] }[];
  staff: Staff[];
  branch_name?: string | null;
  chain_name?: string | null;
  branch_count?: number;
  branches?: Branch[];
};

export type Slot = { starts_at: string; ends_at: string; time: string };

export type Appointment = {
  id: number;
  business_name: string | null;
  business_slug: string | null;
  business_address: string | null;
  business_lat: number | null;
  business_lng: number | null;
  member_id: number;
  member_name: string | null;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  starts_at: string;
  ends_at: string;
  total_price: number;
  discount?: number;                    // aksiya chegirmasi; to'lanadigani total_price - discount
  discount_source?: 'hot' | 'promo' | 'loyalty' | null;
  services: string[];
  services_ru?: string[];
  service_ids: number[];
  attendance: 'reminded' | 'confirmed' | 'no_response' | null;
  needs_contact: boolean;
  review_rating?: number | null;
  review_staff_rating?: number | null;
  can_review?: boolean;
  confirm_by?: string | null;          // salon shu vaqtgacha tasdiqlamasa — avtomatik bekor
  cancel_reason?: string | null;
};

export type PublicReview = {
  id: number;
  author: string;
  member_id: number | null;
  member_name: string | null;
  rating: number;
  cleanliness: number | null;
  service_quality: number | null;
  comment: string | null;
  staff_rating: number | null;
  staff_comment: string | null;
  reply: string | null;
  reply_at: string | null;
  created_at: string;
};

export type ReviewsOut = {
  summary: {
    count: number;
    rating_avg: number | null;
    cleanliness_avg: number | null;
    quality_avg: number | null;
    distribution: Record<string, number>;
  };
  items: PublicReview[];
};

export type Notification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: {
    appointment_id?: number; action?: string; slug?: string;
    service_id?: number; member_id?: number; starts_at?: string;     // waitlist_offer (sql/052)
  } | null;
  read_at: string | null;
  created_at: string;
};

// ─── Aksiyalar ──────────────────────────────────────────────────────────────
export type HotSlot = {
  business_id: number;
  business_slug: string;
  business_name: string;
  category_name: string;
  category_name_ru?: string | null;
  distance_m: number | null;
  photo: string | null;
  service_id: number;
  service_name: string;
  service_name_ru?: string | null;
  member_id: number;
  member_name: string;
  starts_at: string;
  time: string;
  percent: number;
  price: number;
  final: number;
  rule_title: string;
  ends_window: string;
};

export type Offer = {
  business_id: number;
  business_slug: string;
  business_name: string;
  distance_m: number | null;
  code: string;
  title: string;
  percent: number;
  first_visit_only: boolean;
  valid_to: string | null;
};

export type MyLoyalty = {
  business_id: number;
  business_slug: string;
  business_name: string;
  visits: number;
  required: number;
  percent: number;
  ready: boolean;
};

export type Quote = {
  price: number;
  percent: number;
  discount: number;
  final: number;
  source: 'hot' | 'promo' | 'loyalty' | null;
  code_error: 'promo_not_found' | 'promo_used' | 'promo_limit' | 'promo_first_visit' | null;
};
