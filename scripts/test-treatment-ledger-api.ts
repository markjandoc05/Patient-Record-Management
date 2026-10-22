import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const configuredOrigin = new URL(process.env.APP_URL || 'https://invalid');
const storage = path.resolve(process.env.STORAGE_DIR || '/');
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_treatment_ledger_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.NODE_ENV !== 'production'
  || !configuredOrigin.hostname.endsWith('.invalid')
  || ![tmpdir(), '/private/tmp', '/tmp'].some(root => storage.startsWith(path.resolve(root) + path.sep))) {
  throw Error('Use an empty disposable loopback vine_treatment_ledger_test, production test middleware, .invalid APP_URL and temporary STORAGE_DIR');
}
const origin = configuredOrigin.origin, base = '/api/records/patients/patient/treatment-ledger';
const sessions = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen> | undefined, checks = 0, slot = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; }
async function request(route: string, method = 'GET', body?: any, actor = 'admin', extraHeaders: Record<string, string> = {}) {
  // Sequential workflow tests model an editor opening the current saved Visit.
  if (method === 'PATCH' && /^\/api\/records\/visits\/[^/]+$/.test(route) && !Object.hasOwn(body || {}, 'expectedVisitVersion')) {
    const record = (await db.collection('visits').doc(decodeURIComponent(route.split('/').at(-1)!)).get()).data();
    body = { ...body, expectedVisitVersion: record?.visitVersion ?? 0 };
  }
  const session = sessions.get(actor);
  const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json',
      ...(session ? { Cookie: session.cookie, Authorization: `Bearer ${session.csrf}` } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
function status(result: { status: number; body: any }, expected: number, message: string) {
  check(result.status === expected, `${message}: expected ${expected}, got ${result.status}: ${JSON.stringify(result.body)?.slice(0, 1000)}`);
}
const read = async (collection: string, id: string) => (await db.collection(collection).doc(id).get()).data()!;
const moment = () => {
  const index = slot++;
  return `2037-01-${String(1 + Math.floor(index / 19)).padStart(2, '0')}T${String(10 + Math.floor(index % 19 / 2)).padStart(2, '0')}:${index % 19 % 2 ? '30' : '00'}`;
};
const visit = (service: any, extra: any = {}) => ({ clientVisitId: randomUUID(), patientId: 'patient', branchId: 'A',
  visitDate: moment(), visitType: 'Treatment Session', doctorId: null, performedByUserId: 'nurse',
  assistingStaffText: 'Synthetic assistant', notes: 'Synthetic clinical documentation',
  serviceSelection: { serviceId: service.id, expectedVersion: service.version }, ...extra });
const usage = (line: any, sessions = 1, commandId = randomUUID()) => ({ commandId, lineId: line.id, sessions,
  expectedLineVersion: line.version, expectedUsageVersion: 0 });
const ledger = async (actor = 'admin') => { const result = await request(base, 'GET', undefined, actor); status(result, 200, actor + ' ledger read'); return result.body; };
const purchaseIn = (value: any, id: string) => value.purchases.find((purchase: any) => purchase.id === id);
const lineIn = (value: any, id: string) => value.purchases.flatMap((purchase: any) => purchase.lines).find((line: any) => line.id === id);
const eventCount = async () => Number((await pool.query('SELECT count(*) FROM treatment_ledger_events')).rows[0].count);
async function sqlReject(sql: string, values: any[], code: string, message: string) {
  await assert.rejects(pool.query(sql, values), (error: any) => error.code === code, message); checks++;
}
const sqlSnapshot = async () => JSON.stringify((await pool.query(`
  SELECT 'purchase' AS kind,row_to_json(r) AS record FROM (SELECT * FROM treatment_ledger_purchases ORDER BY id) r
  UNION ALL SELECT 'line',row_to_json(r) FROM (SELECT * FROM treatment_ledger_lines ORDER BY id) r
  UNION ALL SELECT 'event',row_to_json(r) FROM (SELECT * FROM treatment_ledger_events ORDER BY id) r
  UNION ALL SELECT 'usage',row_to_json(r) FROM (SELECT * FROM treatment_ledger_visit_usage ORDER BY visit_id) r
`)).rows);
function purchasePayload(services: any[], branchId = 'A', extra: any = {}) {
  return { commandId: randomUUID(), expectedVersion: 0, packageName: 'Synthetic package', purchaseDate: '2036-12-31',
    branchId, notes: 'Synthetic package notes', lines: services.map(service => ({ serviceId: service.id,
      expectedServiceVersion: service.version, purchasedSessions: 5 })), ...extra };
}
async function createPurchase(payload: any, actor = 'admin') {
  const before = new Set((await ledger()).purchases.map((purchase: any) => purchase.id));
  const result = await request(base + '/purchases', 'POST', payload, actor); status(result, 201, 'purchase create');
  const purchase = result.body.purchases.find((purchase: any) => !before.has(purchase.id));
  check(!!purchase && result.body.command.id === payload.commandId && result.body.command.replayed === false, 'purchase response has authoritative identity and command result');
  return purchase;
}
async function createService(name: string) {
  const result = await request('/api/services', 'POST', { id: randomUUID(), name, defaultDurationMinutes: 45,
    standardPrice: { mode: 'free' }, branchSettings: [{ branchId: 'A', available: true, price: { mode: 'inherit' } },
      { branchId: 'B', available: true, price: { mode: 'priced', amount: '9876543.21' } }] });
  status(result, 201, 'create synthetic catalogue Service'); return result.body;
}
const assertBalances = (value: any) => {
  for (const purchase of value.purchases) for (const line of purchase.lines) {
    check(line.remainingSessions === line.purchasedSessions + line.adjustmentSessions - line.usedSessions && line.remainingSessions >= 0,
      'server computed nonnegative line balance follows immutable ledger events');
  }
};
try {
  check(!(await pool.query("SELECT to_regclass('public.app_records') AS records")).rows[0].records,
    'API suite requires an empty disposable database');
  check((await pool.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].count === 0,
    'disposable API database contains no unrelated user tables');
  await migrateDatabase(); await migrateDatabase();
  check((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.length === (await readdir('migrations')).filter(name => name.endsWith('.sql')).length, 'fresh complete checksummed migration chain, repeat-safe');
  for (const [id, branchStatus] of [['A', 'Active'], ['B', 'Active'], ['C', 'Inactive']]) await db.collection('branches').doc(id).set({
    branchName: 'Original synthetic branch ' + id, status: branchStatus, timezone: 'Asia/Manila' });
  const allLedger = { 'treatment_ledger.view': 'allow', 'treatment_ledger.purchase': 'allow', 'treatment_ledger.adjust': 'allow', 'treatment_ledger.reference': 'allow' };
  for (const [id, profile] of Object.entries({
    admin: { role: 'admin', assignedBranches: ['A', 'B'] },
    staffA: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'], permissionOverrides: allLedger },
    staffB: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['B'], permissionOverrides: allLedger },
    deniedClinical: { role: 'admin', assignedBranches: ['A', 'B'], permissionOverrides: { 'clinical.view': 'deny' } },
    deniedLedger: { role: 'admin', assignedBranches: ['A', 'B'], permissionOverrides: { 'treatment_ledger.view': 'deny' } },
    deniedVisits: { role: 'admin', assignedBranches: ['A', 'B'], permissionOverrides: { 'visits.view': 'deny' } },
    deniedPatients: { role: 'admin', assignedBranches: ['A', 'B'], permissionOverrides: { 'patients.view': 'deny' } },
    inactive: { role: 'admin', active: false, assignedBranches: ['A', 'B'] },
  })) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(id).set({ active: true, fullName: 'Synthetic ' + id, ...profile });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [createHash('sha256').update(token).digest('hex'), id, csrf]);
    sessions.set(id, { cookie: `${origin.startsWith('https') ? '__Host-' : ''}vine_session=${token}`, csrf });
  }
  await db.collection('users').doc('nurse').set({ role: 'staff', staffDesignation: 'Nurse', active: true,
    fullName: 'Original synthetic performer', assignedBranches: ['A', 'B'] });
  await db.collection('users').doc('provider').set({ role: 'doctor', active: true,
    fullName: 'Original synthetic doctor', assignedBranches: ['A', 'B'] });
  await db.collection('patients').doc('patient').set({ name: 'Synthetic ledger patient', patientID: 'SYNTHETIC', isArchived: false });
  await db.collection('patients').doc('other-patient').set({ name: 'Synthetic other patient', isArchived: false });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const service = await createService('Original synthetic laser'), otherService = await createService('Original synthetic facial');
  status(await request(base, 'GET', undefined, 'anonymous'), 401, 'ledger requires session');
  for (const actor of ['deniedClinical', 'deniedLedger', 'deniedVisits', 'deniedPatients', 'inactive']) {
    status(await request(base, 'GET', undefined, actor), 403, actor + ' ledger read denied');
    status(await request(base + '/purchases', 'POST', purchasePayload([service]), actor), 403, actor + ' ledger mutation denied');
  }
  status(await request(base + '/purchases', 'POST', purchasePayload([service]), 'admin', { Origin: 'https://wrong.invalid' }), 403, 'purchase enforces origin');
  status(await request(base + '/purchases', 'POST', purchasePayload([service]), 'admin', { Authorization: 'Bearer wrong' }), 403, 'purchase enforces CSRF');
  const singlePayload = purchasePayload([service], 'A', { packageName: 'Single Service package', orNumber: '0000012' });
  const single = await createPurchase(singlePayload);
  check(single.lines.length === 1 && single.lines[0].purchasedSessions === 5 && single.lines[0].remainingSessions === 5,
    'single Service purchase opens authoritative balance');
  check(single.purchaseDate === singlePayload.purchaseDate && single.orNumber === '0000012' && single.actor.uid === 'admin' && single.branchNameSnapshot === 'Original synthetic branch A'
    && single.timezoneSnapshot === 'Asia/Manila' && typeof single.recordedAt === 'string', 'Admin OR leading zeros and server purchase attribution retained');
  const countBeforeRetry = await eventCount();
  const replay = await request(base + '/purchases', 'POST', singlePayload); status(replay, 200, 'lost purchase response retry');
  check(replay.body.command.replayed && await eventCount() === countBeforeRetry, 'purchase retry makes no duplicate SQL event');
  status(await request(base + '/purchases', 'POST', { ...singlePayload, packageName: 'Changed same command' }), 409, 'purchase command reused with different payload denied');
  const multi = await createPurchase(purchasePayload([service, otherService], 'B', { packageName: 'Multi Service package', notes: 'PRIVATE_BRANCH_B_NOTES', orNumber: '0000999' }));
  check(multi.lines.length === 2 && multi.lines.every((line: any) => line.remainingSessions === 5), 'multi Service package keeps separate line balances');
  const staffLedger = await ledger('staffA');
  check(staffLedger.redemptionPolicy === 'authorized_branches' && staffLedger.branches.every((branch: any) => branch.id === 'A'), 'redemption response exposes only actor authorized branch directory');
  const shared = purchaseIn(staffLedger, multi.id);
  check(shared.lines.length === 2 && shared.metadataRedacted === true && shared.notes === '' && shared.orNumber === null,
    'shared out-of-branch balances retain no purchase notes or OR');
  check(!JSON.stringify(staffLedger).includes('PRIVATE_BRANCH_B_NOTES') && !JSON.stringify(staffLedger).includes('0000999')
    && !JSON.stringify(staffLedger).includes('9876543.21') && !JSON.stringify(staffLedger).includes('price_override'),
    'shared ledger GET leaks neither hidden purchase metadata nor catalogue price configuration');
  const staffPurchase = await createPurchase(purchasePayload([service], 'A', { notes: 'Reception purchase' }), 'staffA');
  for (const payload of [purchasePayload([service], 'A', { orNumber: '0000042' }), purchasePayload([service], 'A', { orNumber: null })])
    status(await request(base + '/purchases', 'POST', payload, 'staffA'), 403, 'non-Admin cannot forge OR permission on purchase');
  status(await request(base + '/purchases/' + staffPurchase.id, 'PATCH', { commandId: randomUUID(), expectedVersion: staffPurchase.version, orNumber: '0000042' }, 'staffA'), 403, 'non-Admin OR edit denied despite explicit allow');
  status(await request(base + '/purchases', 'POST', purchasePayload([service], 'B'), 'staffA'), 403, 'purchase origin branch remains restricted');
  for (const value of [0, -1, 1.5, '1', null, 10001]) status(await request(base + '/purchases', 'POST', purchasePayload([service], 'A', {
    lines: [{ serviceId: service.id, expectedServiceVersion: service.version, purchasedSessions: value }] })), 400, 'invalid purchased quantity ' + JSON.stringify(value));
  for (const payload of [
    purchasePayload([], 'A'), purchasePayload([service], 'A', { lines: Array.from({ length: 21 }, () => ({ serviceId: service.id, expectedServiceVersion: service.version, purchasedSessions: 1 })) }),
    purchasePayload([service], 'A', { recordedAt: 'spoof' }), purchasePayload([service], 'A', { actor: { uid: 'spoof' } }),
    purchasePayload([service], 'A', { remainingSessions: 99 }), purchasePayload([service], 'A', { lines: [{ serviceId: service.id, expectedServiceVersion: service.version, purchasedSessions: 1, serviceNameSnapshot: 'Forged' }] }),
  ]) status(await request(base + '/purchases', 'POST', payload), 400, 'malformed purchase or client metadata denied');
  const noteCommand = { commandId: randomUUID(), expectedVersion: single.version, notes: 'Updated synthetic package notes' };
  const notes = await request(base + '/purchases/' + single.id, 'PATCH', noteCommand); status(notes, 200, 'purchase notes edit');
  let currentSingle = purchaseIn(notes.body, single.id);
  check(currentSingle.version === single.version + 1 && currentSingle.notes === noteCommand.notes && currentSingle.orNumber === '0000012', 'notes version advances without changing OR');
  const noteEvents = await eventCount();
  status(await request(base + '/purchases/' + single.id, 'PATCH', noteCommand), 200, 'notes lost response retry is safe');
  check(await eventCount() === noteEvents && purchaseIn(await ledger(), single.id).version === currentSingle.version, 'notes retry does not add event or version');
  const initialPurchaseEvent = (await ledger()).events.find((event: any) => event.type === 'purchase' && event.purchaseId === single.id);
  check(initialPurchaseEvent.metadata.notes === singlePayload.notes && initialPurchaseEvent.metadata.orNumber === singlePayload.orNumber
    && initialPurchaseEvent.metadata.lines[0].purchasedSessions === 5, 'initial immutable purchase event retains original notes, OR and quantities after edits');
  status(await request(base + '/purchases/' + single.id, 'PATCH', { commandId: randomUUID(), expectedVersion: single.version, notes: 'Stale notes' }), 409, 'stale notes cannot overwrite');
  const notesRace = await Promise.all(['Race notes A', 'Race notes B'].map(notes => request(base + '/purchases/' + single.id, 'PATCH', { commandId: randomUUID(), expectedVersion: currentSingle.version, notes })));
  check(notesRace.map(result => result.status).sort().join() === '200,409', 'concurrent note edits have one optimistic winner');
  currentSingle = purchaseIn(await ledger(), single.id);
  const orEdit = await request(base + '/purchases/' + single.id, 'PATCH', { commandId: randomUUID(), expectedVersion: currentSingle.version, orNumber: '0000007' }); status(orEdit, 200, 'Admin OR edit');
  check(purchaseIn(orEdit.body, single.id).orNumber === '0000007', 'OR edit preserves all leading zeros');
  const crossLine = multi.lines.find((line: any) => line.serviceId === service.id), crossVisit = visit(service, { performedByUserId: 'staffA', sessionUsage: usage(crossLine) });
  const crossResult = await request('/api/records/visits', 'POST', crossVisit, 'staffA'); status(crossResult, 201, 'Staff A redeems purchase B in authorized Visit A');
  const crossId = crossResult.body.id;
  check((await read('visits', crossId)).branchId === 'A' && lineIn(await ledger(), crossLine.id).remainingSessions === 4,
    'cross-branch redemption commits Visit and one deduction');
  const crossActive = (await ledger()).activeVisitUsages.find((entry: any) => entry.visitId === crossId);
  for (const actor of ['staffA', 'staffB']) status(await request(base + '/usage/' + crossActive.eventId + '/reversal', 'POST', {
    commandId: randomUUID(), expectedLineVersion: lineIn(await ledger(), crossLine.id).version,
    expectedUsageVersion: crossActive.version, reason: 'Synthetic cross-branch reversal attempt' }, actor), 403,
    'reversal requires both purchase-origin and performed-Visit branch scope for ' + actor);
  for (const [route, method, payload] of [
    [base + '/purchases/' + multi.id, 'PATCH', { commandId: randomUUID(), expectedVersion: multi.version, notes: 'Forbidden branch B notes' }],
    [base + '/purchases/' + multi.id, 'PATCH', { commandId: randomUUID(), expectedVersion: multi.version, orNumber: '0000001' }],
    [base + '/lines/' + crossLine.id + '/adjustments', 'POST', { commandId: randomUUID(), expectedLineVersion: lineIn(await ledger(), crossLine.id).version, delta: 1, reason: 'Forbidden adjustment' }],
  ] as const) status(await request(route, method, payload, 'staffA'), 403, 'shared balance does not grant purchase B metadata/adjust authority');
  status(await request('/api/records/visits', 'POST', visit(service, { branchId: 'B', performedByUserId: 'staffA', sessionUsage: usage(lineIn(await ledger(), crossLine.id)) }), 'staffA'), 403, 'shared balances do not grant Visit B write');
  const line = lineIn(await ledger(), single.lines[0].id), directPayload = visit(service, { sessionUsage: usage(line) });
  const direct = await request('/api/records/visits', 'POST', directPayload); status(direct, 201, 'Visit creation and usage atomic success');
  const directId = direct.body.id, afterUse = await ledger(), active = afterUse.activeVisitUsages.find((entry: any) => entry.visitId === directId);
  check(active && active.sessions === 1 && active.visitSnapshot.branchId === 'A' && active.visitSnapshot.serviceNameSnapshot === service.name,
    'usage binds persisted Visit and authoritative snapshot');
  const originalUsageEvent = afterUse.events.find((event: any) => event.id === active.eventId);
  check(originalUsageEvent.balanceAfter.usedSessions === 1 && originalUsageEvent.balanceAfter.remainingSessions === 4,
    'usage event freezes the remaining balance immediately after recording');
  const eventsAfterUse = await eventCount();
  const directReplay = await request('/api/records/visits', 'POST', directPayload); status(directReplay, 200, 'lost Visit response retries stable clientVisitId');
  check(directReplay.body.id === directId && await eventCount() === eventsAfterUse, 'Visit retry creates neither new Visit nor usage event');
  status(await request('/api/records/visits', 'POST', { ...directPayload, notes: 'Changed retry' }), 409, 'same Visit/command identity changed payload denied');
  const editBase = { ...directPayload, clientVisitId: undefined, sessionUsage: undefined, serviceSelection: undefined };
  status(await request('/api/records/visits/' + directId, 'PATCH', { ...editBase, notes: 'Edited clinical documentation' }), 200, 'repeat save retains explicit usage');
  status(await request('/api/records/visits/' + directId, 'PATCH', { ...editBase, notes: 'Edited clinical documentation' }), 200, 'identical repeat save safe');
  check(await eventCount() === eventsAfterUse && lineIn(await ledger(), line.id).usedSessions === 1, 'ordinary repeated saves never auto-deduct sessions');
  const beforeChangedRetry = await sqlSnapshot(), visitBeforeChangedRetry = JSON.stringify(await read('visits', directId));
  const changedRetry = await request('/api/records/visits', 'POST', directPayload);
  status(changedRetry, 409, 'original create retry conflicts after ordinary PATCH supersedes clinical notes');
  check(changedRetry.body.code === 'CREATE_RETRY_CHANGED' && await sqlSnapshot() === beforeChangedRetry
    && JSON.stringify(await read('visits', directId)) === visitBeforeChangedRetry,
    'superseded create retry reports explicit conflict and changes neither Visit nor usage');
  const duplicateUsage = { ...usage(lineIn(await ledger(), line.id)), commandId: directPayload.sessionUsage.commandId };
  status(await request('/api/records/visits', 'POST', visit(service, { sessionUsage: duplicateUsage })), 409,
    'usage command cannot be reused for a different Visit target');
  for (const changes of [{ patientId: 'other-patient' }, { branchId: 'B' }, { visitDate: moment() }, { doctorId: 'provider' },
    { performedByUserId: 'staffA' }, { assistingStaffText: 'Changed assistant' },
    { serviceSelection: { serviceId: otherService.id, expectedVersion: otherService.version } }])
    status(await request('/api/records/visits/' + directId, 'PATCH', { ...editBase, ...changes }), 409, 'active usage binding blocks provenance changes');
  status(await request('/api/records/visits/' + directId, 'PATCH', { ...editBase, sessionUsage: null }), 400, 'null usage cannot silently unbind');
  for (const metadata of [{ creationIntentHash: 'spoof' }, { creationRecordHash: 'spoof' }, { sessionUsageSnapshot: {} }]) {
    status(await request('/api/records/visits', 'POST', visit(service, metadata)), 400, 'client cannot forge server Visit usage metadata');
    status(await request('/api/records/visits/' + directId, 'PATCH', { ...editBase, ...metadata }), 400, 'client cannot rewrite saved Visit usage metadata');
  }
  const snapshotBeforeArchive = await sqlSnapshot();
  status(await request('/api/records/visits/' + directId, 'DELETE', { reason: 'Synthetic Visit archive' }), 200, 'archive usage-bound Visit');
  check(await sqlSnapshot() === snapshotBeforeArchive && lineIn(await ledger(), line.id).remainingSessions === 4,
    'Visit archive causes no automatic ledger reversal');
  const reverseCommand = { commandId: randomUUID(), expectedLineVersion: lineIn(await ledger(), line.id).version,
    expectedUsageVersion: active.version, reason: 'Synthetic erroneous usage correction' };
  const reversed = await request(base + '/usage/' + active.eventId + '/reversal', 'POST', reverseCommand); status(reversed, 200, 'explicit usage correction reversal');
  check(lineIn(reversed.body, line.id).remainingSessions === 5 && !reversed.body.activeVisitUsages.some((entry: any) => entry.visitId === directId),
    'reversal restores exactly deducted sessions and releases usage binding');
  check(reversed.body.events.some((event: any) => event.type === 'reversal' && event.reversesEventId === active.eventId && event.reason === reverseCommand.reason),
    'reversal retains immutable audit link and reason');
  check(reversed.body.events.find((event: any) => event.id === active.eventId).balanceAfter.remainingSessions === 4
    && reversed.body.events.find((event: any) => event.id === reversed.body.command.eventId).balanceAfter.remainingSessions === 5,
    'later reversal preserves original event balance and records its restored balance');
  const reverseEvents = await eventCount();
  status(await request(base + '/usage/' + active.eventId + '/reversal', 'POST', reverseCommand), 200, 'reversal retry safe');
  check(await eventCount() === reverseEvents, 'reversal retry emits no duplicate event');
  status(await request(base + '/usage/' + active.eventId + '/reversal', 'POST', { ...reverseCommand, commandId: randomUUID() }), 409, 'already reversed usage cannot restore balance twice');
  status(await request('/api/records/visits/' + directId + '/restore', 'POST', {}), 200, 'restore corrected Visit');
  status(await request('/api/records/visits/' + directId, 'PATCH', { ...editBase, sessionUsage: directPayload.sessionUsage }), 200,
    'retrying original usage after reversal does not restore its deduction');
  check(await eventCount() === reverseEvents && lineIn(await ledger(), line.id).remainingSessions === 5,
    'reversed original usage retry remains an immutable no-op');
  status(await request('/api/records/visits/' + directId, 'PATCH', { ...editBase, serviceSelection: { serviceId: otherService.id, expectedVersion: otherService.version } }), 200,
    'explicit reversal permits corrected performed Service');
  let adjustmentLine = lineIn(await ledger(), line.id);
  const adjustment = { commandId: randomUUID(), expectedLineVersion: adjustmentLine.version, delta: -2, reason: 'Synthetic purchased quantity correction' };
  const adjusted = await request(base + '/lines/' + line.id + '/adjustments', 'POST', adjustment); status(adjusted, 200, 'explicit adjustment succeeds');
  adjustmentLine = lineIn(adjusted.body, line.id);
  check(adjustmentLine.purchasedSessions === 5 && adjustmentLine.adjustmentSessions === -2 && adjustmentLine.remainingSessions === 3,
    'adjustment preserves original quantity and derives corrected balance');
  check(adjusted.body.events.find((event: any) => event.id === adjusted.body.command.eventId).balanceAfter.remainingSessions === 3,
    'adjustment timeline freezes the resulting balance');
  status(await request(base + '/lines/' + line.id + '/adjustments', 'POST', { ...adjustment, commandId: randomUUID(), delta: 1 }), 409, 'stale adjustment version denied');
  status(await request(base + '/lines/' + line.id + '/adjustments', 'POST', { ...adjustment, commandId: randomUUID(), expectedLineVersion: adjustmentLine.version, delta: -4 }), 409, 'adjustment cannot create negative balance');
  for (const delta of [0, 1.5, '1', null]) status(await request(base + '/lines/' + line.id + '/adjustments', 'POST', {
    commandId: randomUUID(), expectedLineVersion: adjustmentLine.version, delta, reason: 'Invalid quantity' }), 400, 'invalid adjustment quantity denied');
  status(await request(base + '/lines/' + line.id + '/adjustments', 'POST', {
    commandId: randomUUID(), expectedLineVersion: adjustmentLine.version, delta: 1, reason: '' }), 400, 'adjustment reason required');
  const tiny = await createPurchase(purchasePayload([service], 'A', { lines: [{ serviceId: service.id, expectedServiceVersion: service.version, purchasedSessions: 1 }] }));
  const tinyLine = tiny.lines[0], racers = [visit(service, { sessionUsage: usage(tinyLine) }), visit(service, { sessionUsage: usage(tinyLine) })];
  const raced = await Promise.all(racers.map(payload => request('/api/records/visits', 'POST', payload)));
  check(raced.map(result => result.status).sort().join() === '201,409', 'concurrent session redemption has exactly one winner');
  check(lineIn(await ledger(), tinyLine.id).remainingSessions === 0
    && (await db.collection('visits').get()).docs.filter(document => racers.some(payload => payload.clientVisitId === document.id)).length === 1,
    'losing concurrent redemption creates no Visit and balance never negative');
  status(await request('/api/records/visits', 'POST', visit(service, { sessionUsage: usage(lineIn(await ledger(), tinyLine.id)) })), 409,
    'current-version redemption of exhausted line denied');
  status(await request('/api/records/visits', 'POST', visit(otherService, { sessionUsage: usage(lineIn(await ledger(), line.id)) })), 400,
    'redemption requires line Service to match performed Visit Service');
  status(await request('/api/records/visits', 'POST', visit(service, { patientId: 'other-patient', sessionUsage: usage(lineIn(await ledger(), line.id)) })), 404,
    'redemption cannot use a different patient package');
  for (const sessions of [0, -1, 1.5, '1', null]) status(await request('/api/records/visits', 'POST', visit(service, {
    sessionUsage: usage(lineIn(await ledger(), line.id), sessions as any) })), 400, 'invalid usage quantity denied');
  for (const sessionUsage of [{ ...usage(lineIn(await ledger(), line.id)), remainingSessions: 90 },
    { ...usage(lineIn(await ledger(), line.id)), actor: 'spoof' }, { ...usage(lineIn(await ledger(), line.id)), visitSnapshot: {} }])
    status(await request('/api/records/visits', 'POST', visit(service, { sessionUsage })), 400, 'client usage metadata denied');
  // A later edit can add explicitly requested usage to a previously saved Visit.
  const unboundPayload = visit(service), unbound = await request('/api/records/visits', 'POST', unboundPayload); status(unbound, 201, 'create Visit without usage');
  check(unbound.body.id === unboundPayload.clientVisitId
    && !(await ledger()).activeVisitUsages.some((entry: any) => entry.visitId === unbound.body.id),
    'clientVisitId without usage is a valid stable Visit identity and does not deduct sessions');
  const noUsageEvents = await eventCount(), noUsageRetry = await request('/api/records/visits', 'POST', unboundPayload);
  status(noUsageRetry, 200, 'identical clientVisitId retry without usage is accepted');
  check(noUsageRetry.body.id === unbound.body.id && await eventCount() === noUsageEvents,
    'no-usage Visit retry adds no ledger event');
  const updateLine = lineIn(await ledger(), line.id);
  const staleUsageBefore = await sqlSnapshot(), staleVisitBefore = JSON.stringify(await read('visits', unbound.body.id));
  const stalePatientBefore = JSON.stringify(await read('patients', 'patient'));
  const staleUsage = await request('/api/records/visits/' + unbound.body.id, 'PATCH', { ...unboundPayload,
    clientVisitId: undefined, serviceSelection: undefined, expectedVisitVersion: 0, sessionUsage: usage(updateLine) });
  status(staleUsage, 409, 'stale Visit cannot deduct package sessions');
  check(staleUsage.body.code === 'VISIT_VERSION_CHANGED' && await sqlSnapshot() === staleUsageBefore
    && JSON.stringify(await read('visits', unbound.body.id)) === staleVisitBefore
    && JSON.stringify(await read('patients', 'patient')) === stalePatientBefore,
    'Visit conflict leaves package balance, usage, event history, Visit and patient summaries untouched');
  status(await request('/api/records/visits/' + unbound.body.id, 'PATCH', { ...unboundPayload, clientVisitId: undefined,
    serviceSelection: undefined, sessionUsage: usage(updateLine) }), 200, 'Visit update with usage commits atomically');
  check(lineIn(await ledger(), line.id).remainingSessions === 2, 'explicit Visit update deducts exactly once');
  const appointmentDate = moment(), appointmentResult = await request('/api/records/appointments', 'POST', {
    patientId: 'patient', branchId: 'A', doctorId: null, appointmentDate, visitType: 'Treatment Session', status: 'Scheduled',
    serviceSelection: { serviceId: service.id, expectedVersion: service.version } }); status(appointmentResult, 201, 'create linked synthetic appointment');
  const linkedLine = lineIn(await ledger(), line.id), linkedPayload = visit(service, { visitDate: appointmentDate,
    appointmentId: appointmentResult.body.id, sessionUsage: usage(linkedLine) });
  const beforeAtomic = await sqlSnapshot(), beforePatient = JSON.stringify(await read('patients', 'patient')),
    beforeAppointment = JSON.stringify(await read('appointments', appointmentResult.body.id));
  const originalTransaction = db.runTransaction;
  db.runTransaction = async callback => originalTransaction(async transaction => {
    const create = transaction.create.bind(transaction);
    transaction.create = ((reference: any, data: any) => {
      if (reference.collectionPath === 'audit_logs') throw Error('Synthetic ledger audit failure');
      return create(reference, data);
    }) as any;
    return callback(transaction);
  });
  try { status(await request('/api/records/visits', 'POST', linkedPayload), 500, 'injected audit failure surfaced'); }
  finally { db.runTransaction = originalTransaction; }
  check(await sqlSnapshot() === beforeAtomic && !(await db.collection('visits').doc(linkedPayload.clientVisitId).get()).exists
    && JSON.stringify(await read('patients', 'patient')) === beforePatient && JSON.stringify(await read('appointments', appointmentResult.body.id)) === beforeAppointment,
    'failed Visit+usage rolls back SQL ledger, Visit, patient summaries and appointment completion');
  const linked = await request('/api/records/visits', 'POST', linkedPayload); status(linked, 201, 'linked Visit and usage success');
  check((await read('appointments', appointmentResult.body.id)).visitHistoryId === linked.body.id
    && (await read('appointments', appointmentResult.body.id)).status === 'Completed' && lineIn(await ledger(), line.id).remainingSessions === 1,
    'linked appointment, Visit and one session deduction commit together');
  let release!: () => void, arrived!: () => void, intercepted = false;
  const gate = new Promise<void>(resolve => { release = resolve; }), arrival = new Promise<void>(resolve => { arrived = resolve; });
  db.runTransaction = async callback => {
    if (!intercepted) { intercepted = true; arrived(); await gate; }
    return originalTransaction(callback);
  };
  try {
    const pending = request(base + '/purchases', 'POST', purchasePayload([service], 'A', { packageName: 'Queued forbidden purchase' }), 'staffA');
    await arrival;
    await db.collection('users').doc('staffA').update({ permissionOverrides: { ...allLedger, 'treatment_ledger.purchase': 'deny' } });
    const beforeRelease = await sqlSnapshot(); release(); status(await pending, 403, 'queued purchase rechecks revoked actor permission');
    check(await sqlSnapshot() === beforeRelease, 'queued authorization loss leaves all ledger SQL unchanged');
  } finally { release(); db.runTransaction = originalTransaction; }
  let releaseUsage!: () => void, arrivedUsage!: () => void, interceptedUsage = false;
  const usageGate = new Promise<void>(resolve => { releaseUsage = resolve; }), usageArrival = new Promise<void>(resolve => { arrivedUsage = resolve; });
  db.runTransaction = async callback => {
    if (!interceptedUsage) { interceptedUsage = true; arrivedUsage(); await usageGate; }
    return originalTransaction(callback);
  };
  try {
    const queuedVisit = visit(service, { performedByUserId: 'staffA', sessionUsage: usage(staffPurchase.lines[0]) });
    const pending = request('/api/records/visits', 'POST', queuedVisit, 'staffA');
    await usageArrival;
    await db.collection('users').doc('staffA').update({ permissionOverrides: { ...allLedger, 'treatment_ledger.view': 'deny' } });
    const beforeRelease = await sqlSnapshot(); releaseUsage(); status(await pending, 403, 'queued Visit usage rechecks revoked ledger view permission');
    check(await sqlSnapshot() === beforeRelease && !(await db.collection('visits').doc(queuedVisit.clientVisitId).get()).exists,
      'queued redemption authorization loss commits neither usage nor Visit');
  } finally { releaseUsage(); db.runTransaction = originalTransaction; }
  status(await request('/api/records/visits', 'POST', crossVisit, 'staffA'), 403,
    'identical Visit create retry still enforces current ledger viewing permission');
  // Constraints backstop dedicated API validation even for direct SQL mistakes.
  await sqlReject('UPDATE treatment_ledger_lines SET purchased_sessions=6 WHERE id=$1', [line.id], '23514', 'original purchased session quantity is immutable in SQL');
  await sqlReject('DELETE FROM treatment_ledger_purchases WHERE id=$1', [single.id], '23514', 'purchase history cannot be hard-deleted in SQL');
  await sqlReject('UPDATE treatment_ledger_events SET used_delta=0 WHERE id=$1', [active.eventId], '23514', 'usage event history cannot be rewritten in SQL');
  await sqlReject('DELETE FROM treatment_ledger_events WHERE id=$1', [active.eventId], '23514', 'usage event history cannot be deleted in SQL');
  await sqlReject("DELETE FROM app_records WHERE collection_path='patients' AND id='patient'", [], '23503', 'patient package relationship protected by foreign key');
  await sqlReject(`INSERT INTO treatment_ledger_events(id,command_id,request_hash,type,purchase_id,line_id,branch_id,sessions_delta,actor,reason,balance_after)
    VALUES($1,$2,$3,'adjustment',$4,$5,'A',-1,$6,'Synthetic direct SQL invalid balance',$7)`,
    [randomUUID(), randomUUID(), 'a'.repeat(64), tiny.id, tinyLine.id, JSON.stringify({ uid: 'admin', name: 'Synthetic admin', role: 'admin' }),
      JSON.stringify({ purchasedSessions: 1, adjustmentSessions: -1, usedSessions: 1, remainingSessions: -1 })],
    '23514', 'SQL adjustment cannot drive remaining balance negative');
  const ownerLine = lineIn(await ledger(), line.id);
  await sqlReject(`INSERT INTO treatment_ledger_events(id,command_id,request_hash,type,purchase_id,line_id,branch_id,sessions_delta,actor,reason,balance_after)
    VALUES($1,$2,$3,'adjustment',$4,$5,'A',1,$6,'Synthetic mismatched purchase',$7)`,
    [randomUUID(), randomUUID(), 'b'.repeat(64), tiny.id, line.id, JSON.stringify({ uid: 'admin', name: 'Synthetic admin', role: 'admin' }),
      JSON.stringify({ purchasedSessions: ownerLine.purchasedSessions, adjustmentSessions: ownerLine.adjustmentSessions + 1,
        usedSessions: ownerLine.usedSessions, remainingSessions: ownerLine.remainingSessions + 1 })],
    '23514', 'SQL event cannot bind line to another purchase');
  await db.collection('patients').doc('patient').update({ isArchived: true });
  const archivedLedger = await ledger(), beforeArchivedRetry = await sqlSnapshot();
  check(archivedLedger.purchases.length > 0, 'archived patient ledger history remains readable');
  status(await request(base + '/purchases', 'POST', purchasePayload([service])), 409, 'archived patient package mutation denied');
  status(await request('/api/records/visits', 'POST', linkedPayload), 409,
    'identical Visit create retry still rechecks archived patient context');
  check(await sqlSnapshot() === beforeArchivedRetry, 'archived patient retries change no ledger records');
  await db.collection('patients').doc('patient').update({ isArchived: false });
  const storedSnapshots = JSON.stringify((await ledger()).purchases.map((purchase: any) => ({ branchNameSnapshot: purchase.branchNameSnapshot,
    lines: purchase.lines.map((line: any) => ({ serviceNameSnapshot: line.serviceNameSnapshot, serviceCatalogueVersion: line.serviceCatalogueVersion })) })));
  const serviceEdit = await request('/api/services/' + service.id, 'PATCH', { expectedVersion: service.version, name: 'Renamed inactive synthetic laser', active: false }); status(serviceEdit, 200, 'deactivate/rename purchased Service');
  await db.collection('branches').doc('A').update({ branchName: 'Renamed synthetic branch A' });
  await db.collection('users').doc('nurse').update({ fullName: 'Renamed synthetic performer' });
  const historical = await ledger();
  check(JSON.stringify(historical.purchases.map((purchase: any) => ({ branchNameSnapshot: purchase.branchNameSnapshot,
    lines: purchase.lines.map((line: any) => ({ serviceNameSnapshot: line.serviceNameSnapshot, serviceCatalogueVersion: line.serviceCatalogueVersion })) }))) === storedSnapshots,
    'rename/deactivation retains authoritative historical purchase snapshots');
  const ledgerBeforeHistoricalEdit = await sqlSnapshot();
  status(await request('/api/records/visits/' + linked.body.id, 'PATCH', { ...linkedPayload, clientVisitId: undefined,
    serviceSelection: undefined, sessionUsage: undefined, notes: 'Edited documentation with retained inactive historical Service' }), 200,
    'ordinary documentation edit retains inactive historical Service and existing usage');
  check(await sqlSnapshot() === ledgerBeforeHistoricalEdit
    && (await ledger()).activeVisitUsages.find((entry: any) => entry.visitId === linked.body.id).visitSnapshot.performedByNameSnapshot === 'Original synthetic performer',
    'unrelated historical edit creates no deduction or snapshot refresh');
  status(await request('/api/records/visits', 'POST', visit(serviceEdit.body, { sessionUsage: usage(lineIn(historical, line.id)) })), 400, 'inactive historical Service cannot start new redemption');
  for (const collection of ['treatment_ledger_purchases', 'treatment_ledger_lines', 'treatment_ledger_events', 'treatment_ledger_visit_usage', 'treatmentLedger']) {
    check((await request('/api/data/query', 'POST', { path: collection, kind: 'collection', constraints: [] })).status >= 400, 'generic data query cannot access ledger ' + collection);
    check((await request('/api/data/write', 'POST', { operations: [{ path: collection + '/forged', mode: 'set', data: { remainingSessions: 999 } }] })).status >= 400,
      'generic data write cannot forge ledger ' + collection);
  }
  status(await request('/api/data/write', 'POST', { operations: [{ path: 'visits/' + linked.body.id, mode: 'update', data: { sessionUsage: { sessions: -1 } } }] }), 403, 'generic Visit write cannot bypass session API');
  assertBalances(await ledger());
  console.log(`Treatment ledger API: ${checks} checks passed (real HTTP/authentication, PostgreSQL transactions and synthetic records).`);
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool.end();
}
