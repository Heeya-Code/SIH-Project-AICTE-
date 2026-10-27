import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Pages can name their own last breadcrumb (for example the case reference).
const Ctx = createContext<{ crumb: string | null; setCrumb: (c: string | null) => void }>({ crumb: null, setCrumb: () => {} });
export const PageMetaProvider = ({ children }: { children: ReactNode }) => { const [crumb, setCrumb] = useState<string | null>(null); return <Ctx.Provider value={{ crumb, setCrumb }}>{children}</Ctx.Provider>; };
export const usePageMeta = () => useContext(Ctx);
export function useCrumb(label: string | null | undefined) { const { setCrumb } = usePageMeta(); useEffect(() => { setCrumb(label ?? null); return () => setCrumb(null); }, [label, setCrumb]); }
