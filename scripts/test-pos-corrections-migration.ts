import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (target.hostname !== '127.0.0.1' || target.pathname !== '/vine_pos_corrections_migration_test'
    || process.env.ALLOW_TEST_DATABASE !== 'yes') {
  throw Error('Use empty disposable loopback vine_pos_corrections_migration_test only');
}
const original = process.cwd(), hash = (s: string) => createHash('sha256').update(s).digest('hex');
const actor = JSON.stringify({ uid: 'synthetic-admin', role: 'Admin' });
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
  const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename NOT IN ('schema_migrations','pos_payment_reversals') ORDER BY tablename`)).rows;
  const data: Record<string, unknown> = {};
  for (const { tablename } of tables)
    data[tablename] = (await pool.query(`SELECT to_jsonb(r) AS row FROM "${tablename}" r ORDER BY to_jsonb(r)::text`)).rows;
  return JSON.stringify(data);
}
async function rejects(query: string, values: unknown[], code: string, label: string) {
  await assert.rejects(pool.query(query, values), (error: any) => error.code === code, label); checks++;
}
const paid = async (invoice: string) => Number((await pool.query('SELECT pos_paid_cents($1) AS paid', [invoice])).rows[0].paid);
const usable = async (purchase: string) => (await pool.query('SELECT pos_purchase_usable($1) AS usable', [purchase])).rows[0].usable;
const correctionSql = 'INSERT INTO pos_payment_reversals(id,payment_id,command_id,reason,actor) VALUES($1,$2,$3,$4,$5)';
const correctionValues = (payment: string, reason = 'Synthetic entry correction', command = randomUUID()) => [randomUUID(), payment, command, reason, actor];
const usageSql = `INSERT INTO treatment_ledger_events(id,command_id,request_hash,type,purchase_id,line_id,visit_id,branch_id,used_delta,treatment_date,actor,visit_snapshot,balance_after)
  VALUES($1,$2,$3,'usage',$4,$5,$6,'A',1,'2035-01-01T10:00',$7,'{"serviceNameSnapshot":"Retained service"}',
    '{"purchasedSessions":6,"adjustmentSessions":0,"usedSessions":1,"remainingSessions":5}')`;
const usageValues = (purchase: string, line: string, visit = 'old-visit') => [randomUUID(), randomUUID(), 'a'.repeat(64), purchase, line, visit, actor];
let service: string;
async function purchase(name: string) {
  const id = randomUUID(), line = randomUUID();
  await pool.query(`INSERT INTO treatment_ledger_purchases(id,command_id,patient_id,branch_id,package_name,purchase_date,branch_name_snapshot,timezone_snapshot,notes,or_number,actor)
    VALUES($1,$2,'patient','A',$3,'2035-01-01','Retained branch','Asia/Manila','Original notes','000001',$4)`, [id, randomUUID(), name, actor]);
  await pool.query(`INSERT INTO treatment_ledger_lines(id,purchase_id,service_id,service_name_snapshot,service_catalogue_version,purchased_sessions)
    VALUES($1,$2,$3,'Retained service',1,6)`, [line, id, service]);
  return { id, line };
}
async function invoice(state: 'draft' | 'posted' | 'void', amount: number, paymentAmount = 0, linkedPurchase?: string) {
  const id = randomUUID(), item = randomUUID(), payment = randomUUID();
  await pool.query(`INSERT INTO pos_invoices(id,patient_id,branch_id,patient_name,branch_name,total_cents,notes,or_number,actor)
    VALUES($1,'patient','A','Synthetic retained patient','Retained branch',$2,'Original invoice notes','INV-OR-001',$3)`, [id, amount, actor]);
  await pool.query(`INSERT INTO pos_invoice_items(id,invoice_id,position,kind,name,amount_cents,snapshot)
    VALUES($1,$2,0,$3,'Retained invoice item',$4,$5)`, [item, id, linkedPurchase ? 'package' : 'appointment', amount,
    JSON.stringify({ id: 'booking', bookingPricingRevision: 2, quote: { totalCents: amount, source: 'special' } })]);
  if (linkedPurchase) await pool.query('INSERT INTO pos_package_purchases(item_id,purchase_id) VALUES($1,$2)', [item, linkedPurchase]);
  if (state !== 'draft') await pool.query("UPDATE pos_invoices SET state=$2,posted_at='2035-01-01T02:00Z',version=version+1 WHERE id=$1", [id, state]);
  if (paymentAmount) await pool.query(`INSERT INTO pos_payments(id,invoice_id,amount_cents,tender_cents,method,reference,actor,recorded_at)
    VALUES($1,$2,$3::bigint,$3::bigint+500,'cash','Original reference',$4,'2035-01-01T02:01Z')`, [payment, id, paymentAmount, actor]);
  return { id, item, payment };
}
async function backendPid(client: PoolClient) {
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  return pid;
}
async function waitBlocked(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0]?.wait_event_type === 'Lock') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Expected concurrent operation to wait for the invoice lock');
}
async function correctionUsageRace(correctionFirst: boolean) {
  const owned = await purchase(correctionFirst ? 'Synthetic correction-first race' : 'Synthetic usage-first race');
  const billed = await invoice('posted', 10000, 10000, owned.id);
  const first = await pool.connect(), second = await pool.connect();
  try {
    const pid = await backendPid(second);
    await first.query('BEGIN'); await second.query('BEGIN');
    await first.query("SET LOCAL statement_timeout='10s'"); await second.query("SET LOCAL statement_timeout='10s'");
    await first.query(correctionFirst ? correctionSql : usageSql,
      correctionFirst ? correctionValues(billed.payment) : usageValues(owned.id, owned.line));
    const pending = second.query(correctionFirst ? usageSql : correctionSql,
      correctionFirst ? usageValues(owned.id, owned.line) : correctionValues(billed.payment))
      .then(() => ({ error: undefined as any }), error => ({ error }));
    await waitBlocked(pid);
    await first.query('COMMIT');
    const result = await pending;
    check(result.error?.code === '23514' && result.error.message.includes(correctionFirst ? 'awaits full invoice payment' : 'usage or adjustment history'),
      correctionFirst ? 'waiting usage observes committed correction and rejects unfunded redemption' : 'waiting correction observes committed usage and preserves funding');
    await second.query('ROLLBACK');
    check(await paid(billed.id) === (correctionFirst ? 0 : 10000), 'concurrent winner determines retained invoice net payments');
    check(Number((await pool.query("SELECT count(*) FROM treatment_ledger_events WHERE purchase_id=$1 AND type='usage'", [owned.id])).rows[0].count) === (correctionFirst ? 0 : 1), 'concurrent loser cannot append conflicting package usage');
  } finally {
    await first.query('ROLLBACK'); await second.query('ROLLBACK'); first.release(); second.release();
  }
}

try {
  check(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count) === 0, 'empty disposable database required');
  const names = (await readdir('migrations')).filter(n => n.endsWith('.sql') && n < '010_').sort();
  check(names.length === 9 && names[8] === '009_pos_payment_corrections.sql', 'additive ordered migration009');
  const sources = await Promise.all(names.map(n => readFile(path.join(original, 'migrations', n), 'utf8')));
  const previousChecksums = ['67e8a46d4714a66514feee5f75152c1c884d37635766f687a9225be6c3a3af53', '8eefa5f8bb13f1f83a6611b22ae380788ed2b12d8d58f74c75b721e12da628d2', '7c1f6534769aa22b6a7bb2a0db99c22acb0c77dafb210c83b24f237493aca77c', '8d7c187555c848c0a615492ca58ed1e874f84ed17e57fec737dcc431ae3fc83c', 'e9c0e5ffac8ca4f373ecf57735031c1e2562576632f4ce0454ab2103dfd51c2a', 'c8397897fb344647368a7b50b4f88e0384649b4c20391671ea887a050b83ba8e', '6473912d9508ef0a35ac3537c35d92265ad4595472a09eb3838aae69170ac9ac', '65e7913519e2abef087240ba8a6e68d060d45a944a7cc59e249e1a355685f61a'];
  for (let i = 0; i < 8; i++) check(hash(sources[i]) === previousChecksums[i], names[i] + ' remains immutable');
  temporary = await mkdtemp(path.join(tmpdir(), 'vine-pos-corrections-migrations-'));
  await mkdir(path.join(temporary, 'migrations'));
  for (let i = 0; i < names.length; i++) await writeFile(path.join(temporary, 'migrations', names[i]), sources[i]);
  process.chdir(temporary);
  await migrateDatabase();
  const fresh = await schema(), freshApplied = await applied();
  check(JSON.stringify(JSON.parse(freshApplied).map((row: any) => row.name)) === JSON.stringify(names), 'fresh chain applies exactly001–009');
  check((await pool.query('SELECT count(*) FROM pos_payment_reversals')).rows[0].count === '0', 'fresh reversal table has no fixtures');
  await migrateDatabase();
  check(await schema() === fresh && await applied() === freshApplied, 'fresh complete-chain repeat is inert');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await rm(path.join(temporary, 'migrations', names[8]));
  await migrateDatabase();
  check(JSON.stringify(JSON.parse(await applied()).map((row: any) => row.name)) === JSON.stringify(names.slice(0, 8)), 'upgrade begins from exact committed001–008');
  service = randomUUID();
  await pool.query(`INSERT INTO app_records(collection_path,id,data) VALUES
    ('branches','A','{"branchName":"Synthetic retained branch","status":"Active"}'),
    ('patients','patient','{"name":"Synthetic retained patient","legacyText":"Keep","archived":true}'),
    ('visits','old-visit','{"patientId":"patient","branchId":"A","notes":"Original clinical history","legacyTreatment":"Keep","visitQuote":{"totalCents":10000},"visitPricingRevision":2}'),
    ('appointments','booking','{"patientId":"patient","branchId":"A","specialPrice":"100.00","bookingPricingRevision":2,"bookingQuote":{"totalCents":10000}}')`);
  await pool.query("INSERT INTO services(id,name,default_duration_minutes,standard_price,created_by,updated_by) VALUES($1,'Synthetic retained Service',30,100,'test','test')", [service]);
  await pool.query("INSERT INTO auth_identities(google_subject,user_id,email) VALUES('synthetic','synthetic-admin','synthetic@example.invalid')");
  const manual = await purchase('Original manual purchase');
  const legacyUsage = usageValues(manual.id, manual.line);
  await pool.query(usageSql, legacyUsage);
  await pool.query(`INSERT INTO treatment_ledger_visit_usage(visit_id,event_id,line_id,sessions,visit_snapshot)
    VALUES('old-visit',$1,$2,1,'{"serviceNameSnapshot":"Retained service"}')`, [legacyUsage[0], manual.line]);
  const unpaidPackage = await purchase('Original awaiting-payment package');
  const paidPackage = await purchase('Original paid package');
  const usedPackage = await purchase('Original used paid package');
  const adjustedPackage = await purchase('Original adjusted paid package');
  const draft = await invoice('draft', 10000), partial = await invoice('posted', 10000, 4000, unpaidPackage.id);
  const full = await invoice('posted', 10000, 10000, paidPackage.id), voided = await invoice('void', 10000);
  const used = await invoice('posted', 10000, 10000, usedPackage.id), adjusted = await invoice('posted', 10000, 10000, adjustedPackage.id);
  await pool.query(usageSql, usageValues(usedPackage.id, usedPackage.line));
  await pool.query(`INSERT INTO treatment_ledger_events(id,command_id,request_hash,type,purchase_id,line_id,branch_id,sessions_delta,actor,reason,balance_after)
    VALUES($1,$2,$3,'adjustment',$4,$5,'A',1,$6,'Original adjustment','{"purchasedSessions":6,"adjustmentSessions":1,"usedSessions":0,"remainingSessions":7}')`,
    [randomUUID(), randomUUID(), 'b'.repeat(64), adjustedPackage.id, adjustedPackage.line, actor]);
  await pool.query("INSERT INTO pos_source_claims(collection_path,record_id,invoice_id) VALUES('appointments','booking',$1),('visits','old-visit',$1)", [full.id]);
  await pool.query(`INSERT INTO pos_events(id,command_id,invoice_id,request_hash,kind,actor,detail)
    VALUES($1,$2,$3,$4,'payment',$5,'{"preserve":"Original audit"}')`, [randomUUID(), randomUUID(), full.id, 'c'.repeat(64), actor]);
  const before = await retained(), previous = await applied();
  await writeFile(path.join(temporary, 'migrations', names[8]), sources[8]);
  await migrateDatabase();
  check(await retained() === before, '008→009 preserves all existing invoices, payments, quotes, purchase balances, legacy data and usage byte-for-byte');
  check(await schema() === fresh, 'fresh001–009 and upgrade008→009 schemas, constraints, functions and triggers match exactly');
  check(JSON.stringify((await pool.query("SELECT * FROM schema_migrations WHERE name<>'009_pos_payment_corrections.sql' ORDER BY name")).rows) === previous, 'previous applied checksums and timestamps unchanged');
  check((await pool.query('SELECT count(*) FROM pos_payment_reversals')).rows[0].count === '0', 'upgrade creates no reversal backfill');
  check(await paid(draft.id) === 0 && await paid(partial.id) === 4000 && await paid(full.id) === 10000 && await paid(voided.id) === 0, 'old draft/partial/paid/void invoice amounts remain compatible');
  check(await usable(manual.id) === true && await usable(unpaidPackage.id) === false && await usable(paidPackage.id) === true, 'manual purchases and existing POS funding gates remain compatible');
  const upgraded = await applied();
  await migrateDatabase();
  check(await retained() === before && await applied() === upgraded && await schema() === fresh, 'upgrade repeat is inert');
  await writeFile(path.join(temporary, 'migrations', names[8]), sources[8] + '\n-- synthetic tamper\n');
  await assert.rejects(migrateDatabase(), /Applied migration changed: 009_pos_payment_corrections.sql/); checks++;
  await writeFile(path.join(temporary, 'migrations', names[8]), sources[8]);
  check(await retained() === before && await applied() === upgraded, 'checksum tamper rejection preserves records and migration metadata');
  for (let i = 0; i < names.length; i++) check(hash(await readFile(path.join(original, 'migrations', names[i]), 'utf8')) === hash(sources[i]), 'workspace migration source remains unchanged');
  check((await pool.query(`SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relname='pos_payment_reversals' AND NOT c.convalidated`)).rows[0].count === '0', 'all new reversal constraints validated');

  await rejects(correctionSql, correctionValues(partial.payment, '  '), '23514', 'blank correction reason denied');
  await rejects(correctionSql, correctionValues(partial.payment, 'x'.repeat(1001)), '23514', 'overlong correction reason denied');
  const invalidActor = correctionValues(partial.payment); invalidActor[4] = '[]';
  await rejects(correctionSql, invalidActor, '23514', 'non-object correction actor denied');
  await rejects(correctionSql, correctionValues(randomUUID()), '23514', 'missing payment correction denied');
  await rejects(correctionSql, correctionValues(used.payment), '23514', 'package usage history prevents correction');
  await rejects(correctionSql, correctionValues(adjusted.payment), '23514', 'package adjustment history prevents correction');
  const command = randomUUID(), partialReversal = correctionValues(partial.payment, 'Correct original partial entry', command);
  await pool.query(correctionSql, partialReversal);
  check(await paid(partial.id) === 0, 'full payment correction reopens partial invoice balance');
  check(await retained() === before, 'correction appends reversal without changing any original invoice, payment or ledger record');
  await rejects(correctionSql, correctionValues(partial.payment), '23505', 'one reversal per original payment');
  await rejects(correctionSql, correctionValues(full.payment, 'Another correction', command), '23505', 'one reversal per command');
  await rejects('UPDATE pos_payment_reversals SET reason=$2 WHERE id=$1', [partialReversal[0], 'Rewrite'], '23514', 'reversal reason cannot be rewritten');
  await rejects('DELETE FROM pos_payment_reversals WHERE id=$1', [partialReversal[0]], '23514', 'reversal history cannot be deleted');
  await rejects('UPDATE pos_payments SET reference=$2 WHERE id=$1', [partial.payment, 'Rewrite'], '23514', 'original payment remains immutable after correction');
  await rejects('DELETE FROM pos_payments WHERE id=$1', [partial.payment], '23514', 'original payment cannot be deleted after correction');
  await pool.query(correctionSql, correctionValues(full.payment));
  check(await paid(full.id) === 0 && await usable(paidPackage.id) === false, 'correcting unused funded package closes its session gate');
  await rejects(usageSql, usageValues(paidPackage.id, paidPackage.line), '23514', 'unfunded package cannot be redeemed after correction');
  await pool.query(`INSERT INTO pos_payments(id,invoice_id,amount_cents,tender_cents,method,reference,actor)
    VALUES($1,$2,10000,10000,'card','Synthetic replacement payment',$3)`, [randomUUID(), full.id, actor]);
  check(await paid(full.id) === 10000 && await usable(paidPackage.id) === true, 'corrected invoice accepts replacement collection and restores package gate');
  await rejects(`INSERT INTO pos_payments(id,invoice_id,amount_cents,tender_cents,method,reference,actor)
    VALUES($1,$2,1,1,'cash','',$3)`, [randomUUID(), full.id, actor], '23514', 'net paid balance still prevents overpayment');
  await correctionUsageRace(true);
  await correctionUsageRace(false);
  console.log(`POS corrections migration: ${checks} checks passed (fresh001–009, retained008→009, direct-SQL funding/correction races).`);
} finally {
  process.chdir(original);
  if (temporary) await rm(temporary, { recursive: true, force: true });
  await pool.end();
}
