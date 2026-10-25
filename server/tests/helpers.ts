import request from 'supertest';
import { openDb, migrate, type DB } from '../src/db';
import { createApp } from '../src/app';
import { seedBase, seedUsers } from '../src/seed';
import { clock } from '../src/clock';
import { placeholderPdf } from '../src/files';

export const PASSWORD = 'Test@12345!';
export const MON = '2026-03-02T04:30:00Z';   // Monday 10:00 IST

export function makeCtx(now: string = MON) {
  clock.set(new Date(now));
  const db = openDb(':memory:'); migrate(db); seedBase(db); seedUsers(db, PASSWORD);
  const app = createApp(db);
  const tokens: Record<string, string> = {};
  const login = async (email: string) => tokens[email] ??= (await request(app).post('/api/auth/login').send({ email, password: PASSWORD })).body.token;
  const as = async (email: string) => {
    const t = await login(email); const a = { Authorization: `Bearer ${t}` };
    const call = (method: 'get' | 'post' | 'put' | 'patch', url: string, body?: any) => { const r = (request(app) as any)[method](url).set(a); return body !== undefined ? r.send(body) : r; };
    return { get: (u: string) => call('get', u), post: (u: string, b: any = {}) => call('post', u, b), put: (u: string, b: any) => call('put', u, b), patch: (u: string, b: any) => call('patch', u, b), token: t, headers: a };
  };
  return { db, app, as, login };
}
export type Ctx = ReturnType<typeof makeCtx>;
export const setNow = (iso: string) => clock.set(new Date(iso));

export async function upload(ctx: Ctx, email: string, fields: Record<string, string>, name = 'doc.pdf', buf: Buffer = placeholderPdf('test')) {
  const t = await ctx.login(email);
  let r = request(ctx.app).post('/api/documents').set('Authorization', `Bearer ${t}`);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', buf, { filename: name });
}

// Creates a draft, uploads every required document and (optionally) submits. Returns the application id.
export async function newApp(ctx: Ctx, instEmail = 'inst1@demo.local', category = 'EXT', submit = true) {
  const u = await ctx.as(instEmail);
  const created = await u.post('/api/applications', { category_code: category, title: `Test application ${category}` });
  if (created.status !== 201) throw new Error('create failed ' + JSON.stringify(created.body));
  const id = created.body.id;
  const reqs = (ctx.db.prepare('SELECT * FROM document_requirements WHERE category_code=? AND required=1').all(category) as any[]);
  for (const r of reqs) {
    const res = await upload(ctx, instEmail, { application_id: String(id), doc_type: r.doc_type, ...(r.has_expiry ? { expiry_date: '2028-01-01' } : {}) });
    if (res.status !== 201) throw new Error('upload failed ' + JSON.stringify(res.body));
  }
  if (submit) { const s = await u.post(`/api/applications/${id}/submit`); if (s.status !== 200) throw new Error('submit failed ' + JSON.stringify(s.body)); }
  return id as number;
}
export const getApp = (db: DB, id: number) => db.prepare('SELECT * FROM applications WHERE id=?').get(id) as any;
export const count = (db: DB, sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any).c as number;

export async function scrutinise(ctx: Ctx, id: number, roEmail = 'ro.nr@demo.local') {
  const ro = await ctx.as(roEmail);
  await ro.post(`/api/applications/${id}/observations`, { text: 'Reviewed documents against checklist.' });
  return ro.post(`/api/applications/${id}/transitions`, { action: 'complete_scrutiny' });
}
