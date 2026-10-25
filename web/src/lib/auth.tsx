import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler, tokenStore } from './api';

export type Me = { id: number; name: string; email: string; role: string; role_label: string; region_id: number | null; institution_id: number | null; region_name: string | null; institution_name: string | null };
type Ctx = { user: Me | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => void };
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const logout = useCallback(() => { tokenStore.clear(); setUser(null); qc.clear(); }, [qc]);
  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);
  useEffect(() => {
    if (!tokenStore.get()) return;
    api<{ user: Me }>('/auth/me').then(r => setUser(r.user)).catch(() => tokenStore.clear()).finally(() => setLoading(false));
  }, []);
  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: Me }>('/auth/login', { body: { email, password } });
    tokenStore.set(r.token); qc.clear(); setUser(r.user);
  }, [qc]);
  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
