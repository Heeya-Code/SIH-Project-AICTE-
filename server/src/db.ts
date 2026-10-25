import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clock } from './clock';

export type DB = Database.Database;
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, '../migrations');

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

// Flyway-style versioned migrations: NNN_name.sql applied once, in order, each in a transaction.
export function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const done = new Set((db.prepare('SELECT version FROM schema_migrations').all() as any[]).map(r => r.version));
  const files = fs.readdirSync(MIGRATIONS).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    const version = parseInt(f, 10);
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)').run(version, f, clock.iso());
    })();
    applied.push(f);
  }
  return applied;
}

export const migrationStatus = (db: DB) =>
  db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all();
