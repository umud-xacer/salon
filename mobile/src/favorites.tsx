// Sevimli salonlar ekranlar orasida bir xil turishi uchun umumiy holat.
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { useAuth } from './auth';
import { useAuthGate } from './authGate';
import { t } from './i18n';

type Favorites = { has: (id: number) => boolean; toggle: (id: number) => void; count: number };

const FavoritesContext = createContext<Favorites>({ has: () => false, toggle: () => {}, count: 0 });

export const useFavorites = () => useContext(FavoritesContext);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [ids, setIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!me) {
      setIds(new Set());
      return;
    }
    api<number[]>('/me/favorites/ids').then((list) => setIds(new Set(list))).catch(() => {});
  }, [me]);

  // Tugma darhol javob beradi, server rad etsa holat qaytariladi
  const { requireAuth } = useAuthGate();
  const toggle = useCallback((id: number) => {
    if (!requireAuth(t("Sevimli salonlarni saqlash uchun profilingizga kiring yoki ro'yxatdan o'ting"))) return;
    setIds((current) => {
      const on = current.has(id);
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      api(`/me/favorites/${id}`, { method: on ? 'DELETE' : 'PUT' }).catch(() => {
        setIds((later) => {
          const undone = new Set(later);
          if (on) undone.add(id);
          else undone.delete(id);
          return undone;
        });
      });
      return next;
    });
  }, [requireAuth]);

  const value = useMemo<Favorites>(() => ({ has: (id) => ids.has(id), toggle, count: ids.size }), [ids, toggle]);
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}
