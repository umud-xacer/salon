import { Building2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthProvider";
import { Spinner } from "./components/ui";
import { AppShell } from "./layouts/AppShell";
import { BusinessPanel } from "./pages/BusinessPanel";
import { LoginPage } from "./pages/LoginPage";
import { ClientOnlyPage, ForcePasswordPage } from "./pages/Notices";

// Xarita kutubxonasi og'ir: faqat Super Admin yuklaydi
const BusinessesPage = lazy(() =>
  import("./modules/superadmin/BusinessesPage").then((m) => ({ default: m.BusinessesPage })),
);

function Home() {
  const { me } = useAuth();
  if (me?.workspace === "superadmin") return <Navigate to="/superadmin" replace />;
  const first = me?.memberships[0];
  return first ? <Navigate to={`/b/${first.business_id}`} replace /> : <ClientOnlyPage />;
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
        path="/superadmin"
        element={
          me.workspace === "superadmin" ? (
            <AppShell title="Super Admin" nav={[{ to: "/superadmin", label: "Salonlar", icon: Building2 }]}>
              <Suspense fallback={<Spinner />}>
                <BusinessesPage />
              </Suspense>
            </AppShell>
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route path="/b/:businessId/*" element={<BusinessPanel />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
