import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { AttendanceAlerts } from "../components/AttendanceAlerts";
import { AppShell } from "../layouts/AppShell";
import { sectionsFor, sectionUrl } from "../modules/registry";
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
  const navigate = useNavigate();
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
  const switcher = memberships.length > 1 && (
    <select
      aria-label="Salonni tanlash"
      value={membership.business_slug}
      onChange={(e) => navigate(`/${e.target.value}`)}
      className="w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm text-white"
    >
      {memberships.map((m) => (
        <option key={m.business_id} value={m.business_slug} className="text-ink">
          {m.business_name}
        </option>
      ))}
    </select>
  );

  return (
    <AppShell
      title={membership.business_name}
      header={switcher}
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
  );
}
