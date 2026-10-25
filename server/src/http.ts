import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { ApiError } from './util';

export const h = (fn: (req: Request, res: Response) => any): RequestHandler => (req, res, next) => {
  try { Promise.resolve(fn(req, res)).catch(next); } catch (e) { next(e); }
};

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Check the highlighted fields', r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  return r.data;
}

export function paging(req: Request, defaultSize = 20) {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? defaultSize), 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export const paged = (rows: any[], total: number, p: { page: number; pageSize: number }) => ({ rows, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) });

export const intParam = (v: unknown, name = 'id') => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'BAD_REQUEST', `Invalid ${name}`);
  return n;
};
export const qs = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function errorHandler(log: (m: string) => void) {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Check the highlighted fields', details: err.issues } });
    if (err?.name === 'MulterError') return res.status(400).json({ error: { code: 'UPLOAD_FAILED', message: err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large' : 'Upload failed' } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON' } });
    const id = req.correlationId ?? 'n/a';
    log(`[error] ${id} ${req.method} ${req.path}: ${err?.stack ?? err}`);   // details stay in the server log only
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side', correlationId: id } });
  };
}
