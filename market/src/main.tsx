import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth";
import { AuthModal } from "./components/AuthModal";
import { Layout } from "./components/Layout";
import { Bookings, Profile } from "./pages/Account";
import Booking from "./pages/Booking";
import Business from "./pages/Business";
import Home from "./pages/Home";
import Salon from "./pages/Salon";
import Search from "./pages/Search";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } } });

function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-28 text-center">
      <p className="text-6xl font-extrabold text-brand-grad">404</p>
      <h1 className="mt-3 text-2xl font-extrabold">Sahifa topilmadi</h1>
      <a href="/" className="mt-6 inline-flex h-12 items-center rounded-full bg-brand px-6 font-bold text-white">Bosh sahifa</a>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Bron — alohida to'liq sahifa (header/footer'siz), lekin kirish oynasi kerak */}
            <Route path="/s/:slug/bron" element={<><Booking /><AuthModalOnly /></>} />
            <Route path="*" element={
              <Layout>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/qidiruv" element={<Search />} />
                  <Route path="/biznes" element={<Business />} />
                  <Route path="/s/:slug" element={<Salon />} />
                  <Route path="/bronlarim" element={<Bookings />} />
                  <Route path="/profil" element={<Profile />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Layout>
            } />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

function AuthModalOnly() { return <AuthModal />; }
