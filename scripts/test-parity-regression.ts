import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
import { normalizeMediaSettings } from '../src/mediaSettings';
import { shouldRecordAuditEvent } from '../src/auditPolicy';
import { shouldRecordLoginActivity } from '../src/loginActivityPolicy';

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
async function query(path: string, role = 'staff', kind = 'collection') {
  const r = await request('/api/data/query', { path, kind, constraints: [] }, role);
  check(r.status === 200, `${role}: ${path} read authorized`); return r.json();
}
async function upload(name: string, bytes: Uint8Array, mime: string, role = 'support_developer') {
  const c = credentials.get(role)!;
  const form = new FormData(); form.append('file', new Blob([Buffer.from(bytes)], { type: mime }), name);
  form.append('patientId', 'patient-A'); form.append('resourceType', 'patient'); form.append('resourceId', 'patient-A');
  return fetch(`http://127.0.0.1:${(server!.address() as any).port}/api/attachments/upload`, {
    method: 'POST', headers: { Origin: origin, Cookie: c.cookie, Authorization: `Bearer ${c.csrf}` }, body: form });
}
const policy = { allowedExtensions: ['.png', '.jpg', '.pdf'], maxFileSizeMB: 1, maxFilesPerRecord: 5 };
try {
  await migrateDatabase(); // Initialize only the guarded disposable test schema.
  await pool.query('TRUNCATE app_records, auth_sessions, auth_identities, oauth_attempts');
  for (const branch of ['A', 'B']) await db.collection('branches').doc(branch).set({ branchName: `Synthetic ${branch}`, status: 'Active' });
  for (const role of ['admin', 'doctor', 'staff', 'manager', 'support_developer']) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(role).set({ role, active: true, assignedBranches: role === 'doctor' ? ['A', 'B'] : ['A'], fullName: `Synthetic ${role}` });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [role, `${role}@example.invalid`]);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), role, csrf]);
    credentials.set(role, { cookie: `${origin.startsWith('https:') ? '__Host-vine_session' : 'vine_session'}=${token}`, csrf });
  }
  for (const branch of ['A', 'B']) await db.collection('patients').doc(`patient-${branch}`).set({ name: `Synthetic Patient ${branch}`, homeBranchId: branch, status: 'Active' });
  await db.collection('settings').doc('media').set(policy);
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  for (const role of ['staff', 'manager', 'doctor', 'admin', 'support_developer']) {
    const patients = await query('patients', role);
    check(patients.documents.length === 2, `${role}: shared patient directory still spans A/B`);
    const direct = await query('patients/patient-B', role, 'document');
    check(direct.document.data.homeBranchId === 'B', `${role}: existing shared patient direct read preserved`);
    check((await query('branches', role)).documents.length === 2, `${role}: shared branch directory preserved`);
    check((await query('users', role)).documents.length === 5, `${role}: shared user directory preserved`);
  }
  const booking = { patientId: 'patient-A', branchId: 'A', doctorId: 'doctor', appointmentDate: '2035-01-01T10:00', visitType: 'Initial Consultation', status: 'Arrived', mainConcern: 'Synthetic', notes: 'Synthetic clinical notes' };
  const booked = await request('/api/records/appointments', booking, 'doctor'); check(booked.status === 201, 'Authorized doctor appointment creation');
  const appointmentId = (await booked.json()).id;
  const visit = { ...booking, appointmentId, visitDate: booking.appointmentDate, diagnosis: 'Synthetic assessment', treatmentPlan: 'Synthetic plan' };
  const encountered = await request('/api/records/visits', visit, 'doctor'); check(encountered.status === 201, 'Linked clinical visit creation');
  const visitId = (await encountered.json()).id;
  await db.collection('visits').doc('synthetic-visit-B').set({ patientId: 'patient-B', branchId: 'B', doctorId: 'doctor', visitDate: '2035-01-02T10:00', status: 'Completed' });
  for (const role of ['staff', 'manager', 'doctor', 'admin', 'support_developer']) {
    const visits = await query('visits', role);
    check(visits.documents.length === 2, `${role}: shared clinical reads do not acquire new branch restriction`);
    check((await query('visits/synthetic-visit-B', role, 'document')).document.data.patientId === 'patient-B', `${role}: shared clinical direct relationship retained`);
  }
  const appt = (await query(`appointments/${appointmentId}`, 'doctor', 'document')).document.data;
  check(appt.visitHistoryId === visitId && appt.visitHistoryCreated === true && appt.patientId === 'patient-A', 'Appointment links to correct visit and patient');
  check((await db.collection('patients').doc('patient-A').get()).data()?.totalVisits === 1, 'Clinical patient summary correct');
  for (const kind of ['patients', 'appointments', 'visits']) {
    const id = kind === 'patients' ? 'patient-B' : kind === 'appointments' ? appointmentId : visitId;
    check((await request(`/api/records/${kind}/${id}`, { reason: 'Synthetic archive' }, 'staff', 'DELETE')).status === 403, `Staff ${kind} archive remains denied`);
    check((await request(`/api/records/${kind}/${id}/restore`, {}, 'staff')).status === 403, `Staff ${kind} restore remains denied`);
  }
  check((await request(`/api/records/visits/${visitId}`, { reason: 'Synthetic archive' }, 'support_developer', 'DELETE')).status === 200, 'Legacy support clinical archive allowed');
  check((await db.collection('patients').doc('patient-A').get()).data()?.totalVisits === 0, 'Archive recomputes patient history');
  check((await request(`/api/records/visits/${visitId}/restore`, {}, 'support_developer')).status === 200, 'Legacy support clinical restore allowed');
  check((await db.collection('patients').doc('patient-A').get()).data()?.totalVisits === 1, 'Restore recomputes patient history without duplicates');
  const png = Buffer.from([137,80,78,71,13,10,26,10]); const jpeg = Buffer.from([255,216,255]); const pdf = Buffer.from('%PDF-1.4\nSynthetic');
  for (const [name, bytes, mime] of [['synthetic.PNG', png, 'application/octet-stream'], ['synthetic.jpg', jpeg, 'text/plain'], ['synthetic.pdf', pdf, 'application/pdf']] as const) {
    const r = await upload(name, bytes, mime); check(r.status === 201, `${name}: signature-based canonical policy upload`);
    const { attachment } = await r.json();
    const downloaded = await request(`/api/attachments/content?path=${encodeURIComponent(attachment.storagePath)}`, null, 'staff', 'GET');
    check(downloaded.status === 200 && Buffer.from(await downloaded.arrayBuffer()).equals(bytes), 'Shared authorized patient file access preserved');
    check((await request('/api/attachments', { storagePath: attachment.storagePath }, 'support_developer', 'DELETE')).status === 204, 'Legacy support file deletion audited and allowed');
  }
  check((await upload('synthetic.jpeg', jpeg, 'image/jpeg')).status === 400, 'Production saved whitelist rejects jpeg extension');
  check((await upload('synthetic.webp', Buffer.from('RIFFxxxxWEBP'), 'image/webp')).status === 400, 'Production saved whitelist rejects webp extension');
  check((await upload('synthetic.png', pdf, 'image/png')).status === 400, 'Declared MIME cannot bypass signature check');
  check((await upload('synthetic.pdf', Buffer.concat([pdf, Buffer.alloc(1024 * 1024)]), 'application/pdf')).status === 400, 'Canonical one MB file limit');
  check((await upload('synthetic.png', Buffer.concat([png, Buffer.alloc(500 * 1024)]), 'image/png')).status === 400, 'Separate 500 KB image ceiling');
  for (let n = 0; n < 5; n++) check((await upload(`count-${n}.pdf`, pdf, 'application/pdf')).status === 201, 'Attachment below count limit');
  check((await upload('sixth.pdf', pdf, 'application/pdf')).status === 409, 'Canonical five-file count limit');
  const normalized = normalizeMediaSettings({ allowedExtensions: [' PNG ', 'JPG', '.pdf', '.PDF'], maxFileSizeMB: 1, maxFilesPerAppointment: 5, maxSizeMB: 3 });
  assert.deepEqual(normalized, policy); checks++;
  check((await request('/api/data/write', { operations: [{ path: 'settings/footer', mode: 'set', data: { footerText: 'Synthetic legal text' } }] }, 'support_developer')).status === 200, 'Legacy support settings mutation allowed');
  check((await request('/api/data/write', { operations: [{ path: 'users/staff', mode: 'update', data: { assignedBranches: ['A', 'B'] } }] }, 'support_developer')).status === 200, 'Legacy support access administration allowed');
  check((await request('/api/data/write', { operations: [{ path: 'patients/patient-A/privateNotes', mode: 'create', data: { note: 'Synthetic private note' } }] }, 'support_developer')).status === 400, 'Malformed private-note document path rejected');
  check((await request('/api/data/write', { operations: [{ path: 'patients/patient-A/privateNotes/synthetic', mode: 'create', data: { note: 'Synthetic private note' } }] }, 'support_developer')).status === 200, 'Legacy support private note mutation allowed');
  const logs = (await db.collection('audit_logs').get()).docs.map(d => d.data()!);
  for (const event of ['record_archived', 'record_restored', 'attachment_uploaded', 'attachment_deleted']) check(logs.some(l => l.userRole === 'support_developer' && l.eventType === event), `${event} cannot disappear under legacy support exemption`);
  for (const resource of ['User', 'Settings', 'Patient']) check(logs.some(l => l.userRole === 'support_developer' && l.resource === resource && l.eventType === 'configuration_or_note_changed'), `Legacy support ${resource} configuration/note mutation audited`);
  for (const role of ['support_developer', 'SUPPORT_DEVELOPER']) {
    for (const resource of ['Patient', 'Appointment', 'Visit', 'Settings', 'User'] as const) for (const action of ['CREATE', 'UPDATE', 'DELETE'] as const) check(shouldRecordAuditEvent({ actorRole: role, resource, action }), `${role}: ${resource} ${action} not exempt`);
    check(!shouldRecordAuditEvent({ actorRole: role, resource: 'Patient', action: 'VIEW' }), 'Routine clinical view exemption shared across roles');
    check(shouldRecordAuditEvent({ actorRole: role, resource: 'Settings', action: 'VIEW', eventType: 'developer_metrics_view' }), 'Developer diagnostics remain audited');
  }
  check(!shouldRecordLoginActivity('support_developer') && shouldRecordLoginActivity('SUPPORT_DEVELOPER'), 'Existing login alias discrepancy documented without changing policy');
  console.log(`${checks} parity/shared clinical/upload/audit regression checks passed (disposable PostgreSQL and files).`);
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool.end();
}
