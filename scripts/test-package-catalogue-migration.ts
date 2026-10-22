import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
const url=new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/vine_package_catalogue_migration_test'||process.env.ALLOW_TEST_DATABASE!=='yes') throw Error('Use empty disposable loopback vine_package_catalogue_migration_test only');
const original=process.cwd(), hash=(s:string)=>createHash('sha256').update(s).digest('hex');
let checks=0,temporary:string|undefined;
const check=(v:unknown,m:string)=>{assert.ok(v,m);checks++;};
const migrations=async()=>JSON.stringify((await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows);
const oldTables=['app_records','auth_identities','auth_sessions','oauth_attempts','service_categories','services','service_branch_settings','treatment_ledger_purchases','treatment_ledger_lines','treatment_ledger_events','treatment_ledger_visit_usage'];
async function snapshot(){const data:any={};for(const t of oldTables){data[t]=(await pool.query(`SELECT to_jsonb(r)-ARRAY['catalogue_package_id','catalogue_package_version'] AS record FROM ${t} r ORDER BY (to_jsonb(r)-ARRAY['catalogue_package_id','catalogue_package_version'])::text`)).rows;}return JSON.stringify(data);}
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
try {
  check(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count)===0,'requires an empty disposable database');
  const names=(await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort();check(names.length===6&&names[5]==='006_package_catalogue.sql','one ordered new006');
  const sources=await Promise.all(names.map(n=>readFile(path.join(original,'migrations',n),'utf8')));
  const expected=['67e8a46d4714a66514feee5f75152c1c884d37635766f687a9225be6c3a3af53','8eefa5f8bb13f1f83a6611b22ae380788ed2b12d8d58f74c75b721e12da628d2','7c1f6534769aa22b6a7bb2a0db99c22acb0c77dafb210c83b24f237493aca77c','8d7c187555c848c0a615492ca58ed1e874f84ed17e57fec737dcc431ae3fc83c','e9c0e5ffac8ca4f373ecf57735031c1e2562576632f4ce0454ab2103dfd51c2a'];
  for(let i=0;i<5;i++)check(hash(sources[i])===expected[i],names[i]+' remains immutable');
  await migrateDatabase();const fresh=await schema(),freshMigrations=await migrations();
  for(const table of ['package_catalogue','package_catalogue_versions','package_catalogue_lines'])check((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count==='0','no catalogue fixtures seeded');
  await migrateDatabase();check(await schema()===fresh&&await migrations()===freshMigrations,'fresh rerun is inert');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  temporary=await mkdtemp(path.join(tmpdir(),'vine-package-migrations-'));await mkdir(path.join(temporary,'migrations'));
  for(let i=0;i<5;i++)await writeFile(path.join(temporary,'migrations',names[i]),sources[i]);
  process.chdir(temporary);await migrateDatabase();
  const service=randomUUID(),purchase=randomUUID(),line=randomUUID(),buyEvent=randomUUID(),useEvent=randomUUID();
  await pool.query(`INSERT INTO app_records(collection_path,id,data) VALUES('branches','A','{"branchName":"Synthetic original branch","status":"Active"}'),('patients','patient','{"name":"Synthetic old patient","legacyField":{"preserve":true}}'),('visits','old-visit','{"patientId":"patient","notes":"Synthetic old notes","legacyTreatment":"Original text"}')`);
  await pool.query('INSERT INTO services(id,name,default_duration_minutes,standard_price,created_by,updated_by) VALUES($1,\'Synthetic retained Service\',30,0,\'test\',\'test\')',[service]);
  await pool.query(`INSERT INTO treatment_ledger_purchases(id,command_id,patient_id,branch_id,package_name,purchase_date,branch_name_snapshot,timezone_snapshot,notes,or_number,actor) VALUES($1,$2,'patient','A','Original manual purchase','2035-01-01','Original branch','Asia/Manila','Retain original notes','000001','{"uid":"test"}')`,[purchase,randomUUID()]);
  await pool.query(`INSERT INTO treatment_ledger_lines(id,purchase_id,service_id,service_name_snapshot,service_catalogue_version,purchased_sessions) VALUES($1,$2,$3,'Original service snapshot',1,6)`,[line,purchase,service]);
  await pool.query(`INSERT INTO treatment_ledger_events(id,command_id,request_hash,type,purchase_id,branch_id,actor) VALUES($1,$2,$3,'purchase',$4,'A','{"uid":"test"}')`,[buyEvent,randomUUID(),'a'.repeat(64),purchase]);
  await pool.query(`INSERT INTO treatment_ledger_events(id,command_id,request_hash,type,purchase_id,line_id,visit_id,branch_id,used_delta,treatment_date,actor,visit_snapshot,balance_after) VALUES($1,$2,$3,'usage',$4,$5,'old-visit','A',1,'2035-01-01T10:00','{"uid":"test"}','{"serviceNameSnapshot":"Original service snapshot"}','{"purchasedSessions":6,"adjustmentSessions":0,"usedSessions":1,"remainingSessions":5}')`,[useEvent,randomUUID(),'b'.repeat(64),purchase,line]);
  await pool.query(`INSERT INTO treatment_ledger_visit_usage(visit_id,event_id,line_id,sessions,visit_snapshot) VALUES('old-visit',$1,$2,1,'{"serviceNameSnapshot":"Original service snapshot"}')`,[useEvent,line]);
  await pool.query("INSERT INTO auth_identities(google_subject,user_id,email) VALUES('synthetic','synthetic','synthetic@example.invalid')");
  const before=await snapshot(),applied=await migrations();
  await writeFile(path.join(temporary,'migrations',names[5]),sources[5]);await migrateDatabase();
  check(await snapshot()===before,'005→006 preserves every legacy row, event, snapshot, balance and Visit binding');
  check((await pool.query('SELECT catalogue_package_id,catalogue_package_version FROM treatment_ledger_purchases')).rows.every(r=>r.catalogue_package_id===null&&r.catalogue_package_version===null),'old purchases remain unlinked/manual without backfill');
  check(JSON.stringify((await pool.query("SELECT * FROM schema_migrations WHERE name<>'006_package_catalogue.sql' ORDER BY name")).rows)===applied,'old applied checksums/timestamps unchanged');
  check(await schema()===fresh,'fresh001–006 and upgrade005→006 schemas identical');
  check(Number((await pool.query(`SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname LIKE 'package_catalogue%' AND NOT c.convalidated`)).rows[0].count)===0,'new catalogue constraints validated');
  const upgraded=await migrations();await migrateDatabase();check(await snapshot()===before&&await migrations()===upgraded,'upgrade rerun preserves all records');
  for(let i=0;i<6;i++){
    await writeFile(path.join(temporary,'migrations',names[i]),sources[i]+'\n-- synthetic tamper\n');
    await assert.rejects(migrateDatabase(),new RegExp('Applied migration changed: '+names[i]));checks++;
    await writeFile(path.join(temporary,'migrations',names[i]),sources[i]);
  }
  check(await snapshot()===before&&await migrations()===upgraded,'checksum rejection leaves records and versions intact');
  for(let i=0;i<6;i++)check(hash(await readFile(path.join(original,'migrations',names[i]),'utf8'))===hash(sources[i]),'workspace migration unchanged');
  console.log(`Package catalogue migration: ${checks} checks passed (fresh001–006, retained005→006, isolated synthetic PostgreSQL).`);
} finally {process.chdir(original);if(temporary)await rm(temporary,{recursive:true,force:true});await pool.end();}
