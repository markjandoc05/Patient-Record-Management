import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { OAuth2Client } from 'google-auth-library';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_onboarding_test' || process.env.ALLOW_TEST_DATABASE !== 'yes'
    || process.env.NODE_ENV !== 'production' || !process.env.STORAGE_DIR || !new URL(process.env.APP_URL!).hostname.endsWith('.invalid')) throw new Error('Use disposable local vine_onboarding_test, production-mode middleware and temporary files only');
const origin = new URL(process.env.APP_URL!).origin;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const secure = origin.startsWith('https:');
const originals = { getToken:OAuth2Client.prototype.getToken,verify:OAuth2Client.prototype.verifyIdToken,transaction:db.runTransaction };
type Credentials = { cookie:string; csrf:string; uid:string };
let server: ReturnType<typeof app.listen>;
let checks=0;
function check(value:unknown,label:string) { assert.ok(value,label); checks++; }
const base = () => `http://127.0.0.1:${(server.address() as any).port}`;
async function request(path:string, credentials?:Credentials, body:any={}, method='POST') {
  return fetch(base()+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(credentials?{Cookie:credentials.cookie,Authorization:`Bearer ${credentials.csrf}`}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
}
async function query(path:string,c:Credentials,kind='collection') { return request('/api/data/query',c,{path,kind,constraints:[]}); }
async function callback(email:string,extra:any={}) {
  const state=random(),nonce=random();
  await pool.query("INSERT INTO oauth_attempts(state_hash,verifier,nonce,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",[hash(state),'synthetic-verifier',nonce]);
  const code=Buffer.from(JSON.stringify({email,sub:`synthetic-subject-${email}`,email_verified:true,name:'Synthetic onboarding user',nonce,...extra})).toString('base64url');
  return fetch(`${base()}/api/auth/google/callback?state=${state}&code=${code}`,{headers:{Cookie:`${secure?'__Host-vine_oauth':'vine_oauth'}=${state}`},redirect:'manual'});
}
async function login(email:string):Promise<Credentials> {
  const response=await callback(email);
  check(response.status===302 && response.headers.get('location')===origin+'/',`${email}: simulated verified callback accepted`);
  const cookie=response.headers.getSetCookie().find(c=>c.startsWith(`${secure?'__Host-vine_session':'vine_session'}=`))!.split(';')[0];
  const session=await fetch(base()+'/api/auth/session',{headers:{Cookie:cookie}});
  check(session.status===200,'Session created by callback readable');
  const data=await session.json(); return {cookie,csrf:data.csrfToken,uid:data.user.uid};
}
const profile = async(uid:string)=>(await db.collection('users').doc(uid).get()).data()!;
const lifecycle=(uid:string,action:string,c:Credentials)=>request(`/api/users/${uid}/${action}`,c);
async function write(uid:string,data:any,c:Credentials) {
  if (Object.keys(data).some(key=>['role','assignedBranches','defaultBranchId'].includes(key))) return request(`/api/users/${uid}/access`,c,{expectedAccessRevision:(await profile(uid)).accessRevision??0,...data},'PATCH');
  return request('/api/data/write',c,{operations:[{path:`users/${uid}`,mode:'update',data}]});
}
async function auditCount(uid:string,eventType:string) { return (await pool.query("SELECT count(*)::int AS n FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1 AND data->>'eventType'=$2",[uid,eventType])).rows[0].n; }
function barrier() { let release!:()=>void; const wait=new Promise<void>(resolve=>{release=resolve;}); return {wait,release}; }
try {
  await migrateDatabase();
  await pool.query('TRUNCATE service_branch_settings, services, service_categories, app_records,auth_sessions,auth_identities,oauth_attempts');
  OAuth2Client.prototype.getToken=(async(options:any)=>({tokens:{id_token:options.code}})) as any;
  OAuth2Client.prototype.verifyIdToken=(async(options:any)=>({getPayload:()=>JSON.parse(Buffer.from(options.idToken,'base64url').toString())})) as any;
  server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  await db.collection('branches').doc('A').set({branchName:'Synthetic A',status:'Active'});
  await db.collection('branches').doc('B').set({branchName:'Synthetic B',status:'Inactive'});
  const admin=await login('admin@example.invalid');
  await db.collection('users').doc(admin.uid).update({role:'admin',active:true,accountStatus:'active'});
  const staff=await login('staff@example.invalid');
  check((await profile(staff.uid)).active===false && (await profile(staff.uid)).accountStatus==='pending_activation','First sign-in starts pending staff');
  check((await query('users/'+staff.uid,staff,'document')).status===200,'Pending account can read its own approval state');
  check((await query('patients',staff)).status===403,'Pending account cannot read clinic records');
  check((await lifecycle(staff.uid,'activate',staff)).status===403,'Pending account cannot approve itself');
  const repeated=await login('staff@example.invalid'); check(repeated.uid===staff.uid,'Repeat sign-in keeps existing account ID');
  const concurrent=await Promise.all([login('concurrent@example.invalid'),login('concurrent@example.invalid')]);
  check(concurrent[0].uid===concurrent[1].uid,'Concurrent first sign-ins reuse one verified identity/profile');
  check((await pool.query("SELECT count(*)::int AS n FROM app_records WHERE collection_path='users' AND data->>'email'='concurrent@example.invalid'")).rows[0].n===1,'Concurrent registration has one profile');
  const register=await request('/api/auth/register-pending-profile',staff);
  check(register.status===200 && (await register.json()).created===false,'Fallback registration retry is idempotent');
  const first=await lifecycle(staff.uid,'activate',admin);
  check(first.status===400 && (await first.json()).error.includes('at least one active clinic'),'Approval explains missing clinic');
  check(await auditCount(staff.uid,'user_activated')===0,'Failed approval creates no success audit');
  for(const data of [{assignedBranches:['unknown']},{assignedBranches:['A',7]},{assignedBranches:null},{assignedBranches:[],defaultBranchId:'A'},{assignedBranches:['A'],defaultBranchId:'B'}]) check((await write(staff.uid,data,admin)).status===400,'Invalid/malformed/default clinic assignment rejected by server');
  check((await write(staff.uid,{role:'unknown'},admin)).status===400,'Unknown role rejected');
  check((await write(staff.uid,{assignedBranches:['B'],defaultBranchId:'B'},admin)).status===200,'Existing draft inactive-clinic assignment can be saved');
  check((await lifecycle(staff.uid,'activate',admin)).status===400,'Inactive clinic blocks approval');
  check((await write(staff.uid,{assignedBranches:['A'],defaultBranchId:'A'},admin)).status===200,'Valid assignments save');
  const approvals=await Promise.all([lifecycle(staff.uid,'activate',admin),lifecycle(staff.uid,'activate',admin)]);
  check(approvals.map(r=>r.status).sort().join(',')==='200,409','Concurrent approval succeeds once and safely rejects duplicate');
  check(await auditCount(staff.uid,'user_activated')===1,'Concurrent approval creates one audit event');
  const activated=await login('staff@example.invalid');
  check(activated.uid===staff.uid && (await query('patients',activated)).status===200,'Approved sign-in preserves ID and opens authorized operations');
  check((await write(admin.uid,{role:'admin'},activated)).status===403,'Active ordinary staff cannot assign roles');
  check((await lifecycle(concurrent[0].uid,'activate',activated)).status===403,'Active ordinary staff cannot approve others');
  check((await lifecycle(admin.uid,'deactivate',admin)).status===403,'Self-account lifecycle protection remains');
  const support=await login('support@example.invalid'); await db.collection('users').doc(support.uid).update({role:'support_developer'});
  check((await lifecycle(support.uid,'activate',admin)).status===403,'Administrator cannot manage Support / Developer');
  for(const role of ['doctor','manager']) {
    const c=await login(`${role}@example.invalid`);
    check((await write(c.uid,{role},admin)).status===200,'Existing role assignment allowed');
    check((await lifecycle(c.uid,'activate',admin)).status===400,`${role}: missing clinic blocked`);
    await write(c.uid,{assignedBranches:['A']},admin);
    check((await lifecycle(c.uid,'activate',admin)).status===200,`${role}: valid clinic activates`);
  }
  const global=await login('global@example.invalid'); await write(global.uid,{role:'admin'},admin);
  check((await lifecycle(global.uid,'activate',admin)).status===200,'Administrator activates without clinic assignments');
  check((await write(global.uid,{defaultBranchId:'A'},admin)).status===400,'Global access does not bypass default-clinic validation');

  // Queue approval while assignments change. The transaction must see the new
  // state, rather than the profile used before acquiring the mutation lock.
  const queued=await login('queued@example.invalid'); await write(queued.uid,{assignedBranches:['A'],defaultBranchId:'A'},admin);
  const entered=barrier(),resume=barrier(); let intercept=true;
  db.runTransaction=(async(fn:any)=>{ if(intercept){intercept=false;entered.release();await resume.wait;} return originals.transaction(fn); }) as any;
  const queuedApproval=lifecycle(queued.uid,'activate',admin); await entered.wait;
  await originals.transaction(async tx=>{tx.update(db.collection('branches').doc('A'),{status:'Inactive'});});
  resume.release(); check((await queuedApproval).status===400,'Queued approval sees newly inactive branch');
  db.runTransaction=originals.transaction; await db.collection('branches').doc('A').update({status:'Active'});
  const actorEntered=barrier(),actorResume=barrier();intercept=true;
  db.runTransaction=(async(fn:any)=>{if(intercept){intercept=false;actorEntered.release();await actorResume.wait;}return originals.transaction(fn);}) as any;
  const revokedApproval=lifecycle(queued.uid,'activate',admin);await actorEntered.wait;
  await originals.transaction(async tx=>{tx.update(db.collection('users').doc(admin.uid),{role:'staff'});});
  actorResume.release();check((await revokedApproval).status===403,'Queued approval rechecks acting administrator role');
  db.runTransaction=originals.transaction;await db.collection('users').doc(admin.uid).update({role:'admin'});
  check(await auditCount(queued.uid,'user_activated')===0,'Rejected queued approvals never log success');
  check((await lifecycle(queued.uid,'activate',admin)).status===200,'Approval recovers after valid configuration restored');

  check((await lifecycle(staff.uid,'deactivate',admin)).status===200,'Account deactivation succeeds');
  check((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1',[staff.uid])).rows[0].n===0,'Deactivation revokes every session atomically');
  check((await query('patients',activated)).status===401,'Old session cannot access clinic records after deactivation');
  check((await callback('staff@example.invalid')).headers.get('location')?.includes('auth_error='),'Inactive account cannot acquire a new session');
  check((await lifecycle(staff.uid,'activate',admin)).status===200,'Existing deactivated account can reactivate');
  await login('staff@example.invalid');
  const sessionEntered=barrier(),sessionResume=barrier();let phase=0;
  db.runTransaction=(async(fn:any)=>{phase++;if(phase===2){sessionEntered.release();await sessionResume.wait;}return originals.transaction(fn);}) as any;
  const racingCallback=callback('staff@example.invalid'); await sessionEntered.wait;
  check((await lifecycle(staff.uid,'deactivate',admin)).status===200,'Deactivation during sign-in succeeds');
  sessionResume.release();check((await racingCallback).headers.get('location')?.includes('auth_error='),'Session issuance rechecks a concurrently deactivated account');
  db.runTransaction=originals.transaction;
  check((await pool.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1',[staff.uid])).rows[0].n===0,'Racing callback cannot recreate revoked sessions');
  await lifecycle(staff.uid,'activate',admin); const archivedSession=await login('staff@example.invalid');
  check((await lifecycle(staff.uid,'archive',admin)).status===200,'Archive succeeds');
  check((await query('patients',archivedSession)).status===401,'Archive revokes old session');
  check((await lifecycle(staff.uid,'activate',admin)).status===409,'Archived account must use restore');
  check((await lifecycle(staff.uid,'restore',admin)).status===200,'Restore reuses existing profile and assignments');
  check((await login('staff@example.invalid')).uid===staff.uid,'Restored sign-in preserves ID');
  check(await auditCount(staff.uid,'user_archived')===1 && await auditCount(staff.uid,'user_restored')===1,'Archive/restore durable audits remain');
  const rejected=await callback('unverified@example.invalid',{email_verified:false});
  check(rejected.headers.get('location')?.includes('auth_error='),'Unverified provider email rejected');
  check((await pool.query("SELECT count(*)::int AS n FROM auth_identities WHERE email='unverified@example.invalid'")).rows[0].n===0,'Unverified account never creates identity');
  console.log(`${checks} onboarding PostgreSQL/HTTP checks passed (simulated Google provider; real server, transactions, sessions and audits).`);
} finally {
  db.runTransaction=originals.transaction;
  OAuth2Client.prototype.getToken=originals.getToken; OAuth2Client.prototype.verifyIdToken=originals.verify;
  if(server!) { server.close();await once(server,'close'); }
  await pool.query('TRUNCATE service_branch_settings, services, service_categories, app_records,auth_sessions,auth_identities,oauth_attempts');
  await pool.end();
}
