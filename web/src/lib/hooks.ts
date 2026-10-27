import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useLookups = () => useQuery({ queryKey: ['lookups'], queryFn: () => api<any>('/lookups'), staleTime: 60_000 });
export function useLookupMaps() {
  const q = useLookups();
  return { ...q, regions: q.data?.regions ?? [], institutions: q.data?.institutions ?? [], categories: q.data?.categories ?? [], stages: q.data?.stages ?? [], docTypes: q.data?.doc_types ?? [], officers: q.data?.officers ?? [] };
}

import { useEffect } from 'react';
// One document title per page, so tabs, history and screen readers can tell pages apart.
export function usePageTitle(title: string) { useEffect(() => { document.title = `${title} · ApprovalFlow (demo)`; }, [title]); }
// Warns before the browser tab is closed while a form has unsaved changes.
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);
}
// A small localStorage-backed list, used for recently viewed cases and saved filters.
export function useStoredList<T>(key: string, max = 8) {
  const read = (): T[] => { try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; } };
  const [list, setList] = useState<T[]>(read);
  const save = (next: T[]) => { setList(next); try { localStorage.setItem(key, JSON.stringify(next.slice(0, max))); } catch { /* storage unavailable: the list just stays in memory */ } };
  return [list, save] as const;
}
