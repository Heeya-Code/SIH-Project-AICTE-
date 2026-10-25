import type { DB } from './db';

const STOP = new Set('a an and are as at be by can do does for from has have how i if in is it its of on or our shall should that the their there this to under what when where which who why will with would my we you your about any all need needed must long many much require required requirement requirements rule rules institution institutions'.split(' '));
const DECISION = /\b(will|would|can|could|should)\b.*\b(my|our|the) (application|institution|college|approval)\b.*\b(be )?(approved|rejected|granted|denied)\b|\bapprove (my|our)\b|\bgrant (us|my|our)\b|\bis (my|our) (application|institution) (eligible|approved)\b/i;

export type Evidence = { rule_code: string; title: string; statement: string; kind: string; verification_status: string; flagged: boolean; section_ref: string | null; page_ref: string | null; page_note: string | null; effective_note: string | null;
  source: { code: string; title: string; url: string | null; trust: string; version_label: string | null } | null; matched_terms: string[] };

const stem = (w: string) => (w.length > 5 ? w.slice(0, 5) : w);

// Retrieval over the indexed, paraphrased excerpts only. It never writes an answer of its own: it returns the matching excerpts with their sources,
// and says so plainly when the index does not contain enough evidence.
export function askReference(db: DB, question: string) {
  const disclaimer = 'Paraphrased from excerpts of copies of AICTE documents, not legal advice. Confirm against the official handbook. This tool cannot decide, predict or recommend an approval or rejection.';
  const indexed = { rules: (db.prepare('SELECT COUNT(*) c FROM reference_chunks').get() as any).c, sources: (db.prepare('SELECT COUNT(*) c FROM regulatory_sources').get() as any).c };
  if (DECISION.test(question)) return { answered: false, reason: 'decision_request', message: 'Approval and rejection decisions are reserved for the competent authority. This tool only retrieves what the indexed excerpts say.', evidence: [] as Evidence[], indexed, disclaimer };
  const terms = [...new Set(question.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)))];
  if (!terms.length) return { answered: false, reason: 'no_terms', message: 'Ask a question that names a topic, for example "land lease requirement" or "when is an EVC conducted".', evidence: [], indexed, disclaimer };
  const q = terms.map(t => `"${t.replace(/"/g, '')}"*`).join(' OR ');
  let hits: any[] = [];
  try { hits = db.prepare(`SELECT chunk_id, text, title, bm25(reference_fts) AS rank FROM reference_fts WHERE reference_fts MATCH ? ORDER BY rank LIMIT 12`).all(q) as any[]; } catch { hits = []; }
  const need = Math.min(terms.length, Math.max(2, Math.ceil(terms.length * 0.6)));
  const scored = hits.map(h => { const hay = `${h.title} ${h.text}`.toLowerCase(); const matched = terms.filter(t => hay.includes(stem(t)) ); return { ...h, matched }; }).filter(h => h.matched.length >= need);
  if (!scored.length) return { answered: false, reason: 'insufficient_evidence', message: 'The indexed excerpts do not contain enough evidence to answer this. Nothing has been guessed. Check the official handbook, or ask an administrator to add and review a source.', evidence: [], indexed, disclaimer };
  const evidence: Evidence[] = scored.slice(0, 4).map(h => {
    const r = db.prepare(`SELECT r.*, s.code scode, s.title stitle, s.url, s.trust, s.version_label FROM reference_chunks c JOIN regulatory_rules r ON r.id=c.rule_id LEFT JOIN regulatory_sources s ON s.id=r.source_id WHERE c.id=?`).get(h.chunk_id) as any;
    return { rule_code: r.code, title: r.title, statement: r.statement, kind: r.kind, verification_status: r.verification_status, flagged: !!r.flagged_for_review, section_ref: r.section_ref, page_ref: r.page_ref, page_note: r.page_note, effective_note: r.effective_note,
      source: r.scode ? { code: r.scode, title: r.stitle, url: r.url, trust: r.trust, version_label: r.version_label } : null, matched_terms: h.matched };
  });
  const caveats: string[] = [];
  if (evidence.some(e => e.flagged)) caveats.push('At least one excerpt below is unverified or needs review. Do not treat it as a rule until an administrator has checked it against the official handbook.');
  if (evidence.some(e => e.kind === 'configurable_assumption')) caveats.push('One result is a demonstration assumption used in this prototype, not an AICTE requirement.');
  if (evidence.every(e => e.verification_status !== 'verified_official')) caveats.push('None of these has been checked against the official handbook by an administrator yet.');
  return { answered: true, message: `Found ${evidence.length} relevant excerpt(s) in the indexed sources.`, evidence, caveats, indexed, disclaimer };
}
