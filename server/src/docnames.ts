// Single source of truth for how a stored document type is shown to people.
// The stored `doc_type` value is never changed (it is used for lookups, requirements and existing records);
// only the label shown in the UI, notifications and exports comes from here.
export const DOC_NAMES: Record<string, string> = {
  'Land / Title Documents': 'Land Ownership Document',
  'Lease Deed': 'Lease Agreement',
  'Fire Safety Certificate': 'Fire Safety Certificate',
  'Trust / Society Registration': 'Trust or Society Registration Certificate',
  'Annual Self-Disclosure': 'Annual Self-Disclosure Declaration',
  'Infrastructure Statement': 'Infrastructure Statement',
  'Faculty List': 'Faculty Details List',
  'Building Plan': 'Building Plan (by registered architect)',
  'Closure Declaration': 'Closure Declaration',
  'Other': 'Other Supporting Document',
};
export const docName = (type?: string | null) => (!type || !type.trim() ? 'Unnamed Document' : DOC_NAMES[type] ?? type);
export const docCode = (id: number | string) => `DOC-${String(id).padStart(4, '0')}`;
export const withDocLabels = <T extends { id: number; doc_type?: string | null }>(d: T) => ({ ...d, display_name: docName(d.doc_type), doc_code: docCode(d.id) });

// Documents that were on file when a submission was made (read from its stored snapshot).
export function submissionDocs(snapshot: string | null): { id: number; version: number; display_name: string; doc_code: string }[] {
  try { return (JSON.parse(snapshot ?? '{}').documents ?? []).map((x: any) => ({ id: x.id, version: x.version, display_name: docName(x.doc_type), doc_code: docCode(x.id) })); } catch { return []; }
}
