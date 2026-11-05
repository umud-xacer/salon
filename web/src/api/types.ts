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

export type PasswordStatus = "none" | "issued" | "temporary" | "own";

export interface Membership {
  member_id: number;
  business_id: number;
  business_name: string;
  business_slug: string;
  business_kind: string;
  staff_titles?: string[];
  business_type_name?: string | null;
  staff_word?: string | null;
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
  confirm_by?: string | null;        // 'pending': shu vaqtgacha tasdiqlanmasa — avtomatik bekor qilinadi
  cancel_reason?: string | null;
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
  category_name: string;
  default_opens_at: string;
  default_closes_at: string;
}

export interface ReportDay {
  date: string;
  income: number;
  refunds: number;
  expenses: number;
  bookings: number;
}

export interface Report {
  date_from: string;
  date_to: string;
  money: { income: number; refunds: number; net_income: number; expenses: number; profit: number;
           prev_net_income: number; prev_profit: number };
  methods: { method: string; income: number; refunds: number }[];
  expenses_by_category: { name: string; amount: number }[];
  bookings: { total: number; by_status: Record<string, number>; by_source: Record<string, number>;
              completed: number; completed_revenue: number; avg_check: number; cancel_rate: number };
  services: { name: string; count: number; revenue: number }[];
  staff: { member_id: number; name: string; bookings: number; completed: number; no_show: number; revenue: number }[];
  clients: { total: number; new: number; returning: number };
  daily: ReportDay[];
}

export interface ServicePreset {
  name: string;
  duration_min: number;
  price: number;
  category?: string | null;
}

export interface BusinessType {
  id: number;
  slug: string;
  kind: string;
  name_uz: string;
  name_ru: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  opens_at: string;
  closes_at: string;
  service_presets: ServicePreset[];
  staff_titles: string[];
  staff_word?: string | null;
  business_count: number;
}

export interface ServicePresets {
  category_name: string;
  presets: (ServicePreset & { exists: boolean })[];
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
  owner_member_id: number | null;
  owner_user_id?: number | null;
  owner_status?: string | null;
  owner_last_login_at?: string | null;
  type_name?: string | null;
  staff_count: number;
  service_count: number;
  hours_count: number;
  photo_count: number;
  rating_avg: number;
  rating_count: number;
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
  category: string | null;
  barcode: string | null;
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

// ─── Super Admin: obuna to'lovlari va platforma statistikasi (W7) ──────────
export type SubscriptionMethod = "cash" | "card" | "transfer" | "free";

export interface SubscriptionPayment {
  id: number;
  business_id: number | null;
  business_name: string;
  days: number;
  amount: number;
  method: SubscriptionMethod;
  note: string | null;
  ends_at: string;
  created_by_name: string | null;
  created_at: string;
}

export interface PlatformStats {
  businesses_total: number;
  businesses_operational: number;
  businesses_suspended: number;
  businesses_blocked: number;
  businesses_listed: number;
  expiring_soon: { id: number; name: string; subscription_ends_at: string; owner_phone: string | null }[];
  by_type: { key: string; label: string; count: number }[];
  users_total: number;
  clients_total: number;
  staff_total: number;
  bookings_today: number;
  bookings_30d: number;
  bookings_30d_prev: number;
  daily: { day: string; bookings: number; new_clients: number }[];
  revenue_this_month: number;
  revenue_prev_month: number;
  revenue_monthly: { month: string; amount: number; count: number }[];
  recent_payments: SubscriptionPayment[];
  reviews_total: number;
  reviews_30d: number;
  rating_avg: number | null;
  rating_top: RatingRow[];
  rating_low: RatingRow[];
}

export interface UserAdmin {
  id: number;
  phone: string;
  full_name: string;
  status: "active" | "blocked";
  is_superadmin: boolean;
  created_at: string;
  last_login_at: string | null;
  memberships: { business_id: number; business_name: string; role: string }[];
  client_of: number;
}

export interface AuditEntry {
  id: number;
  business_id: number | null;
  business_name: string | null;
  user_id: number | null;
  user_name: string | null;
  user_phone: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  changes: Record<string, unknown> | unknown[] | null;
  created_at: string;
}

// ─── Reyting va baholash ───────────────────────────────────────────────────
export interface ReviewSummary {
  count: number;
  rating_avg: number | null;
  cleanliness_avg: number | null;
  quality_avg: number | null;
  distribution: Record<string, number>;
}

export interface BusinessReview {
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
  client_name?: string | null;
  client_phone?: string | null;
  appointment_id?: number;
  appointment_starts_at?: string;
  is_hidden?: boolean;
  replied_by_name?: string | null;
}

export interface ReviewsPage {
  summary: ReviewSummary;
  items: BusinessReview[];
  total?: number;
}

export interface RatingRow { id: number; name: string; category: string; rating_avg: number; rating_count: number }
