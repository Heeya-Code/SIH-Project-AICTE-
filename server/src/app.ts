import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { DB } from './db';
import { config } from './config';
import { authenticate } from './auth';
import { errorHandler } from './http';
import { authRouter, lookupsRouter, insightsRouter, reportsRouter } from './routes/core';
import { applicationsRouter } from './routes/applications';
import { documentsRouter, undertakingsRouter, evcRouter, escalationsRouter, tasksRouter, notificationsRouter } from './routes/modules';
import { usersRouter, adminRouter, auditRouter, workflowsRouter } from './routes/admin';
import { migrationStatus } from './db';
import { publicDataRouter } from './routes/publicdata';
import { searchRouter, caseExtrasRouter } from './routes/ux';
import { analyticsRouter, intelligenceRouter, regulatoryRouter, referenceRouter, integrityRouter } from './routes/intelligence';

export function createApp(db: DB, opts: { log?: (m: string) => void; schedulerSeconds?: number } = {}) {
  const log = opts.log ?? (() => {});
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'frame-src': ["'self'", 'blob:'], 'img-src': ["'self'", 'data:', 'blob:'], 'object-src': ["'none'"] } } }));
  app.use((req, res, next) => { req.correlationId = String(req.headers['x-correlation-id'] ?? crypto.randomUUID()).slice(0, 64); res.setHeader('X-Correlation-Id', req.correlationId); next(); });
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => {
    let dbOk = true; try { db.prepare('SELECT 1').get(); } catch { dbOk = false; }
    res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', database: dbOk ? 'ok' : 'down', migrations: migrationStatus(db).length, time: new Date().toISOString() });
  });
  app.use('/api/auth', authRouter(db));

  const api = express.Router();
  api.use(authenticate(db));
  api.use('/lookups', lookupsRouter(db));
  api.use('/search', searchRouter(db));
  api.use('/applications', caseExtrasRouter(db));
  api.use('/applications', applicationsRouter(db));
  api.use('/documents', documentsRouter(db));
  api.use('/undertakings', undertakingsRouter(db));
  api.use('/evc', evcRouter(db));
  api.use('/escalations', escalationsRouter(db));
  api.use('/tasks', tasksRouter(db));
  api.use('/notifications', notificationsRouter(db));
  api.use('/reports', reportsRouter(db));
  api.use('/workflows', workflowsRouter(db));
  api.use('/users', usersRouter(db));
  api.use('/audit', auditRouter(db));
  api.use('/public-data', publicDataRouter(db));
  api.use('/analytics', analyticsRouter(db));
  api.use('/intelligence', intelligenceRouter(db));
  api.use('/regulatory', regulatoryRouter(db));
  api.use('/reference', referenceRouter(db));
  api.use('/integrity', integrityRouter(db));
  api.use('/admin', adminRouter(db, { everySeconds: opts.schedulerSeconds ?? config.jobIntervalSeconds }));
  api.use('/', insightsRouter(db));
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } }));

  // Built front end (production / single-process demo).
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }
  app.use(errorHandler(log));
  return app;
}
