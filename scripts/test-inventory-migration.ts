import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (target.hostname !== '127.0.0.1' || target.pathname !== '/vine_inventory_migration_test' || process.env.ALLOW_TEST_DATABASE !== 'yes') {
  throw Error('Use empty disposable loopback vine_inventory_migration_test only');
}
const original = process.cwd(), hash = (s: string) => createHash('sha256').update(s).digest('hex');
let checks = 0, temporary: string | undefined;
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; };
const applied = async () => JSON.stringify((await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows);
const schema = async () => JSON.stringify((await pool.query(`
  SELECT 'column' AS kind, table_name AS relation, column_name AS name,
    concat(data_type, ':', udt_name, ':', is_nullable, ':', coalesce(column_default,'')) AS definition
  FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'constraint', c.relname, n.conname, pg_get_constraintdef(n.oid)
    FROM pg_constraint n JOIN pg_class c ON c.oid=n.conrelid JOIN pg_namespace p ON p.oid=c.relnamespace WHERE p.nspname='public'
  UNION ALL SELECT 'index', tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public'
  UNION ALL SELECT 'function', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
  UNION ALL SELECT 'trigger', c.relname, t.tgname, pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal
  ORDER BY kind,relation,name
`)).rows);
async function oldRecords() {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' AND tablename NOT LIKE 'inventory_%' ORDER BY tablename")).rows;
  const value: Record<string, unknown> = {};
  for (const { tablename } of tables) value[tablename] = (await pool.query(`SELECT to_jsonb(r) AS record FROM "${tablename}" r ORDER BY to_jsonb(r)::text`)).rows;
  return JSON.stringify(value);
}
try {
  check(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count) === 0, 'migration suite requires empty disposable database');
  const names = (await readdir('migrations')).filter(n => n.endsWith('.sql')).sort();
  check(names.length === 7 && names[6] === '007_inventory_movements.sql', 'exact ordered migration chain 001–007');
  const sources = await Promise.all(names.map(n => readFile(path.join(original, 'migrations', n), 'utf8')));
  const expected = [
    '67e8a46d4714a66514feee5f75152c1c884d37635766f687a9225be6c3a3af53',
    '8eefa5f8bb13f1f83a6611b22ae380788ed2b12d8d58f74c75b721e12da628d2',
    '7c1f6534769aa22b6a7bb2a0db99c22acb0c77dafb210c83b24f237493aca77c',
    '8d7c187555c848c0a615492ca58ed1e874f84ed17e57fec737dcc431ae3fc83c',
    'e9c0e5ffac8ca4f373ecf57735031c1e2562576632f4ce0454ab2103dfd51c2a',
    'c8397897fb344647368a7b50b4f88e0384649b4c20391671ea887a050b83ba8e',
  ];
  for (let i = 0; i < expected.length; i++) check(hash(sources[i]) === expected[i], names[i] + ' immutable checksum');
  await migrateDatabase(); const fresh = await schema(), freshApplied = await applied();
  await migrateDatabase(); check(await schema() === fresh && await applied() === freshApplied, 'fresh migration rerun changes no schema/checksums');
  const inventoryTables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'inventory_%' ORDER BY tablename")).rows;
  check(inventoryTables.length > 0, 'new inventory integrity tables exist');
  for (const { tablename } of inventoryTables) check((await pool.query(`SELECT count(*) FROM "${tablename}"`)).rows[0].count === '0', 'no automatic fixtures in ' + tablename);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  temporary = await mkdtemp(path.join(tmpdir(), 'vine-inventory-migrations-')); await mkdir(path.join(temporary, 'migrations'));
  for (let i = 0; i < 6; i++) await writeFile(path.join(temporary, 'migrations', names[i]), sources[i]);
  process.chdir(temporary); await migrateDatabase();
  const legacy = [
    ['branches', 'A', { branchName: 'Synthetic retained branch A', status: 'Active' }],
    ['branches', 'B', { branchName: 'Synthetic retained branch B', status: 'Active' }],
    ['users', 'old-staff', { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'], legacyField: true }],
    ['patients', 'old-patient', { name: 'Synthetic old patient', legacyField: { preserve: true } }],
    ['visits', 'old-visit', { patientId: 'old-patient', notes: 'Synthetic old notes', treatment: 'Original treatment' }],
    ['inventory_items', 'old-item', { name: 'Synthetic retained cream', sku: 'OLD-CREAM', category: 'Original category', unit: 'bottle', lowStockThreshold: 2, legacyField: 'keep' }],
    ['suppliers', 'old-supplier', { name: 'Synthetic original supplier', phone: '0000000', legacyField: true }],
    ['inventory_stocks', 'old-stock-A', { itemId: 'old-item', branchId: 'A', quantity: 8.125, legacyField: true }],
    ['inventory_stocks', 'old-stock-B', { itemId: 'old-item', branchId: 'B', quantity: 3 }],
    ['stock_transfers', 'old-pending', { itemId: 'old-item', fromBranchId: 'A', toBranchId: 'B', quantity: 2, status: 'pending', createdBy: 'old-staff', createdAt: { __timestamp: '2035-01-01T10:00:00.000Z' } }],
    ['stock_transfers', 'old-completed', { itemId: 'old-item', fromBranchId: 'B', toBranchId: 'A', quantity: 1, status: 'completed', completedBy: 'old-staff', completedAt: '2034-12-31T10:00:00.000Z' }],
    ['inventory_stocks', 'malformed-legacy', { itemId: 'unknown', branchId: 'A', quantity: 'unknown' }],
  ];
  for (const [collection, id, data] of legacy) await pool.query('INSERT INTO app_records(collection_path,id,data) VALUES($1,$2,$3)', [collection, id, JSON.stringify(data)]);
  await pool.query("INSERT INTO auth_identities(google_subject,user_id,email) VALUES('synthetic','old-staff','synthetic@example.invalid')");
  const before = await oldRecords(), previous = await applied();
  await writeFile(path.join(temporary, 'migrations', names[6]), sources[6]); await migrateDatabase();
  check(await oldRecords() === before, '006→007 retains exact legacy JSONB rows, accounts, Visits, quantities and old transfers');
  check(JSON.stringify((await pool.query("SELECT * FROM schema_migrations WHERE name<>'007_inventory_movements.sql' ORDER BY name")).rows) === previous, 'old applied migration timestamps/checksums unchanged');
  check(await schema() === fresh, 'fresh001–007 and upgrade006→007 have equivalent actual schema');
  check(Number((await pool.query("SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname LIKE 'inventory_%' AND NOT c.convalidated")).rows[0].count) === 0, 'all new inventory constraints validated');
  const upgraded = await applied(); await migrateDatabase();
  check(await oldRecords() === before && await applied() === upgraded, 'upgrade rerun preserves records and immutable versions');
  for (let i = 0; i < names.length; i++) {
    await writeFile(path.join(temporary, 'migrations', names[i]), sources[i] + '\n-- synthetic checksum tamper\n');
    await assert.rejects(migrateDatabase(), new RegExp('Applied migration changed: ' + names[i])); checks++;
    await writeFile(path.join(temporary, 'migrations', names[i]), sources[i]);
  }
  check(await oldRecords() === before && await applied() === upgraded, 'checksum rejection preserves data and applied history');
  for (let i = 0; i < names.length; i++) check(hash(await readFile(path.join(original, 'migrations', names[i]), 'utf8')) === hash(sources[i]), names[i] + ' workspace source unchanged');
  console.log(`Inventory migration: ${checks} checks passed (fresh001–007, retained006→007; disposable synthetic PostgreSQL only).`);
} finally { process.chdir(original); if (temporary) await rm(temporary, { recursive: true, force: true }); await pool.end(); }
