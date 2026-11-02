// Sevimli salonlar ekranlar orasida bir xil turishi uchun umumiy holat.
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { useAuth } from './auth';

type Favorites = { has: (id: number) => boolean; toggle: (id: number) => void };

const FavoritesContext = createContext<Favorites>({ has: () => false, toggle: () => {} });

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
  const toggle = useCallback((id: number) => {
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
  }, []);

  const value = useMemo<Favorites>(() => ({ has: (id) => ids.has(id), toggle }), [ids, toggle]);
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}
