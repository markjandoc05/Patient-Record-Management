import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../backend/database';

function assertDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
  if (url.hostname !== '127.0.0.1' || !/^\/vine_(?:[a-z_]+_)?test$/.test(url.pathname)
      || process.env.ALLOW_TEST_DATABASE !== 'yes') {
    throw new Error('Platform test helpers require an explicitly enabled disposable loopback Vine test database.');
  }
}

// Keep older workflow suites aligned with the complete immutable migration chain.
// Individual feature migrations still have their own focused upgrade tests.
export async function assertCurrentMigrationChain(): Promise<boolean> {
  assertDisposableDatabase();
  const names = (await readdir(path.resolve('migrations'))).filter(name => name.endsWith('.sql')).sort();
  const rows = (await pool.query('SELECT name, checksum FROM schema_migrations ORDER BY name')).rows;
  assert.deepEqual(rows.map(row => row.name), names);
  for (const row of rows) {
    const checksum = createHash('sha256').update(await readFile(path.resolve('migrations', row.name))).digest('hex');
    assert.equal(row.checksum, checksum, `Applied migration checksum: ${row.name}`);
  }
  return true;
}

export async function resetDisposablePlatformRecords() {
  assertDisposableDatabase();
  // Explicit dependent tables avoid CASCADE and retain schema/checksum history.
  const known = ['pos_payment_reversals', 'pos_package_purchases', 'pos_source_claims', 'pos_events', 'pos_payments', 'pos_invoice_items', 'pos_invoices', 'inventory_movements', 'inventory_commands', 'inventory_accounts',
    'package_catalogue_lines', 'package_catalogue_versions', 'package_catalogue',
    'treatment_ledger_visit_usage', 'treatment_ledger_events', 'treatment_ledger_lines',
    'treatment_ledger_purchases', 'service_branch_settings', 'services', 'service_categories',
    'app_records', 'auth_sessions', 'auth_identities', 'oauth_attempts'];
  const present: string[] = [];
  for (const table of known) if ((await pool.query('SELECT to_regclass($1) AS name', [table])).rows[0].name) present.push(table);
  await pool.query(`TRUNCATE ${present.join(', ')}`);
}
