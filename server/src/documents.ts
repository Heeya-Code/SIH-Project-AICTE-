import type { DB } from './db';
import { clock } from './clock';
import { audit, actorOf } from './audit';
import { notifyRole, notify } from './notify';
import { canSee, type User } from './auth';
import { badRequest, conflict, forbidden, isDate, notFound, unprocessable } from './util';
import { sweepEscalations } from './escalation';
import { docName } from './docnames';
import { originFlag } from './origin';
import type { StoredFile } from './files';

export type UploadInput = { application_id?: number | null; undertaking_id?: number | null; doc_type?: string; reference_no?: string | null; issue_date?: string | null; expiry_date?: string | null; renew_of?: number | null };

// Records a document. A renewal (or a corrected re-upload of the same type for the same application) creates a NEW version
// and keeps the old one: nothing is overwritten or deleted.
export function addDocument(db: DB, user: User, input: UploadInput, file: StoredFile, opts: { skipRoleCheck?: boolean } = {}) {
  if (!opts.skipRoleCheck && user.role !== 'institution') throw forbidden('Only the institution can upload documents');
  if (!input.renew_of && !input.doc_type?.trim()) throw badRequest('Choose a document type');
  for (const k of ['issue_date', 'expiry_date'] as const) if (input[k] && !isDate(input[k])) throw badRequest(`${k.replace('_', ' ')} must be a valid date (YYYY-MM-DD)`);
  if (input.issue_date && input.expiry_date && input.expiry_date < input.issue_date) throw unprocessable('Expiry date cannot be before the issue date');
  return db.transaction(() => {
    let institution_id = user.institution_id!, region_id = 0;
    let app: any = null, prev: any = null;
    if (input.renew_of) {
      prev = db.prepare('SELECT * FROM documents WHERE id=?').get(input.renew_of);
      if (!prev || !canSee(user, prev)) throw notFound('Document not found');
      if (!prev.is_current) throw conflict('Only the current version of a document can be renewed');
      institution_id = prev.institution_id; region_id = prev.region_id; input = { ...input, doc_type: prev.doc_type as string, application_id: prev.application_id, undertaking_id: prev.undertaking_id };
    }
    if (input.application_id) {
      app = db.prepare('SELECT * FROM applications WHERE id=?').get(input.application_id);
      if (!app || !canSee(user, app)) throw notFound('Application not found');
      if (!prev && !['draft', 'returned'].includes(app.status)) throw conflict('Documents can be added while the application is a draft or returned for clarification');
      institution_id = app.institution_id; region_id = app.region_id;
      if (!prev) prev = db.prepare('SELECT * FROM documents WHERE application_id=? AND doc_type=? AND is_current=1').get(app.id, input.doc_type) ?? null;
      const req = db.prepare('SELECT has_expiry FROM document_requirements WHERE category_code=? AND doc_type=?').get(app.category_code, input.doc_type) as any;
      if (req?.has_expiry && !input.expiry_date) throw unprocessable(`${docName(input.doc_type)} needs an expiry date`);
    } else if (!prev) {
      const inst = db.prepare('SELECT * FROM institutions WHERE id=?').get(institution_id) as any;
      region_id = inst.region_id;
    }
    const now = clock.iso();
    const version = prev ? prev.version + 1 : 1;
    const id = Number(db.prepare(`INSERT INTO documents (lineage_id,institution_id,region_id,application_id,undertaking_id,doc_type,reference_no,issue_date,expiry_date,version,is_current,supersedes_id,
      verification_status,renewal_status,file_name,storage_ref,mime,size,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?, 'pending','not_due',?,?,?,?,?,?)`)
      .run(prev?.lineage_id ?? null, institution_id, region_id, input.application_id ?? null, input.undertaking_id ?? null, input.doc_type, input.reference_no ?? null, input.issue_date ?? null, input.expiry_date ?? null,
        version, prev?.id ?? null, file.file_name, file.storage_ref, file.mime, file.size, user.id, now).lastInsertRowid);
    db.prepare('UPDATE documents SET lineage_id=COALESCE(lineage_id,?), synthetic=? WHERE id=?').run(prev?.lineage_id ?? id, originFlag(), id);
    if (prev) {
      db.prepare(`UPDATE documents SET is_current=0, renewal_status='renewed' WHERE id=?`).run(prev.id);
      db.prepare(`UPDATE undertakings SET status='closed' WHERE document_id=? AND status NOT IN ('closed')`).run(prev.id);
    }
    audit(db, { actor: actorOf(user), type: prev ? 'document.renewed' : 'document.uploaded', entity: 'document', entityId: id, prev: prev ? { id: prev.id, version: prev.version, expiry_date: prev.expiry_date } : null,
      next: { doc_type: input.doc_type, version, expiry_date: input.expiry_date ?? null, application_id: input.application_id ?? null } });
    if (prev) notifyRole(db, { role: 'regional_officer', regionId: region_id }, { event: 'document.renewed', vars: { doc_type: docName(input.doc_type), institution: (db.prepare('SELECT name FROM institutions WHERE id=?').get(institution_id) as any).name }, link: '/documents', dedupeKey: `doc-renewed:${id}`, entity: { type: 'document', id } });
    sweepEscalations(db, 'Document renewed');
    return id;
  })();
}

export function verifyDocument(db: DB, user: User, id: number, decision: 'verified' | 'returned', note?: string) {
  if (!['regional_officer', 'bureau_officer'].includes(user.role)) throw forbidden('Only officers can verify documents');
  return db.transaction(() => {
    const d = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as any;
    if (!d || !canSee(user, d)) throw notFound('Document not found');
    if (!d.is_current) throw conflict('Only the current version can be verified');
    if (decision === 'returned' && !note?.trim()) throw unprocessable('Explain why the document is being returned');
    db.prepare('UPDATE documents SET verification_status=?, verification_note=?, verified_by=?, verified_at=? WHERE id=?').run(decision, note ?? null, user.id, clock.iso(), id);
    audit(db, { actor: actorOf(user), type: `document.${decision}`, entity: 'document', entityId: id, prev: { status: d.verification_status }, next: { status: decision }, reason: note });
    notifyRole(db, { role: 'institution', institutionId: d.institution_id }, { event: decision === 'verified' ? 'document.verified' : 'document.returned',
      vars: { doc_type: docName(d.doc_type), note: note ?? '' }, link: '/documents', dedupeKey: `doc-${decision}:${id}`, entity: { type: 'document', id } });
  })();
}
