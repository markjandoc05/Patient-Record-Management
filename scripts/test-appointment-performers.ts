import { assertCurrentMigrationChain } from './platform-test-support';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

// This suite creates only synthetic records in an empty, disposable database.
const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const configuredOrigin = new URL(process.env.APP_URL || 'https://invalid');
const storage = path.resolve(process.env.STORAGE_DIR || '/');
const temporaryRoots = [tmpdir(), '/private/tmp', '/tmp'].map(value => path.resolve(value));
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_performers_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.NODE_ENV !== 'production'
  || !configuredOrigin.hostname.endsWith('.invalid') || !temporaryRoots.some(root => storage.startsWith(root + path.sep))) {
  throw Error('Use empty loopback vine_performers_test, production test middleware, synthetic .invalid APP_URL and temporary STORAGE_DIR');
}
const origin = configuredOrigin.origin;
const sessions = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen> | undefined;
let checks = 0, slot = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; }
async function request(route: string, method = 'GET', body?: any, actor = 'admin') {
  const session = sessions.get(actor);
  const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json',
      ...(session ? { Cookie: session.cookie, Authorization: `Bearer ${session.csrf}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
function status(result: { status: number; body: any }, expected: number, message: string) {
  check(result.status === expected, `${message}: expected ${expected}, received ${result.status} ${result.body?.error || ''}`);
}
const read = async (collection: string, id: string) => (await db.collection(collection).doc(id).get()).data()!;
const stamp = (record: any) => Object.fromEntries(['performedByUserId', 'performedByNameSnapshot', 'performedByRoleSnapshot', 'performedByDesignationSnapshot'].map(key => [key, record[key]]));
const moment = () => {
  const index = slot++;
  return `2035-01-${String(1 + Math.floor(index / 19)).padStart(2, '0')}T${String(10 + Math.floor(index % 19 / 2)).padStart(2, '0')}:${index % 19 % 2 ? '30' : '00'}`;
};
const appointment = (extra: any = {}) => ({ patientId: 'patient', branchId: 'A', appointmentDate: moment(),
  visitType: 'Treatment Session', status: 'Scheduled', mainConcern: '', notes: '', ...extra });
const visit = (extra: any = {}) => ({ patientId: 'patient', branchId: 'A', visitDate: moment(), visitType: 'Treatment Session', ...extra });
const createAppointment = async (payload: any, actor = 'admin') => {
  const result = await request('/api/records/appointments', 'POST', payload, actor);
  status(result, 201, 'create synthetic appointment'); return result.body.id;
};
const createVisit = async (payload: any, actor = 'admin') => {
  const result = await request('/api/records/visits', 'POST', payload, actor);
  status(result, 201, 'create synthetic Visit'); return result.body.id;
};
const writeUser = (id: string, data: any, actor = 'admin') => request('/api/data/write', 'POST', {
  operations: [{ path: 'users/' + id, mode: 'update', data }],
}, actor);

try {
  const existing = await pool.query("SELECT to_regclass('public.app_records') AS records");
  if (existing.rows[0].records) throw Error('vine_performers_test must be empty; recreate only this disposable test database');
  await migrateDatabase(); await migrateDatabase();
  check(await assertCurrentMigrationChain(), 'fresh complete migration chain, repeat-safe');
  for (const [id, branchStatus] of [['A', 'Active'], ['B', 'Active'], ['C', 'Inactive']]) {
    await db.collection('branches').doc(id).set({ branchName: 'Synthetic branch ' + id, status: branchStatus });
  }
  for (const role of ['admin', 'support_developer', 'doctor', 'staff', 'manager']) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(role).set({ role, active: true, assignedBranches: role === 'staff' ? ['A'] : ['A', 'B'], fullName: 'Synthetic ' + role });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [role, role + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), role, csrf]);
    sessions.set(role, { cookie: `${origin.startsWith('https') ? '__Host-' : ''}vine_session=${token}`, csrf });
  }
  const profiles: Record<string, any> = {
    provider: { role: 'doctor', fullName: 'Original Doctor' },
    nurse: { role: 'staff', staffDesignation: 'Nurse', fullName: 'Original Nurse' },
    medical: { role: 'staff', staffDesignation: 'Medical Staff', fullName: 'Medical Person' },
    reception: { role: 'staff', staffDesignation: 'Reception/Admin Staff', fullName: 'Reception Person' },
    undesignated: { role: 'staff', fullName: 'Undesignated Staff' },
    inactive: { role: 'staff', staffDesignation: 'Nurse', active: false },
    archived: { role: 'staff', staffDesignation: 'Nurse', isArchived: true },
    pending: { role: 'staff', staffDesignation: 'Nurse', accountStatus: 'pending_activation' },
    outside: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['B'] },
  };
  for (const [id, profile] of Object.entries(profiles)) await db.collection('users').doc(id).set({ active: true, assignedBranches: ['A', 'B'], ...profile });
  await db.collection('patients').doc('patient').set({ name: 'Synthetic performer patient', patientID: 'SYNTHETIC', isArchived: false });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');

  // Unassigned is a nullable relationship, never a synthetic provider account.
  for (const doctorId of [undefined, null, '']) {
    const payload = appointment(doctorId === undefined ? {} : { doctorId });
    const id = await createAppointment(payload, 'staff');
    check((await read('appointments', id)).doctorId === null, 'unassigned create normalizes missing/null/empty doctor');
    const edited = { ...payload, status: 'Confirmed' };
    status(await request('/api/records/appointments/' + id, 'PATCH', edited, 'staff'), 200, 'unassigned edit remains supported');
    status(await request('/api/records/appointments/' + id, 'DELETE', { reason: 'Synthetic archive' }), 200, 'unassigned archive');
    status(await request('/api/records/appointments/' + id + '/restore', 'POST', {}), 200, 'unassigned restore without doctor lookup');
    check((await read('appointments', id)).doctorId === null && !(await read('appointments', id)).isArchived, 'restore retains unassigned relationship');
  }
  for (const visitType of ['Initial Consultation', 'Follow-up', 'Treatment Session', 'Assessment']) {
    const id = await createAppointment(appointment({ doctorId: null, visitType }));
    check((await read('appointments', id)).visitType === visitType, 'every existing appointment type can remain unassigned');
  }
  for (const doctorId of ['nurse', 'inactive', 'missing', {}, 8]) {
    status(await request('/api/records/appointments', 'POST', appointment({ doctorId })), 400, 'invalid doctor association rejected');
  }
  status(await request('/api/records/appointments', 'POST', appointment({ branchId: 'B' }), 'staff'), 403, 'unassigned does not bypass actor branch scope');
  status(await request('/api/records/appointments', 'POST', appointment({ branchId: 'C' })), 400, 'unassigned still requires active branch');
  status(await request('/api/records/appointments', 'POST', appointment({ appointmentDate: '2035-01-01T04:30' })), 400, 'unassigned still requires existing clinic time slots');

  const occupied = appointment({ doctorId: 'provider' });
  const occupiedId = await createAppointment(occupied);
  const unassigned = { ...occupied, doctorId: null };
  const unassignedId = await createAppointment(unassigned);
  check((await read('appointments', unassignedId)).doctorId === null, 'unassigned may share an occupied doctor time without reserving them');
  const beforeDeniedAssignment = JSON.stringify(await read('appointments', unassignedId));
  status(await request('/api/records/appointments/' + unassignedId, 'PATCH', occupied), 409, 'later doctor assignment rechecks existing conflict');
  check(JSON.stringify(await read('appointments', unassignedId)) === beforeDeniedAssignment, 'failed assignment is atomic');
  status(await request('/api/records/appointments/' + occupiedId, 'PATCH', unassigned), 200, 'explicit unassignment frees prior doctor reservation');
  status(await request('/api/records/appointments/' + unassignedId, 'PATCH', occupied), 200, 'later assignment succeeds when doctor time is free');
  check((await read('appointments', unassignedId)).doctorId === 'provider', 'later assignment stores canonical doctor');
  status(await request('/api/records/appointments/' + unassignedId, 'PATCH', { ...unassigned, doctorId: undefined, status: 'Confirmed' }), 200, 'omitted doctor on legacy edit does not unassign an existing doctor');
  check((await read('appointments', unassignedId)).doctorId === 'provider', 'omitted appointment doctor preserves canonical relationship');
  status(await request('/api/records/appointments', 'POST', { ...occupied, branchId: 'B' }), 409, 'doctor conflict remains cross-branch');
  const concurrent = appointment();
  const first = await createAppointment(concurrent), second = await createAppointment(concurrent);
  const assignments = await Promise.all([first, second].map(id => request('/api/records/appointments/' + id, 'PATCH', { ...concurrent, doctorId: 'provider' })));
  check(assignments.filter(result => result.status === 200).length === 1 && assignments.filter(result => result.status === 409).length === 1, 'concurrent later assignments serialize doctor conflict');
  const archivePayload = appointment({ doctorId: 'provider' });
  const archivedBooking = await createAppointment(archivePayload);
  status(await request('/api/records/appointments/' + archivedBooking, 'DELETE', { reason: 'Synthetic archive' }), 200, 'assigned booking archive');
  await createAppointment(archivePayload);
  status(await request('/api/records/appointments/' + archivedBooking + '/restore', 'POST', {}), 409, 'assigned booking restore retains conflict rule');
  const legacyBooking = appointment();
  await db.collection('appointments').doc('legacy-booking').set({ ...legacyBooking, unknownHistory: { retained: 'original' } });
  status(await request('/api/records/appointments/legacy-booking', 'PATCH', { ...legacyBooking, notes: 'Edited scheduling note' }), 200, 'legacy appointment with missing doctor editable');
  check((await read('appointments', 'legacy-booking')).unknownHistory.retained === 'original', 'legacy appointment unknown history preserved');

  // Booked doctor, actual performer and record author remain different facts.
  const canonical = await request('/api/services', 'POST', { id: randomUUID(), name: 'Synthetic performed care', defaultDurationMinutes: 30,
    standardPrice: { mode: 'free' }, branchSettings: [{ branchId: 'A', available: true, price: { mode: 'inherit' } }] });
  status(canonical, 201, 'create synthetic Service');
  const withService = { serviceSelection: { serviceId: canonical.body.id, expectedVersion: canonical.body.version } };
  const nurseBooking = appointment({ doctorId: null, ...withService });
  const nurseBookingId = await createAppointment(nurseBooking);
  const bookedBefore = await read('appointments', nurseBookingId);
  const nursePayload = visit({ visitDate: nurseBooking.appointmentDate, doctorId: null, appointmentId: nurseBookingId,
    performedByUserId: 'nurse', assistingStaffText: 'Alice Example, Bob Example', ...withService });
  const nurseVisitId = await createVisit(nursePayload);
  const nurseVisit = await read('visits', nurseVisitId);
  check(JSON.stringify(stamp(nurseVisit)) === JSON.stringify({ performedByUserId: 'nurse', performedByNameSnapshot: 'Original Nurse', performedByRoleSnapshot: 'staff', performedByDesignationSnapshot: 'Nurse' }), 'nurse performer snapshots authored from current profile');
  check(nurseVisit.doctorId === null && nurseVisit.assistingStaffText === 'Alice Example, Bob Example', 'nurse performance keeps empty doctor and descriptive assistants');
  check(nurseVisit.createdByUid === 'admin' && nurseVisit.createdBy === 'Synthetic admin', 'authenticated record author is independent from performer');
  const bookedAfter = await read('appointments', nurseBookingId);
  check(bookedAfter.doctorId === null && bookedAfter.serviceNameSnapshot === bookedBefore.serviceNameSnapshot, 'Visit does not silently assign booking doctor or rewrite Service');
  check(bookedAfter.visitHistoryId === nurseVisitId && bookedAfter.visitHistoryCreated && bookedAfter.status === 'Completed', 'unassigned linked booking keeps existing completion link');
  check(nurseVisit.serviceId === canonical.body.id && nurseVisit.serviceNameSnapshot === canonical.body.name, 'canonical performed Service still authoritative');
  const linkedDoctorBooking = appointment({ doctorId: null });
  const linkedDoctorBookingId = await createAppointment(linkedDoctorBooking);
  const ownLinkedVisit = await createVisit(visit({ visitDate: linkedDoctorBooking.appointmentDate, doctorId: null,
    appointmentId: linkedDoctorBookingId, performedByUserId: 'doctor' }), 'doctor');
  check((await read('visits', ownLinkedVisit)).doctorId === 'doctor' && (await read('appointments', linkedDoctorBookingId)).doctorId === null, 'unassigned doctor-led Visit derives own doctor association without altering booking');
  const assignedBooking = appointment({ doctorId: 'provider' });
  const assignedBookingId = await createAppointment(assignedBooking);
  const assignedNurseVisit = await createVisit(visit({ visitDate: assignedBooking.appointmentDate, doctorId: 'provider',
    appointmentId: assignedBookingId, performedByUserId: 'medical', assistingStaffText: 'Doctor observed' }));
  check((await read('visits', assignedNurseVisit)).doctorId === 'provider' && (await read('visits', assignedNurseVisit)).performedByUserId === 'medical', 'assigned doctor and actual staff performer stored separately');
  check((await read('appointments', assignedBookingId)).doctorId === 'provider', 'assigned booking doctor retained');
  const mismatchBooking = appointment({ doctorId: 'provider' });
  const mismatchBookingId = await createAppointment(mismatchBooking);
  status(await request('/api/records/visits', 'POST', visit({ visitDate: mismatchBooking.appointmentDate, appointmentId: mismatchBookingId,
    doctorId: 'doctor', performedByUserId: 'doctor' })), 409, 'linked assigned doctor cannot be silently replaced');
  status(await request('/api/records/visits', 'POST', visit({ visitDate: mismatchBooking.appointmentDate, appointmentId: mismatchBookingId,
    doctorId: 'provider', performedByUserId: 'nurse', branchId: 'B' })), 409, 'linked branch mismatch retained');

  const doctorLed = await createVisit(visit({ doctorId: null, performedByUserId: 'provider' }));
  check((await read('visits', doctorLed)).doctorId === 'provider', 'standalone doctor performer retains doctor scheduling association');
  const oldCaller = await createVisit(visit({ doctorId: 'provider' }));
  check((await read('visits', oldCaller)).performedByUserId === 'provider', 'legacy doctor-only create remains compatible and obtains authoritative performer');
  const simultaneousNurse = visit({ doctorId: null, performedByUserId: 'nurse' });
  await createVisit(simultaneousNurse); await createVisit(simultaneousNurse);
  check(true, 'staff designation does not invent nurse scheduling conflicts');
  const twoDoctors = visit({ doctorId: 'provider', performedByUserId: 'doctor' });
  const twoDoctorsId = await createVisit(twoDoctors);
  status(await request('/api/records/appointments', 'POST', appointment({ doctorId: 'doctor', appointmentDate: twoDoctors.visitDate })), 409, 'actual lead Doctor remains reserved even when associated doctor differs');
  status(await request('/api/records/appointments', 'POST', appointment({ doctorId: 'provider', appointmentDate: twoDoctors.visitDate })), 409, 'associated doctor reservation remains intact alongside different lead');
  status(await request('/api/records/visits/' + twoDoctorsId, 'DELETE', { reason: 'Synthetic archive' }), 200, 'archive Visit with two distinct Doctor identities');
  const conflictingLeadBooking = await createAppointment(appointment({ doctorId: 'doctor', appointmentDate: twoDoctors.visitDate }));
  status(await request('/api/records/visits/' + twoDoctorsId + '/restore', 'POST', {}), 409, 'restoring Visit rechecks actual lead Doctor availability');
  check((await read('visits', twoDoctorsId)).isArchived === true, 'failed lead Doctor restore leaves archived Visit unchanged');
  status(await request('/api/records/appointments/' + conflictingLeadBooking, 'DELETE', { reason: 'Synthetic cleanup' }), 200, 'remove synthetic lead conflict');
  status(await request('/api/records/visits/' + twoDoctorsId + '/restore', 'POST', {}), 200, 'restore succeeds after actual lead conflict removed');
  for (const performedByUserId of [null, '', 'missing', 'reception', 'undesignated', 'inactive', 'archived', 'pending', 'outside', {}, 1]) {
    status(await request('/api/records/visits', 'POST', visit({ doctorId: 'provider', performedByUserId })), 400, 'explicit invalid/ineligible performer is server-denied');
  }
  status(await request('/api/records/visits', 'POST', visit({ doctorId: null })), 400, 'no doctor and no actual performer rejected');
  for (const field of ['performedByNameSnapshot', 'performedByRoleSnapshot', 'performedByDesignationSnapshot']) {
    status(await request('/api/records/visits', 'POST', visit({ doctorId: null, performedByUserId: 'nurse', [field]: 'forged' })), 400, 'create rejects forged performer ' + field);
    status(await request('/api/records/visits/' + nurseVisitId, 'PATCH', { ...nursePayload, serviceSelection: undefined, [field]: 'forged' }), 400, 'edit rejects forged performer ' + field);
  }
  for (const assistingStaffText of ['x'.repeat(501), ['Alice'], { name: 'Alice' }, 42]) {
    status(await request('/api/records/visits', 'POST', visit({ doctorId: null, performedByUserId: 'nurse', assistingStaffText })), 400, 'invalid assistant text rejected');
  }
  const textOnly = await createVisit(visit({ doctorId: null, performedByUserId: 'medical', assistingStaffText: 'Unregistered Assistant, Same Name, Same Name' }));
  check((await read('visits', textOnly)).assistingStaffText === 'Unregistered Assistant, Same Name, Same Name', 'assistant names are descriptive text without account lookup');
  status(await request('/api/records/visits/' + textOnly, 'PATCH', visit({ visitDate: (await read('visits', textOnly)).visitDate,
    doctorId: null, performedByUserId: 'medical', assistingStaffText: '' })), 200, 'explicit assistant text clearing allowed');
  check((await read('visits', textOnly)).assistingStaffText === '', 'explicit empty assistants stored');

  const historicNurseSnapshot = JSON.stringify(stamp(nurseVisit));
  await db.collection('users').doc('nurse').update({ fullName: 'Renamed Nurse', active: false, staffDesignation: 'Reception/Admin Staff' });
  const unchangedNurseEdit = { ...nursePayload, serviceSelection: undefined, performedByUserId: undefined, assistingStaffText: undefined, notes: 'Unrelated historical edit' };
  status(await request('/api/records/visits/' + nurseVisitId, 'PATCH', unchangedNurseEdit), 200, 'historical inactive performer retained on omitted selection');
  check(JSON.stringify(stamp(await read('visits', nurseVisitId))) === historicNurseSnapshot && (await read('visits', nurseVisitId)).assistingStaffText === nurseVisit.assistingStaffText, 'historical name/designation and omitted assistants preserved');
  status(await request('/api/records/visits/' + nurseVisitId, 'PATCH', { ...unchangedNurseEdit, performedByUserId: 'nurse' }), 200, 'unchanged same-branch historical performer may echo prior ID');
  check(JSON.stringify(stamp(await read('visits', nurseVisitId))) === historicNurseSnapshot, 'unchanged explicit historical selection never refreshes snapshot');
  status(await request('/api/records/visits', 'POST', visit({ doctorId: null, performedByUserId: 'nurse' })), 400, 'inactive historical performer cannot be newly selected');
  await db.collection('users').doc('nurse').update({ fullName: 'Original Nurse', active: true, staffDesignation: 'Nurse' });
  status(await request('/api/records/visits/' + nurseVisitId, 'PATCH', { ...unchangedNurseEdit, performedByUserId: 'medical' }), 200, 'explicit eligible performer replacement');
  check((await read('visits', nurseVisitId)).performedByNameSnapshot === 'Medical Person' && (await read('appointments', nurseBookingId)).doctorId === null, 'replacement updates Visit snapshots without changing unassigned booking');
  status(await request('/api/records/visits/' + nurseVisitId, 'PATCH', { ...unchangedNurseEdit, performedByUserId: 'provider', doctorId: null }), 200, 'unassigned linked Visit may explicitly replace staff lead with Doctor lead');
  check((await read('visits', nurseVisitId)).doctorId === 'provider' && (await read('appointments', nurseBookingId)).doctorId === null, 'Doctor replacement derives Visit association without altering unassigned booking');
  status(await request('/api/records/visits/' + nurseVisitId, 'PATCH', { ...unchangedNurseEdit, performedByUserId: 'medical', doctorId: null }), 200, 'unassigned linked Visit may return to staff lead');
  check((await read('visits', nurseVisitId)).doctorId === null && (await read('visits', nurseVisitId)).performedByUserId === 'medical', 'staff replacement clears derived Doctor association');
  const historicalStandalone = visit({ doctorId: null, performedByUserId: 'nurse' });
  const historicalStandaloneId = await createVisit(historicalStandalone);
  await db.collection('users').doc('nurse').update({ active: false });
  const historicalPrior = JSON.stringify(await read('visits', historicalStandaloneId));
  status(await request('/api/records/visits/' + historicalStandaloneId, 'PATCH', { ...historicalStandalone, visitDate: moment() }), 400, 'rescheduling an inactive performer requires current eligibility');
  check(JSON.stringify(await read('visits', historicalStandaloneId)) === historicalPrior, 'denied historical schedule change preserves Visit exactly');
  await db.collection('users').doc('nurse').update({ active: true });
  const legacyVisit = visit({ doctorId: 'provider', unknownHistory: { note: 'retained' }, assistingStaffText: '  Historical '.repeat(60) });
  await db.collection('visits').doc('legacy-visit').set(legacyVisit);
  status(await request('/api/records/visits/legacy-visit', 'PATCH', { ...legacyVisit, assistingStaffText: undefined, notes: 'Unrelated edit' }), 200, 'legacy Visit omission does not require new performer');
  const retainedLegacy = await read('visits', 'legacy-visit');
  check(!Object.hasOwn(retainedLegacy, 'performedByUserId') && retainedLegacy.assistingStaffText === legacyVisit.assistingStaffText && retainedLegacy.unknownHistory.note === 'retained', 'legacy raw assistants and absence of performer snapshots retained');
  status(await request('/api/records/visits/legacy-visit', 'PATCH', { ...legacyVisit, assistingStaffText: legacyVisit.assistingStaffText }), 200, 'unchanged over-limit imported assistants retained byte-for-byte');
  status(await request('/api/records/visits/' + doctorLed, 'DELETE', { reason: 'Synthetic archive' }), 200, 'performer Visit archive');
  status(await request('/api/records/visits/' + doctorLed + '/restore', 'POST', {}), 200, 'performer Visit restore');
  check((await read('visits', doctorLed)).performedByNameSnapshot === 'Original Doctor', 'archive/restore preserves performer history');

  // Designation now supplies medical Visit defaults through revisioned access management.
  const designate = async (id: string, staffDesignation: unknown, actor = 'admin') => request('/api/users/' + id + '/access', 'PATCH', {
    expectedAccessRevision: (await read('users', id)).accessRevision ?? 0, staffDesignation,
  }, actor);
  status(await writeUser('staff', { staffDesignation: 'Nurse' }), 403, 'generic users.manage writes cannot confer clinical access');
  for (const actor of ['staff', 'manager', 'anonymous']) {
    check([401, 403].includes((await request('/api/records/visits', 'POST', visit({ doctorId: null, performedByUserId: 'nurse' }), actor)).status), actor + ' without medical designation cannot gain Visit writes');
  }
  status(await designate('staff', 'Nurse'), 200, 'access administrator designates existing Staff');
  const designatedStaff = await read('users', 'staff');
  check(designatedStaff.role === 'staff' && !designatedStaff.permissionOverrides && designatedStaff.accessRevision === 1, 'designation grants medical defaults without role changes or persisted overrides');
  const designationAudits = (await pool.query("SELECT data FROM app_records WHERE collection_path='audit_logs' AND data->>'eventType'='access_policy_changed' AND data->>'resourceId'='staff'")).rows;
  check(designationAudits.some(row => row.data.changes.some((change: any) => change.field === 'staffDesignation' && change.after === 'Nurse')), 'designation authority is audited atomically');
  status(await request('/api/users/staff/access', 'PATCH', { expectedAccessRevision: 0, staffDesignation: 'Medical Staff' }), 409, 'stale designation revision conflicts');
  status(await designate('medical', 'Nurse', 'staff'), 403, 'ordinary Staff cannot designate someone');
  status(await designate('staff', 'Medical Staff', 'staff'), 403, 'Staff cannot self-designate');
  status(await designate('provider', 'Nurse'), 400, 'designation cannot turn a Doctor into Staff');
  for (const staffDesignation of ['doctor', 'nurse', 'Administrator', {}, ['Nurse']]) {
    status(await designate('undesignated', staffDesignation), 400, 'unapproved designation value rejected');
  }
  status(await designate('undesignated', 'Medical Staff'), 200, 'approved medical designation');
  const designatedId = await createVisit(visit({ doctorId: null, performedByUserId: 'undesignated' }));
  check((await read('visits', designatedId)).performedByDesignationSnapshot === 'Medical Staff', 'server recognizes saved Staff designation');
  status(await designate('undesignated', null), 200, 'designation can be explicitly removed');
  status(await request('/api/records/visits', 'POST', visit({ doctorId: null, performedByUserId: 'undesignated' })), 400, 'designation removal immediately prevents new selection');

  for (const staffDesignation of ['Nurse', 'Medical Staff']) {
    status(await designate('staff', staffDesignation), 200, 'configure synthetic medical workflow designation');
    const booking = appointment({ doctorId: null, status: 'Arrived', mainConcern: 'Synthetic medical concern', notes: 'Synthetic appointment notes' });
    const bookingId = await createAppointment(booking, 'staff');
    const payload = { patientId: booking.patientId, branchId: booking.branchId, visitDate: booking.appointmentDate,
      appointmentId: bookingId, visitType: booking.visitType, doctorId: null, performedByUserId: 'staff', assistingStaffText: 'Synthetic assistant',
      mainConcern: 'Synthetic concern', notes: 'Synthetic Visit notes', diagnosis: 'Synthetic findings', treatmentPlan: 'Synthetic plan' };
    const beforePatient = await read('patients', 'patient');
    const completedId = await createVisit(payload, 'staff');
    const completed = await read('visits', completedId), completedBooking = await read('appointments', bookingId);
    check(completed.doctorId === null && completed.status === 'Completed' && completed.performedByUserId === 'staff'
      && completed.performedByDesignationSnapshot === staffDesignation, staffDesignation + ' completes Visit with own recorded performer and no Doctor');
    check(completedBooking.status === 'Completed' && completedBooking.visitHistoryId === completedId && completedBooking.visitHistoryCreated === true
      && completedBooking.doctorId === null, 'medical Staff completion links appointment atomically without assigning a Doctor');
    check((await read('patients', 'patient')).totalCompletedVisits === beforePatient.totalCompletedVisits + 1, 'medical Staff completion updates patient aggregate once');
    status(await request('/api/records/visits', 'POST', payload, 'staff'), 409, 'medical Staff duplicate completion is rejected');
    status(await request('/api/records/visits/' + completedId, 'PATCH', { ...payload, notes: 'Updated by medical Staff' }, 'staff'), 200, 'medical Staff edits completed Visit through existing workflow');
    const chartPath = '/api/records/visits/' + completedId + '/chart';
    const emptyChart = await request(chartPath, 'GET', undefined, 'staff'); status(emptyChart, 200, 'medical Staff opens own Visit chart');
    check(emptyChart.body.permissions.canEdit && !emptyChart.body.permissions.canSign, 'medical Staff inherits chart drafting, without signing');
    const points = ['face', 'body-front', 'body-back'].map((map, index) => ({ id: 'point-' + index, map, x: 0.4, y: 0.5, label: 'Synthetic point', notes: '' }));
    status(await request(chartPath + '/draft', 'PUT', { expectedVersion: 0, expectedContextKey: emptyChart.body.contextKey, markers: points, notes: 'Medical Staff chart' }, 'staff'), 200, 'medical Staff saves all chart maps');
    const savedChart = (await request(chartPath, 'GET', undefined, 'staff')).body;
    check(savedChart.chart.draft.markers.length === 3 && savedChart.chart.draft.createdBy.uid === 'staff'
      && savedChart.chart.draft.context.performedByDesignationSnapshot === staffDesignation, 'chart reload retains authoritative medical Staff attribution');
    status(await request(chartPath + '/sign', 'POST', { expectedVersion: savedChart.chart.version, expectedContextKey: savedChart.contextKey }, 'staff'), 403, 'medical Staff needs explicit signing grant just like Doctor');
    status(await request('/api/records/visits/' + completedId, 'DELETE', { reason: 'Synthetic attempt' }, 'staff'), 403, 'medical Staff gains no Visit archive authority');
    status(await request('/api/records/visits', 'POST', visit({ branchId: 'B', doctorId: null, performedByUserId: 'medical' }), 'staff'), 403, 'medical Staff defaults cannot expand branch scope');
    const rawChart = JSON.stringify(await read('clinical_charts', completedId));
    status(await designate('staff', 'Reception/Admin Staff'), 200, 'access administrator revokes medical designation');
    status(await request('/api/records/visits/' + completedId, 'PATCH', payload, 'staff'), 403, 'designation loss immediately denies Visit edits');
    status(await request(chartPath + '/draft', 'PUT', { expectedVersion: savedChart.chart.version, expectedContextKey: savedChart.contextKey, markers: [], notes: 'Denied change' }, 'staff'), 403, 'designation loss immediately denies chart changes');
    check(JSON.stringify(await read('clinical_charts', completedId)) === rawChart, 'designation revocation leaves saved chart history exact');
    const historicalChart = await request(chartPath, 'GET', undefined, 'staff');
    status(historicalChart, 200, 'designation loss preserves existing authorized clinical history');
    check(!historicalChart.body.permissions.canEdit, 'former medical Staff remains read-only');
  }
  status(await designate('staff', 'Nurse'), 200, 'restore synthetic medical designation for later denials');
  for (const permission of ['visits.create', 'visits.edit', 'clinical.edit_draft', 'clinical.view']) {
    status(await request('/api/users/staff/access', 'PATCH', { expectedAccessRevision: (await read('users', 'staff')).accessRevision, permissionChanges: { [permission]: 'deny' } }), 200, 'explicit medical Staff denial configured');
    if (permission !== 'visits.edit') status(await request('/api/records/visits', 'POST', visit({ doctorId: null, performedByUserId: 'staff' }), 'staff'), 403, 'explicit denial overrides inherited medical completion');
    else status(await request('/api/records/visits/' + designatedId, 'PATCH', { ...await read('visits', designatedId), performedByNameSnapshot: undefined, performedByRoleSnapshot: undefined, performedByDesignationSnapshot: undefined }, 'staff'), 403, 'explicit denial overrides inherited medical Visit editing');
    status(await request('/api/users/staff/access', 'PATCH', { expectedAccessRevision: (await read('users', 'staff')).accessRevision, permissionChanges: { [permission]: 'inherit' } }), 200, 'restore synthetic inherited permission');
  }
  const queuedPayload = visit({ doctorId: null, performedByUserId: 'nurse' });
  const beforeQueued = (await db.collection('visits').get()).docs.length;
  const previousRun = db.runTransaction;
  let revokedDesignation = false;
  db.runTransaction = async callback => {
    if (!revokedDesignation) { revokedDesignation = true; await previousRun(async tx => tx.update(db.collection('users').doc('staff'), { staffDesignation: 'Reception/Admin Staff' })); }
    return previousRun(callback);
  };
  try { status(await request('/api/records/visits', 'POST', queuedPayload, 'staff'), 403, 'queued medical Staff completion rechecks current designation under transaction lock'); }
  finally { db.runTransaction = previousRun; }
  check((await db.collection('visits').get()).docs.length === beforeQueued, 'queued designation denial leaves no partial Visit');
  status(await request('/api/records/visits', 'POST', visit({ doctorId: null, performedByUserId: 'nurse' }), 'doctor'), 403, 'Doctor cannot create a nurse-led Visit without own doctor association');
  status(await request('/api/records/visits', 'POST', visit({ doctorId: 'provider', performedByUserId: 'provider' }), 'doctor'), 403, 'Doctor cannot spoof another doctor ownership');
  const ownDoctorNurse = await createVisit(visit({ doctorId: 'doctor', performedByUserId: 'nurse' }), 'doctor');
  check((await read('visits', ownDoctorNurse)).doctorId === 'doctor' && (await read('visits', ownDoctorNurse)).performedByUserId === 'nurse', 'Doctor may record actual nurse performer under existing own-doctor association');
  status(await request('/api/records/visits/' + nurseVisitId, 'PATCH', unchangedNurseEdit, 'doctor'), 403, 'Doctor cannot edit unrelated nurse-led Visit');
  status(await request('/api/users/staff/access', 'PATCH', { expectedAccessRevision: (await read('users', 'staff')).accessRevision ?? 0, permissionChanges: { 'clinical.view': 'deny' } }), 200, 'synthetic Staff clinical denial fixture');
  const operationalVisit = await request('/api/data/query', 'POST', { path: 'visits/' + nurseVisitId, kind: 'document' }, 'staff');
  status(operationalVisit, 200, 'clinically denied Staff keeps authorized operational Visit');
  check(operationalVisit.body.document.data.performedByNameSnapshot === 'Medical Person' && !Object.hasOwn(operationalVisit.body.document.data, 'assistingStaffText'), 'performer operational attribution visible while assisting narrative remains clinically protected');
  status(await request('/api/data/query', 'POST', { path: 'visits', kind: 'collection', constraints: [{ type: 'where', field: 'assistingStaffText', operator: '==', value: 'Alice Example, Bob Example' }] }, 'staff'), 403, 'clinical-denied reader cannot infer assisting narrative via query');
  status(await request('/api/users/staff/access', 'PATCH', { expectedAccessRevision: (await read('users', 'staff')).accessRevision ?? 0, permissionChanges: { 'clinical.view': 'inherit' } }), 200, 'restore synthetic Staff clinical default');
  status(await request('/api/records/visits', 'POST', visit({ branchId: 'C', doctorId: null, performedByUserId: 'nurse' })), 400, 'nurse Visit requires active branch');
  await db.collection('users').doc('doctor').update({ assignedBranches: ['A'] });
  status(await request('/api/records/visits', 'POST', visit({ branchId: 'B', doctorId: null, performedByUserId: 'doctor' }), 'doctor'), 403, 'performer selection cannot widen actor branch scope');
  for (const performedByUserId of ['missing', 'outside', 'reception']) {
    status(await request('/api/records/visits', 'POST', visit({ branchId: 'B', doctorId: null, performedByUserId }), 'doctor'), 403, 'unauthorized branch denied before performer lookup');
  }
  const ownPrior = JSON.stringify(await read('visits', ownLinkedVisit));
  status(await request('/api/records/visits/' + ownLinkedVisit, 'PATCH', visit({ branchId: 'B', doctorId: 'doctor', performedByUserId: 'missing', visitDate: (await read('visits', ownLinkedVisit)).visitDate } ), 'doctor'), 403, 'unauthorized edit branch denied before performer lookup');
  check(JSON.stringify(await read('visits', ownLinkedVisit)) === ownPrior, 'unauthorized branch edit preserves original Visit');
  await db.collection('users').doc('doctor').update({ assignedBranches: ['A', 'B'] });
  for (const mode of ['create', 'update', 'set']) {
    status(await request('/api/data/write', 'POST', { operations: [{ path: 'visits/' + nurseVisitId, mode, data: { performedByUserId: 'provider' } }] }), 403, 'generic Visit write cannot bypass performer validation');
  }

  // Fresh authority and performer eligibility must be reloaded under the lock.
  const originalTransaction = db.runTransaction;
  for (const narrowing of [{ active: false }, { assignedBranches: ['B'] }, { staffDesignation: 'Reception/Admin Staff' }]) {
    await db.collection('users').doc('medical').update({ active: true, assignedBranches: ['A', 'B'], staffDesignation: 'Medical Staff' });
    let intercepted = false;
    db.runTransaction = async callback => {
      if (!intercepted) { intercepted = true; await originalTransaction(async transaction => { transaction.update(db.collection('users').doc('medical'), narrowing); }); }
      return originalTransaction(callback);
    };
    try { status(await request('/api/records/visits', 'POST', visit({ doctorId: null, performedByUserId: 'medical' })), 400, 'transactional performer eligibility loss denied'); }
    finally { db.runTransaction = originalTransaction; }
  }
  await db.collection('users').doc('medical').update({ active: true, assignedBranches: ['A', 'B'], staffDesignation: 'Medical Staff' });
  let denied = false;
  db.runTransaction = async callback => {
    if (!denied) { denied = true; await originalTransaction(async transaction => { transaction.update(db.collection('users').doc('staff'), { assignedBranches: [] }); }); }
    return originalTransaction(callback);
  };
  try { status(await request('/api/records/appointments', 'POST', appointment({ doctorId: null }), 'staff'), 403, 'queued unassigned booking rechecks actor branch authority'); }
  finally { db.runTransaction = originalTransaction; }
  await db.collection('users').doc('staff').update({ assignedBranches: ['A'] });
  const recordsBefore = JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path IN ('appointments','visits') ORDER BY collection_path,id")).rows);
  await migrateDatabase();
  check(recordsBefore === JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path IN ('appointments','visits') ORDER BY collection_path,id")).rows), 'migration rerun preserves legacy and new JSONB exactly');
  check(await assertCurrentMigrationChain(), 'performer workflow preserves the current migration chain');
  console.log(`Appointment and Visit performers API: ${checks} checks passed (disposable synthetic database)`);
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool.end();
}
