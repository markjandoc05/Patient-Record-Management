import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_appointment_services_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || !process.env.STORAGE_DIR) throw Error('Disposable loopback vine_appointment_services_test and temporary storage required');
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
const read = async (id: string) => (await db.collection('appointments').doc(id).get()).data()!;
const snapshot = (record: any) => Object.fromEntries(['serviceId', 'serviceNameSnapshot', 'serviceDurationMinutesSnapshot', 'serviceCatalogueVersion'].map(field => [field, record[field]]));
let minute = 0;
const booking = (extra = {}, branchId = 'A') => {
  const slot = minute++;
  return { patientId: 'patient', doctorId: 'provider', branchId,
    appointmentDate: `${2029 + Math.floor(slot / 19)}-01-01T${String(10 + Math.floor((slot % 19) / 2)).padStart(2, '0')}:${slot % 19 % 2 ? '30' : '00'}`,
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
  await db.collection('appointments').doc('legacy').set({ branchId: 'A', visitType: 'Follow-up', notes: '  retained historical text  ' });
  const before = JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path='appointments'")).rows);
  await migrateDatabase(); await migrateDatabase();
  check(before === JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path='appointments'")).rows), '002 -> 004 preserves legacy values and timestamps');
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
  let service = await createService('Appointment reference');
  const payload = booking(selection(service));
  const created = await request('/api/records/appointments', 'POST', payload);
  check(created.status === 201, 'priced Service booking'); const id = created.body.id;
  check(JSON.stringify(snapshot(await read(id))) === JSON.stringify({ serviceId: service.id, serviceNameSnapshot: service.name, serviceDurationMinutesSnapshot: 45, serviceCatalogueVersion: 1 }), 'authoritative four fields');
  check(!(await read(id)).serviceSelection && !JSON.stringify(await read(id)).includes('100.00') && !JSON.stringify(await read(id)).includes('987.65'), 'no command or charged price stored');
  check((await read(id)).visitType === payload.visitType && (await read(id)).doctorId === 'provider', 'visit type and provider unchanged');
  const original = JSON.stringify(snapshot(await read(id)));
  service = await editService(service, { name: 'Renamed current Service', defaultDurationMinutes: 90, active: false });
  check((await request('/api/records/appointments/' + id, 'PATCH', { ...payload, serviceSelection: undefined, notes: 'Edited notes' })).status === 200, 'unrelated edit retains inactive historical Service');
  check(JSON.stringify(snapshot(await read(id))) === original, 'name duration version are never silently refreshed');
  check((await request('/api/records/appointments', 'POST', booking(selection(service)))).status === 400, 'inactive new selection denied');
  const staleVersion = await request('/api/records/appointments', 'POST', booking({ serviceSelection: { serviceId: service.id, expectedVersion: 1 } }));
  check(staleVersion.status === 409, 'stale catalogue version denied');
  check(staleVersion.body.code === 'SERVICE_VERSION_CHANGED', 'Service version denial is distinguishable from appointment conflicts');
  check((await request('/api/records/appointments/' + id, 'PATCH', { ...payload, serviceSelection: undefined, branchId: 'B' })).status === 409, 'branch change cannot implicitly retain snapshot');
  check(JSON.stringify(snapshot(await read(id))) === original && (await read(id)).branchId === 'A', 'failed branch write atomic');
  service = await editService(service, { active: true });
  check((await request('/api/records/appointments/' + id, 'PATCH', { ...payload, ...selection(service), branchId: 'B' })).status === 200, 'explicit eligible branch re-selection');
  check((await read(id)).serviceCatalogueVersion === service.version && (await read(id)).serviceDurationMinutesSnapshot === 90, 'explicit re-selection replaces authoritative snapshot');
  service = await editService(service, { branchSettings: [{ branchId: 'B', available: false, price: { mode: 'inherit' } }] });
  const changedPayload = { ...payload, branchId: 'B', serviceSelection: undefined };
  check((await request('/api/records/appointments/' + id, 'PATCH', changedPayload)).status === 200, 'unavailable historical selection retained');
  check((await request('/api/records/appointments', 'POST', booking(selection(service), 'B'))).status === 400, 'unavailable new selection denied');
  check((await request('/api/records/appointments/' + id, 'PATCH', { ...changedPayload, branchId: 'A', serviceSelection: null })).status === 200, 'explicit clear allows branch change');
  check(Object.values(snapshot(await read(id))).every(value => value === null), 'explicit removal clears all four fields');
  const free = await createService('Free appointment Service', { mode: 'free' });
  check((await request('/api/records/appointments', 'POST', booking(selection(free)))).status === 201, 'explicit Free is eligible');
  const unpriced = await createService('Unconfigured appointment Service', { mode: 'unpriced' });
  check((await request('/api/records/appointments', 'POST', booking(selection(unpriced)))).status === 400, 'inherited unconfigured price denied');
  check((await request('/api/records/appointments', 'POST', booking(selection(unpriced), 'B'))).status === 201, 'branch configured price makes unpriced standard eligible');
  const overrideFree = await editService(unpriced, { branchSettings: [{ branchId: 'A', available: true, price: { mode: 'free' } }] });
  check((await request('/api/records/appointments', 'POST', booking(selection(overrideFree)))).status === 201, 'branch Free override eligible');
  for (const body of [{ serviceSelection: {} }, { serviceSelection: { serviceId: free.id } }, { serviceSelection: { serviceId: free.id, expectedVersion: '1' } }, { serviceSelection: { serviceId: 'invalid', expectedVersion: 1 } }, { serviceSelection: { serviceId: free.id, expectedVersion: 1, price: '1' } }]) check((await request('/api/records/appointments', 'POST', booking(body))).status === 400, 'invalid selection rejected');
  for (const field of ['serviceId', 'serviceNameSnapshot', 'serviceDurationMinutesSnapshot', 'serviceCatalogueVersion']) {
    check((await request('/api/records/appointments', 'POST', booking({ [field]: 'forged' }))).status === 400, 'create rejects forged ' + field);
    check((await request('/api/records/appointments/' + id, 'PATCH', { ...payload, serviceSelection: undefined, [field]: null })).status === 400, 'edit rejects forged ' + field);
  }
  check((await request('/api/records/appointments', 'POST', booking({ serviceSelection: { serviceId: randomUUID(), expectedVersion: 1 } }))).status === 400, 'missing Service denied');
  check((await request('/api/records/appointments', 'POST', booking(selection(free), 'C'))).status === 400, 'inactive branch denied');
  const legacyBooking = booking(); const legacyCreate = await request('/api/records/appointments', 'POST', legacyBooking);
  check(legacyCreate.status === 201 && !Object.hasOwn(await read(legacyCreate.body.id), 'serviceId'), 'legacy create has no snapshot fields');
  check((await request('/api/records/appointments/' + legacyCreate.body.id, 'PATCH', { ...legacyBooking, branchId: 'B' })).status === 200, 'legacy branch change unaffected');
  for (const role of ['admin', 'support_developer', 'manager', 'doctor', 'staff']) {
    check((await request('/api/records/appointments', 'POST', booking(selection(free)), role)).status === 201, role + ' existing booking permission preserved');
    const scoped = await request('/api/services?branchId=A&availableOnly=true', 'GET', undefined, role);
    check(scoped.status === 200 && scoped.body.services.every((s: any) => s.branches.every((b: any) => b.id === 'A')), role + ' branch-filtered options');
    check(!JSON.stringify(scoped.body).includes('987.65'), role + ' removed branch price not exposed');
    if (!['admin', 'support_developer'].includes(role)) {
      check((await request('/api/records/appointments', 'POST', booking(selection(free), 'B'), role)).status === 403, role + ' unauthorized booking branch denied');
      check((await request('/api/services?branchId=B', 'GET', undefined, role)).status === 403, role + ' unauthorized catalogue branch denied');
    }
  }
  for (const role of ['inactive', 'anonymous']) check([401, 403].includes((await request('/api/records/appointments', 'POST', booking(selection(free)), role)).status), role + ' denied');
  check([401, 403].includes((await request('/api/records/appointments', 'POST', booking(selection(free)), 'admin', { Authorization: 'Bearer invalid' })).status), 'CSRF retained');
  const clash = booking(selection(free)); const first = await request('/api/records/appointments', 'POST', clash);
  check(first.status === 201 && (await request('/api/records/appointments', 'POST', clash)).status === 409, 'existing exact-slot conflict retained');
  check((await request('/api/records/appointments/' + first.body.id, 'PATCH', clash)).status === 200, 'self excluded from slot conflict');
  const durationOverlap = { ...clash, appointmentDate: clash.appointmentDate.endsWith('00') ? clash.appointmentDate.slice(0, -2) + '30' : `${clash.appointmentDate.slice(0, 11)}${String(Number(clash.appointmentDate.slice(11, 13)) + 1).padStart(2, '0')}:00` };
  check((await request('/api/records/appointments', 'POST', durationOverlap)).status === 201, 'reference duration does not add advanced scheduling');
  const archive = await request('/api/records/appointments/' + first.body.id, 'DELETE', { reason: 'Synthetic archive test' });
  check(archive.status === 200, 'archive unchanged');
  const archivedSnapshot = JSON.stringify(snapshot(await read(first.body.id)));
  check((await request('/api/records/appointments/' + first.body.id, 'PATCH', clash)).status === 409, 'archived edit denied');
  check((await request('/api/records/appointments/' + first.body.id + '/restore', 'POST', {})).status === 200, 'restore unchanged');
  check(JSON.stringify(snapshot(await read(first.body.id))) === archivedSnapshot, 'archive and restore preserve snapshot');
  await db.collection('appointments').doc(first.body.id).update({ visitHistoryCreated: true });
  check((await request('/api/records/appointments/' + first.body.id, 'PATCH', { ...clash, serviceSelection: null })).status === 409, 'visit seal unchanged');
  // Race a catalogue revision against appointment selection: whichever wins the
  // shared transaction lock determines a coherent snapshot or stale-version denial.
  const racing = await createService('Racing Service');
  const racedPayload = booking(selection(racing));
  const race = await Promise.all([request('/api/records/appointments', 'POST', racedPayload), request('/api/services/' + racing.id, 'PATCH', { expectedVersion: 1, name: 'Racing Service updated', defaultDurationMinutes: 60 })]);
  check(race[1].status === 200 && [201, 409].includes(race[0].status), 'catalogue/booking race is serialized');
  if (race[0].status === 201) check((await read(race[0].body.id)).serviceNameSnapshot === racing.name && (await read(race[0].body.id)).serviceDurationMinutesSnapshot === 45, 'race has coherent original snapshot');
  // Access can narrow after initial HTTP authorization but before the lock.
  const originalTransaction = db.runTransaction;
  let narrowed = false;
  db.runTransaction = async callback => {
    if (!narrowed) { narrowed = true; await originalTransaction(async tx => { tx.update(db.collection('users').doc('staff'), { assignedBranches: [] }); }); }
    return originalTransaction(callback);
  };
  try { check((await request('/api/records/appointments', 'POST', booking(selection(free)), 'staff')).status === 403, 'current transactional branch scope enforced'); }
  finally { db.runTransaction = originalTransaction; }
  // Stored snapshots are readable even when their catalogue reference is gone.
  await db.collection('appointments').doc('orphan-history').set({ ...booking(), serviceId: randomUUID(), serviceNameSnapshot: 'Historical removed reference', serviceDurationMinutesSnapshot: 20, serviceCatalogueVersion: 7 });
  const orphan = await read('orphan-history');
  check((await request('/api/records/appointments/orphan-history', 'PATCH', { ...orphan, ...Object.fromEntries(Object.keys(snapshot(orphan)).map(k => [k, undefined])) })).status === 200, 'historical missing reference editable without catalogue lookup');
  const historicalRead = await request('/api/data/query', 'POST', { path: 'appointments/orphan-history', kind: 'document' }, 'doctor');
  check(historicalRead.status === 200 && historicalRead.body.document.data.serviceNameSnapshot === 'Historical removed reference', 'snapshot readable through authorized appointment API');
  const freeBooking = booking(selection(free)); const freeAppointment = await request('/api/records/appointments', 'POST', freeBooking);
  const freeBefore = JSON.stringify(snapshot(await read(freeAppointment.body.id)));
  await editService(free, { standardPrice: { mode: 'unpriced' } });
  check((await request('/api/records/appointments/' + freeAppointment.body.id, 'PATCH', { ...freeBooking, serviceSelection: undefined })).status === 200, 'historical newly unpriced Service remains editable');
  check(JSON.stringify(snapshot(await read(freeAppointment.body.id))) === freeBefore, 'unpriced historical snapshot unchanged');
  const atomicService = await createService('Atomic Service');
  const recordCount = (await pool.query("SELECT count(*) FROM app_records WHERE collection_path='appointments'")).rows[0].count;
  db.runTransaction = callback => originalTransaction(async tx => {
    const originalSet = tx.set.bind(tx);
    tx.set = ((ref: any, data: any, options: any) => { if (ref.collectionPath === 'audit_logs') throw Error('Synthetic appointment audit failure'); return originalSet(ref, data, options); }) as any;
    return callback(tx);
  });
  try { check((await request('/api/records/appointments', 'POST', booking(selection(atomicService)))).status === 500, 'audit failure returned'); }
  finally { db.runTransaction = originalTransaction; }
  check((await pool.query("SELECT count(*) FROM app_records WHERE collection_path='appointments'")).rows[0].count === recordCount, 'audit failure rolls back snapshot and booking');
  await db.collection('users').doc('staff').update({ assignedBranches: ['A'] });
  let disabled = false;
  db.runTransaction = async callback => {
    if (!disabled) { disabled = true; await originalTransaction(async tx => { tx.update(db.collection('users').doc('staff'), { active: false }); }); }
    return originalTransaction(callback);
  };
  try { check((await request('/api/records/appointments', 'POST', booking(selection(atomicService)), 'staff')).status === 403, 'transactional access loss denied'); }
  finally { db.runTransaction = originalTransaction; }
  const audits = (await pool.query("SELECT data FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1", [id])).rows.map(row => row.data);
  check(audits.some(log => log.changes?.some((change: any) => change.field === 'serviceId')), 'explicit selection change appears in trusted appointment audit');
  console.log(`Appointment Services API: ${checks} checks passed (disposable synthetic database)`);
} finally {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
