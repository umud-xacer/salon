// Panel bo'limlari ro'yxati. Yangi bo'lim qo'shish uchun shu yerga bitta yozuv kifoya:
// menyu ham, yo'l ham, huquq tekshiruvi ham shundan quriladi.
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  CalendarClock,
  ClipboardList,
  Clock3,
  Contact,
  Hospital,
  LayoutDashboard,
  Package,
  Pill,
  Receipt,
  Scissors,
  Star,
  Stethoscope,
  Store,
  Users,
  Wallet,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import type { Membership, Panel } from "../api/types";
import { panelVocab, type BusinessKind, type Vocab } from "./vocab";
export { panelVocab } from "./vocab";
import { BusinessPage } from "./business/BusinessPage";
import { CalendarPage } from "./calendar/CalendarPage";
import { ClientsPage } from "./clients/ClientsPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { CashPage, ExpensesPage } from "./finance/FinancePages";
import { InventoryPage } from "./inventory/InventoryPage";
import { MyPayrollPage, PayrollPage } from "./payroll/PayrollPage";
import { ReportsPage } from "./reports/ReportsPage";
import { MyReviewsPage, ReviewsPage } from "./reviews/ReviewsPage";
import { MyBookingsPage, MySchedulePage, MyServicesPage } from "./schedule/StaffPages";
import { ServicesPage } from "./services/ServicesPage";
import { StaffPage } from "./staff/StaffPage";
import { WorkSchedulePage } from "./staff/WorkSchedulePage";

export interface Section {
  path: string;
  label: string;
  icon: LucideIcon;
  panel: Panel;
  module?: string;                // yoqilgan bo'lishi shart bo'lgan modul
  anyPermission?: string[];       // shulardan biri bo'lsa kifoya
  term?: Exclude<keyof Vocab, "titles">;   // nomi muassasa turiga qarab (Ustalar/Shifokorlar...)
  uz: string;                     // manzil: /b/1/kassa
  uzByKind?: Partial<Record<BusinessKind, string>>;   // turga qarab: dorixonada /farmatsevtlar
  iconByKind?: Partial<Record<BusinessKind, LucideIcon>>;   // klinikada qaychi emas — stetoskop
  page: ComponentType<{ membership: Membership }>;
}

export const SECTIONS: Section[] = [
  { path: "dashboard", uz: "bosh-sahifa", label: "Bosh sahifa", icon: LayoutDashboard, panel: "admin", page: DashboardPage },
  {
    path: "calendar", uz: "kalendar", uzByKind: { pharmacy: "navbat", clinic: "qabullar" }, label: "Kalendar", term: "calendar", icon: CalendarRange, panel: "admin", module: "booking",
    anyPermission: ["appointments.view_all"], page: CalendarPage,
  },
  {
    path: "cash", uz: "kassa", label: "Kassa", icon: Wallet, panel: "admin", module: "finance",
    anyPermission: ["finance.view", "payments.accept"], page: CashPage,
  },
  {
    path: "expenses", uz: "xarajatlar", label: "Xarajatlar", icon: Receipt, panel: "admin", module: "finance",
    anyPermission: ["finance.view"], page: ExpensesPage,
  },
  {
    path: "reports", uz: "hisobotlar", label: "Hisobotlar", icon: BarChart3, panel: "admin", module: "finance",
    anyPermission: ["finance.view"], page: ReportsPage,
  },
  {
    path: "inventory", uz: "ombor", uzByKind: { pharmacy: "dorilar" }, label: "Ombor", term: "inventory", icon: Package, panel: "admin", module: "inventory",
    anyPermission: ["inventory.view"], page: InventoryPage,
  },
  {
    path: "payroll", uz: "oylik", label: "Oylik", icon: WalletCards, panel: "admin", module: "payroll",
    anyPermission: ["payroll.manage"], page: PayrollPage,
  },
  {
    path: "clients", uz: "mijozlar", uzByKind: { pharmacy: "xaridorlar", clinic: "bemorlar" }, label: "Mijozlar", term: "clients", icon: Contact, panel: "admin", module: "booking",
    anyPermission: ["clients.view"], page: ClientsPage,
  },
  { path: "staff", uz: "xodimlar", uzByKind: { pharmacy: "farmatsevtlar", clinic: "shifokorlar" }, label: "Xodimlar", term: "staff", icon: Users, panel: "admin", anyPermission: ["staff.manage"], page: StaffPage },
  {
    path: "work-schedule", uz: "ish-jadvali", label: "Ish jadvali", icon: CalendarClock, panel: "admin",
    anyPermission: ["staff.manage"], page: WorkSchedulePage,
  },
  {
    path: "services", uz: "xizmatlar", uzByKind: { clinic: "tibbiy-xizmatlar" }, label: "Xizmatlar", term: "services", icon: Scissors, iconByKind: { clinic: Stethoscope, pharmacy: ClipboardList }, panel: "admin",
    anyPermission: ["services.manage"], page: ServicesPage,
  },
  { path: "reviews", uz: "baholar", label: "Baholar", icon: Star, panel: "admin", anyPermission: ["business.manage"], page: ReviewsPage },
  { path: "business", uz: "salon", uzByKind: { pharmacy: "dorixona", clinic: "klinika" }, label: "Salon", term: "businessPage", icon: Store, iconByKind: { clinic: Hospital, pharmacy: Pill }, panel: "admin", anyPermission: ["business.manage"], page: BusinessPage },
  { path: "bookings", uz: "bronlarim", label: "Mening bronlarim", icon: CalendarDays, panel: "staff", page: MyBookingsPage },
  { path: "schedule", uz: "jadvalim", label: "Ish jadvalim", icon: Clock3, panel: "staff", page: MySchedulePage },
  { path: "my-services", uz: "xizmatlarim", label: "Xizmatlarim", icon: Scissors, iconByKind: { clinic: Stethoscope }, panel: "staff", page: MyServicesPage },
  { path: "my-reviews", uz: "baholarim", label: "Baholarim", icon: Star, panel: "staff", page: MyReviewsPage },
  { path: "my-payroll", uz: "oyliklarim", label: "Oyliklarim", icon: WalletCards, panel: "staff", module: "payroll", page: MyPayrollPage },
];

/** Bo'lim manzili muassasa turiga qarab (o'zbekcha). path — eski inglizcha nom, yo'naltirish uchun. */
export function sectionUrl(s: Section, kind: string | undefined): string {
  return s.uzByKind?.[kind as BusinessKind] ?? s.uz;
}

export function sectionsFor(m: Membership): Section[] {
  const v = panelVocab(m);
  return SECTIONS.filter(
    (s) =>
      s.panel === m.panel &&
      (!s.module || m.modules.includes(s.module)) &&
      (!s.anyPermission || s.anyPermission.some((p) => m.permissions.includes(p))),
  ).map((s) => ({ ...s, ...(s.term ? { label: v[s.term] } : {}), icon: s.iconByKind?.[m.business_kind as BusinessKind] ?? s.icon }));
}
