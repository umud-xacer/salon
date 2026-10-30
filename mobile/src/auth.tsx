import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, clearTokens, getRefreshToken, loadTokens, LoginOut, Me, saveTokens, setSessionLostHandler } from './api';
import { registerForPush, unregisterPush } from './notifications';

type Auth = {
  me: Me | null;
  ready: boolean;
  signIn: (login: LoginOut) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Auth>(null as unknown as Auth);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    setMe(await api<Me>('/auth/me'));
    registerForPush().catch((e) => console.warn('Push ro\'yxatdan o\'tmadi', e));
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => setMe(null));
    (async () => {
      try {
        if (await loadTokens()) await load();
      } catch {
        // Tarmoq yo'q yoki sessiya tugagan: kirish ekrani ochiladi
      } finally {
        setReady(true);
      }
    })();
  }, [load]);

  const value = useMemo<Auth>(() => ({
    me,
    ready,
    signIn: async (login) => {
      await saveTokens(login);
      await load();
    },
    signOut: async () => {
      await unregisterPush();
      const refresh_token = await getRefreshToken();
      if (refresh_token) await api('/auth/logout', { method: 'POST', body: { refresh_token } }).catch(() => {});
      await clearTokens();
      setMe(null);
    },
  }), [me, ready, load]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
