import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { developmentAccessEnabled } from '../backend/developmentAccess';
import { SUPPORT_DEVELOPER, RBAC, hasPermission, canAccessView, getPatientEditScope } from '../src/rbac';

// Real Express routes and cookie/CSRF authorization; all persistence and session
// rows are in memory. This test never creates identities/sessions in a database.
const testStorage = await mkdtemp(join(tmpdir(), 'vine-support-access-'));
process.env.STORAGE_DIR = testStorage;
process.env.NODE_ENV = 'development';
process.env.APP_URL = 'http://localhost:3000';
process.env.DATABASE_URL = 'postgresql://vine_dev@127.0.0.1/vine_development';
const { db, pool, RecordQuery, DocumentReference, DocumentSnapshot, QuerySnapshot, resolveData } = await import('../backend/database');
const originalQuery = RecordQuery.prototype.get;
const originalDocument = DocumentReference.prototype.get;
const originalTransaction = db.runTransaction;
const originalSql = pool.query;
const records = new Map<string, any>();
const sessions = new Map<string, { uid: string; csrf: string }>();
const tokens: Record<string, { cookie: string; csrf: string }> = {};
let checks = 0;
let beforeTransaction: (() => void) | null = null;
const put = (path: string, data: any) => records.set(path, structuredClone(data));
const get = (path: string) => structuredClone(records.get(path));
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; };
for (const role of Object.keys(RBAC)) {
  const uid = `test-${role}`;
  put(`users/${uid}`, { role, active: true, fullName: `Synthetic ${role}`, email: `${role}@example.invalid`, assignedBranches: ['demo-branch'] });
  const token = Buffer.alloc(32, Object.keys(tokens).length + 1).toString('base64url');
  const csrf = `csrf-${role}`;
  sessions.set(createHash('sha256').update(token).digest('hex'), { uid, csrf });
  tokens[role] = { cookie: `vine_session=${token}`, csrf };
}
put('branches/demo-branch', { branchName: 'Demo', status: 'Active' });
put('branches/acceptance-branch-b', { branchName: 'Restricted B', status: 'Active' });
put('users/doctor-a', { role: 'doctor', active: true, fullName: 'Demo Doctor', assignedBranches: ['demo-branch'], email: 'hidden@example.invalid', contactNumber: 'hidden' });
put('users/doctor-b', { role: 'doctor', active: true, assignedBranches: ['acceptance-branch-b'] });
put('patients/patient-a', { name: 'Synthetic Patient A', patientID: 'TEST-A', homeBranchId: 'demo-branch', allergies: 'secret', notes: 'secret', attachments: ['secret'], totalVisits: 99 });
put('patients/patient-b', { name: 'Synthetic Patient B', homeBranchId: 'acceptance-branch-b' });
put('patients/malformed', { name: 'Malformed', homeBranchId: ['demo-branch'] });
const appointment = { patientId: 'patient-a', patientName: 'Synthetic Patient A', branchId: 'demo-branch', doctorId: 'doctor-a', appointmentDate: '2026-10-20T10:00', visitType: 'Initial Consultation', status: 'Scheduled', mainConcern: 'secret', notes: 'secret', attachments: ['secret'] };
put('appointments/appointment-a', appointment);
put('appointments/appointment-b', { ...appointment, patientId: 'patient-b', branchId: 'acceptance-branch-b', doctorId: 'doctor-b' });
put('visits/visit-a', { patientId: 'patient-a', branchId: 'demo-branch', diagnosis: 'secret' });
put('settings/branding', { maintenanceMode: false });
put('users/pending-support', { role: SUPPORT_DEVELOPER, active: false, accountStatus: 'pending_activation', assignedBranches: ['demo-branch'], synthetic: true });

