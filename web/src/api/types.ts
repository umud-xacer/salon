// Backend javoblari (app/schemas). Maydon qo'shilsa, avval shu yerda.
export type Panel = "admin" | "staff";

export interface User {
  id: number;
  phone: string;
  full_name: string;
  language: string;
  is_superadmin: boolean;
}

export interface Membership {
  member_id: number;
  business_id: number;
  business_name: string;
  business_status: "pending" | "active" | "blocked";
  business_active: boolean;
  subscription_ends_at: string | null;
  operational: boolean;
  role: "owner" | "manager" | "receptionist" | "staff";
  panel: Panel;
  title: string | null;
  permissions: string[];
  modules: string[];
}

export interface Me {
  user: User;
  workspace: "superadmin" | "business" | "client";
  memberships: Membership[];
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
}

export interface Appointment {
  id: number;
  member_id: number;
  member_name: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  total_price: number;
  services: string[];
  client_name: string | null;
  client_phone: string | null;
}

export interface ScheduleDay {
  weekday: number;
  start_time: string;
  end_time: string;
  breaks: { start: string; end: string }[];
}

export interface ModuleInfo {
  code: string;
  name: string;
}

export interface BusinessAdmin {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  status: "pending" | "active" | "blocked";
  is_active: boolean;
  subscription_ends_at: string | null;
  operational: boolean;
  owner_name: string | null;
  owner_phone: string | null;
  staff_count: number;
  modules: string[];
}
