import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { api, hasSession, logout as apiLogout, setSessionLostHandler, storeSession } from "../api/client";
import type { LoginResponse, Me } from "../api/types";

interface AuthValue {
  me: Me | null;
  loading: boolean;
  signIn: (tokens: LoginResponse) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const ME_KEY = ["me"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ME_KEY,
    queryFn: () => (hasSession() ? api<Me>("/auth/me") : Promise.resolve(null)),
    retry: false,
    // Obuna yoki modul Super Admin tomonidan o'zgarsa, panel qayta kirmasdan yangilanadi
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    setSessionLostHandler(() => {
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
    });
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
        queryClient.clear();
        queryClient.setQueryData(ME_KEY, null);
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
