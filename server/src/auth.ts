import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { DB } from './db';
import { config } from './config';
import { ApiError, forbidden } from './util';

export type Role = 'institution' | 'regional_officer' | 'bureau_officer' | 'evc_coordinator' | 'competent_authority' | 'admin';
export interface User { id: number; email: string; name: string; role: Role; region_id: number | null; institution_id: number | null; active: number }
declare global { namespace Express { interface Request { user?: User; correlationId?: string } } }

export const signToken = (u: User) => jwt.sign({ sub: u.id }, config.jwtSecret, { expiresIn: config.jwtTtl as any });

// Resolves the user from the bearer token on every request, so deactivation or a role change takes effect immediately.
export const authenticate = (db: DB) => (req: Request, _res: Response, next: NextFunction) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue'));
  try {
    const p: any = jwt.verify(h.slice(7), config.jwtSecret);
    const u = db.prepare('SELECT id,email,name,role,region_id,institution_id,active FROM users WHERE id=?').get(p.sub) as User | undefined;
    if (!u || !u.active) return next(new ApiError(401, 'UNAUTHENTICATED', 'Account unavailable'));
    req.user = u; next();
  } catch { next(new ApiError(401, 'UNAUTHENTICATED', 'Session expired - sign in again')); }
};

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) =>
  roles.includes(req.user!.role) ? next() : next(forbidden());

// Row-level data scope. `alias` must expose institution_id and region_id columns.
//  institution -> own institution only; regional officer / EVC coordinator -> own region; all other roles -> national.
export function scope(u: User, alias: string): { sql: string; params: any[] } {
  switch (u.role) {
    case 'institution': return { sql: `${alias}.institution_id = ?`, params: [u.institution_id ?? -1] };
    case 'regional_officer':
    case 'evc_coordinator': return { sql: `${alias}.region_id = ?`, params: [u.region_id ?? -1] };
    default: return { sql: '1=1', params: [] };
  }
}
// Draft applications are private to the institution until submitted.
export function appScope(u: User, alias: string) {
  const s = scope(u, alias);
  return u.role === 'institution' ? s : { sql: `${s.sql} AND ${alias}.status <> 'draft'`, params: s.params };
}
export function canSee(u: User, row: { institution_id: number; region_id: number; status?: string }) {
  if (row.status === 'draft' && u.role !== 'institution') return false;
  if (u.role === 'institution') return row.institution_id === u.institution_id;
  if (u.role === 'regional_officer' || u.role === 'evc_coordinator') return row.region_id === u.region_id;
  return true;
}
export const roleLabel: Record<Role, string> = {
  institution: 'Institution representative', regional_officer: 'Regional officer', bureau_officer: 'Bureau officer',
  evc_coordinator: 'EVC coordinator', competent_authority: 'Competent authority', admin: 'Administrator',
};
