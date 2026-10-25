import path from 'node:path';

const env = process.env;
export const config = {
  nodeEnv: env.NODE_ENV ?? 'development',
  port: Number(env.PORT ?? 4000),
  dbPath: path.resolve(env.DB_PATH ?? path.resolve(process.cwd(), 'data/approvalflow.db')),
  storageDir: path.resolve(env.STORAGE_DIR ?? path.resolve(process.cwd(), 'data/storage')),
  webDist: path.resolve(env.WEB_DIST ?? path.resolve(process.cwd(), '../web/dist')),
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me',
  jwtTtl: env.JWT_TTL ?? '8h',
  demoPassword: env.DEMO_PASSWORD ?? 'Demo@1234',
  jobIntervalSeconds: Number(env.JOB_INTERVAL_SECONDS ?? 300),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 5) * 1024 * 1024,
  // Demo tooling (simulated clock, reset, seed) - disable in any real deployment.
  demoTools: (env.ALLOW_DEMO_TOOLS ?? 'true') === 'true',
  // Synthetic data: SEED_APPLICATIONS=0 disables the generated applications (the small curated demo set is always seeded on an empty database).
  seed: Number(env.SEED ?? 2026),
  seedApplications: Number(env.SEED_APPLICATIONS ?? 500),
  loginRateLimit: Number(env.LOGIN_RATE_LIMIT ?? 20),
};

export function assertSafeConfig() {
  if (config.nodeEnv === 'production') {
    if (config.jwtSecret === 'dev-only-secret-change-me') throw new Error('JWT_SECRET must be set in production');
    if (config.demoTools) throw new Error('Set ALLOW_DEMO_TOOLS=false in production');
  }
}
