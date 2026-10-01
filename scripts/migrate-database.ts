import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../backend/database';
import { createHash } from 'node:crypto';
export async function migrateDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = path.resolve(process.cwd(), 'migrations');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(78194603)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await readFile(path.join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
      if (previous.rows[0]) { if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`); continue; }
      await client.query('BEGIN');
      try {
        await client.query(sql.replace(/^BEGIN;\s*/i, '').replace(/COMMIT;\s*$/i, ''));
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT'); console.log(`Applied ${name}`);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock(78194603)'); client.release(); }
}
if ((process.argv[1]?.endsWith('migrate-database.ts') || process.argv[1]?.endsWith('migrate.cjs'))) {
  migrateDatabase().then(() => pool.end()).catch(async error => { console.error(error.message); await pool.end(); process.exitCode = 1; });
}
