import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_treatment_ledger_migration_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes') {
  throw Error('Use an empty disposable loopback vine_treatment_ledger_migration_test database only');
}
const originalCwd = process.cwd();
const previousNames = ['001_platform.sql', '002_session_integrity.sql', '003_services.sql', '004_services_name_identity.sql'];
// Applied migration files are immutable. These are the audited pre-feature bytes.
const previousChecksums = [
  '67e8a46d4714a66514feee5f75152c1c884d37635766f687a9225be6c3a3af53',
  '8eefa5f8bb13f1f83a6611b22ae380788ed2b12d8d58f74c75b721e12da628d2',
  '7c1f6534769aa22b6a7bb2a0db99c22acb0c77dafb210c83b24f237493aca77c',
  '8d7c187555c848c0a615492ca58ed1e874f84ed17e57fec737dcc431ae3fc83c',
];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const ledgerTables = ['treatment_ledger_purchases', 'treatment_ledger_lines', 'treatment_ledger_events', 'treatment_ledger_visit_usage'];
const migrationRows = async () => JSON.stringify((await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows);
const retainedRows = async () => JSON.stringify((await pool.query(`
  SELECT 'app_records' AS table_name, row_to_json(r) AS record FROM (SELECT * FROM app_records ORDER BY collection_path,id) r
  UNION ALL SELECT 'service_categories', row_to_json(r) FROM (SELECT * FROM service_categories ORDER BY id) r
  UNION ALL SELECT 'services', row_to_json(r) FROM (SELECT * FROM services ORDER BY id) r
  UNION ALL SELECT 'service_branch_settings', row_to_json(r) FROM (SELECT * FROM service_branch_settings ORDER BY id) r
`)).rows);
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
let temporary: string | undefined;
let ledgerCwd: string | undefined;
try {
  check(!(await pool.query("SELECT to_regclass('public.app_records') AS records")).rows[0].records,
    'migration suite starts in an empty disposable database');
  check((await pool.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].count === 0,
    'disposable migration database contains no unrelated user tables');
  const names = (await readdir(path.join(originalCwd, 'migrations'))).filter(name => name.endsWith('.sql') && name < '006_').sort();
  check(names.length === 5 && names.slice(0, 4).join() === previousNames.join() && /^005_/.test(names[4]),
    'one ordered forward migration follows unchanged 001–004');
  const sources = await Promise.all(names.map(name => readFile(path.join(originalCwd, 'migrations', name), 'utf8')));
  // Pin this regression to its original 004→005 boundary; later migrations
  // have independent fresh/upgrade suites. All copied bytes remain checksummed.
  ledgerCwd = await mkdtemp(path.join(os.tmpdir(), 'vine-ledger-005-boundary-'));
  await mkdir(path.join(ledgerCwd, 'migrations'));
  for (let i = 0; i < names.length; i++) await writeFile(path.join(ledgerCwd, 'migrations', names[i]), sources[i]);
  process.chdir(ledgerCwd);
  for (let index = 0; index < 4; index++) check(hash(sources[index]) === previousChecksums[index], `${names[index]} retains audited bytes`);
  await migrateDatabase();
  check((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(row => row.name).join() === names.join(),
    'fresh database applies complete 001–005 sequence');
  for (const table of ledgerTables) {
    check((await pool.query('SELECT to_regclass($1) AS relation', ['public.' + table])).rows[0].relation === table,
      `fresh schema includes ${table}`);
    check((await pool.query(`SELECT count(*)::integer AS count FROM ${table}`)).rows[0].count === 0,
      `${table} has no automatically seeded clinical or ledger records`);
  }
  const freshSchema = await schema(), freshLedger = await migrationRows();
  await migrateDatabase();
  check(await migrationRows() === freshLedger && await schema() === freshSchema,
    'checksummed fresh-chain rerun changes neither applied times nor schema');

  // This database was required to be empty and is exclusively owned by this suite.
  // Reinitialize it at the immediately previous committed schema using the runner.
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  temporary = await mkdtemp(path.join(os.tmpdir(), 'vine-treatment-ledger-migrations-'));
  await mkdir(path.join(temporary, 'migrations'));
  for (let index = 0; index < 4; index++) await writeFile(path.join(temporary, 'migrations', names[index]), sources[index]);
  process.chdir(temporary); await migrateDatabase(); process.chdir(ledgerCwd!);
  check((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(row => row.name).join() === previousNames.join(),
    'upgrade fixture starts at committed schema 004');
  const oldApplied = await migrationRows();
  for (const [collection, id, data] of [
    ['branches', 'synthetic-A', { branchName: 'Original synthetic branch', status: 'Active', timezone: 'Asia/Manila' }],
    ['users', 'synthetic-actor', { role: 'admin', active: true, unknownHistory: { retained: true } }],
    ['patients', 'synthetic-patient', { name: 'Synthetic retained patient', medicalHistory: '  Original history\n', isArchived: false }],
    ['visits', 'synthetic-visit', { patientId: 'synthetic-patient', branchId: 'synthetic-A', treatmentService: '  ORIGINAL\tfree text\n', unknownHistory: { retained: true } }],
    ['appointments', 'synthetic-appointment', { patientId: 'synthetic-patient', branchId: 'synthetic-A', visitType: 'Treatment Session' }],
  ] as const) await pool.query('INSERT INTO app_records(collection_path,id,data) VALUES($1,$2,$3)', [collection, id, JSON.stringify(data)]);
  const categoryId = randomUUID(), serviceId = randomUUID();
  await pool.query('INSERT INTO service_categories(id,name,created_by,updated_by) VALUES($1,$2,$3,$3)', [categoryId, 'Retained synthetic category', 'synthetic-actor']);
  await pool.query(`INSERT INTO services(id,name,category_id,default_duration_minutes,standard_price,active,created_by,updated_by)
    VALUES($1,$2,$3,45,0,false,$4,$4)`, [serviceId, '  Retained synthetic Service  ', categoryId, 'synthetic-actor']);
  await pool.query(`INSERT INTO service_branch_settings(id,service_id,branch_id,available,created_by,updated_by)
    VALUES($1,$2,$3,true,$4,$4)`, [randomUUID(), serviceId, 'synthetic-A', 'synthetic-actor']);
  const retained = await retainedRows();
  await migrateDatabase();
  check(await retainedRows() === retained, '004→005 preserves synthetic app records, Services, settings and all timestamps exactly');
  check(JSON.stringify((await pool.query('SELECT * FROM schema_migrations WHERE name <> $1 ORDER BY name', [names[4]])).rows) === oldApplied,
    '004→005 preserves original migration checksums and applied timestamps');
  check(await schema() === freshSchema, 'fresh and 004→005 upgrade produce the same structural schema');
  check((await pool.query(`SELECT count(*)::integer AS count FROM pg_constraint n
    JOIN pg_class c ON c.oid=n.conrelid WHERE c.relname=ANY($1::text[]) AND NOT n.convalidated`, [ledgerTables])).rows[0].count === 0,
    'new ledger constraints are validated after upgrade');
  const upgradedLedger = await migrationRows();
  await migrateDatabase();
  check(await migrationRows() === upgradedLedger && await retainedRows() === retained && await schema() === freshSchema,
    'repeated upgrade does not mutate migrations, retained records or schema');

  // Tamper only temporary source copies; applied files in the workspace stay intact.
  await writeFile(path.join(temporary, 'migrations', names[4]), sources[4]);
  process.chdir(temporary);
  for (const index of [0, 1, 2, 3, 4]) {
    await writeFile(path.join(temporary, 'migrations', names[index]), sources[index] + '\n-- synthetic checksum mismatch\n');
    await assert.rejects(migrateDatabase(), new RegExp('Applied migration changed: ' + names[index])); checks++;
    await writeFile(path.join(temporary, 'migrations', names[index]), sources[index]);
  }
  process.chdir(ledgerCwd!);
  check(await migrationRows() === upgradedLedger && await retainedRows() === retained && await schema() === freshSchema,
    'checksum failures roll back without changing schema, records or migration ledger');
  for (let index = 0; index < names.length; index++) check(hash(await readFile(path.join(originalCwd, 'migrations', names[index]), 'utf8')) === hash(sources[index]),
    `${names[index]} workspace source unchanged by tests`);
  console.log(`Treatment ledger migration: ${checks} checks passed (fresh 001–005 and retained-record 004→005, disposable synthetic PostgreSQL).`);
} finally {
  process.chdir(originalCwd);
  if (temporary) await rm(temporary, { recursive: true, force: true });
  if (ledgerCwd) await rm(ledgerCwd, { recursive: true, force: true });
  await pool.end();
}
