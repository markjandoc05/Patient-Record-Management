import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_appointment_auth_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.NODE_ENV !== 'production' || !process.env.STORAGE_DIR) {
  throw new Error('Use disposable local vine_appointment_auth_test, production test mode and ALLOW_TEST_DATABASE=yes');
}

let checks = 0;
const credentials = new Map<string, { cookie: string; csrf: string }>();
const origin = new URL(process.env.APP_URL!).origin;
const secretB = 'SYNTHETIC_UNASSIGNED_APPOINTMENT_PAYLOAD';
const appointmentA = '10-appointment-A', appointmentB = '00-appointment-B';
const payload = { patientId: 'patient-A', doctorId: 'doctor', appointmentDate: '2035-01-01T12:00',
  visitType: 'Initial Consultation', status: 'Scheduled', mainConcern: 'Synthetic intake', notes: 'Synthetic notes' };
let server: ReturnType<typeof app.listen> | undefined;

function check(condition: unknown, message: string) { assert.ok(condition, message); checks++; }
function noProtectedPayload(body: any) {
  check(!JSON.stringify(body).includes(secretB), 'Response contains no protected synthetic payload');
}
async function request(path: string, body: any, account = 'staff', method = 'POST') {
  const credential = credentials.get(account);
  return fetch(`http://127.0.0.1:${(server!.address() as any).port}${path}`, { method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(credential ? {
      Cookie: credential.cookie, Authorization: `Bearer ${credential.csrf}`,
    } : {}) }, body: JSON.stringify(body) });
}
async function list(constraints: any = [], account = 'staff', extra: any = {}) {
  const response = await request('/api/data/query', { kind: 'collection', path: 'appointments', constraints, ...extra }, account);
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}
async function direct(id: string, account = 'staff') {
  const response = await request('/api/data/query', { kind: 'document', path: `appointments/${id}` }, account);
  return { status: response.status, body: await response.json() };
}
async function expectList(constraints: any, ids: string[], account = 'staff', extra: any = {}) {
  const result = await list(constraints, account, extra);
  check(result.status === 200, `${account} list succeeds`);
  assert.deepEqual(result.body.documents.map((d: any) => d.id).sort(), [...ids].sort()); checks++;
  if (!ids.includes(appointmentB)) noProtectedPayload(result.body);
  return result;
}
const branchFilter = (operator: string, value: any) => [{ type: 'where', field: 'branchId', operator, value }];