DocumentReference.prototype.get = async function () { return new DocumentSnapshot(this.id, get(this.path)); };
RecordQuery.prototype.get = async function () {
  let rows = [...records].filter(([path]) => path.slice(0, path.lastIndexOf('/')) === this.collectionPath)
    .map(([path, data]) => ({ id: path.slice(path.lastIndexOf('/') + 1), data: structuredClone(data) }));
  if (this.ids) rows = rows.filter(row => this.ids!.includes(row.id));
  for (const [field, operator, value] of this.filters) rows = rows.filter(({ data }) => {
    const actual = data[field];
    if (operator === 'string-in') return typeof actual === 'string' && value.includes(actual);
    if (operator === 'in') return value.includes(actual);
    if (operator === '==') return JSON.stringify(actual) === JSON.stringify(value);
    if (operator === '!=') return actual !== value;
    if (operator === '>=') return actual >= value;
    if (operator === '<') return actual < value;
    if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(value);
    throw new Error(`Unexpected filter ${operator}`);
  });
  rows.sort((a, b) => this.ordering ? String(a.data[this.ordering[0]]).localeCompare(String(b.data[this.ordering[0]])) * (this.ordering[1] === 'desc' ? -1 : 1) : a.id.localeCompare(b.id));
  if (this.maximum !== undefined) rows = rows.slice(0, this.maximum);
  return new QuerySnapshot(rows.map(row => new DocumentSnapshot(row.id, row.data)));
};
db.runTransaction = (async (callback: any) => {
  beforeTransaction?.(); beforeTransaction = null;
  const staged: (() => void)[] = [];
  const tx: any = { get: (ref: any) => ref.get(), sql: async (sql: string, values: any[]) => {
    if (sql.includes('FROM auth_sessions s')) return pool.query(sql, values);
    if (sql === 'SELECT 1 FROM service_branch_settings WHERE branch_id=$1 LIMIT 1') return { rows: [] }; // No service fixtures in this in-memory suite.
    if (sql.includes('SELECT 1 FROM auth_identities')) return pool.query(sql, values);
    if (!sql.startsWith('DELETE FROM auth_')) throw new Error('Unexpected mutation SQL');
    if (sql.startsWith('DELETE FROM auth_sessions')) staged.push(() => {
      for (const [token, session] of sessions) if (session.uid === values[0]) sessions.delete(token);
    });
    return { rows: [] };
  } };
  for (const mode of ['create', 'update', 'set']) tx[mode] = (ref: any, data: any, options?: any) => {
    staged.push(() => put(ref.path, resolveData(data, mode === 'update' || options?.merge ? get(ref.path) : {}))); return tx;
  };
  tx.delete = (ref: any) => staged.push(() => records.delete(ref.path));
  const result = await callback(tx); staged.forEach(apply => apply()); return result;
}) as any;
pool.query = (async (sql: string, values: any[]) => {
  if (sql.includes('FROM auth_sessions s')) {
    const session = sessions.get(values[0]);
    return { rows: session ? [{ user_id: session.uid, csrf_token: session.csrf, email: get(`users/${session.uid}`).email, google_subject: `synthetic-${session.uid}`, data: get(`users/${session.uid}`) }] : [] };
  }
  if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: [...records.keys()].filter(path => path.slice(0, path.lastIndexOf('/')) === values[0]).length }] };
  if (sql.startsWith('DELETE FROM auth_sessions')) return { rows: [] };
  if (sql.includes('SELECT 1 FROM auth_identities')) return { rows: [...sessions.values()].some(session => session.uid === values[0]) ? [{}] : [] };
  if (sql.includes('SELECT csrf_token FROM auth_sessions')) return { rows: [{ csrf_token: sessions.get(values[0])!.csrf }] };
  throw new Error(`Unexpected SQL in in-memory test: ${sql}`);
}) as any;
const { app } = await import('../server');
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function request(path: string, body?: any, role = SUPPORT_DEVELOPER as string, method = 'POST', extra: Record<string, string> = {}) {
  const token = tokens[role];
  const response = await fetch(base + path, { method, headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(token ? { Cookie: token.cookie, Authorization: `Bearer ${token.csrf}` } : {}), ...extra }, ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {}) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
const query = (path: string, constraints: any[] = [], kind = 'collection', role = SUPPORT_DEVELOPER as string) => request('/api/data/query', { path, kind, constraints }, role);
try {
  check(developmentAccessEnabled(), 'Isolated development enabled');
  for (const env of [{ NODE_ENV: 'production' }, { DATABASE_URL: 'postgresql://vine_prod@127.0.0.1/vine_production' }, { APP_URL: 'https://production.example.invalid' }]) check(!developmentAccessEnabled({ ...process.env, ...env }), 'Production/unknown environment fails closed');
  check(getPatientEditScope(SUPPORT_DEVELOPER) === 'full', 'Full patient edit scope');
  for (const module of ['patientRecord', 'appointment', 'visitHistory'] as const) for (const permission of ['read', 'create', 'update', 'delete'] as const) check(hasPermission(SUPPORT_DEVELOPER, module, permission), `${module}/${permission} granted`);
  for (const view of ['BranchDashboard', 'Records', 'Appointments', 'Settings', 'Insights', 'Inventory', 'DeveloperTools', 'AuditTrail', 'VisitHistory', 'Profile', 'AccountSettings']) check(canAccessView(SUPPORT_DEVELOPER, view), `${view} available`);
  check((await request('/api/auth/session', undefined, SUPPORT_DEVELOPER, 'GET')).status === 200, 'Existing authenticated session accepted');
  check((await query('appointments', [], 'collection', 'anonymous')).status === 401, 'Unauthenticated reads rejected');
  check((await request('/api/data/query', { kind: 'collection', path: 'appointments' }, SUPPORT_DEVELOPER, 'POST', { Authorization: '' })).status >= 400, 'CSRF enforced');
  check((await request('/api/data/query', { kind: 'collection', path: 'appointments' }, SUPPORT_DEVELOPER, 'POST', { Origin: 'http://evil.invalid' })).status === 403, 'Origin enforced');
  for (const role of ['admin', 'support_developer', SUPPORT_DEVELOPER]) {
    check((await query('branches', [], 'collection', role)).body.documents.length === 2, `${role} sees all branches`);
    check((await query('appointments', [], 'collection', role)).body.documents.length === 2, `${role} sees all appointments`);
  }
  check((await query('appointments', [], 'collection', 'staff')).body.documents.length === 1, 'Staff appointment restrictions preserved');
  check((await query('appointments/appointment-b', [], 'document', 'staff')).status === 403, 'Staff direct unauthorized record rejected');
  check((await query('patients', [], 'collection', 'staff')).body.documents.length === 3, 'Legacy staff patient continuity preserved');
  check((await query('branches/acceptance-branch-b', [], 'document')).status === 200, 'Other branch direct read available');
  check((await query('appointments/appointment-b', [], 'document')).body.document.data.notes === 'secret', 'Other branch appointment and clinical fields available');
  check((await query('appointments', [{ type: 'where', field: 'branchId', operator: '==', value: 'acceptance-branch-b' }])).body.documents.length === 1, 'Global role can query any branch');
  check((await query('patients/patient-b', [], 'document')).status === 200, 'Other branch patient available');
  check((await query('patients/patient-a', [], 'document')).body.document.data.allergies === 'secret', 'Clinical patient fields available');
  check((await request('/api/patients', undefined, SUPPORT_DEVELOPER, 'GET')).body.length === 3, 'REST patient list retains full developer access');
  check((await query('users')).body.documents.some((doc: any) => doc.id === 'doctor-b'), 'Full user directory available');
  for (const collection of ['visits', 'patients/patient-a/privateNotes', 'audit_logs', 'inventory_items', 'inventory_stocks', 'suppliers', 'stock_transfers']) check((await query(collection)).status === 200, `${collection} available`);
  const write = (operation: any) => request('/api/data/write', { operations: [operation] });
  check((await request('/api/data/write', { operations: [{ path: 'users/test-staff', mode: 'update', data: { role: SUPPORT_DEVELOPER } }] }, 'admin')).status === 403, 'Admin cannot grant developer role from submitted selector value');
  check((await request('/api/data/write', { operations: [{ path: 'users/test-staff', mode: 'update', data: { role: SUPPORT_DEVELOPER } }] }, 'staff')).status === 403, 'Staff cannot grant developer role from submitted selector value');
  check((await request('/api/users/test-staff/access', { expectedAccessRevision: 0, role: 'manager' }, SUPPORT_DEVELOPER, 'PATCH')).status === 200, 'Role administration available');
  check((await request('/api/users/test-staff/access', { expectedAccessRevision: 1, assignedBranches: ['demo-branch', 'acceptance-branch-b'] }, SUPPORT_DEVELOPER, 'PATCH')).status === 200, 'Branch assignment administration available');
  check((await write({ path: `users/test-${SUPPORT_DEVELOPER}`, mode: 'update', data: { role: 'admin' } })).status === 403, 'Own-role change safeguard preserved');
  check((await request('/api/users/test-support_developer/access', { expectedAccessRevision: 0, assignedBranches: ['demo-branch'] }, SUPPORT_DEVELOPER, 'PATCH')).status === 200, 'Developer can manage legacy developer profiles');
  for (const setting of ['branding', 'timezone', 'footer', 'media']) check((await write({ path: `settings/${setting}`, mode: 'set', merge: true, data: setting === 'branding' ? { appName: 'Test Vine' } : { developmentTest: true } })).status === 200, `${setting} configuration available`);
  check((await write({ path: 'settings/branding', mode: 'update', data: { maintenanceMode: true } })).status === 403, 'Maintenance must use dedicated validated endpoint');
  check((await write({ path: 'branches/unused', mode: 'create', data: { branchName: 'Synthetic Branch', status: 'Active' } })).status === 200, 'Branch creation available');
  check((await write({ path: 'branches/unused', mode: 'delete' })).status === 200, 'Unlinked branch deletion available');
  check((await write({ path: 'branches/demo-branch', mode: 'delete' })).status === 403, 'Linked branch deletion invariant preserved');
  check((await write({ path: 'patients/patient-a/privateNotes/test-note', mode: 'create', data: { note: 'Synthetic clinical note' } })).status === 200, 'Private clinical notes available');
  check((await write({ path: 'patients/patient-a', mode: 'update', data: { name: 'Bypass' } })).status === 403, 'Dedicated clinical record validation still required');
  check((await request('/api/login-activity', undefined, SUPPORT_DEVELOPER, 'GET')).status === 200, 'Login activity administration available');
  put('users/lifecycle', { role: 'staff', active: false, accountStatus: 'pending_activation', assignedBranches: ['demo-branch'] });
  for (const action of ['activate', 'deactivate', 'archive', 'restore']) check((await request(`/api/users/lifecycle/${action}`)).status === 200, `User ${action} available`);
  check((await request('/api/users/lifecycle', undefined, SUPPORT_DEVELOPER, 'DELETE')).status === 204, 'User deletion available');
  check((await request(`/api/users/test-${SUPPORT_DEVELOPER}/deactivate`)).status === 403, 'Own-account deactivation invariant preserved');
  check((await request('/api/users/pending-support/activate')).status === 400, 'Prepared identity cannot bypass Google verification');
  check((await request('/api/users/test-support_developer/deactivate', {}, 'admin')).status === 403, 'Administrator legacy developer safeguard preserved');

  const patientPayload = { name: 'Synthetic Full Developer Patient', email: 'full-developer@example.invalid', contactNumber: '+639171234567', gender: 'Female', address: 'Test Address', mainConcern: 'Synthetic concern', birthday: '1990-01-01', homeBranchId: 'acceptance-branch-b', status: 'Active' };
  const patient = await request('/api/records/patients', patientPayload);
  check(patient.status === 201, 'Patient creation in any branch available');
  const patientId = patient.body.id;
  check((await request(`/api/records/patients/${patientId}`, { ...patientPayload, mainConcern: 'Updated synthetic concern' }, SUPPORT_DEVELOPER, 'PATCH')).status === 200, 'Full clinical patient editing available');
  check((await request(`/api/records/patients/${patientId}`, { reason: 'Synthetic test' }, SUPPORT_DEVELOPER, 'DELETE')).status === 200, 'Patient archive available');
  check((await request(`/api/records/patients/${patientId}/restore`)).status === 200, 'Patient restore available');
  const payload = { ...appointment, patientId, branchId: 'acceptance-branch-b', doctorId: 'doctor-b', appointmentDate: '2026-10-21T10:00', status: 'Arrived' };
  const created = await request('/api/records/appointments', payload);
  check(created.status === 201, 'Other branch appointment creation with clinical notes available');
  const id = created.body.id;
  check((await request(`/api/records/appointments/${id}`, { ...payload, notes: 'Edited clinical notes' }, SUPPORT_DEVELOPER, 'PATCH')).status === 200, 'Clinical appointment editing available');
  check((await request(`/api/records/appointments/${id}`, { reason: 'Synthetic test' }, SUPPORT_DEVELOPER, 'DELETE')).status === 200, 'Other branch appointment archive available');
  check((await request(`/api/records/appointments/${id}/restore`)).status === 200, 'Appointment restore available');
  const visitPayload = { patientId, branchId: 'acceptance-branch-b', doctorId: 'doctor-b', visitDate: payload.appointmentDate, appointmentId: id, visitType: 'Initial Consultation', mainConcern: 'Concern', notes: 'Clinical notes', diagnosis: 'Synthetic diagnosis', treatmentPlan: 'Synthetic plan', visitOutcome: 'Completed' };
  const visit = await request('/api/records/visits', visitPayload);
  check(visit.status === 201, 'Linked clinical visit creation in any branch available');
  check((await request(`/api/records/visits/${visit.body.id}`, { ...visitPayload, diagnosis: 'Updated diagnosis' }, SUPPORT_DEVELOPER, 'PATCH')).status === 200, 'Clinical visit editing available');
  check((await request(`/api/records/visits/${visit.body.id}`, { reason: 'Synthetic test' }, SUPPORT_DEVELOPER, 'DELETE')).status === 200, 'Clinical visit archive available');
  check((await request(`/api/records/visits/${visit.body.id}/restore`)).status === 200, 'Clinical visit restore available');

  const credential = tokens[SUPPORT_DEVELOPER];
  const form = new FormData(); form.append('file', new Blob(['%PDF-1.4\nSynthetic developer test attachment'], { type: 'application/pdf' }), 'test.pdf');
  form.append('patientId', patientId); form.append('resourceType', 'visit'); form.append('resourceId', visit.body.id);
  const upload = await fetch(base + '/api/attachments/upload', { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: credential.cookie, Authorization: `Bearer ${credential.csrf}` }, body: form });
  check(upload.status === 201, 'Clinical attachment upload available');
  const uploadBody = await upload.json();
  const storagePath = uploadBody.attachment.storagePath;
  const download = await fetch(base + '/api/attachments/content?path=' + encodeURIComponent(storagePath), { headers: { Cookie: credential.cookie, Authorization: `Bearer ${credential.csrf}` } });
  check(download.status === 200 && (await download.text()).startsWith('%PDF'), 'Clinical attachment content available');
  check((await request('/api/attachments', { storagePath }, SUPPORT_DEVELOPER, 'DELETE')).status === 204, 'Clinical attachment deletion available');
  const brandingForm = new FormData(); brandingForm.append('folder', 'test');
  brandingForm.append('file', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'test.png');
  check((await fetch(base + '/api/branding/upload', { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: credential.cookie, Authorization: `Bearer ${credential.csrf}` }, body: brandingForm })).status === 200, 'Branding upload permission available');
  check((await write({ path: 'inventory_items/item', mode: 'create', data: { name: 'Synthetic item', sku: 'SYNTHETIC', lowStockThreshold: 1 } })).status === 200, 'Inventory item creation available');
  check((await write({ path: 'suppliers/supplier', mode: 'create', data: { name: 'Synthetic supplier' } })).status === 200, 'Supplier creation available');
  put('inventory_stocks/source', { itemId: 'item', branchId: 'demo-branch', quantity: 10 });
  const transfer = await request('/api/inventory/transfers/create', { itemId: 'item', fromBranchId: 'demo-branch', toBranchId: 'acceptance-branch-b', quantity: 3 });
  check(transfer.status === 200, 'Cross-branch stock transfer creation available');
  check((await request('/api/inventory/transfers/complete', { id: transfer.body.id })).status === 200 && get('inventory_stocks/source').quantity === 7, 'Stock transfer completion works');

  const metrics = await request('/api/developer/metrics', undefined, SUPPORT_DEVELOPER, 'GET');
  check(metrics.status === 200 && ['users', 'patients', 'appointments', 'visits'].every(field => Number.isInteger(metrics.body[field])), 'All four Developer count tools work');
  check((await request('/api/developer/diagnostics')).status === 200, 'Developer database diagnostics work');
  for (const event of ['developer_cache_cleared', 'developer_settings_refreshed', 'developer_fault_simulated']) check((await request('/api/developer/activity', { event })).status === 201, `${event} audit activity works`);
  check((await request('/api/developer/maintenance', { maintenanceMode: true })).status === 200, 'Developer can enable maintenance');
  check((await request('/api/developer/diagnostics')).status === 200, 'Developer bypass works while maintenance active');
  check((await request('/api/records/patients', { ...patientPayload, email: 'blocked@example.invalid' }, 'doctor')).status === 503, 'Maintenance still blocks ordinary roles');
  check((await request('/api/developer/maintenance', { maintenanceMode: false })).status === 200, 'Developer can end maintenance');
  for (const role of ['admin', 'staff', 'doctor', 'manager']) check((await request('/api/developer/diagnostics', {}, role)).status === 403, `${role} does not inherit Developer tools`);
  check((await request('/api/developer/diagnostics', {}, 'support_developer')).status === 200, 'Legacy Developer diagnostics preserved');
  check((await query('audit_logs')).body.documents.some((doc: any) => doc.data.eventType === 'developer_maintenance_changed'), 'Developer activities remain audited');

  const supportPath = `users/test-${SUPPORT_DEVELOPER}`, support = get(supportPath);
  beforeTransaction = () => put(supportPath, { ...support, active: false });
  check((await request(`/api/records/appointments/${id}`, { reason: 'Scope revoked' }, SUPPORT_DEVELOPER, 'DELETE')).status === 403, 'Deactivation mid-transaction fails closed');
  check((await query('appointments')).status === 403, 'Deactivated developer cannot read protected records');
  put(supportPath, support);
  beforeTransaction = () => put(supportPath, { ...support, role: 'staff' });
  check((await query('patients')).status === 403, 'Role change mid-read fails closed');
  put(supportPath, support);
  process.env.NODE_ENV = 'production';
  for (const endpoint of ['/api/developer/metrics', '/api/login-activity']) check((await request(endpoint, undefined, SUPPORT_DEVELOPER, 'GET')).status === 403, 'Full development role disabled in production');
  check((await query('appointments')).status === 403, 'Production protected reads denied');
  check((await request('/api/inventory/transfers/create', {})).status === 403, 'Inventory route independently enforces development environment');
  check((await query('branches', [], 'collection', 'admin')).status === 200, 'Production administrator unchanged');
  process.env.NODE_ENV = 'development';
  const generated: any[] = [];
  await originalQuery.call(db.collection('appointments').where('branchId', 'string-in', ['demo-branch']).limit(1), { query: async (sql: string, values: any[]) => { generated.push({ sql, values }); return { rows: [] }; } } as any);
  check(generated[0].sql.includes('jsonb_typeof') && generated[0].sql.includes('ANY('), 'Restricted staff queries retain strict SQL branch membership');
  console.log(`${checks} full Support / Developer access checks passed (real HTTP routes, in-memory synthetic persistence and disposable test uploads).`);

} finally {
  server.close(); await once(server, 'close');
  RecordQuery.prototype.get = originalQuery; DocumentReference.prototype.get = originalDocument;
  db.runTransaction = originalTransaction; pool.query = originalSql;
  await pool.end();
  await rm(testStorage, { recursive: true, force: true });
}
