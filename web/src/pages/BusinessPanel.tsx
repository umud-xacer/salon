import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { AttendanceAlerts } from "../components/AttendanceAlerts";
import { AppShell } from "../layouts/AppShell";
import { panelVocab, sectionsFor, sectionUrl } from "../modules/registry";
import { VocabContext } from "../modules/vocab";
import { SuspendedPage } from "./Notices";

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
  if (!membership.operational) return <SuspendedPage membership={membership} />;

  const sections = sectionsFor(membership);
  const base = `/${membership.business_slug}`;
  const kind = membership.business_kind;
  const url = (s: (typeof sections)[number]) => sectionUrl(s, kind);
  const home = `${base}/${url(sections[0])}`;     // har bir panelda kamida bitta bo'lim bor
  // Muassasa almashtirish ro'yxati yo'q (foydalanuvchi talabi): panel faqat shu muassasani ko'rsatadi.
  // Boshqa muassasaga kirish huquqini baza (RLS) va yuqoridagi tekshiruv hal qiladi.
  return (
    <VocabContext.Provider value={panelVocab(membership)}>
    <AppShell
      title={membership.business_name}
      nav={sections.map((s) => ({ to: `${base}/${url(s)}`, label: s.label, icon: s.icon }))}
    >
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
