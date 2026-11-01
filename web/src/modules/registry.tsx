// Panel bo'limlari ro'yxati. Yangi bo'lim qo'shish uchun shu yerga bitta yozuv kifoya:
// menyu ham, yo'l ham, huquq tekshiruvi ham shundan quriladi.
import {
  CalendarDays,
  CalendarRange,
  Clock3,
  LayoutDashboard,
  Package,
  Receipt,
  Scissors,
  Users,
  Wallet,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import type { Membership, Panel } from "../api/types";
import { CalendarPage } from "./calendar/CalendarPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { CashPage, ExpensesPage } from "./finance/FinancePages";
import { InventoryPage } from "./inventory/InventoryPage";
import { PayrollPage } from "./payroll/PayrollPage";
import { MyBookingsPage, MySchedulePage } from "./schedule/StaffPages";
import { ServicesPage, StaffPage } from "./staff/ManagementPages";

export interface Section {
  path: string;
  label: string;
  icon: LucideIcon;
  panel: Panel;
  module?: string;                // yoqilgan bo'lishi shart bo'lgan modul
  anyPermission?: string[];       // shulardan biri bo'lsa kifoya
  page: ComponentType<{ membership: Membership }>;
}

export const SECTIONS: Section[] = [
  { path: "dashboard", label: "Bosh sahifa", icon: LayoutDashboard, panel: "admin", page: DashboardPage },
  {
    path: "calendar", label: "Kalendar", icon: CalendarRange, panel: "admin", module: "booking",
    anyPermission: ["appointments.view_all"], page: CalendarPage,
  },
  {
    path: "cash", label: "Kassa", icon: Wallet, panel: "admin", module: "finance",
    anyPermission: ["finance.view", "payments.accept"], page: CashPage,
  },
  {
    path: "expenses", label: "Xarajatlar", icon: Receipt, panel: "admin", module: "finance",
    anyPermission: ["finance.view"], page: ExpensesPage,
  },
  {
    path: "inventory", label: "Ombor", icon: Package, panel: "admin", module: "inventory",
    anyPermission: ["inventory.view"], page: InventoryPage,
  },
  {
    path: "payroll", label: "Oylik", icon: WalletCards, panel: "admin", module: "payroll",
    anyPermission: ["payroll.manage"], page: PayrollPage,
  },
  { path: "staff", label: "Xodimlar", icon: Users, panel: "admin", anyPermission: ["staff.manage"], page: StaffPage },
  {
    path: "services", label: "Xizmatlar", icon: Scissors, panel: "admin",
    anyPermission: ["services.manage"], page: ServicesPage,
  },
  { path: "bookings", label: "Mening bronlarim", icon: CalendarDays, panel: "staff", page: MyBookingsPage },
  { path: "schedule", label: "Ish jadvalim", icon: Clock3, panel: "staff", page: MySchedulePage },
];

export function sectionsFor(m: Membership): Section[] {
  return SECTIONS.filter(
    (s) =>
      s.panel === m.panel &&
      (!s.module || m.modules.includes(s.module)) &&
      (!s.anyPermission || s.anyPermission.some((p) => m.permissions.includes(p))),
  );
}
