// Direktorning o'zi ro'yxatdan o'tishi va 5 kunlik sinov (backend: app/api/v1/onboarding.py, sql/070).
import { api, json, publicGet, publicPost } from "./client";
import type { LoginResponse, Region } from "./types";

export type TeamSize = "1" | "2-5" | "6-10" | "11-20" | "21+";

export interface SignupCategory { id: number; slug: string; name_uz: string; name_ru: string | null; icon: string | null; kind: string }

export interface SignupPoll {
  status: "pending" | "ok";
  signup_token: string | null;
  phone: string | null;
  full_name: string | null;
  exists: boolean;
  has_password: boolean;
}

export interface SignupBody {
  signup_token: string;
  full_name: string;
  password: string;
  category_id: number;
  team_size: TeamSize;
  business_name: string;
  region: string | null;
  city: string | null;
  address: string | null;
  contact_phone: string | null;
}

export type SignupResult = LoginResponse & { business_id: number; business_slug: string };

export interface Readiness {
  logged_in: boolean; services: boolean; staff: boolean; hours: boolean; location: boolean; photos: boolean;
  visible: boolean; all_filled: boolean;
}

export interface Onboarding {
  status: "none" | "pending" | "trial" | "converted";
  trial_ends_at: string | null;
  days_left: number | null;
  readiness: Readiness | null;
}

export interface SignupAdmin {
  business_id: number; business_name: string; slug: string; category_name: string | null;
  region: string | null; city: string | null; address: string | null; contact_phone: string | null;
  team_size: TeamSize; owner_name: string; owner_phone: string; owner_telegram: boolean;
  status: "pending" | "trial" | "converted"; created_at: string; reviewed_at: string | null;
  trial_started_at: string | null; trial_ends_at: string | null; sms_day3_at: string | null; tg_day4_at: string | null;
  readiness: Readiness | null;
}

export interface TrialEvent {
  id: number; business_id: number; business_name: string; owner_phone: string | null; event: string;
  dry_run: boolean; details: Record<string, unknown>; created_at: string;
}

export const signupRegions = () => publicGet<Region[]>("/onboarding/regions");
export const signupCategories = () => publicGet<SignupCategory[]>("/onboarding/categories");
export const signupTelegramStart = () =>
  publicPost<{ nonce: string; url: string; expires_in: number }>("/onboarding/telegram/start", {});
export const signupTelegramPoll = (nonce: string) => publicPost<SignupPoll>("/onboarding/telegram/poll", { nonce });
export const signupSubmit = (body: SignupBody) => publicPost<SignupResult>("/onboarding/signup", body);

export const businessOnboarding = (businessId: number) => api<Onboarding>(`/businesses/${businessId}/onboarding`);

export const adminSignups = (status: string) => api<SignupAdmin[]>(`/superadmin/signups?status=${status}`);
export const adminSignupCount = () => api<{ pending: number }>("/superadmin/signups/count");
export const adminApprove = (id: number, days?: number) =>
  api<void>(`/superadmin/signups/${id}/approve`, json("POST", { days: days ?? null }));
export const adminReject = (id: number, reason: string) =>
  api<void>(`/superadmin/signups/${id}/reject`, json("POST", { reason: reason || null }));
export const adminTrialEvents = () => api<TrialEvent[]>("/superadmin/signups/events?limit=200");
