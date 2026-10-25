import fs from 'node:fs';
import { config } from './config';
import { openDb, migrate } from './db';
import { seedBase, seedUsers, seedDemo, resetDemo } from './seed';
import { generateApplications } from './generate';
import { validateIntegrity } from './integrity';
import { importFile } from './importer';

const cmd = process.argv[2];
const db = openDb(config.dbPath);
const applied = migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

if (cmd === 'seed') {
  const has = (db.prepare('SELECT COUNT(*) c FROM users').get() as any).c;
  if (has) { console.log('Database already has data. Use "npm run reset" to wipe and re-seed.'); process.exit(0); }
  console.time('seed');
  seedBase(db); seedUsers(db); await seedDemo(db);
  if (config.seedApplications > 0) await generateApplications(db, { seed: config.seed, count: config.seedApplications, quiet: true });
  console.timeEnd('seed');
  console.log(`Seeded synthetic data into ${config.dbPath}`);
} else if (cmd === 'generate') {
  const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
  console.time('generate');
  const r = await generateApplications(db, { seed: arg('seed', 2026), count: arg('count', 500) });
  console.timeEnd('generate'); console.log(r.skipped ? 'Already generated with these settings; nothing to do.' : JSON.stringify(r, null, 1));
} else if (cmd === 'validate') {
  const r = validateIntegrity(db); console.log(JSON.stringify(r.checked)); console.log(r.ok ? 'Integrity checks passed.' : `${r.issues.length} issue(s):\n` + r.issues.map(i => ` [${i.check}] ${i.id}: ${i.message}`).join('\n')); process.exit(r.ok ? 0 : 1);
} else if (cmd === 'import') {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const file = arg('file'), source = arg('source'), year = arg('year'), retrieved = arg('retrieved');
  if (!file || !source || !year || !retrieved) { console.log('Usage: npm run import -- --file data.xlsx --source AIKOSH-AISHE-COLLEGES --year 2023-24 --retrieved 2026-10-23 [--sheet NAME] [--map \'{"Header":"name"}\'] [--dry-run] [--force]'); process.exit(1); }
  const out = await importFile(db, null, { sourceCode: source, buffer: fs.readFileSync(file), fileName: file.split(/[\\/]/).pop()!, academicYear: year, retrievedOn: retrieved, mapping: arg('map') ? JSON.parse(arg('map')!) : undefined, sheet: arg('sheet'), dryRun: process.argv.includes('--dry-run'), force: process.argv.includes('--force') });
  console.log(JSON.stringify(out, null, 1)); process.exit(['rejected', 'blocked_provenance'].includes(out.status) ? 2 : 0);
} else if (cmd === 'reset') {
  await resetDemo(db);
  fs.rmSync(config.storageDir, { recursive: true, force: true });
  console.log('Demo data reset.');
} else {
  console.log('Usage: tsx src/cli.ts seed | generate [--seed N --count N] | import --file F --source CODE --year YYYY-YY --retrieved YYYY-MM-DD | validate | reset');
}
