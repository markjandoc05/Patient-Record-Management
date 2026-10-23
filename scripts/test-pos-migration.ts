import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (target.hostname !== '127.0.0.1' || target.pathname !== '/vine_pos_migration_test' || process.env.ALLOW_TEST_DATABASE !== 'yes') {
    throw Error('Use empty disposable loopback vine_pos_migration_test only');
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
async function retained() {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' AND tablename NOT LIKE 'pos_%' ORDER BY tablename")).rows;
    const data: any = {};
    for (const { tablename } of tables)
        data[tablename] = (await pool.query(`SELECT to_jsonb(r) AS row FROM "${tablename}" r ORDER BY to_jsonb(r)::text`)).rows;
    return JSON.stringify(data);
}
try {
    check(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count) === 0, 'empty disposable database required');
    const names = (await readdir('migrations')).filter(n => n.endsWith('.sql') && n < '009_').sort();
    check(names.length === 8 && names[7] === '008_pos_payments.sql', 'focused ordered POS migration chain through008');
    const sources = await Promise.all(names.map(n => readFile(path.join(original, 'migrations', n), 'utf8')));
    // Keep this release's fresh and upgrade schemas comparable when later migrations exist.
    temporary = await mkdtemp(path.join(tmpdir(), 'vine-pos-migrations-'));
    await mkdir(path.join(temporary, 'migrations'));
    for (let i = 0; i < names.length; i++)
        await writeFile(path.join(temporary, 'migrations', names[i]), sources[i]);
    process.chdir(temporary);
    await migrateDatabase();
    const fresh = await schema(), freshApplied = await applied();
    check(JSON.stringify(JSON.parse(freshApplied).map((row: any) => row.name)) === JSON.stringify(names), 'fresh baseline applies exactly001–008, excluding later workspace migrations');
    await migrateDatabase();
    check(await schema() === fresh && await applied() === freshApplied, 'fresh complete chain repeat is inert');
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'pos_%'")).rows;
    for (const { tablename } of tables)
        check((await pool.query(`SELECT count(*) FROM "${tablename}"`)).rows[0].count === '0', 'no fixtures in ' + tablename);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await rm(path.join(temporary, 'migrations', names[7]));
    await migrateDatabase();
    check(JSON.stringify(JSON.parse(await applied()).map((row: any) => row.name)) === JSON.stringify(names.slice(0, 7)), 'retained setup applies exactly001–007');
    const { randomUUID } = await import('node:crypto');
    const service = randomUUID(), purchase = randomUUID(), line = randomUUID();
    await pool.query(`INSERT INTO app_records(collection_path,id,data) VALUES('branches','A','{"branchName":"Synthetic retained clinic","status":"Active"}'),('patients','patient','{"name":"Synthetic retained patient","legacyText":"Keep"}'),('visits','old-visit','{"patientId":"patient","branchId":"A","notes":"Unsaved origin history","legacyTreatment":"Keep"}'),('appointments','booking','{"specialPrice":"100.00","bookingPricingRevision":2,"bookingQuote":{"total":"100.00"}}')`);
    await pool.query("INSERT INTO services(id,name,default_duration_minutes,standard_price,created_by,updated_by) VALUES($1,'Synthetic retained Service',30,0,'test','test')", [service]);
    await pool.query(`INSERT INTO treatment_ledger_purchases(id,command_id,patient_id,branch_id,package_name,purchase_date,branch_name_snapshot,timezone_snapshot,notes,or_number,actor) VALUES($1,$2,'patient','A','Original manual purchase','2035-01-01','Original branch','Asia/Manila','Original notes','000001','{"uid":"test"}')`, [purchase, randomUUID()]);
    await pool.query(`INSERT INTO treatment_ledger_lines(id,purchase_id,service_id,service_name_snapshot,service_catalogue_version,purchased_sessions) VALUES($1,$2,$3,'Original service',1,6)`, [line, purchase, service]);
    await pool.query(`INSERT INTO treatment_ledger_events(id,command_id,request_hash,type,purchase_id,line_id,visit_id,branch_id,used_delta,treatment_date,actor,visit_snapshot,balance_after) VALUES($1,$2,$3,'usage',$4,$5,'old-visit','A',1,'2035-01-01T10:00','{"uid":"test"}','{"serviceNameSnapshot":"Original service"}','{"purchasedSessions":6,"adjustmentSessions":0,"usedSessions":1,"remainingSessions":5}')`, [randomUUID(), randomUUID(), 'a'.repeat(64), purchase, line]);
    const before = await retained(), previous = await applied();
    await writeFile(path.join(temporary, 'migrations', names[7]), sources[7]);
    await migrateDatabase();
    check(await retained() === before, '007→008 preserves every legacy record, quote, purchase, session and event byte-for-byte');
    check((await pool.query('SELECT pos_purchase_usable($1) AS usable', [purchase])).rows[0].usable === true, 'old purchases stay usable without backfill');
    check(await schema() === fresh, 'fresh and upgrade schema, constraints, functions and triggers match exactly');
    check(JSON.stringify((await pool.query("SELECT * FROM schema_migrations WHERE name<>'008_pos_payments.sql' ORDER BY name")).rows) === previous, 'previous migration metadata unchanged');
    console.log(`POS migration: ${checks} checks passed`);
}
finally {
    process.chdir(original);
    if (temporary)
        await rm(temporary, { recursive: true, force: true });
    await pool.end();
}
