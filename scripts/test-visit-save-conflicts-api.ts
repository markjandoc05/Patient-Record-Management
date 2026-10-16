import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
import { assertCurrentMigrationChain } from './platform-test-support';

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const configuredOrigin = new URL(process.env.APP_URL || 'https://invalid');
const storage = path.resolve(process.env.STORAGE_DIR || '/');
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_visit_conflicts_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.NODE_ENV !== 'production'
  || !configuredOrigin.hostname.endsWith('.invalid')
  || ![tmpdir(), '/private/tmp', '/tmp'].some(root => storage.startsWith(path.resolve(root) + path.sep))) {
  throw Error('Use an empty disposable loopback vine_visit_conflicts_test, .invalid origin and temporary storage');
}
const origin = configuredOrigin.origin;
const sessions = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen> | undefined, checks = 0, slot = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const read = async (id: string) => (await db.collection('visits').doc(id).get()).data()!;
const request = async (route: string, method: string, body: any, actor = 'admin') => {
  const session = sessions.get(actor);
  const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json',
      ...(session ? { Cookie: session.cookie, Authorization: `Bearer ${session.csrf}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};
function status(result: { status: number; body: any }, expected: number, message: string, code?: string) {
  check(result.status === expected && (!code || result.body?.code === code),
    `${message}: expected ${expected} ${code || ''}, got ${result.status} ${result.body?.code || ''} ${result.body?.error || ''}`);
}
function payload(extra: any = {}) {
  const index = slot++;
  return { patientId: 'patient', branchId: 'A', doctorId: 'doctor', visitType: 'Treatment Session',
    visitDate: `2038-01-${String(1 + Math.floor(index / 16)).padStart(2, '0')}T${String(10 + Math.floor(index % 16 / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
    notes: 'Original synthetic notes', diagnosis: '', treatmentPlan: '', mainConcern: '', ...extra };
}
// No version is inferred by this test client: each editor supplies its opened version.
const edit = (id: string, body: any, actor = 'admin') => request('/api/records/visits/' + id, 'PATCH', body, actor);
const fingerprint = async () => JSON.stringify((await pool.query(
  'SELECT collection_path,id,data,created_at,updated_at FROM app_records ORDER BY collection_path,id')).rows);
const auditCount = async () => Number((await pool.query("SELECT count(*) FROM app_records WHERE collection_path='audit_logs'")).rows[0].count);

try {
  if ((await pool.query("SELECT to_regclass('public.app_records') AS records")).rows[0].records) {
    throw Error('vine_visit_conflicts_test must be empty');
  }
  await migrateDatabase(); await migrateDatabase();
  check(await assertCurrentMigrationChain(), 'fresh complete immutable migration chain, repeat-safe');
  for (const id of ['A', 'B']) await db.collection('branches').doc(id).set({ branchName: 'Synthetic ' + id, status: 'Active' });
  const profiles: Record<string, any> = {
    admin: { role: 'admin', assignedBranches: ['A', 'B'] },
    doctor: { role: 'doctor', assignedBranches: ['A'] },
    otherDoctor: { role: 'doctor', assignedBranches: ['A'] },
    nurse: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'] },
    medical: { role: 'staff', staffDesignation: 'Medical Staff', assignedBranches: ['A'] },
    reception: { role: 'staff', staffDesignation: 'Reception/Admin Staff', assignedBranches: ['A'] },
  };
  for (const [id, profile] of Object.entries(profiles)) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(id).set({ active: true, fullName: 'Synthetic ' + id, ...profile });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id, csrf]);
    sessions.set(id, { cookie: '__Host-vine_session=' + token, csrf });
  }
  await db.collection('patients').doc('patient').set({ name: 'Synthetic conflict patient', patientID: 'SYNTHETIC', isArchived: false });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');

  const legacy = payload({ treatmentService: '  retained historical text  ', servicePerformed: 'Old performed text', unknownHistory: { retained: true } });
  await db.collection('visits').doc('legacy').set(legacy);
  const beforeRead = await fingerprint();
  const loaded = await request('/api/data/query', 'POST', { path: 'visits/legacy', kind: 'document' });
  status(loaded, 200, 'legacy Visit readable');
  check(!Object.hasOwn(loaded.body.document.data, 'visitVersion') && await fingerprint() === beforeRead, 'reading legacy Visit performs no version backfill');
  const winner = await edit('legacy', { ...legacy, expectedVisitVersion: 0, notes: 'WINNING_NOTES', diagnosis: 'WINNING_DIAGNOSIS', treatmentPlan: 'WINNING_PLAN' });
  status(winner, 200, 'first legacy editor succeeds'); check(winner.body.visitVersion === 1, 'legacy first save becomes version one');
  const beforeStale = await fingerprint();
  const stale = await edit('legacy', { ...legacy, expectedVisitVersion: 0, notes: 'LOSING_NOTES' });
  status(stale, 409, 'stale editor cannot overwrite', 'VISIT_VERSION_CHANGED');
  check(!Object.hasOwn(stale.body, 'document') && !JSON.stringify(stale.body).includes('WINNING_NOTES'), 'conflict receipt contains no clinical record');
  check(await fingerprint() === beforeStale, 'conflict leaves Visit, audit and patient counters untouched');
  check((await read('legacy')).notes === 'WINNING_NOTES' && (await read('legacy')).treatmentPlan === 'WINNING_PLAN', 'winning clinical fields survive conflict');
  check((await read('legacy')).treatmentService === legacy.treatmentService && (await read('legacy')).servicePerformed === legacy.servicePerformed
    && (await read('legacy')).unknownHistory.retained === true, 'historical whitespace, fallback and unknown JSONB retained');

  for (const expected of [undefined, null, -1, 1.5, '1', true, Number.MAX_SAFE_INTEGER + 1]) {
    status(await edit('legacy', { ...legacy, expectedVisitVersion: expected }), 409, 'unversioned/malformed save denied', 'VISIT_VERSION_REQUIRED');
  }
  check(await fingerprint() === beforeStale, 'required-version denials do not write');
  for (const forged of [0, 99, null]) status(await edit('legacy', { ...legacy, expectedVisitVersion: 1, visitVersion: forged }), 400, 'server version cannot be forged', 'VISIT_VERSION_METADATA');
  status(await request('/api/records/visits', 'POST', payload({ visitVersion: 1 })), 400, 'create cannot forge version', 'VISIT_VERSION_METADATA');

  const newPayload = payload({ clientVisitId: randomUUID() });
  const created = await request('/api/records/visits', 'POST', newPayload); status(created, 201, 'create versioned Visit');
  check(created.body.visitVersion === 1 && (await read(created.body.id)).visitVersion === 1, 'server creates authoritative version one');
  const retryBefore = await fingerprint(), retry = await request('/api/records/visits', 'POST', newPayload);
  status(retry, 200, 'idempotent create retry preserved');
  check(retry.body.id === created.body.id && retry.body.visitVersion === 1 && await fingerprint() === retryBefore, 'create retry returns saved version without duplicate effects');
  const { clientVisitId: _clientId, ...newEdit } = newPayload;
  const concurrent = await Promise.all(['EDITOR_A', 'EDITOR_B'].map(notes => edit(created.body.id, { ...newEdit, expectedVisitVersion: 1, notes })));
  check(concurrent.filter(result => result.status === 200).length === 1 && concurrent.filter(result => result.status === 409 && result.body.code === 'VISIT_VERSION_CHANGED').length === 1, 'simultaneous editors serialize to one winner and one conflict');
  check((await read(created.body.id)).visitVersion === 2, 'concurrent writes advance version exactly once');
  const same = await read(created.body.id);
  status(await edit(created.body.id, { ...newEdit, expectedVisitVersion: 2, notes: same.notes }), 200, 'accepted no-op edit remains versioned');
  check((await read(created.body.id)).visitVersion === 3, 'accepted no-op stales other opened editors');

  for (const stored of ['broken', -1, 1.5, {}, Number.MAX_SAFE_INTEGER]) {
    const id = randomUUID(), base = payload(); await db.collection('visits').doc(id).set({ ...base, visitVersion: stored });
    const before = await fingerprint();
    status(await request('/api/data/query', 'POST', { path: 'visits/' + id, kind: 'document' }), 200, 'invalid version does not hide historical Visit');
    status(await edit(id, { ...base, expectedVisitVersion: stored === Number.MAX_SAFE_INTEGER ? stored : 0 }), 409, 'invalid stored metadata fails closed', 'VISIT_VERSION_INVALID');
    check(await fingerprint() === before, 'invalid stored version is not reset or repaired silently');
  }
  const nullBase = payload(); await db.collection('visits').doc('null-legacy').set({ ...nullBase, visitVersion: null });
  status(await edit('null-legacy', { ...nullBase, expectedVisitVersion: 0 }), 200, 'legacy null metadata is version zero');

  const authorityBefore = await fingerprint();
  status(await edit('legacy', { ...legacy, expectedVisitVersion: 0 }, 'otherDoctor'), 403, 'Doctor ownership still enforced before conflict');
  status(await edit('legacy', { ...legacy, expectedVisitVersion: 0 }, 'reception'), 403, 'ordinary Staff cannot gain clinical writes');
  status(await edit('legacy', { ...legacy, expectedVisitVersion: 0, branchId: 'B' }, 'nurse'), 403, 'destination branch denied before conflict');
  await db.collection('visits').doc('outside').set(payload({ branchId: 'B' }));
  const outside = await read('outside'), outsideBefore = await fingerprint();
  status(await edit('outside', { ...outside, expectedVisitVersion: 0, branchId: 'A' }, 'medical'), 403, 'source branch denied before conflict');
  check(await fingerprint() === outsideBefore && authorityBefore.includes('WINNING_NOTES'), 'authority denials leave data untouched');
  for (const actor of ['nurse', 'medical', 'doctor']) {
    const current = (await read('legacy')).visitVersion;
    const result = await edit('legacy', { ...legacy, expectedVisitVersion: current, notes: 'Authorized ' + actor }, actor);
    status(result, 200, actor + ' existing clinical workflow retained');
    check(result.body.visitVersion === current + 1, actor + ' save advances version');
  }
  await db.collection('users').doc('nurse').update({ permissionOverrides: { 'visits.edit': 'deny' } });
  status(await edit('legacy', { ...legacy, expectedVisitVersion: 0 }, 'nurse'), 403, 'explicit capability denial retained');

  const archiveBase = payload(); await db.collection('visits').doc('archive-cycle').set(archiveBase);
  status(await request('/api/records/visits/archive-cycle', 'DELETE', { reason: 'Synthetic archive' }), 200, 'archive workflow retained');
  check((await read('archive-cycle')).visitVersion === 1, 'archive advances version');
  status(await request('/api/records/visits/archive-cycle/restore', 'POST', {}), 200, 'restore workflow retained');
  check((await read('archive-cycle')).visitVersion === 2, 'restore advances version');
  status(await edit('archive-cycle', { ...archiveBase, expectedVisitVersion: 0 }), 409, 'pre-archive draft cannot save after restoration', 'VISIT_VERSION_CHANGED');
  status(await edit('archive-cycle', { ...archiveBase, expectedVisitVersion: 2 }), 200, 'fresh restored edit succeeds');

  const atomicBefore = await fingerprint(), originalTransaction = db.runTransaction;
  (db as any).runTransaction = (fn: any) => originalTransaction.call(db, async transaction => {
    const originalSet = transaction.set.bind(transaction);
    transaction.set = ((ref: any, data: any, options: any) => {
      if (ref.collectionPath === 'audit_logs') throw Error('Synthetic Visit audit failure');
      return originalSet(ref, data, options);
    }) as any;
    return fn(transaction);
  });
  try { status(await edit('archive-cycle', { ...archiveBase, expectedVisitVersion: 3, notes: 'Must roll back' }), 500, 'audit failure surfaced'); }
  finally { db.runTransaction = originalTransaction; }
  check(await fingerprint() === atomicBefore, 'failed transaction rolls back version, Visit and counters');
  check(await auditCount() > 0, 'normal successful edits remain audited');
  console.log(`Visit save-conflict API: ${checks} checks passed`);
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool.end();
}
