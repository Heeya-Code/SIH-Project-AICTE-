import { config, assertSafeConfig } from './config';
import { openDb, migrate } from './db';
import { createApp } from './app';
import { startScheduler } from './jobs';
import { clock, atIstMorning } from './clock';
import { seedBase, seedUsers, seedDemo } from './seed';
import { ensureRegulatoryData } from './regulatory';
import { ensurePublicDataRegistry } from './publicdata';
import { generateApplications } from './generate';

assertSafeConfig();
const db = openDb(config.dbPath);
const applied = migrate(db);
if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);

if (!(db.prepare('SELECT COUNT(*) c FROM users').get() as any).c) {
  console.log('[db] empty database: seeding synthetic demonstration data...');
  seedBase(db); seedUsers(db); await seedDemo(db, { quiet: true });
  if (config.seedApplications > 0) {
    console.log(`[db] generating ${config.seedApplications} synthetic applications (seed ${config.seed})...`);
    const r = await generateApplications(db, { seed: config.seed, count: config.seedApplications, quiet: true });
    console.log(`[db] generated ${r.generated} applications for ${r.institutions} institutions`);
  }
}
ensureRegulatoryData(db); ensurePublicDataRegistry(db);   // idempotent: adds missing sources/rules/categories, keeps any administrator review
const sim = (db.prepare(`SELECT value FROM settings WHERE key='sim_clock'`).get() as any)?.value;
if (sim && config.demoTools) { clock.set(atIstMorning(sim)); console.log(`[clock] restored simulated date ${sim}`); }

const app = createApp(db, { log: console.log });
app.listen(config.port, () => {
  console.log(`AICTE ApprovalFlow (demonstration prototype) listening on http://localhost:${config.port}`);
  if (config.jwtSecret === 'dev-only-secret-change-me') console.log('[warn] using the development JWT secret; set JWT_SECRET for anything beyond a local demo');
});
startScheduler(db, config.jobIntervalSeconds);
