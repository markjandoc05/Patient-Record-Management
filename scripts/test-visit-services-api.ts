import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_visit_services_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || !process.env.STORAGE_DIR) throw Error('Disposable loopback vine_visit_services_test and temporary storage required');
const origin = new URL(process.env.APP_URL!).origin;
const credentials = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen>, checks = 0;
const check = (value: any, message: string) => { assert.ok(value, message); checks++; };
async function request(path: string, method = 'GET', body?: any, role = 'admin', headers: any = {}) {
  const c = credentials.get(role);
  const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}${path}`, { method,
    headers: { Origin: origin, ...(c ? { Cookie: c.cookie, Authorization: `Bearer ${c.csrf}` } : {}), 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const read = async (id: string) => (await db.collection('visits').doc(id).get()).data()!;
const readAppointment = async (id: string) => (await db.collection('appointments').doc(id).get()).data()!;
const readPatient = async () => (await db.collection('patients').doc('patient').get()).data()!;
const editPayload = (record: any) => Object.fromEntries(Object.entries(record).filter(([key]) => !['serviceId','serviceNameSnapshot','serviceDurationMinutesSnapshot','serviceCatalogueVersion'].includes(key)));
const snapshot = (record: any) => Object.fromEntries(['serviceId', 'serviceNameSnapshot', 'serviceDurationMinutesSnapshot', 'serviceCatalogueVersion'].map(field => [field, record[field]]));
let minute = 0;
const booking = (extra = {}, branchId = 'A') => {
  const slot = minute++;
  return { patientId: 'patient', doctorId: 'provider', branchId,
    visitDate: `${2029 + Math.floor(slot / 19)}-01-01T${String(10 + Math.floor((slot % 19) / 2)).padStart(2, '0')}:${slot % 19 % 2 ? '30' : '00'}`,
    visitType: 'Initial Consultation', status: 'Scheduled', mainConcern: '', notes: '', ...extra };
};
const selection = (service: any) => ({ serviceSelection: { serviceId: service.id, expectedVersion: service.version } });
async function createService(name: string, price: any = { mode: 'priced', amount: '100' }, settings = [{ branchId: 'A', available: true, price: { mode: 'inherit' } }, { branchId: 'B', available: true, price: { mode: 'priced', amount: '987.65' } }]) {
  const result = await request('/api/services', 'POST', { id: randomUUID(), name, defaultDurationMinutes: 45, standardPrice: price, branchSettings: settings });
  check(result.status === 201, 'create synthetic catalogue Service'); return result.body;
}
async function editService(service: any, changes: any) {
  const result = await request('/api/services/' + service.id, 'PATCH', { expectedVersion: service.version, ...changes });
  check(result.status === 200, 'edit synthetic catalogue Service'); return result.body;
}
try {
  // Production's known 002 -> local 004 release gap, retaining legacy JSONB.
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const name of ['001_platform.sql', '002_session_integrity.sql']) {
    const sql = await readFile('migrations/' + name, 'utf8'); await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, createHash('sha256').update(sql).digest('hex')]);
  }
  await db.collection('visits').doc('legacy').set({ branchId: 'A', visitType: 'Follow-up', treatmentService: '  arbitrary legacy text  ', servicePerformed:'Old performed', notes: '  retained historical text  ' });
  const before = JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path='visits'")).rows);
  await migrateDatabase(); await migrateDatabase();
  check(before === JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path='visits'")).rows), '002 -> 004 preserves legacy values and timestamps');
  check((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.length === 4, 'same four migration chain');
  for (const role of ['admin', 'support_developer', 'manager', 'doctor', 'staff', 'inactive']) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(role).set({ role: role === 'inactive' ? 'staff' : role, active: role !== 'inactive', assignedBranches: ['A'], fullName: 'Synthetic ' + role });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [role, role + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), role, csrf]);
    credentials.set(role, { cookie: `${origin.startsWith('https') ? '__Host-' : ''}vine_session=${token}`, csrf });
  }
  for (const [id, status] of [['A', 'Active'], ['B', 'Active'], ['C', 'Inactive']]) await db.collection('branches').doc(id).set({ branchName: 'Synthetic ' + id, status });
  await db.collection('users').doc('provider').set({ role: 'doctor', active: true, assignedBranches: ['A', 'B', 'C'] });
  await db.collection('patients').doc('patient').set({ name: 'Synthetic patient', patientID: 'SYNTHETIC', isArchived: false });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  await db.collection('users').doc('doctor').update({ assignedBranches: ['A', 'B'] });
  let service = await createService('Performed reference');
  const payload = booking(selection(service));
  const created = await request('/api/records/visits', 'POST', payload);
  check(created.status === 201, 'new priced performed Service'); const id = created.body.id;
  check(JSON.stringify(snapshot(await read(id))) === JSON.stringify({ serviceId: service.id, serviceNameSnapshot: service.name, serviceDurationMinutesSnapshot: 45, serviceCatalogueVersion: 1 }), 'authoritative four fields');
  check((await read(id)).treatmentService === service.name, 'authoritative name mirrored for legacy readers');
  check(!(await read(id)).serviceSelection && !JSON.stringify(await read(id)).includes('100.00') && !JSON.stringify(await read(id)).includes('987.65'), 'no command or catalogue price persisted');
  check((await read(id)).visitType === payload.visitType && (await read(id)).doctorId === 'provider', 'clinical type/provider preserved');
  const original = JSON.stringify(snapshot(await read(id)));
  service = await editService(service, { name: 'Renamed current Service', defaultDurationMinutes: 90, active: false });
  check((await request('/api/records/visits/' + id, 'PATCH', { ...payload, serviceSelection: undefined, treatmentService:'Forged mirror', notes:'Edited notes' })).status === 200, 'unrelated Completed edit retains inactive historical Service');
  check(JSON.stringify(snapshot(await read(id))) === original && (await read(id)).treatmentService === 'Performed reference', 'snapshot/mirror never silently refreshed');
  check((await request('/api/records/visits', 'POST', booking(selection(service)))).status === 400, 'inactive new selection denied');
  const stale = await request('/api/records/visits', 'POST', booking({serviceSelection:{serviceId:service.id,expectedVersion:1}}));
  check(stale.status === 409 && stale.body.code === 'SERVICE_VERSION_CHANGED', 'stale catalogue version distinguishable 409');
  check((await request('/api/records/visits/' + id, 'PATCH', {...payload,serviceSelection:undefined,branchId:'B'})).status === 409, 'persisted snapshot requires explicit branch resolution');
  check(JSON.stringify(snapshot(await read(id))) === original && (await read(id)).branchId === 'A', 'failed branch write atomic');
  check((await request('/api/records/visits/' + id, 'PATCH', {...payload,serviceSelection:undefined})).status === 200, 'branch roundtrip retains historical snapshot');
  service = await editService(service, {active:true});
  check((await request('/api/records/visits/' + id, 'PATCH', {...payload,...selection(service),branchId:'B'})).status === 200, 'explicit branch replacement');
  check((await read(id)).serviceCatalogueVersion === service.version && (await read(id)).treatmentService === service.name && (await read(id)).serviceDurationMinutesSnapshot === 90, 'reviewed revision stores coherent authoritative identity');
  service = await editService(service, {branchSettings:[{branchId:'B',available:false,price:{mode:'inherit'}}]});
  const changedPayload = {...payload,branchId:'B',serviceSelection:undefined};
  check((await request('/api/records/visits/' + id,'PATCH',changedPayload)).status === 200, 'unavailable historical Service retained');
  check((await request('/api/records/visits','POST',booking(selection(service),'B'))).status === 400, 'new unavailable Service denied');
  check((await request('/api/records/visits/' + id,'PATCH',{...changedPayload,branchId:'A',serviceSelection:null})).status === 200, 'explicit removal resolves branch');
  check(Object.values(snapshot(await read(id))).every(value=>value===null) && (await read(id)).treatmentService === '', 'removal clears canonical identity and mirror only by intent');
  const free = await createService('Free performed Service',{mode:'free'});
  check((await request('/api/records/visits','POST',booking(selection(free)))).status === 201, 'Free eligible');
  const unpriced = await createService('Unconfigured performed Service',{mode:'unpriced'});
  check((await request('/api/records/visits','POST',booking(selection(unpriced)))).status === 400, 'unpriced new selection denied');
  check((await request('/api/records/visits','POST',booking(selection(unpriced),'B'))).status === 201, 'configured branch override eligible');
  const overrideFree = await editService(unpriced,{branchSettings:[{branchId:'A',available:true,price:{mode:'free'}}]});
  check((await request('/api/records/visits','POST',booking(selection(overrideFree)))).status === 201, 'Free branch override eligible');
  for (const body of [{serviceSelection:{}},{serviceSelection:{serviceId:free.id}},{serviceSelection:{serviceId:free.id,expectedVersion:'1'}},{serviceSelection:{serviceId:'invalid',expectedVersion:1}},{serviceSelection:{serviceId:free.id,expectedVersion:1,price:'1'}}]) check((await request('/api/records/visits','POST',booking(body))).status === 400, 'invalid selection rejected');
  for (const field of ['serviceId','serviceNameSnapshot','serviceDurationMinutesSnapshot','serviceCatalogueVersion']) {
    check((await request('/api/records/visits','POST',booking({[field]:'forged'}))).status === 400,'create rejects forged '+field);
    check((await request('/api/records/visits/'+id,'PATCH',{...payload,serviceSelection:undefined,[field]:null})).status === 400,'edit rejects forged '+field);
  }
  check((await request('/api/records/visits','POST',booking({serviceSelection:{serviceId:randomUUID(),expectedVersion:1}}))).status === 400,'missing Service denied');
  check((await request('/api/records/visits','POST',booking(selection(free),'C'))).status === 400,'inactive branch denied');
  // New/legacy compatibility: untouched imported text, even over today's limit,
  // is not a new normalized write or an automatic catalogue mapping.
  const legacyPayload = booking({treatmentService:'Custom non-catalogue care'});
  const legacyCreate = await request('/api/records/visits','POST',legacyPayload);
  check(legacyCreate.status===201 && !Object.hasOwn(await read(legacyCreate.body.id),'serviceId'),'legacy create remains canonical-free');
  for (const raw of ['  retained clinical free text  ','Legacy '.repeat(30)]) {
    await db.collection('visits').doc(legacyCreate.body.id).update({treatmentService:raw,servicePerformed:'Old imported performed',unknownHistory:{value:'preserved'}});
    check((await request('/api/records/visits/'+legacyCreate.body.id,'PATCH',{...legacyPayload,treatmentService:raw,notes:'Notes only'})).status===200,'untouched imported text edit accepted');
    check((await read(legacyCreate.body.id)).treatmentService===raw,'untouched legacy text byte-for-byte');
    check((await request('/api/records/visits/'+legacyCreate.body.id,'PATCH',{...legacyPayload,treatmentService:undefined})).status===200,'omitted legacy text retained');
    check((await read(legacyCreate.body.id)).treatmentService===raw && (await read(legacyCreate.body.id)).servicePerformed==='Old imported performed' && (await read(legacyCreate.body.id)).unknownHistory.value==='preserved','unknown JSONB and old servicePerformed retained');
    check(!Object.hasOwn(await read(legacyCreate.body.id),'serviceId'),'no automatic historical mapping');
  }
  check((await request('/api/records/visits/'+legacyCreate.body.id,'PATCH',{...legacyPayload,treatmentService:'  Edited new text  ',branchId:'B'})).status===200,'legacy explicit text/branch edit preserved');
  check((await read(legacyCreate.body.id)).treatmentService==='Edited new text','changed legacy text follows existing parser');
  check((await request('/api/records/visits/'+legacyCreate.body.id,'PATCH',{...legacyPayload,treatmentService:'x'.repeat(121)})).status===400,'new long legacy text still denied');
  await db.collection('visits').doc('service-performed-only').set({...booking(),servicePerformed:'Imported performed-only'});
  const oldPerformed = await read('service-performed-only');
  check((await request('/api/records/visits/service-performed-only','PATCH',editPayload(oldPerformed))).status===200,'servicePerformed-only record editable');
  check((await read('service-performed-only')).servicePerformed==='Imported performed-only' && !Object.hasOwn(await read('service-performed-only'),'serviceId'),'servicePerformed-only remains untouched');
  // Booked and performed facts are separate, including legacy linked Visits.
  const booked = await createService('Booked snapshot');
  const performed = await createService('Different performed snapshot');
  async function link(performance: any, bookedService = booked) {
    const p = booking(selection(bookedService));
    const b = await request('/api/records/appointments','POST',{...p,appointmentDate:p.visitDate,status:'Scheduled'});
    check(b.status===201,'create linked synthetic booking');
    const bookingBefore = await readAppointment(b.body.id);
    const v = await request('/api/records/visits','POST',{...p,serviceSelection:undefined,...performance,appointmentId:b.body.id});
    check(v.status===201,'create linked clinical Visit');
    const bookingAfter = await readAppointment(b.body.id);
    check(JSON.stringify(snapshot(bookingAfter))===JSON.stringify(snapshot(bookingBefore)),'booking snapshot preserved');
    check(bookingAfter.visitHistoryId===v.body.id && bookingAfter.visitHistoryCreated===true && bookingAfter.status==='Completed','existing linking/completion retained');
    return {v:v.body.id,b:b.body.id,p};
  }
  const match = await link(selection(booked));
  check((await read(match.v)).serviceId===booked.id,'performed may match booked');
  const different = await link(selection(performed));
  check((await read(different.v)).serviceId===performed.id && (await readAppointment(different.b)).serviceId===booked.id,'performed may differ without rewriting booking');
  const legacyLinked = await link({treatmentService:'Legacy linked text'});
  check(!Object.hasOwn(await read(legacyLinked.v),'serviceId'),'canonical booking does not auto-convert legacy Visit');
  check((await request('/api/records/visits/'+legacyLinked.v,'PATCH',{...legacyLinked.p,serviceSelection:undefined,appointmentId:legacyLinked.b,treatmentService:'Legacy linked text',notes:'Unrelated'})).status===200,'legacy linked edit');
  check(!Object.hasOwn(await read(legacyLinked.v),'serviceId'),'linked edit never auto-adopts booking');
  const oldBooking = booking(selection(booked));
  const b = await request('/api/records/appointments','POST',{...oldBooking,appointmentDate:oldBooking.visitDate,status:'Scheduled'});
  check(b.status===201,'historical booking');
  const historicBooked = JSON.stringify(snapshot(await readAppointment(b.body.id)));
  await editService(booked,{active:false,name:'No longer eligible booking',standardPrice:{mode:'unpriced'},branchSettings:[{branchId:'A',available:false,price:{mode:'inherit'}}]});
  check((await request('/api/records/visits','POST',{...oldBooking,appointmentId:b.body.id})).status===409,'historical old version proposal denied');
  const eligibleDifferent = await request('/api/records/visits','POST',{...oldBooking,...selection(performed),appointmentId:b.body.id});
  check(eligibleDifferent.status===201 && (await read(eligibleDifferent.body.id)).serviceId===performed.id,'another eligible performed Service allowed for ineligible booking');
  check(JSON.stringify(snapshot(await readAppointment(b.body.id)))===historicBooked,'historical ineligible booking preserved');
  const beforeEditBooking = JSON.stringify(await readAppointment(different.b));
  check((await request('/api/records/visits/'+different.v,'PATCH',{...different.p,...selection(free),appointmentId:different.b})).status===200,'explicit performed replacement on linked Visit');
  check(JSON.stringify(await readAppointment(different.b))===beforeEditBooking,'performed edit does not write any appointment field');
  check((await request('/api/records/visits/'+different.v,'PATCH',{...different.p,serviceSelection:undefined,appointmentId:null})).status===409,'existing immutable link protected');
  // Signing policy is not invented: explicit seal markers block all edits;
  // existing Completed records above remain editable and audited.
  for (const marker of [{isSigned:true},{isFinalized:true},{signedAt:'2029-01-01T00:00:00Z'},{finalizedAt:'2029-01-01'},{status:'Signed'},{status:'Finalized'}]) {
    const sealedId = randomUUID(); const sealed = {...booking(),...snapshot(await read(eligibleDifferent.body.id)),...marker};
    await db.collection('visits').doc(sealedId).set(sealed);
    const prior = JSON.stringify(await read(sealedId));
    check((await request('/api/records/visits/'+sealedId,'PATCH',{...editPayload(sealed),serviceSelection:null})).status===409,'explicit seal denies removal');
    check(JSON.stringify(await read(sealedId))===prior,'sealed historical Visit unchanged');
  }
  const archivePayload=booking(selection(performed));const av=await request('/api/records/visits','POST',archivePayload);
  check(av.status===201,'archive test Visit');
  const beforeArchive=JSON.stringify(snapshot(await read(av.body.id)));
  check((await request('/api/records/visits/'+av.body.id,'DELETE',{reason:'Synthetic archive'})).status===200,'archive unchanged');
  check((await request('/api/records/visits/'+av.body.id,'PATCH',archivePayload)).status===409,'archived edit denied');
  check((await request('/api/records/visits/'+av.body.id+'/restore','POST',{})).status===200,'restore unchanged');
  check(JSON.stringify(snapshot(await read(av.body.id)))===beforeArchive,'archive restore preserves performance');
  for (const role of ['admin','support_developer','doctor']) {
    check((await request('/api/records/visits','POST',booking({...selection(performed),doctorId:role==='doctor'?'doctor':'provider'}),role)).status===201,role+' clinical permission preserved');
    const scoped=await request('/api/services?branchId=A&availableOnly=true','GET',undefined,role);
    check(scoped.status===200 && scoped.body.services.every((s:any)=>s.branches.every((br:any)=>br.id==='A')) && !JSON.stringify(scoped.body).includes('987.65'),role+' catalogue branch-price scoping');
  }
  for (const role of ['staff','manager','inactive','anonymous']) check([401,403].includes((await request('/api/records/visits','POST',booking(selection(performed)),role)).status),role+' clinical mutation denied');
  check((await request('/api/records/visits','POST',booking(selection(performed)),'doctor')).status===403,'doctor cannot create for other provider');
  check((await request('/api/records/visits/'+id,'PATCH',{...payload,serviceSelection:undefined},'doctor')).status===403,'doctor cannot edit another clinician Visit');
  await db.collection('users').doc('doctor').update({assignedBranches:['A']});
  check((await request('/api/records/visits','POST',booking({...selection(performed),doctorId:'doctor'},'B'),'doctor')).status===403,'unauthorized Visit branch server denied');
  check((await request('/api/services?branchId=B','GET',undefined,'doctor')).status===403,'unauthorized catalogue branch denied');
  for (const mode of ['set','update','create']) check((await request('/api/data/write','POST',{operations:[{path:'visits/'+id,mode,data:{serviceId:performed.id}}]})).status===403,'generic Visit '+mode+' bypass denied');
  check([401,403].includes((await request('/api/records/visits','POST',booking(selection(performed)),'admin',{Authorization:'Bearer invalid'})).status),'CSRF retained');
  const clash=booking(selection(performed));
  check((await request('/api/records/appointments','POST',{...clash,appointmentDate:clash.visitDate,status:'Scheduled'})).status===201,'provider conflict booking setup');
  check((await request('/api/records/visits','POST',clash)).status===409,'existing provider booking conflict retained');
  const racing = await createService('Racing performance');
  const race = await Promise.all([request('/api/records/visits','POST',booking(selection(racing))),request('/api/services/'+racing.id,'PATCH',{expectedVersion:1,name:'Racing updated',defaultDurationMinutes:60})]);
  check(race[1].status===200 && [201,409].includes(race[0].status),'catalogue/Visit race serialized');
  if (race[0].status===201) check((await read(race[0].body.id)).serviceNameSnapshot===racing.name && (await read(race[0].body.id)).serviceDurationMinutesSnapshot===45,'coherent race snapshot');
  await db.collection('visits').doc('orphan-history').set({...booking(),serviceId:randomUUID(),serviceNameSnapshot:'Historical removed reference',serviceDurationMinutesSnapshot:20,serviceCatalogueVersion:7});
  const orphan = await read('orphan-history');
  check((await request('/api/records/visits/orphan-history','PATCH',editPayload(orphan))).status===200,'orphan snapshot edit without catalogue resolution');
  const historicalRead = await request('/api/data/query','POST',{path:'visits/orphan-history',kind:'document'},'doctor');
  check(historicalRead.status===200 && historicalRead.body.document.data.serviceNameSnapshot==='Historical removed reference','authorized shared clinical historical read');
  const unpricedPayload=booking(selection(free));const uv=await request('/api/records/visits','POST',unpricedPayload);
  check(uv.status===201,'historical soon unpriced Visit'); const uvSnapshot=JSON.stringify(snapshot(await read(uv.body.id)));
  await editService(free,{standardPrice:{mode:'unpriced'}});
  check((await request('/api/records/visits/'+uv.body.id,'PATCH',{...unpricedPayload,serviceSelection:undefined})).status===200 && JSON.stringify(snapshot(await read(uv.body.id)))===uvSnapshot,'historical unpriced snapshot retained');
  await db.collection('visits').doc('distinct-legacy').set({...booking(),...snapshot(await read(uv.body.id)),treatmentService:'  Distinct imported description  '});
  const distinct=await read('distinct-legacy');
  check((await request('/api/records/visits/distinct-legacy','PATCH',{...editPayload(distinct),serviceSelection:null})).status===200,'explicit reference removal on imported mixed history');
  check((await read('distinct-legacy')).serviceId===null && (await read('distinct-legacy')).treatmentService==='  Distinct imported description  ','distinct legacy text survives reference removal exactly');
  // Current profile/branch/clinical role is rechecked inside the record lock.
  const originalTransaction=db.runTransaction;
  for (const narrowing of [{assignedBranches:[]},{active:false},{role:'staff'}]) {
    await db.collection('users').doc('doctor').update({role:'doctor',active:true,assignedBranches:['A']});let narrowed=false;
    db.runTransaction=async callback=>{if(!narrowed){narrowed=true;await originalTransaction(async tx=>{tx.update(db.collection('users').doc('doctor'),narrowing);});}return originalTransaction(callback);};
    try {check((await request('/api/records/visits','POST',booking({...selection(performed),doctorId:'doctor'}),'doctor')).status===403,'transactional access/clinical permission loss denied');}
    finally {db.runTransaction=originalTransaction;}
  }
  await db.collection('users').doc('doctor').update({role:'doctor',active:true,assignedBranches:['A']});
  const ownPayload=booking({...selection(performed),doctorId:'doctor'});const own=await request('/api/records/visits','POST',ownPayload,'doctor');
  check(own.status===201,'own clinician Visit for transactional edit checks');
  for(const narrowing of [{assignedBranches:[]},{active:false},{role:'staff'}]) {
    await db.collection('users').doc('doctor').update({role:'doctor',active:true,assignedBranches:['A']});let changed=false;const prior=JSON.stringify(await read(own.body.id));
    db.runTransaction=async callback=>{if(!changed){changed=true;await originalTransaction(async tx=>{tx.update(db.collection('users').doc('doctor'),narrowing);});}return originalTransaction(callback);};
    try{check((await request('/api/records/visits/'+own.body.id,'PATCH',{...ownPayload,serviceSelection:undefined,notes:'Denied stale authority'},'doctor')).status===403,'transactional edit clinical/access loss denied');}
    finally{db.runTransaction=originalTransaction;}
    check(JSON.stringify(await read(own.body.id))===prior,'denied clinical edit preserves Visit');
  }
  await db.collection('users').doc('doctor').update({role:'doctor',active:true,assignedBranches:['A']});
  const atomicBooking=booking(selection(performed));const ab=await request('/api/records/appointments','POST',{...atomicBooking,appointmentDate:atomicBooking.visitDate,status:'Scheduled'});
  check(ab.status===201,'atomic booking setup');
  const patientBefore=JSON.stringify(await readPatient()),appointmentBefore=JSON.stringify(await readAppointment(ab.body.id));
  const count=(await pool.query("SELECT count(*) FROM app_records WHERE collection_path='visits'")).rows[0].count;
  db.runTransaction=callback=>originalTransaction(async tx=>{const set=tx.set.bind(tx);tx.set=((ref:any,data:any,options:any)=>{if(ref.collectionPath==='audit_logs')throw Error('Synthetic Visit audit failure');return set(ref,data,options);}) as any;return callback(tx);});
  try {check((await request('/api/records/visits','POST',{...atomicBooking,appointmentId:ab.body.id})).status===500,'audit failure surfaced');}
  finally {db.runTransaction=originalTransaction;}
  check((await pool.query("SELECT count(*) FROM app_records WHERE collection_path='visits'")).rows[0].count===count && JSON.stringify(await readPatient())===patientBefore && JSON.stringify(await readAppointment(ab.body.id))===appointmentBefore,'audit failure rolls back Visit snapshot, patient stats and appointment completion');
  const audits=(await pool.query("SELECT data FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1",[id])).rows.map(row=>row.data);
  check(audits.some(log=>log.changes?.some((change:any)=>change.field==='serviceId')),'explicit performance change in trusted clinical audit');
  const recordsBefore=JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path='visits' ORDER BY id")).rows);
  await migrateDatabase();
  check(JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path='visits' ORDER BY id")).rows)===recordsBefore,'004 application upgrade/restart retains legacy and canonical JSONB including timestamps');
  check((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.length===4,'no 005 migration or schema change');
  console.log(`Visit Services API: ${checks} checks passed (disposable synthetic database)`);
} finally {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
