// Super Admin chap menyusi: "Salonlar" (hammasi), uning ostida har bir muassasa turi, keyin "Muassasa turlari".
import { BarChart3, Building2, Ear, Layers, Leaf, Pill, Scissors, ScrollText, Smile, Sparkles, Stethoscope, Store, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AppShell, type NavItem } from "../../layouts/AppShell";
import { useBusinessTypes } from "./BusinessTypesPage";
import { typeUrl, typeName } from "./typeWording";

import { t } from "../../i18n";
const ICONS: Record<string, LucideIcon> = {
  beauty_salon: Sparkles, barbershop: Scissors, pharmacy: Pill, clinic: Stethoscope, dental: Smile, ent: Ear, spa: Leaf,
};

export function SuperAdminShell({ children }: { children: ReactNode }) {
  const types = useBusinessTypes();
  const nav: NavItem[] = [
    { to: "/superadmin/statistika", label: t("Statistika"), icon: BarChart3 },
    { to: "/superadmin", label: t("Muassasalar"), icon: Building2, end: true,
      badge: types.data?.reduce((n, tx) => n + tx.business_count, 0) },
    ...(types.data ?? []).filter((tx) => tx.is_active || tx.business_count > 0).map((tx) => ({
      to: `/superadmin/${typeUrl(tx)}`, label: typeName(tx), icon: ICONS[tx.slug] ?? Store, sub: true, badge: tx.business_count,
    })),
    { to: "/superadmin/turlar", label: t("Muassasa turlari"), icon: Layers },
    { to: "/superadmin/direktorlar", label: t("Direktorlar"), icon: Users },
    { to: "/superadmin/jurnal", label: t("Audit jurnali"), icon: ScrollText },
  ];
  return <AppShell title={t("Super Admin")} nav={nav}>{children}</AppShell>;
}
