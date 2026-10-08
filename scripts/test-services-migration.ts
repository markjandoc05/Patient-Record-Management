import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
import { serviceName } from '../src/servicesPolicy';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_services_migration_test' || process.env.ALLOW_TEST_DATABASE !== 'yes') throw new Error('Disposable loopback vine_services_migration_test required');
const originalCwd = process.cwd();
const names = ['001_platform.sql', '002_session_integrity.sql', '003_services.sql', '004_services_name_identity.sql'];
const migrations = await Promise.all(names.map(name => readFile(path.join(originalCwd, 'migrations', name), 'utf8')));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
let checks = 0;
const check = (value: any, label: string) => { assert.ok(value, label); checks++; };
const inserts = (table: string) => table === 'services'
  ? 'INSERT INTO services(id,name,default_duration_minutes,created_by,updated_by) VALUES($1,$2,30,\'synthetic\',\'synthetic\')'
  : 'INSERT INTO service_categories(id,name,created_by,updated_by) VALUES($1,$2,\'synthetic\',\'synthetic\')';
const snapshot = async () => JSON.stringify((await pool.query('SELECT * FROM app_records ORDER BY collection_path,id')).rows);
const resetTo003 = async () => {
  await pool.query('DROP TABLE service_branch_settings; DROP TABLE services; DROP TABLE service_categories; DROP FUNCTION IF EXISTS services_normalized_name(text)');
  await pool.query("DELETE FROM schema_migrations WHERE name IN ('003_services.sql','004_services_name_identity.sql')");
  await pool.query(migrations[2]);
  await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [names[2], hash(migrations[2])]);
};
try {
  await migrateDatabase();
  check((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r => r.name).join() === names.join(), 'fresh sequence 001 through 004');
  await migrateDatabase(); check((await pool.query('SELECT * FROM schema_migrations')).rowCount === 4, 'checksummed rerun');
  check((await pool.query('SELECT checksum FROM schema_migrations WHERE name=$1', [names[2]])).rows[0].checksum === hash(migrations[2]), '003 checksum unchanged');
  await pool.query("INSERT INTO app_records(collection_path,id,data) VALUES('visits','synthetic-legacy',$1)", [JSON.stringify({ treatmentService: '  ORIGINAL\tfree text\n', preserved: true })]);
  const legacy = await snapshot();
  await resetTo003();
  for (const table of ['service_categories', 'services']) await pool.query(inserts(table), [randomUUID(), '\t  MiXeD   Display \n']);
  const before = JSON.stringify((await pool.query('SELECT name FROM service_categories UNION ALL SELECT name FROM services')).rows);
  await migrateDatabase();
  check(JSON.stringify((await pool.query('SELECT name FROM service_categories UNION ALL SELECT name FROM services')).rows) === before, 'valid existing display values preserved across 003 to 004');
  check(await snapshot() === legacy, 'JSONB records and timestamps unchanged');
  for (const table of ['service_categories', 'services']) {
    for (const [plain, variant] of [['Spaces Name', '  Spaces Name  '], ['Tabs Name', '\tTabs Name\t'], ['Runs Name', 'Runs \t\n Name'], ['Case Name', 'cASE nAME'], ['Unicode Name', '\u00a0Unicode\u2003Name\ufeff']]) {
      await pool.query(inserts(table), [randomUUID(), plain]);
      await assert.rejects(pool.query(inserts(table), [randomUUID(), variant]), (e: any) => e.code === '23505'); checks++;
    }
    const whitespace = [' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff'];
    for (const value of whitespace) {
      await assert.rejects(pool.query(inserts(table), [randomUUID(), value]), (e: any) => e.code === '23514'); checks++;
      check((await pool.query('SELECT services_normalized_name($1) AS name', [value + 'Laser' + value + value + 'Treatment' + value])).rows[0].name === serviceName(value + 'Laser' + value + value + 'Treatment' + value).toLowerCase(), 'DB/application whitespace agreement');
    }
  }
  // 003 accepts boundary-tab collisions and tab-only blanks. 004 must fail before
  // replacing either index and roll back the function/checksum without touching rows.
  for (const fixture of ['category collision', 'service collision', 'category blank', 'service blank']) {
    await resetTo003();
    const table = fixture.startsWith('category') ? 'service_categories' : 'services';
    await pool.query(inserts(table), [randomUUID(), fixture.endsWith('blank') ? '\t\n' : 'Collision Name']);
    if (fixture.endsWith('collision')) await pool.query(inserts(table), [randomUUID(), '\tCollision Name\t']);
    const rowsBefore = JSON.stringify((await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows);
    const indexesBefore = JSON.stringify((await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename IN ('services','service_categories') ORDER BY indexname")).rows);
    await assert.rejects(migrateDatabase(), /Services name migration blocked/); checks++;
    check(JSON.stringify((await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows) === rowsBefore, 'failed migration leaves Services rows intact');
    check(JSON.stringify((await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename IN ('services','service_categories') ORDER BY indexname")).rows) === indexesBefore, 'failed migration leaves original indexes intact');
    check((await pool.query("SELECT 1 FROM schema_migrations WHERE name='004_services_name_identity.sql'")).rowCount === 0, 'failed migration not registered');
    check((await pool.query("SELECT to_regprocedure('services_normalized_name(text)') AS f")).rows[0].f === null, 'failed migration function rolled back');
    check(await snapshot() === legacy, 'failed migration does not change JSONB');
  }
  await resetTo003(); await migrateDatabase();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'services-checksum-'));
  try {
    await mkdir(path.join(temp, 'migrations'));
    for (let i = 0; i < names.length; i++) await writeFile(path.join(temp, 'migrations', names[i]), migrations[i]);
    process.chdir(temp);
    for (const i of [2, 3]) {
      await writeFile(path.join(temp, 'migrations', names[i]), migrations[i] + '\n-- synthetic tamper\n');
      await assert.rejects(migrateDatabase(), new RegExp('Applied migration changed: ' + names[i])); checks++;
      await writeFile(path.join(temp, 'migrations', names[i]), migrations[i]);
    }
  } finally { process.chdir(originalCwd); await rm(temp, { recursive: true, force: true }); }
  check(await snapshot() === legacy, 'final JSONB snapshot unchanged');
  check(hash(await readFile(path.join(originalCwd, 'migrations', names[2]), 'utf8')) === hash(migrations[2]), '003 source untouched by checksum tests');
  console.log(`Services forward migration: ${checks} checks passed`);
} finally { process.chdir(originalCwd); await pool.end(); }
