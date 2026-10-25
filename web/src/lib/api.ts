export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}
const KEY = 'af_token';
export const tokenStore = {
  get: () => sessionStorage.getItem(KEY),
  set: (t: string) => sessionStorage.setItem(KEY, t),
  clear: () => sessionStorage.removeItem(KEY),
};
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function raw(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const t = tokenStore.get();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  let res: Response;
  try { res = await fetch(`/api${path}`, { ...init, headers }); }
  catch { throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check that the backend is running and try again.'); }
  if (!res.ok) {
    let body: any = null; try { body = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? `Request failed (${res.status})`, body?.error?.details);
  }
  return res;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET') };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers = { 'Content-Type': 'application/json' }; }
  const res = await raw(path, init);
  return res.status === 204 ? (undefined as T) : res.json();
}

export async function download(path: string, fallbackName: string) {
  const res = await raw(path);
  const cd = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const qstr = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString(); return s ? `?${s}` : '';
};
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong');
export const errDetails = (e: unknown): string[] => {
  if (!(e instanceof ApiError) || !e.details) return [];
  const d = e.details;
  if (Array.isArray(d)) return d.map((x: any) => (typeof x === 'string' ? x : x.field ? `${x.field}: ${x.message}` : JSON.stringify(x)));
  if (d.unmet) return d.unmet; if (d.missing_documents) return d.missing_documents.map((m: string) => `Missing: ${m}`);
  return [];
};
