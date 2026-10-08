import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_parity_test' || process.env.ALLOW_TEST_DATABASE !== 'yes'
  || process.env.NODE_ENV !== 'production' || !process.env.STORAGE_DIR) throw new Error('Use disposable local vine_parity_test and temporary files only');
const origin = new URL(process.env.APP_URL!).origin;
const credentials = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen> | undefined;
let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; }
async function request(path: string, body: any, role = 'staff', method = 'POST') {
  const c = credentials.get(role)!;
  return fetch(`http://127.0.0.1:${(server!.address() as any).port}${path}`, { method,
    headers: { Origin: origin, Cookie: c.cookie, Authorization: `Bearer ${c.csrf}`, 'Content-Type': 'application/json' },
    ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}) });
}

async function read(path: string, account='staff', kind='collection', constraints:any=[]) {
 const r=await request('/api/data/query',{path,kind,constraints},account);return {status:r.status,body:await r.json()};
}
try {
 await migrateDatabase();await pool.query('TRUNCATE service_branch_settings, services, service_categories, app_records,auth_sessions,auth_identities,oauth_attempts');
 for(const role of ['staff','admin','inactive']) {
  const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  await db.collection('users').doc(role).set({role:role==='inactive'?'staff':role,active:role!=='inactive',assignedBranches:['A'],fullName:'Synthetic account'});
  await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)',[role,`${role}@example.invalid`]);
  await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),role,csrf]);
  credentials.set(role,{cookie:`__Host-vine_session=${token}`,csrf});
 }
 for(const id of ['A','B'])await db.collection('branches').doc(id).set({branchName:`Synthetic ${id}`,status:'Active'});
 for(const [id,branch,status,archived] of [['A','A','Active',false],['B','B','Active',false],['archived','B','Active',true],['inactive-patient','A','Inactive',false]] as const)
  await db.collection('patients').doc(id).set({name:'SYNTHETIC_PATIENT_PAYLOAD',homeBranchId:branch,status,isArchived:archived});
 server=app.listen(0,'127.0.0.1');await once(server,'listening');
 for(const role of ['staff','admin']) {
  const list=await read('patients',role);check(list.status===200&&list.body.documents.length===4,role+': shared list includes both clinics and lifecycle states');
  const direct=await read('patients/B',role,'document');check(direct.status===200&&direct.body.document.data.homeBranchId==='B',role+': shared direct read');
  const filtered=await read('patients',role,'collection',[{type:'where',field:'homeBranchId',operator:'==',value:'B'}]);check(filtered.status===200&&filtered.body.documents.length===2,role+': branch filter narrows shared scope');
 }
 const denied=await read('patients','inactive');check(denied.status===403&&!JSON.stringify(denied.body).includes('SYNTHETIC_PATIENT_PAYLOAD'),'Inactive account denied without payload');
 for(const constraints of [[{type:'limit',value:'all'}],[{type:'where',field:'homeBranchId; DROP TABLE app_records',operator:'==',value:'B'}],[{type:'where',field:'homeBranchId',operator:'or',value:'B'}]]) {
  const r=await read('patients','staff','collection',constraints);check(r.status>=400&&!JSON.stringify(r.body).includes('SYNTHETIC_PATIENT_PAYLOAD'),'Hostile filter fails without payload');
 }
 const invalid=await read('patients/../../users','staff','document');check(invalid.status>=400,'Malformed direct path rejected');
 const unauth=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/data/query`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({path:'patients',kind:'collection'})});
 check(unauth.status>=400&&!(await unauth.text()).includes('SYNTHETIC_PATIENT_PAYLOAD'),'Anonymous read denied without payload');
 const base={name:'Synthetic Findings',contactNumber:'09171234567',email:'',gender:'Female',address:'',mainConcern:'Synthetic concern',homeBranchId:'A',status:'Active',birthDateStatus:'unknown'};
 for(const [i,fields] of [{},{allergies:'Legacy unconfirmed details'},{allergiesStatus:'none_known',medicationsStatus:'none_known',medicalConditionsStatus:'none_known'},{allergiesStatus:'present',allergies:'Reported allergy',medicationsStatus:'present',medications:'Reported medication',medicalConditionsStatus:'present',medicalConditions:'Reported condition'}].entries()){
  const response=await request('/api/records/patients',{...base,name:'Synthetic Findings '+i,...fields});check(response.status===201,'Valid explicit finding registration');
  const created=await response.json();const saved=(await read('patients/'+created.id,'staff','document')).body.document.data;
  check(saved.allergiesStatus===(fields.allergiesStatus||'unknown'),'Server stores explicit or Unknown status');
  check(!saved.clinicalReview&& !saved.reviewedBy,'Encoding does not create clinician review');
  check((await request('/api/records/patients/'+created.id,{allergiesStatus:'none_known'},'staff','PATCH')).status===403,'Staff cannot bypass existing clinical edit restrictions');
 }
 for(const fields of [{allergiesStatus:'present'},{medicationsStatus:'none_known',medications:'A medication'},{medicalConditionsStatus:'bad'}]) check((await request('/api/records/patients',{...base,...fields})).status===400,'Contradictory/invalid clinical states rejected server-side');
 check((await request('/api/records/patients',{...base,allergiesStatus:'none_known'},'inactive')).status===403,'Inactive account denied');
 console.log(`${checks} clinical finding API/permission checks passed (real disposable PostgreSQL and HTTP; synthetic identities).`);
} finally {if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await pool.end();}
