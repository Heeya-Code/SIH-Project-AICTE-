import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useLookups = () => useQuery({ queryKey: ['lookups'], queryFn: () => api<any>('/lookups'), staleTime: 60_000 });
export function useLookupMaps() {
  const q = useLookups();
  return { ...q, regions: q.data?.regions ?? [], institutions: q.data?.institutions ?? [], categories: q.data?.categories ?? [], stages: q.data?.stages ?? [], docTypes: q.data?.doc_types ?? [], officers: q.data?.officers ?? [] };
}
