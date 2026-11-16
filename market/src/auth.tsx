// Foydalanuvchi sessiyasi + "kirish oynasi" (lazy auth: faqat bron/bronlarim uchun so'raladi).
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, clearSession, hasRefresh, LoginOut, Me, refreshOnce, refreshToken, setSessionLostHandler, storeSession } from "./api";

type Auth = {
  me: Me | null;
  ready: boolean;
  signIn: (l: LoginOut) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Kirgan bo'lsa true; aks holda kirish oynasini ochadi */
  requireAuth: (reason?: string) => boolean;
  gate: { open: boolean; reason: string };
  closeGate: () => void;
};

const Ctx = createContext<Auth | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider yo'q");
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [gate, setGate] = useState({ open: false, reason: "" });

  const load = useCallback(async () => setMe(await api<Me>("/auth/me")), []);

  useEffect(() => {
    setSessionLostHandler(() => setMe(null));
    (async () => {
      try {
        if (hasRefresh() && (await refreshOnce())) await load();
      } catch { /* sessiya tugagan — mehmon */ }
      setReady(true);
    })();
  }, [load]);

  const value = useMemo<Auth>(() => ({
    me, ready, gate,
    signIn: async (l) => {
      storeSession(l);
      await load();
      setGate({ open: false, reason: "" });
    },
    signOut: async () => {
      const token = refreshToken();
      if (token) await api("/auth/logout", { method: "POST", body: { refresh_token: token } }).catch(() => {});
      clearSession();
      setMe(null);
    },
    refresh: load,
    requireAuth: (reason) => {
      if (me) return true;
      setGate({ open: true, reason: reason ?? "Davom etish uchun profilingizga kiring yoki ro'yxatdan o'ting" });
      return false;
    },
    closeGate: () => setGate({ open: false, reason: "" }),
  }), [me, ready, gate, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
