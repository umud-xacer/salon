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

export interface Region {
  name: string;
  districts: string[];
}

export interface ReverseAddress {
  address: string;
  region: string | null;
  district: string | null;
  display: string;
}

export interface BusinessProfile {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  is_listed: boolean;
}

export interface BusinessHours {
  weekday: number;
  opens_at: string;
  closes_at: string;
}

export interface BusinessPhoto {
  id: number;
  url: string;
  sort_order: number;
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
  region: string | null;
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
  service_count: number;
  hours_count: number;
  photo_count: number;
  modules: string[];
}

export interface Payment {
  id: number;
  appointment_id: number | null;
  amount: number;
  method: string;
  status: "paid" | "refunded" | "pending" | "failed";
  paid_at: string;
  note: string | null;
  received_by_name: string | null;
  client_name: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  refunded_by_name: string | null;
}

export interface AppointmentPayments {
  appointment_id: number;
  payable: boolean;
  total: number;
  paid: number;
  due: number;
  payments: Payment[];
}

export interface UnpaidAppointment {
  id: number;
  starts_at: string;
  status: string;
  client_name: string | null;
  member_name: string | null;
  services: string[];
  due: number;
}

export interface CashDay {
  date: string;
  income: number;
  refunds: number;
  expenses: number | null;
  net: number | null;
  methods: { method: string; income: number; refunds: number }[];
  unpaid: UnpaidAppointment[];
  payments: Payment[];
}

export interface Product {
  id: number;
  name: string;
  sku: string | null;
  unit: string;
  cost_price: number;
  sale_price: number;
  min_qty: number;
  current_qty: number;
  is_active: boolean;
  is_low: boolean;
}

export interface InventorySummary {
  products: number;
  low_count: number;
  stock_value: number;
  low: Product[];
}

export interface StockMovement {
  id: number;
  product_id: number;
  product_name: string;
  unit: string;
  type: string;
  qty: number;
  unit_cost: number | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface Compensation {
  member_id: number;
  full_name: string;
  role: string;
  title: string | null;
  base_salary: number;
  commission_percent: number;
}

export interface Payroll {
  id: number;
  member_id: number;
  full_name: string;
  title: string | null;
  period_start: string;
  period_end: string;
  base_salary: number;
  revenue: number;
  commission_percent: number;
  commission: number;
  bonus: number;
  deductions: number;
  total: number;
  status: "draft" | "approved" | "paid";
  note: string | null;
  approved_at: string | null;
  paid_at: string | null;
}

export interface PayrollList {
  month: string;
  total: number;
  paid: number;
  items: Payroll[];
}

export interface ExpenseCategory {
  id: number;
  name: string;
}

export interface Expense {
  id: number;
  category_id: number | null;
  category_name: string | null;
  amount: number;
  spent_at: string;
  note: string | null;
  created_by_name: string | null;
}

export interface ExpenseList {
  total: number;
  items: Expense[];
}