try {
  await migrateDatabase();
  await pool.query('TRUNCATE app_records, auth_sessions, auth_identities, oauth_attempts');
  for (const [id, name] of [['A', 'Synthetic Branch A'], ['B', 'Synthetic Branch B']]) {
    await db.collection('branches').doc(id).set({ branchName: name, status: 'Active' });
  }
  await db.collection('patients').doc('patient-A').set({ name: 'Synthetic Patient A', homeBranchId: 'A', status: 'Active' });
  await db.collection('patients').doc('patient-B').set({ name: secretB, homeBranchId: 'B', status: 'Active' });
  for (const [id, role, branches, active] of [
    ['admin', 'admin', [], true], ['staff', 'staff', ['A'], true], ['doctor', 'doctor', ['A', 'B'], true],
    ['manager', 'manager', ['A'], true], ['legacy-support', 'support_developer', [], true],
    ['no-branches', 'staff', [], true], ['invalid-branches', 'staff', 'A', true],
    ['mixed-assignments', 'staff', ['A', '', null, 7, ['B'], { branchId: 'B' }], true],
    ['inactive', 'staff', ['A'], false], ['unknown-role', 'unknown', ['A'], true],
  ] as const) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(id).set({ role, assignedBranches: branches, active,
      fullName: `Synthetic ${id}`, email: `${id}@example.invalid` });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$2,$3)', [id, id, `${id}@example.invalid`]);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [createHash('sha256').update(token).digest('hex'), id, csrf]);
    credentials.set(id, { cookie: `${origin.startsWith('https:') ? '__Host-vine_session' : 'vine_session'}=${token}`, csrf });
  }
  await db.collection('appointments').doc(appointmentA).set({ ...payload, branchId: 'A', patientName: 'Synthetic Patient A' });
  await db.collection('appointments').doc(appointmentB).set({ ...payload, branchId: 'B', patientId: 'patient-B',
    appointmentDate: '2035-01-01T13:00', patientName: secretB, notes: secretB });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');

  const unfiltered = await expectList([], [appointmentA]);
  check(unfiltered.cache === 'no-store', 'Protected query response is not cached');
  await expectList(branchFilter('==', 'A'), [appointmentA]);
  await expectList(branchFilter('==', 'B'), []);
  await expectList(branchFilter('in', ['A', 'B']), [appointmentA]);
  await expectList(branchFilter('in', ['B']), []);
  await expectList(branchFilter('in', []), []);
  await expectList(branchFilter('==', 'unknown-branch'), []);
  await expectList(branchFilter('in', ['unknown-branch', 'A']), [appointmentA]);
  await expectList(branchFilter('!=', 'unknown-branch'), [appointmentA]);
  await expectList(branchFilter('>=', ''), [appointmentA]);
  await expectList([{ type: 'limit', value: 1 }], [appointmentA]);
  await expectList([{ type: 'orderBy', field: 'branchId', direction: 'desc' }, { type: 'limit', value: 1 }], [appointmentA]);
  await expectList([], [appointmentA], 'staff', { branchId: 'B', assignedBranches: ['B'], role: 'admin' });
  await expectList([{ type: 'where', field: 'patientId', operator: '==', value: 'patient-B' }], []);

  const allowed = await direct(appointmentA); check(allowed.status === 200 && allowed.body.document.id === appointmentA, 'Authorized direct appointment readable');
  const denied = await direct(appointmentB); check(denied.status === 403, 'Unassigned direct appointment denied');
  assert.deepEqual(denied.body, { error: 'Branch access denied' }); checks++; noProtectedPayload(denied.body);
  const missing = await direct('missing-appointment'); check(missing.status === 200 && missing.body.document.data === null, 'Missing record retains existing null convention');

  for (const malformed of [null, 7, {}, ['A'], { branchId: 'A' }]) {
    await expectList(branchFilter('==', malformed), []);
  }
  await expectList(branchFilter('in', ['B', null, 7, { branchId: 'B' }, ['B']]), []);
  await expectList(branchFilter('==', undefined), []);
  for (const malformed of [
    branchFilter('in', 'B'), branchFilter('or', ['A', 'B']),
    [{ type: 'where', field: "branchId'); OR true--", operator: '==', value: 'B' }],
    [null], {}, [{ type: 'limit', value: -1 }], [{ type: 'where', field: 'branchId', operator: 'string-in', value: ['A', 7] }],
  ]) {
    const result = await list(malformed); check(result.status === 400, 'Malformed query rejected');
    assert.deepEqual(result.body, { error: 'Data query failed' }); checks++; noProtectedPayload(result.body);
  }
  for (let index = 0; index < 3; index++) await expectList([], [appointmentA]);
  await Promise.all(Array.from({ length: 20 }, () => expectList(branchFilter('in', ['A', 'B']), [appointmentA])));

  for (const account of ['no-branches', 'invalid-branches']) {
    await expectList([], [], account); check((await direct(appointmentA, account)).status === 403, 'No usable assignments denies direct record');
  }
  await expectList([], [appointmentA], 'mixed-assignments');
  await expectList([], [appointmentA], 'manager');
  await expectList([], [appointmentA, appointmentB], 'doctor');
  for (const account of ['admin', 'legacy-support']) {
    await expectList([], [appointmentA, appointmentB], account);
    await expectList(branchFilter('==', 'B'), [appointmentB], account);
    const result = await direct(appointmentB, account);
    check(result.status === 200 && result.body.document.data.patientName === secretB, 'Global direct read remains allowed');
  }
  for (const account of ['inactive', 'unknown-role', 'anonymous']) {
    const result = await list([], account); check(result.status === (account === 'anonymous' ? 401 : 403), 'Inactive/unknown/anonymous list denied'); noProtectedPayload(result.body);
    const record = await direct(appointmentB, account); check(record.status === result.status, 'Inactive/unknown/anonymous direct denied'); noProtectedPayload(record.body);
  }

  // Private appointment media is another server read path. Knowing a file path
  // must not bypass the appointment's branch policy.
  for (const [recordId, patientId, authorized] of [[appointmentA, 'patient-A', true], [appointmentB, 'patient-B', false]] as const) {
    const admin = credentials.get('admin')!;
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4\nSynthetic appointment attachment'], { type: 'application/pdf' }), 'synthetic.pdf');
    form.append('patientId', patientId); form.append('resourceType', 'appointment'); form.append('resourceId', recordId);
    const upload = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/attachments/upload`, {
      method: 'POST', headers: { Origin: origin, Cookie: admin.cookie, Authorization: `Bearer ${admin.csrf}` }, body: form,
    });
    check(upload.status === 201, 'Administrator appointment attachment upload remains allowed');
    const path = (await upload.json()).attachment.storagePath;
    for (const account of ['staff', 'admin']) {
      const credential = credentials.get(account)!;
      const download = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/attachments/content?path=${encodeURIComponent(path)}`, {
        headers: { Cookie: credential.cookie, Authorization: `Bearer ${credential.csrf}` },
      });
      if (account === 'staff' && !authorized) {
        check(download.status === 403, 'Unassigned appointment file denied');
        const body = await download.json(); assert.deepEqual(body, { error: 'Attachment access denied' }); checks++; noProtectedPayload(body);
      } else {
        check(download.status === 200 && (await download.text()).startsWith('%PDF'), 'Authorized appointment file still readable');
      }
    }
  }

  // Non-string/missing stored branch IDs cannot match an authorization scope,
  // including JSON arrays that the legacy generic JSONB IN operator can match.
  for (const [id, branchId] of [['array-branch', ['A']], ['null-branch', null], ['object-branch', { branchId: 'A' }], ['number-branch', 7], ['missing-branch', undefined]] as const) {
    await db.collection('appointments').doc(id).set({ ...payload, branchId, notes: secretB });
    check((await direct(id)).status === 403, 'Invalid stored branch denied');
  }
  await expectList([], [appointmentA]);
  await expectList([{ type: 'limit', value: 1 }], [appointmentA]);
  await db.collection('appointments').doc('archived-A').set({ ...payload, branchId: 'A', isArchived: true });
  await expectList([{ type: 'where', field: 'isArchived', operator: '==', value: true }], ['archived-A']);

  // Exercise the existing write endpoints, not mock permission decisions.
  const create = await request('/api/records/appointments', { ...payload, branchId: 'A', appointmentDate: '2035-01-02T12:00' });
  check(create.status === 201, 'Assigned-branch staff create still allowed'); const created = await create.json();
  const edit = await request(`/api/records/appointments/${created.id}`, { ...payload, branchId: 'A', appointmentDate: '2035-01-02T12:00', status: 'Confirmed' }, 'staff', 'PATCH');
  check(edit.status === 200, 'Assigned-branch staff edit still allowed');
  check((await request('/api/records/appointments', { ...payload, branchId: 'B' })).status === 403, 'Unassigned create still denied');
  check((await request(`/api/records/appointments/${appointmentB}`, { ...payload, branchId: 'B' }, 'staff', 'PATCH')).status === 403, 'Unassigned edit still denied');
  check((await request(`/api/records/appointments/${created.id}`, { reason: 'Synthetic archive' }, 'staff', 'DELETE')).status === 403, 'Staff archive still denied');
  check((await request(`/api/records/appointments/${created.id}/restore`, {})).status === 403, 'Staff restore still denied');
  check((await request(`/api/records/appointments/${created.id}`, { reason: 'Synthetic archive' }, 'admin', 'DELETE')).status === 200, 'Administrator archive still allowed');
  check((await request(`/api/records/appointments/${created.id}/restore`, {}, 'admin')).status === 200, 'Administrator restore still allowed');

  // Same session observes assignment changes on the next request/poll.
  check((await request('/api/data/write', { operations: [{ path: 'users/staff', mode: 'update', data: { assignedBranches: ['B'] } }] }, 'admin')).status === 200, 'Existing admin assignment update succeeds');
  await expectList([], [appointmentB]); check((await direct(appointmentA)).status === 403, 'Removed assignment no longer reads old branch');
  check((await direct(appointmentB)).status === 200, 'New assignment reads new branch');
  await db.collection('users').doc('staff').update({ assignedBranches: [] });
  await expectList([], []); check((await direct(appointmentB)).status === 403, 'Clearing scope removes direct access');

  console.log(`Passed ${checks} appointment read-authorization assertions (disposable synthetic data).`);
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool.end();
}
