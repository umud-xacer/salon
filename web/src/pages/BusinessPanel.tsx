import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { AppShell } from "../layouts/AppShell";
import { sectionsFor } from "../modules/registry";
import { SuspendedPage } from "./Notices";

/** /b/:businessId/* — bitta salon ichidagi panel. Boshqa salon raqami yozilsa, o'z saloniga qaytaradi. */
export function BusinessPanel() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { businessId } = useParams();
  const memberships = me?.memberships ?? [];
  const membership = memberships.find((m) => m.business_id === Number(businessId));

  if (!membership) return <Navigate to="/" replace />;
  if (!membership.operational) return <SuspendedPage membership={membership} />;

  const sections = sectionsFor(membership);
  const base = `/b/${membership.business_id}`;
  const home = `${base}/${sections[0].path}`;     // har bir panelda kamida bitta bo'lim bor
  const switcher = memberships.length > 1 && (
    <select
      aria-label="Salonni tanlash"
      value={membership.business_id}
      onChange={(e) => navigate(`/b/${e.target.value}`)}
      className="w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm text-white"
    >
      {memberships.map((m) => (
        <option key={m.business_id} value={m.business_id} className="text-ink">
          {m.business_name}
        </option>
      ))}
    </select>
  );

  return (
    <AppShell
      title={membership.business_name}
      header={switcher}
      nav={sections.map((s) => ({ to: `${base}/${s.path}`, label: s.label, icon: s.icon }))}
    >
      <Routes>
        {sections.map((s) => (
          <Route key={s.path} path={s.path} element={<s.page membership={membership} />} />
        ))}
        {/* Modul o'chirilgan yoki huquqi yo'q bo'lim ham shu yerga tushadi */}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </AppShell>
  );
}
