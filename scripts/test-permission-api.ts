import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { app } from '../server';
import { db, pool, RecordTransaction } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_permissions_test' || process.env.ALLOW_TEST_DATABASE !== 'yes' || !process.env.STORAGE_DIR) throw Error('Disposable local vine_permissions_test and temporary storage required');
const origin = new URL(process.env.APP_URL!).origin;
const credentials = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen> | undefined, checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; }
async function request(path: string, method = 'GET', body?: any, user = 'admin') {
  const c = credentials.get(user)!;
  const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${path}`, { method,
    headers: { Origin: origin, Cookie: c.cookie, Authorization: `Bearer ${c.csrf}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const read = async (path: string) => { const parts = path.split('/'); return (await db.collection(parts.slice(0, -1).join('/')).doc(parts.at(-1)!).get()).data()!; };
const query = (path: string, user: string, kind = 'document', constraints: any[] = []) => request('/api/data/query', 'POST', { path, kind, constraints }, user);
const write = (path: string, data: any, user = 'manager', mode = 'update') => request('/api/data/write', 'POST', { operations: [{ path, mode, data }] }, user);
async function access(target: string, changes: any, actor = 'admin') {
  return request('/api/users/' + target + '/access', 'PATCH', { expectedAccessRevision: (await read('users/' + target)).accessRevision ?? 0, ...changes }, actor);
}
const grants = (target: string, permissionChanges: any, actor = 'admin') => access(target, { permissionChanges }, actor);
try {
  await migrateDatabase(); await migrateDatabase();
  check((await pool.query('SELECT name FROM schema_migrations')).rows.length === 4, 'fresh immutable four migration chain, idempotent');
  for (const id of ['A', 'B']) await db.collection('branches').doc(id).set({ branchName: 'Synthetic ' + id, status: 'Active' });
  for (const id of ['admin', 'admin2', 'support_developer', 'SUPPORT_DEVELOPER', 'manager', 'doctor', 'staff', 'inactive', 'pending', 'archived']) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    const role = id === 'admin2' ? 'admin' : ['inactive', 'pending', 'archived'].includes(id) ? 'staff' : id;
    await db.collection('users').doc(id).set({ role, active: id !== 'inactive', ...(id === 'pending' ? { accountStatus: 'pending_activation' } : {}), isArchived: id === 'archived', assignedBranches: ['A'], defaultBranchId: 'A', fullName: 'Synthetic ' + id });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id, csrf]);
    credentials.set(id, { cookie: `__Host-vine_session=${token}`, csrf });
  }
  const clinical = { diagnosis: 'SYNTHETIC_SECRET', notes: 'SYNTHETIC_SECRET', mainConcern: 'SYNTHETIC_SECRET', treatmentPlan: 'SYNTHETIC_SECRET', allergies: 'SYNTHETIC_SECRET', medications: 'SYNTHETIC_SECRET', medicalConditions: 'SYNTHETIC_SECRET', clinicalFindings: { nested: ['SYNTHETIC_SECRET'] }, prescriptionDraft: { text: 'SYNTHETIC_SECRET' }, attachments: [{ name: 'SYNTHETIC_SECRET', storagePath: 'uploads/patient/general/patient/secret.pdf' }], unknownClinical: { narrative: 'SYNTHETIC_SECRET' } };
  const operational = { patientId: 'patient', patientName: 'Synthetic Patient', branchId: 'A', branchName: 'Synthetic A', doctorId: 'doctor', doctorName: 'Synthetic Doctor', status: 'Scheduled', visitType: 'Initial Consultation', serviceId: randomUUID(), serviceNameSnapshot: 'Historical Service', serviceDurationMinutesSnapshot: 30, serviceCatalogueVersion: 2 };
  await db.collection('patients').doc('patient').set({ ...clinical, name: 'Synthetic Patient', patientID: 'SYNTHETIC', homeBranchId: 'A', status: 'Active', birthday: '2000-01-01', contactNumber: '1234567890', gender: 'Male' });
  await db.collection('appointments').doc('appointment').set({ ...clinical, ...operational, appointmentDate: '2035-01-01T10:00' });
  await db.collection('appointments').doc('outside').set({ ...clinical, ...operational, branchId: 'B' });
  await db.collection('visits').doc('visit').set({ ...clinical, ...operational, visitDate: '2035-01-02T10:00', status: 'Completed' });
  await db.collection('visits').doc('outside').set({ ...clinical, ...operational, branchId: 'B' });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  for (const user of ['staff', 'manager']) for (const path of ['patients/patient', 'appointments/appointment', 'visits/visit']) {
    const result = await query(path, user); check(result.status === 200 && JSON.stringify(result.body).includes('SYNTHETIC_SECRET'), user + ' preserves legacy clinical read ' + path);
  }
  for (const user of ['inactive', 'pending', 'archived', 'SUPPORT_DEVELOPER']) check((await query('patients/patient', user)).status === 403, user + ' cannot read protected data');
  check((await query('users/pending', 'pending')).status === 200, 'pending own-profile onboarding exception preserved');
  check((await grants('manager', { 'users.manage': 'allow', 'services.manage': 'allow', 'services.pricing': 'allow', 'access.manage': 'allow' })).status === 200, 'administrator explicit grants');
  check((await write('users/staff', { fullName: 'Updated operational name', contactNumber: '123456' })).status === 200, 'delegated operational user details');
  for (const changes of [{ role: 'admin' }, { assignedBranches: ['A', 'B'] }, { permissionChanges: { 'clinical.finalize': 'allow' } }]) {
    check((await access('manager', changes, 'manager')).status === 403, 'Manager self escalation blocked');
    check((await access('staff', changes, 'manager')).status === 403, 'users.manage cannot delegate security policy');
  }
  for (const changes of [{ role: 'admin' }, { assignedBranches: ['A', 'B'] }, { permissionOverrides: { 'clinical.finalize': 'allow' } }, { accessRevision: 40 }, { active: false }]) check((await write('users/staff', changes)).status === 403, 'generic user API blocks security/lifecycle bypass');
  for (const actor of ['admin', 'support_developer']) {
    check((await grants(actor, { 'clinical.finalize': 'allow' }, actor)).status === 403, 'self override blocked ' + actor);
    check((await access(actor, { role: 'doctor' }, actor)).status === 403, 'self role change blocked ' + actor);
  }
  check((await access('support_developer', { role: 'staff' })).status === 403, 'Admin cannot alter guarded Support');
  check((await access('staff', { role: 'SUPPORT_DEVELOPER' })).status === 403, 'Admin cannot grant Developer');
  check((await grants('staff', { 'clinical.finalize': 'allow' }, 'support_developer')).status === 200, 'legacy Support compatible access administration');
  check((await grants('staff', { 'clinical.finalize': 'inherit' })).status === 200 && !Object.hasOwn((await read('users/staff')).permissionOverrides, 'clinical.finalize'), 'INHERIT removes persisted override');
  check((await request('/api/users/staff/access', 'PATCH', { expectedAccessRevision: 0, permissionChanges: {} })).status === 409, 'stale access revision conflicts');
  for (const values of [[], null, { 'clinical.view': true }, { 'invented.permission': 'allow' }]) check((await grants('staff', values)).status === 400, 'malformed overrides rejected');
  check((await access('staff', { assignedBranches: ['missing'] })).status === 400, 'unknown branch rejected');
  check((await grants('admin2', { 'access.manage': 'deny' })).status === 200, 'Admin security capability explicitly denied');
  check((await grants('staff', { 'clinical.view': 'deny' }, 'admin2')).status === 403, 'access.manage deny overrides Admin default');
  check((await write('users/staff', { role: 'doctor' }, 'admin2')).status === 403, 'generic security route honors explicit deny');
  check((await grants('admin2', { 'access.manage': 'inherit' })).status === 200, 'Admin role default restored');
  check((await grants('staff', { 'clinical.view': 'deny', 'audit.view': 'allow' })).status === 200, 'explicit clinical denial');
  for (const path of ['patients/patient', 'appointments/appointment', 'visits/visit', 'visits/outside']) {
    const result = await query(path, 'staff'); check(result.status === 200, 'operational record remains readable ' + path);
    const data = result.body.document.data; check(!JSON.stringify(data).includes('SYNTHETIC_SECRET'), 'server payload redacted ' + path);
    for (const key of Object.keys(clinical)) check(!Object.hasOwn(data, key), 'clinical field absent: ' + path + ' ' + key);
    if (!path.startsWith('patients')) check(data.patientId === 'patient' && data.doctorId === 'doctor' && data.serviceNameSnapshot === 'Historical Service' && data.serviceCatalogueVersion === 2, 'operational Service/provider identity preserved');
    else check(data.birthday === '2000-01-01' && data.contactNumber === '1234567890', 'operational demographics retained');
  }
  for (const collection of ['patients', 'appointments', 'visits']) {
    const result = await query(collection, 'staff', 'collection'); check(result.status === 200 && !JSON.stringify(result.body).includes('SYNTHETIC_SECRET'), 'collection redaction ' + collection);
    check((await query(collection, 'staff', 'collection', [{ type: 'where', field: 'diagnosis', operator: '==', value: 'SYNTHETIC_SECRET' }])).status === 403, 'clinical inference query denied ' + collection);
  }
  check((await query('appointments/outside', 'staff')).status === 403, 'branch scope remains independent');
  const directory = await request('/api/patients', 'GET', undefined, 'staff'); check(directory.status === 200 && !JSON.stringify(directory.body).includes('SYNTHETIC_SECRET'), 'direct directory is also redacted');
  check((await request('/api/attachments/content?path=uploads/patient/general/patient/secret.pdf', 'GET', undefined, 'staff')).status === 403, 'clinical media denied before file lookup');
  check((await query('patients/patient/privateNotes', 'staff', 'collection')).status === 403, 'private notes require clinical permission');
  check((await write('patients/patient', { diagnosis: 'forged' }, 'staff')).status === 403, 'generic clinical writes cannot bypass dedicated APIs');
  check((await request('/api/records/patients/patient', 'PATCH', { name: 'Changed operational name', birthday: '2000-01-01', contactNumber: '1234567890', gender: 'Male' }, 'staff')).status === 200, 'redacted patient operational edit');
  check((await read('patients/patient')).allergies === 'SYNTHETIC_SECRET' && (await read('patients/patient')).mainConcern === 'SYNTHETIC_SECRET', 'redacted form defaults cannot erase protected patient values');
  check((await request('/api/records/patients/patient', 'PATCH', { name: 'Changed operational name', birthday: '2000-01-01', contactNumber: '1234567890', gender: 'Male', mainConcern: 'forged' }, 'staff')).status === 403, 'clinical change denied');
  check((await grants('admin2', { 'clinical.view': 'deny' })).status === 200, 'redacted administrator fixture');
  check((await request('/api/records/patients/patient', 'PATCH', { name: 'Changed operational name', homeBranchId: 'A', birthday: '2000-01-01', contactNumber: '1234567890', gender: 'Male', mainConcern: '', allergies: '', medicalConditions: '', medications: '' }, 'admin2')).status === 200, 'full editor redacted defaults accepted');
  check((await read('patients/patient')).allergies === 'SYNTHETIC_SECRET' && (await read('patients/patient')).mainConcern === 'SYNTHETIC_SECRET', 'redacted full editor preserves stored clinical values');
  const appt = { patientId: 'patient', branchId: 'A', doctorId: 'doctor', appointmentDate: '2035-01-01T10:00', visitType: 'Initial Consultation', status: 'Arrived', notes: '', mainConcern: '' };
  check((await request('/api/records/appointments/appointment', 'PATCH', appt, 'staff')).status === 200, 'redacted appointment operational edit');
  check((await read('appointments/appointment')).notes === 'SYNTHETIC_SECRET' && (await read('appointments/appointment')).mainConcern === 'SYNTHETIC_SECRET', 'redacted defaults preserve appointment clinical content');
  check((await request('/api/records/visits/visit', 'PATCH', { ...appt, visitDate: appt.appointmentDate }, 'staff')).status === 403, 'redacted operational read does not grant clinical write');
  const catalogue = { id: randomUUID(), name: 'Synthetic delegated catalogue', defaultDurationMinutes: 30, standardPrice: { mode: 'free' }, branchSettings: [{ branchId: 'A', available: true, price: { mode: 'inherit' } }] };
  const service = await request('/api/services', 'POST', catalogue, 'manager'); check(service.status === 201, 'explicit Service manage grant supplements role');
  check((await request('/api/services', 'POST', { ...catalogue, id: randomUUID(), name: 'Outside', branchSettings: [{ branchId: 'B', available: true, price: { mode: 'free' } }] }, 'manager')).status === 403, 'Services grant does not broaden branches');
  check((await grants('manager', { 'services.pricing': 'deny' })).status === 200, 'price deny independent');
  const described = await request('/api/services/' + service.body.id, 'PATCH', { expectedVersion: service.body.version, description: 'Operational description' }, 'manager'); check(described.status === 200, 'catalogue edit still allowed without price change');
  check((await request('/api/services/' + service.body.id, 'PATCH', { expectedVersion: described.body.version, standardPrice: { mode: 'priced', amount: '2.00' } }, 'manager')).status === 403, 'price mutation denied server side');
  check((await grants('manager', { 'services.manage': 'inherit' })).status === 200, 'remove delegated manage');
  check((await request('/api/services', 'POST', { ...catalogue, id: randomUUID() }, 'manager')).status === 403, 'current profile read without session renewal');
  const audit = (await db.collection('audit_logs').get()).docs.map(doc => doc.data()!);
  const event = audit.find(row => row.eventType === 'access_policy_changed' && row.resourceId === 'staff' && row.changes.some((c: any) => c.field === 'permissionOverrides.clinical.view'));
  check(event?.userId === 'admin' && !!event.timestamp && event.source === 'trusted_server', 'audit actor and timestamp server authored');
  check(event.changes.some((c: any) => c.before === 'inherit' && c.after === 'deny'), 'audit previous/new override state');
  check(!JSON.stringify(audit.filter(row => row.eventType === 'access_policy_changed')).includes('SYNTHETIC_SECRET'), 'access audit has no clinical narrative');
  const auditRead = await query('audit_logs', 'staff', 'collection'); check(auditRead.status === 200 && !JSON.stringify(auditRead.body).includes('SYNTHETIC_SECRET'), 'audit response redacts old clinical narratives');
  // Simulated storage/audit failure proves override and audit cannot diverge.
  const prior = JSON.stringify(await read('users/staff'));
  const originalCreate = RecordTransaction.prototype.create;
  RecordTransaction.prototype.create = function(ref: any, data: any) { if (data.eventType === 'access_policy_changed') throw Error('Synthetic audit failure'); return originalCreate.call(this, ref, data); };
  try { check((await grants('staff', { 'clinical.view': 'allow' })).status !== 200, 'audit failure fails command'); }
  finally { RecordTransaction.prototype.create = originalCreate; }
  check(JSON.stringify(await read('users/staff')) === prior, 'atomic rollback preserves old access on failed audit');
  // Pause a request before its transaction, revoke permission through the real API,
  // then release it: the actor must be reloaded under the write lock.
  const originalTransaction = db.runTransaction;
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { arrived = resolve; }); let intercepted = false;
  db.runTransaction = async callback => { if (!intercepted) { intercepted = true; arrived(); await gate; } return originalTransaction(callback); };
  try {
    const oldSave = request('/api/records/appointments/appointment', 'PATCH', { ...appt, status: 'Scheduled' }, 'staff');
    await entered;
    check((await grants('staff', { 'appointments.edit': 'deny' })).status === 200, 'concurrent permission revocation commits');
    release(); check((await oldSave).status === 403, 'queued old save uses current actor permission');
    check((await read('appointments/appointment')).status === 'Arrived', 'stale save did not mutate operational state');
  } finally { release(); db.runTransaction = originalTransaction; }
  check((await grants('staff', { 'clinical.view': 'inherit' })).status === 200, 'clinical role default restored explicitly');
  check(JSON.stringify((await query('patients/patient', 'staff')).body).includes('SYNTHETIC_SECRET'), 'fresh reads reflect restored authorized view');
  check((await request('/api/auth/logout', 'POST', {}, 'staff')).status === 200, 'normal sign-out works');
  check((await query('patients/patient', 'staff')).status === 401, 'revoked session cannot read protected data');
  check((await access('admin2', { role: 'manager', assignedBranches: ['A', 'B'], defaultBranchId: 'B' })).status === 200, 'authorized role and branch security update');
  const changedTarget = await read('users/admin2');
  check(changedTarget.role === 'manager' && changedTarget.defaultBranchId === 'B' && changedTarget.defaultBranchName === 'Synthetic B', 'authoritative role and default branch stored');
  const roleAudit = (await db.collection('audit_logs').get()).docs.map(doc => doc.data()!).find(row => row.resourceId === 'admin2' && row.eventType === 'access_policy_changed' && row.changes.some((c: any) => c.field === 'role'));
  check(roleAudit.changes.some((c: any) => c.field === 'role' && c.before === 'admin' && c.after === 'manager'), 'role old/new values audited');
  check(roleAudit.changes.some((c: any) => c.field === 'assignedBranches' && JSON.stringify(c.before) === '["A"]' && JSON.stringify(c.after) === '["A","B"]'), 'branch old/new values audited');
  check((await write('users/doctor', { assignedBranches: ['A', 'B'], defaultBranchId: 'B' }, 'support_developer')).status === 403, 'generic assignments require revisioned dedicated access path');
  check((await access('doctor', { assignedBranches: ['A', 'B'], defaultBranchId: 'B' }, 'support_developer')).status === 200, 'dedicated assignment path remains available');
  check((await db.collection('audit_logs').get()).docs.some(doc => doc.data()?.eventType === 'access_policy_changed' && doc.data()?.resourceId === 'doctor'), 'dedicated branch update emits atomic security audit');

  // Audit predicates must be authorized before raw narrative affects matching/sorting/counts.
  await db.collection('audit_logs').doc('clinical-term').set({resource:'Patient',resourceId:'patient',details:'PROTECTED_TERM_X',changes:[{field:'diagnosis',before:'old',after:'PROTECTED_TERM_X'}],timestamp:'2035-01-01'});
  await grants('manager', {'audit.view':'allow','clinical.view':'deny'});
  for (const field of ['details','changes','diagnosis','notes','treatmentPlan','attachments']) {
    for (const operator of ['==','!=','>','<']) {
      const secret=await query('audit_logs','manager','collection',[{type:'where',field,operator,value:'PROTECTED_TERM_X'},{type:'limit',value:1}]);
      const absent=await query('audit_logs','manager','collection',[{type:'where',field,operator,value:'ABSENT_TERM'}]);
      check(secret.status===403 && absent.status===403 && JSON.stringify(secret.body)===JSON.stringify(absent.body), 'audit sensitive predicates reveal no match/count '+field+operator);
    }
    check((await query('audit_logs','manager','collection',[{type:'orderBy',field,direction:'asc'},{type:'limit',value:1}])).status===403,'hidden audit sort denied '+field);
  }
  const metadata=await query('audit_logs','manager','collection',[{type:'where',field:'resourceId',operator:'==',value:'patient'},{type:'orderBy',field:'timestamp',direction:'desc'},{type:'limit',value:1}]);
  check(metadata.status===200 && !JSON.stringify(metadata.body).includes('PROTECTED_TERM_X'),'safe metadata pagination remains redacted');
  check((await query('audit_logs','admin','collection',[{type:'where',field:'details',operator:'==',value:'PROTECTED_TERM_X'}])).body.documents.length===1,'authorized clinical audit search preserved');
  const oldDoctor=await read('users/doctor');
  const updated=await access('doctor',{assignedBranches:['A'],defaultBranchId:'A',role:'staff'});
  check(updated.status===200,'new role/branch policy established');
  const priorState=JSON.stringify(await read('users/doctor'));
  for (const data of [{assignedBranches:oldDoctor.assignedBranches,defaultBranchId:oldDoctor.defaultBranchId},{role:oldDoctor.role},{permissionOverrides:{'clinical.finalize':'allow'}},{active:true},{accountStatus:'active'}]) {
    check((await write('users/doctor',data,'admin')).status===403,'generic policy/lifecycle bypass denied');
    check(JSON.stringify(await read('users/doctor'))===priorState,'generic denial preserves newer policy');
  }
  const stale=await request('/api/users/doctor/access','PATCH',{expectedAccessRevision:oldDoctor.accessRevision,assignedBranches:['A','B'],role:'doctor',permissionChanges:{'clinical.finalize':'allow'}});
  check(stale.status===409 && JSON.stringify(await read('users/doctor'))===priorState,'stale mixed policy rolls back all fields');
  const rev=(await read('users/doctor')).accessRevision;
  await grants('doctor',{'clinical.finalize':'allow'});
  check((await request('/api/users/doctor/access','PATCH',{expectedAccessRevision:rev,assignedBranches:['A','B']})).status===409,'override versus branch race conflicts');
  await grants('admin',{'clinical.edit_draft':'deny'},'support_developer');
  for (const text of [' Penicillin','Penicillin ','\tPenicillin\n','  Penicillin  ']) {
    await db.collection('patients').doc('patient').update({allergies:text});
    const result=await request('/api/records/patients/patient','PATCH',{name:'Operational update',homeBranchId:'A',birthday:'2000-01-01',contactNumber:'1234567890',gender:'Male',allergies:text.trim()},'admin');
    check(result.status===200,'legacy whitespace does not block permitted edit');
    check((await read('patients/patient')).allergies===text,'unauthorized edit preserves raw clinical bytes');
  }
  check((await request('/api/records/patients/patient','PATCH',{name:'Operational update',homeBranchId:'A',birthday:'2000-01-01',contactNumber:'1234567890',gender:'Male',allergies:'Changed drug'},'admin')).status===403,'semantic clinical change remains denied');
  await grants('admin',{'clinical.edit_draft':'inherit'},'support_developer');
  check((await request('/api/records/patients/patient','PATCH',{name:'Operational update',homeBranchId:'A',birthday:'2000-01-01',contactNumber:'1234567890',gender:'Male',mainConcern:'Reported concern',allergies:'Authorized change'},'admin')).status===200,'authorized clinical edit still works');

  // Access-manager revocation is checked again inside the policy transaction.
  let releaseAccess!:()=>void, enteredAccess!:()=>void, caughtAccess=false;
  const accessGate=new Promise<void>(resolve=>{releaseAccess=resolve;});
  const accessEntered=new Promise<void>(resolve=>{enteredAccess=resolve;});
  const accessTransaction=db.runTransaction;
  db.runTransaction=async callback=>{if(!caughtAccess){caughtAccess=true;enteredAccess();await accessGate;}return accessTransaction(callback);};
  try {
    const revision=(await read('users/doctor')).accessRevision;
    const queued=request('/api/users/doctor/access','PATCH',{expectedAccessRevision:revision,assignedBranches:['A','B'],permissionChanges:{'clinical.finalize':'deny'}});
    await accessEntered;
    check((await grants('admin',{'access.manage':'deny'},'support_developer')).status===200,'access manager revoked before queued policy commit');
    releaseAccess();check((await queued).status===403,'queued policy reloads revoked access manager');
    check((await read('users/doctor')).accessRevision===revision,'revoked manager policy leaves target unchanged');
  } finally {releaseAccess();db.runTransaction=accessTransaction;}
  await grants('admin',{'access.manage':'inherit'},'support_developer');
  const beforeAtomic=JSON.stringify(await read('users/doctor'));
  const createAtomic=RecordTransaction.prototype.create;
  RecordTransaction.prototype.create=function(ref:any,data:any){if(data.eventType==='access_policy_changed')throw Error('Synthetic multi-policy audit failure');return createAtomic.call(this,ref,data);};
  try{check((await access('doctor',{role:'doctor',assignedBranches:['A','B'],permissionChanges:{'clinical.finalize':'deny'}})).status!==200,'multi-policy audit failure rejects change');}
  finally{RecordTransaction.prototype.create=createAtomic;}
  check(JSON.stringify(await read('users/doctor'))===beforeAtomic,'role branch override changes roll back together');
  console.log(`${checks} access-management, clinical redaction, branch, audit atomicity and live-revocation HTTP/PostgreSQL checks passed.`);
} finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await pool.end(); }
