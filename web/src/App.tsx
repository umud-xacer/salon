import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthProvider";
import { Spinner } from "./components/ui";
import { BusinessPanel, LegacyPanelRedirect } from "./pages/BusinessPanel";
import { LoginPage } from "./pages/LoginPage";
import { ClientOnlyPage, ForcePasswordPage } from "./pages/Notices";

// Xarita kutubxonasi og'ir: faqat Super Admin yuklaydi
const BusinessesPage = lazy(() =>
  import("./modules/superadmin/BusinessesPage").then((m) => ({ default: m.BusinessesPage })),
);
const BusinessTypesPage = lazy(() =>
  import("./modules/superadmin/BusinessTypesPage").then((m) => ({ default: m.BusinessTypesPage })),
);
const StatsPage = lazy(() =>
  import("./modules/superadmin/StatsPage").then((m) => ({ default: m.StatsPage })),
);
const SuperAdminShell = lazy(() =>
  import("./modules/superadmin/SuperAdminShell").then((m) => ({ default: m.SuperAdminShell })),
);

function Home() {
  const { me } = useAuth();
  if (me?.workspace === "superadmin") return <Navigate to="/superadmin" replace />;
  const first = me?.memberships[0];
  return first ? <Navigate to={`/${first.business_slug}`} replace /> : <ClientOnlyPage />;
}

export function App() {
  const { me, loading } = useAuth();

  if (loading) return <Spinner />;
  if (!me) return <LoginPage />;
  if (me.user.must_change_password) return <ForcePasswordPage />;

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/superadmin/*"
        element={
          me.workspace === "superadmin" ? (
            <Suspense fallback={<Spinner />}>
            <SuperAdminShell>
              <Suspense fallback={<Spinner />}>
                <Routes>
                  <Route index element={<BusinessesPage />} />
                  <Route path="statistika" element={<StatsPage />} />
                  <Route path="turlar" element={<BusinessTypesPage />} />
                  <Route path="types" element={<Navigate to="/superadmin/turlar" replace />} />
                  <Route path="t/:typeSlug" element={<BusinessesPage />} />
                  <Route path=":typePath" element={<BusinessesPage />} />
                  <Route path="*" element={<Navigate to="/superadmin" replace />} />
                </Routes>
              </Suspense>
            </SuperAdminShell>
            </Suspense>
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      {/* Eski /b/6/... — muassasa havolasiga: /barber-lab/... */}
      <Route path="/b/:businessId/*" element={<LegacyPanelRedirect />} />
      <Route path="/:businessSlug/*" element={<BusinessPanel />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
