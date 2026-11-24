import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { AttendanceAlerts } from "../components/AttendanceAlerts";
import { BranchSwitcher, chainMemberships } from "../components/BranchSwitcher";
import { AppShell } from "../layouts/AppShell";
import { panelVocab, sectionsFor, sectionUrl } from "../modules/registry";
import { BillingPaywall, ExpiryBanner } from "../modules/billing/BillingPage";
import { VocabContext } from "../modules/vocab";
import { SuspendedPage } from "./Notices";
import { PendingSignupPage, TrialCard } from "../components/TrialCard";

/** Eski manzil /b/6/kassa -> /barber-lab/kassa (saqlangan havolalar buzilmasin) */
export function LegacyPanelRedirect() {
  const { me } = useAuth();
  const { businessId, "*": rest } = useParams();
  const m = me?.memberships.find((x) => x.business_id === Number(businessId));
  return <Navigate to={m ? `/${m.business_slug}/${rest ?? ""}` : "/"} replace />;
}

/** /:businessSlug/* — bitta muassasa ichidagi panel. Boshqa muassasa havolasi yozilsa, o'ziniki ga qaytaradi. */
export function BusinessPanel() {
  const { me } = useAuth();
  const { businessSlug } = useParams();
  const memberships = me?.memberships ?? [];
  const membership = memberships.find((m) => m.business_slug === businessSlug);

  if (!membership) return <Navigate to="/" replace />;
  // O'zi ro'yxatdan o'tgan, Super Admin hali tasdiqlamagan muassasa
  if (membership.business_status === "pending") return <PendingSignupPage membership={membership} />;
  if (!membership.operational) {
    // Obuna tugagan direktor faqat to'lov sahifasini ko'radi; bloklangan muassasa va xodimlar — xabarnoma
    if (membership.role === "owner" && membership.business_status !== "blocked") return <BillingPaywall membership={membership} />;
    return <SuspendedPage membership={membership} />;
  }

  const sections = sectionsFor(membership);
  const base = `/${membership.business_slug}`;
  const kind = membership.business_kind;
  const url = (s: (typeof sections)[number]) => sectionUrl(s, kind);
  const home = `${base}/${url(sections[0])}`;     // har bir panelda kamida bitta bo'lim bor
  // Almashtirgich faqat bitta tarmoq (asosiy kompaniya + filiallar) ichida — tarmoqqa kirmagan boshqa
  // muassasalar ro'yxatda chiqmaydi (2026-11-06 talabi). Kirish huquqini baza (RLS) va yuqoridagi tekshiruv hal qiladi.
  const hasBranches = chainMemberships(memberships, membership).length > 1;
  return (
    <VocabContext.Provider value={panelVocab(membership)}>
    <AppShell
      title={membership.branch_name ? `${membership.business_name} · ${membership.branch_name}` : membership.business_name}
      header={hasBranches ? <BranchSwitcher current={membership} dark /> : undefined}
      mobileTitle={hasBranches ? <BranchSwitcher current={membership} /> : undefined}
      nav={sections.map((s) => ({ to: `${base}/${url(s)}`, label: s.label, icon: s.icon }))}
    >
      <ExpiryBanner membership={membership} billingUrl={`${base}/obuna`} />
      <TrialCard membership={membership} base={base} />
      <Routes>
        {sections.map((s) => (
          <Route key={s.path} path={url(s)} element={<s.page membership={membership} />} />
        ))}
        {/* Eski inglizcha manzillar (saqlangan havolalar) — o'zbekchasiga */}
        {sections.filter((s) => s.path !== url(s)).map((s) => (
          <Route key={`old-${s.path}`} path={s.path} element={<Navigate to={`${base}/${url(s)}`} replace />} />
        ))}
        {/* Modul o'chirilgan yoki huquqi yo'q bo'lim ham shu yerga tushadi */}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
      <AttendanceAlerts />
    </AppShell>
    </VocabContext.Provider>
  );
}
