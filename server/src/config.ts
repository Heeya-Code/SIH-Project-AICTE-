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
  // Optional OpenAI-compatible chat-completions provider. No request is made unless a key is configured.
  aiApiKey: env.AI_API_KEY ?? env.OPENAI_API_KEY ?? '',
  aiBaseUrl: env.AI_BASE_URL ?? 'https://api.openai.com/v1',
  aiModel: env.AI_MODEL ?? 'gpt-4o-mini',
  aiTimeoutMs: Number(env.AI_TIMEOUT_MS ?? 20_000),
};

export function assertSafeConfig() {
  if (config.nodeEnv === 'production') {
    if (config.jwtSecret === 'dev-only-secret-change-me') throw new Error('JWT_SECRET must be set in production');
    if (config.demoTools) throw new Error('Set ALLOW_DEMO_TOOLS=false in production');
  }
}
