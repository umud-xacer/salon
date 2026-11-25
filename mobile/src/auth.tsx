import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { track } from './analytics';
import { api, clearTokens, getRefreshToken, loadTokens, LoginOut, Me, saveTokens, setSessionLostHandler } from './api';
import { bioAsked, bioKind } from './biometric';
import { registerForPush, unregisterPush } from './notifications';
import { afterSplash } from './startup';

import { t } from "./i18n";

/** Kirgandan keyingi bosqich: yangi mijoz — profil, so'ng (qurilmada bo'lsa) Face ID taklifi */
export type Setup = 'profile' | 'biometric' | null;

type Auth = {
  me: Me | null;
  ready: boolean;
  setup: Setup;
  setSetup: (s: Setup) => void;
  signIn: (login: LoginOut) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<Auth>(null as unknown as Auth);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [setup, setSetup] = useState<Setup>(null);

  const load = useCallback(async () => {
    const m = await api<Me>('/auth/me');
    // Ism kiritilmagan mijoz (yangi yoki oqim yarim qolgan) — avval profil ekrani
    if (m.workspace === 'client' && !m.user.full_name?.trim()) setSetup('profile');
    setMe(m);
    // Ruxsat oynasi va tarmoq — ochilish animatsiyasidan keyin
    afterSplash(() => { registerForPush().catch((e) => console.warn(t("Push ro'yxatdan o'tmadi"), e)); }, 1500);
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
    setup,
    setSetup,
    refresh: async () => setMe(await api<Me>('/auth/me')),
    signIn: async (login) => {
      await saveTokens(login);
      track('login_success', { is_new: login.is_new });
      // Bosqich "me" dan oldin qo'yiladi: navigator kirish ekranidan to'g'ri joyga yo'naltiradi
      if (login.is_new || !login.user.full_name?.trim()) setSetup('profile');
      else if (!bioAsked() && (await bioKind())) setSetup('biometric');
      await load();
    },
    signOut: async () => {
      await unregisterPush();
      const refresh_token = await getRefreshToken();
      if (refresh_token) await api('/auth/logout', { method: 'POST', body: { refresh_token } }).catch(() => {});
      await clearTokens();
      setSetup(null);
      setMe(null);
    },
  }), [me, ready, setup, load]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
