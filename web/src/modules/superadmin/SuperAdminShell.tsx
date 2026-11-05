// Super Admin chap menyusi: "Salonlar" (hammasi), uning ostida har bir muassasa turi, keyin "Muassasa turlari".
import { BarChart3, Building2, Layers, Leaf, Pill, Scissors, Smile, Sparkles, Stethoscope, Store, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AppShell, type NavItem } from "../../layouts/AppShell";
import { useBusinessTypes } from "./BusinessTypesPage";
import { typeUrl } from "./typeWording";

const ICONS: Record<string, LucideIcon> = {
  beauty_salon: Sparkles, barbershop: Scissors, pharmacy: Pill, clinic: Stethoscope, dental: Smile, spa: Leaf,
};

export function SuperAdminShell({ children }: { children: ReactNode }) {
  const types = useBusinessTypes();
  const nav: NavItem[] = [
    { to: "/superadmin/statistika", label: "Statistika", icon: BarChart3 },
    { to: "/superadmin", label: "Salonlar", icon: Building2, end: true,
      badge: types.data?.reduce((n, t) => n + t.business_count, 0) },
    ...(types.data ?? []).filter((t) => t.is_active || t.business_count > 0).map((t) => ({
      to: `/superadmin/${typeUrl(t)}`, label: t.name_uz, icon: ICONS[t.slug] ?? Store, sub: true, badge: t.business_count,
    })),
    { to: "/superadmin/turlar", label: "Muassasa turlari", icon: Layers },
  ];
  return <AppShell title="Super Admin" nav={nav}>{children}</AppShell>;
}
