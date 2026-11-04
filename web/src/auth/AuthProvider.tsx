import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { api, ApiError, clearSession, hasSession, logout as apiLogout, setSessionLostHandler, storeSession } from "../api/client";
import type { LoginResponse, Me } from "../api/types";

interface AuthValue {
  me: Me | null;
  loading: boolean;
  signIn: (tokens: LoginResponse) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const ME_KEY = ["me"];

// clear() kirish holatini kuzatayotgan so'rovni ham uzadi va ekran eski holatda qolib ketadi.
// Avval holat bo'shatiladi, keyin faqat boshqa ma'lumotlar o'chiriladi.
function resetSession(queryClient: QueryClient) {
  queryClient.setQueryData(ME_KEY, null);
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      if (!hasSession()) return null;
      try {
        return await api<Me>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.code === "wrong_panel") {
          clearSession();
          return null;
        }
        throw e;
      }
    },
    retry: false,
    // Obuna yoki modul Super Admin tomonidan o'zgarsa, panel qayta kirmasdan yangilanadi
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    setSessionLostHandler(() => resetSession(queryClient));
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({
      me: query.data ?? null,
      loading: query.isPending,
      signIn: async (tokens) => {
        storeSession(tokens);
        await queryClient.invalidateQueries({ queryKey: ME_KEY });
        await queryClient.refetchQueries({ queryKey: ME_KEY });
      },
      signOut: async () => {
        await apiLogout();
        resetSession(queryClient);
      },
    }),
    [query.data, query.isPending, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider yo'q");
  return value;
}
