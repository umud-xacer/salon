// Backend javoblari (app/schemas). Maydon qo'shilsa, avval shu yerda.
export type Panel = "admin" | "staff";

export interface User {
  id: number;
  phone: string;
  full_name: string;
  language: string;
  is_superadmin: boolean;
  must_change_password: boolean;
}

export type PasswordStatus = "none" | "temporary" | "own";

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

export interface CalendarStaff {
  id: number;
  full_name: string;
  title: string | null;
}

export interface CalendarData {
  start: string;
  days: number;
  hour_from: number;
  hour_to: number;
  staff: CalendarStaff[];
  appointments: Appointment[];
}

export interface ReceptionOptions {
  services: { id: number; name: string; duration_min: number; price: number }[];
  staff: (CalendarStaff & { service_ids: number[] })[];
}

export interface Slot {
  starts_at: string;
  ends_at: string;
  time: string;
  free_staff?: number;
}

export interface Client {
  id: number;
  full_name: string;
  phone: string;
}

export interface ScheduleDay {
  weekday: number;
  start_time: string;
  end_time: string;
  breaks: { start: string; end: string }[];
}

export interface Member {
  id: number;
  user_id: number;
  role: Membership["role"];
  full_name: string;
  phone: string;
  title: string | null;
  is_active: boolean;
  is_bookable: boolean;
  password_block: string | null;
  password_status: PasswordStatus;
  password_changed_at: string | null;
}

export interface MemberPermission {
  code: string;
  description: string | null;
  module_code: string | null;
  module_enabled: boolean;
  role_default: boolean;
  override: boolean | null;
  effective: boolean;
}

export interface MemberService {
  service_id: number;
  custom_price: number | null;
  custom_duration: number | null;
}

export interface Service {
  id: number;
  name: string;
  description: string | null;
  category_id: number | null;
  duration_min: number;
  price: number;
  is_active: boolean;
}

export interface ServiceCategory {
  id: number;
  name: string;
  sort_order: number;
}

export interface TimeOff {
  id: number;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface ClientRecord extends Client {
  notes: string | null;
  has_account: boolean;
  visits: number;
  total_spent: number;
  last_visit: string | null;
}

export interface ModuleInfo {
  code: string;
  name: string;
}

export interface BusinessAdmin {
  id: number;
  name: string;
  slug: string;
  category_id: number;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: "pending" | "active" | "blocked";
  is_active: boolean;
  subscription_ends_at: string | null;
  operational: boolean;
  owner_name: string | null;
  owner_phone: string | null;
  owner_password_status: PasswordStatus | null;
  owner_password_changed_at: string | null;
  staff_count: number;
  modules: string[];
}
