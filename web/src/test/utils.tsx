import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { AuthProvider, useAuth } from '../lib/auth';
import { ToastProvider } from '../components/ui';
import type { ReactNode } from 'react';

export function renderApp(ui: ReactNode, route = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[route]}><ToastProvider><AuthProvider>{ui}</AuthProvider></ToastProvider></MemoryRouter></QueryClientProvider>);
}
// Routes a fake fetch by URL prefix. Each handler returns [status, body].
export function mockApi(routes: Record<string, (url: string, init?: RequestInit) => [number, any]>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find(k => url.startsWith(k));
    const [status, body] = key ? routes[key](url, init) : [404, { error: { message: `no mock for ${url}` } }];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

function Gate({ children }: { children: ReactNode }) { const { user } = useAuth(); return user ? <>{children}</> : null; }
// Renders a page the way the app does: only once the session has been restored.
export const renderAuthed = (ui: ReactNode, route = '/') => renderApp(<Gate>{ui}</Gate>, route);
