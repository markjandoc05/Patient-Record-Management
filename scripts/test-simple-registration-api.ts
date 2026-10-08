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
 const base={name:'Simple Registration Acceptance',contactNumber:'09171234567',email:'',gender:'Female',address:'',mainConcern:'Synthetic concern',homeBranchId:'A',status:'Active',birthday:'1990-01-01',age:999,emergencyContact:'Legacy text retained',emergencyContactName:' Ana Guardian ',emergencyContactRelationship:' Mother ',emergencyContactNumber:' +63 917 123 4567 '};
 const createdResponse=await request('/api/records/patients',base);check(createdResponse.status===201,'Registration works with birthday and emergency fields');
 const created=await createdResponse.json();let saved=(await read('patients/'+created.id,'staff','document')).body.document.data;
 check(saved.age!==999&&Number.isInteger(saved.age),'Server derives age, ignoring client age');
 check(saved.birthday==='1990-01-01'&&saved.birthDateStatus==='exact','Birthday saved exactly');
 check(saved.email===''&&saved.address==='','Optional email/address remain valid');
 check(saved.emergencyContactName==='Ana Guardian'&&saved.emergencyContactRelationship==='Mother'&&saved.emergencyContactNumber==='+63 917 123 4567','Structured emergency contact saved');
 check(saved.emergencyContact==='Legacy text retained','Legacy contact not lost');
 check((await request('/api/records/patients',{...base,emergencyContactNumber:'123'})).status===400,'Invalid emergency phone rejected');
 check((await request('/api/records/patients',{...base,birthday:'2026-02-30'})).status===400,'Invalid birthday rejected');
 const changed=await request('/api/records/patients/'+created.id,{birthday:'1991-01-01',emergencyContactName:'Another Guardian',emergencyContactRelationship:'Father',emergencyContactNumber:'09189999999',expectedLastUpdatedAt:saved.lastUpdatedAt},'staff','PATCH');
 check(changed.status===200,'Existing staff demographic edit accepts emergency fields');
 saved=(await read('patients/'+created.id,'staff','document')).body.document.data;
 check(saved.birthday==='1991-01-01'&&saved.emergencyContactName==='Another Guardian'&&saved.emergencyContactRelationship==='Father'&&saved.emergencyContactNumber==='09189999999','Changes persist');
 check(saved.emergencyContact==='Legacy text retained','Legacy contact preserved on edit');
 const legacyPayload:any={...base,birthday:saved.birthday,expectedLastUpdatedAt:saved.lastUpdatedAt};
 for(const field of ['emergencyContactName','emergencyContactRelationship','emergencyContactNumber']) delete legacyPayload[field];
 check((await request('/api/records/patients/'+created.id,legacyPayload,'admin','PATCH')).status===200,'Older full-edit request accepted');
 saved=(await read('patients/'+created.id,'admin','document')).body.document.data;
 check(saved.emergencyContactName==='Another Guardian'&&saved.emergencyContactRelationship==='Father'&&saved.emergencyContactNumber==='09189999999','Omitted emergency fields preserve existing values');
 const clearPayload={...legacyPayload,expectedLastUpdatedAt:saved.lastUpdatedAt,emergencyContactName:'',emergencyContactRelationship:'',emergencyContactNumber:''};
 check((await request('/api/records/patients/'+created.id,clearPayload,'admin','PATCH')).status===200,'Explicit emergency clear accepted');
 saved=(await read('patients/'+created.id,'admin','document')).body.document.data;
 check(saved.emergencyContactName===''&&saved.emergencyContactRelationship===''&&saved.emergencyContactNumber==='','Explicit clearing remains intentional');
 check((await request('/api/records/patients',{...base,homeBranchId:'B'})).status===403,'Registration branch policy unchanged');
 console.log(`${checks} simple registration/emergency contact API checks passed (real disposable PostgreSQL and HTTP; synthetic identities).`);
} finally {if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await pool.end();}
