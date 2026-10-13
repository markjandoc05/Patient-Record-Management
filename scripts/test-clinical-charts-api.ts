import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

// Only the caller-created, empty disposable database may receive synthetic data.
const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const configuredOrigin = new URL(process.env.APP_URL || 'https://invalid');
const storage = path.resolve(process.env.STORAGE_DIR || '/');
const temporaryRoots = [tmpdir(), '/private/tmp', '/tmp'].map(value => path.resolve(value));
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_clinical_charts_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.NODE_ENV !== 'production'
  || !configuredOrigin.hostname.endsWith('.invalid') || !temporaryRoots.some(root => storage.startsWith(root + path.sep))) {
  throw Error('Use empty loopback vine_clinical_charts_test, production test middleware, synthetic .invalid APP_URL and temporary STORAGE_DIR');
}
const origin = configuredOrigin.origin;
const sessions = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen> | undefined;
let checks = 0, visitIndex = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; }
type Result = { status: number; body: any; cacheControl: string | null };
async function request(route: string, method = 'GET', body?: any, actor = 'admin', headers: Record<string, string> = {}): Promise<Result> {
  const session = sessions.get(actor);
  const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json',
      ...(session ? { Cookie: session.cookie, Authorization: `Bearer ${session.csrf}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null), cacheControl: response.headers.get('cache-control') };
}
function status(result: Result, expected: number, message: string) {
  check(result.status === expected, `${message}: expected ${expected}, received ${result.status} ${result.body?.error || ''}`);
}
const read = async (collection: string, id: string) => (await db.collection(collection).doc(id).get()).data()!;
const chartRoute = (id: string) => `/api/records/visits/${id}/chart`;
const getChart = (id: string, actor = 'admin') => request(chartRoute(id), 'GET', undefined, actor);
const marker = (id = 'face-1', map = 'face') => ({ id, map, x: 0.25, y: 0.4, label: 'Synthetic point', notes: 'Synthetic private point note' });
const draftPayload = (envelope: any, markers = [marker()], notes = 'Synthetic private chart note') => ({
  expectedVersion: envelope.chart?.version ?? 0, expectedContextKey: envelope.contextKey, markers, notes,
});
const versionPayload = (envelope: any) => ({ expectedVersion: envelope.chart?.version ?? 0, expectedContextKey: envelope.contextKey });
const saveDraft = (id: string, envelope: any, actor = 'admin', markers = [marker()], notes = 'Synthetic private chart note') =>
  request(chartRoute(id) + '/draft', 'PUT', draftPayload(envelope, markers, notes), actor);
const signChart = (id: string, envelope: any, actor = 'admin') => request(chartRoute(id) + '/sign', 'POST', versionPayload(envelope), actor);
const amendChart = (id: string, envelope: any, reason = 'Synthetic correction reason', actor = 'admin') =>
  request(chartRoute(id) + '/amendment', 'POST', { ...versionPayload(envelope), reason }, actor);
const chartBytes = async (id: string) => JSON.stringify(await read('clinical_charts', id));
function visitPayload(extra: any = {}) {
  const index = visitIndex++;
  return { patientId: 'patient', branchId: 'A', doctorId: 'doctor',
    visitDate: `2036-01-${String(1 + Math.floor(index / 16)).padStart(2, '0')}T${String(10 + Math.floor(index % 16 / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
    visitType: 'Treatment Session', mainConcern: '', diagnosis: '', treatmentPlan: '', notes: '', ...extra };
}
async function createVisit(extra: any = {}, actor = 'admin') {
  const payload = visitPayload(extra);
  const result = await request('/api/records/visits', 'POST', payload, actor);
  status(result, 201, 'create persisted synthetic Visit');
  return { id: result.body.id as string, payload };
}
async function profile(id: string, patch: any) { await db.collection('users').doc(id).update(patch); }
async function missingStatus(result: Result, message: string) { check([400, 404].includes(result.status), message); }

try {
  const existing = await pool.query("SELECT to_regclass('public.app_records') AS records");
  if (existing.rows[0].records) throw Error('vine_clinical_charts_test must be empty; recreate only this disposable database');
  await migrateDatabase(); await migrateDatabase();
  const migrations = await pool.query('SELECT name, checksum FROM schema_migrations ORDER BY name');
  const committedNames = (await readdir(path.resolve('migrations'))).filter(name => name.endsWith('.sql')).sort();
  check(committedNames.length === 4 && migrations.rows.length === 4, 'fresh committed migration chain remains 001–004');
  check(JSON.stringify(migrations.rows.map(row => row.name)) === JSON.stringify(committedNames), 'applied migration names match the ordered committed chain');
  for (const row of migrations.rows) {
    check(row.checksum === createHash('sha256').update(await readFile(path.resolve('migrations', row.name))).digest('hex'), `committed checksum matches ${row.name}`);
  }
  for (const [id, branchStatus] of [['A', 'Active'], ['B', 'Active'], ['C', 'Inactive']]) {
    await db.collection('branches').doc(id).set({ branchName: 'Synthetic branch ' + id, status: branchStatus });
  }
  const actors: Record<string, any> = {
    admin: { role: 'admin', fullName: 'Synthetic Administrator', assignedBranches: ['A', 'B'] },
    doctor: { role: 'doctor', fullName: 'Synthetic Assigned Doctor', assignedBranches: ['A'] },
    otherDoctor: { role: 'doctor', fullName: 'Synthetic Other Doctor', assignedBranches: ['A', 'B'] },
    staff: { role: 'staff', fullName: 'Synthetic Nurse', staffDesignation: 'Nurse', assignedBranches: ['A'],
      permissionOverrides: { 'visits.edit': 'deny', 'clinical.edit_draft': 'deny' } },
    manager: { role: 'manager', fullName: 'Synthetic Manager', assignedBranches: ['B'] },
    support: { role: 'support_developer', fullName: 'Synthetic Legacy Support', assignedBranches: ['A', 'B'] },
  };
  for (const [id, actor] of Object.entries(actors)) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(id).set({ active: true, ...actor });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id, csrf]);
    sessions.set(id, { cookie: `${origin.startsWith('https') ? '__Host-' : ''}vine_session=${token}`, csrf });
  }
  await db.collection('patients').doc('patient').set({ name: 'Synthetic chart patient', patientID: 'SYNTHETIC-CHART', isArchived: false });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');

  // Persisting a Visit is a prerequisite. Viewing does not create a chart.
  const primary = await createVisit({}, 'doctor');
  const empty = await getChart(primary.id, 'doctor'); status(empty, 200, 'assigned Doctor opens Visit chart');
  check(empty.body.visitId === primary.id && empty.body.chart === null, 'legacy Visit starts with an absent chart');
  check(empty.cacheControl?.includes('no-store'), 'clinical GET disables caching');
  check(!(await db.collection('clinical_charts').doc(primary.id).get()).exists, 'opening a chart does not write an empty record');
  check(empty.body.visitContext.visitId === primary.id && empty.body.visitContext.patientId === 'patient'
    && empty.body.visitContext.branchId === 'A' && empty.body.visitContext.doctorId === 'doctor', 'server supplies authoritative Visit relationships');
  check(empty.body.permissions.canEdit && !empty.body.permissions.canSign, 'assigned Doctor may draft; finalization is not granted automatically');
  status(await getChart(primary.id, 'anonymous'), 401, 'anonymous chart read denied');
  await missingStatus(await getChart('not-a-visit'), 'unpersisted Visit cannot open chart');
  await missingStatus(await request('/api/records/visits/%20/chart'), 'invalid Visit identifier rejected');

  const maps = [marker('face-1', 'face'), marker('front-1', 'body-front'), marker('back-1', 'body-back')];
  const saved = await saveDraft(primary.id, empty.body, 'doctor', maps); status(saved, 200, 'save all three supported maps');
  const initial = (await getChart(primary.id, 'doctor')).body;
  check(initial.chart.schemaVersion === 1 && initial.chart.version === 1 && initial.chart.visitId === primary.id, 'first draft has one monotonic chart version');
  check(initial.chart.draft.markers.length === 3 && initial.chart.revisions.length === 0, 'face/front/back points are one unsigned Visit chart');
  check(initial.chart.draft.createdBy.uid === 'doctor' && initial.chart.draft.updatedBy.uid === 'doctor', 'draft authorship comes from the session');
  check(initial.chart.createdBy.uid === 'doctor' && initial.chart.draft.contextKey === initial.contextKey, 'chart author and saved context are authoritative');
  check(initial.chart.draft.notes === 'Synthetic private chart note' && initial.chart.draft.markers[0].notes === maps[0].notes, 'clinical notes persist in the dedicated chart document');
  check(!Object.hasOwn(await read('visits', primary.id), 'clinicalChart'), 'separate chart storage does not expand operational Visit records');
  const beforeRejected = await chartBytes(primary.id);
  status(await saveDraft(primary.id, empty.body, 'doctor'), 409, 'lost first-save response retry cannot duplicate or overwrite a newer draft');
  check(await chartBytes(primary.id) === beforeRejected, 'stale retry leaves stored draft unchanged');
  const update = await saveDraft(primary.id, initial, 'doctor', [maps[1]], 'Updated synthetic chart note'); status(update, 200, 'edit/delete draft markers');
  const updated = (await getChart(primary.id, 'doctor')).body;
  check(updated.chart.version === 2 && updated.chart.draft.markers.length === 1 && updated.chart.draft.markers[0].id === 'front-1', 'draft edits replace only the current draft');
  check(updated.chart.createdBy.uid === 'doctor' && updated.chart.draft.createdBy.uid === 'doctor', 'editing retains original attribution');

  // Strict shape and limits reject invalid maps, coordinates and forged server facts.
  const invalidMarkers: any[] = [
    { ...marker(), map: 'dental' }, { ...marker(), map: 'body' },
    { ...marker(), x: -0.001 }, { ...marker(), x: 1.001 }, { ...marker(), y: -1 }, { ...marker(), y: 2 },
    { ...marker(), x: null }, { ...marker(), x: '0.2' }, { ...marker(), y: {} },
    { ...marker(), id: '' }, { ...marker(), id: 'x'.repeat(65) },
    { ...marker(), label: 'x'.repeat(101) }, { ...marker(), notes: 'x'.repeat(1001) },
    { ...marker(), signedBy: { uid: 'forged' } },
  ];
  for (const point of invalidMarkers) status(await request(chartRoute(primary.id) + '/draft', 'PUT', draftPayload(updated, [point]), 'doctor'), 400, 'malformed, unsupported or forged marker rejected');
  for (const markers of [null, {}, [marker(), marker()], Array.from({ length: 101 }, (_, index) => marker('point-' + index))]) {
    status(await request(chartRoute(primary.id) + '/draft', 'PUT', { ...draftPayload(updated), markers }, 'doctor'), 400, 'invalid marker collection rejected');
  }
  for (const notes of ['x'.repeat(3001), {}, null]) status(await request(chartRoute(primary.id) + '/draft', 'PUT', { ...draftPayload(updated), notes }, 'doctor'), 400, 'invalid chart notes rejected');
  for (const field of ['createdBy', 'updatedBy', 'signedBy', 'signedAt', 'revisions', 'visitId', 'context', 'contextKey', 'schemaVersion']) {
    status(await request(chartRoute(primary.id) + '/draft', 'PUT', { ...draftPayload(updated), [field]: 'forged' }, 'doctor'), 400, 'client cannot forge chart ' + field);
  }
  for (const expectedVersion of [-1, 0.5, '2', null]) status(await request(chartRoute(primary.id) + '/draft', 'PUT', { ...draftPayload(updated), expectedVersion }, 'doctor'), 400, 'malformed expected version rejected');
  status(await request(chartRoute(primary.id) + '/draft', 'PUT', { ...draftPayload(updated), expectedContextKey: '0'.repeat(64) }, 'doctor'), 409, 'stale Visit context rejected');
  check(await chartBytes(primary.id) === JSON.stringify(updated.chart), 'all denied writes preserve exact chart content');

  // Existing longitudinal reads remain shared; write permissions/ownership stay independent.
  for (const actor of ['staff', 'manager', 'otherDoctor']) {
    const result = await getChart(primary.id, actor); status(result, 200, actor + ' keeps established shared clinical history visibility');
    check(!result.body.permissions.canEdit && !result.body.permissions.canSign, actor + ' remains read-only on another Doctor chart');
    status(await saveDraft(primary.id, result.body, actor), 403, actor + ' cannot mutate through a chart endpoint');
  }
  await profile('manager', { permissionOverrides: { 'clinical.view': 'deny' } });
  status(await getChart(primary.id, 'manager'), 403, 'clinical denial blocks dedicated chart read');
  const operational = await request('/api/data/query', 'POST', { kind: 'document', path: 'visits/' + primary.id }, 'manager');
  status(operational, 200, 'clinical denial still permits operational Visit view');
  check(!JSON.stringify(operational.body).includes('Synthetic private'), 'operational Visit projection never leaks chart notes');
  await profile('manager', { permissionOverrides: { 'visits.view': 'deny' } });
  status(await getChart(primary.id, 'manager'), 403, 'Visit view denial blocks chart read independently');
  await profile('manager', { permissionOverrides: {} });
  for (const kind of ['document', 'collection']) {
    for (const actor of ['admin', 'doctor', 'staff']) status(await request('/api/data/query', 'POST', {
      kind, path: kind === 'document' ? 'clinical_charts/' + primary.id : 'clinical_charts',
      constraints: [{ type: 'where', field: 'draft.notes', operator: '==', value: 'Updated synthetic chart note' }],
    }, actor), 403, 'generic chart read/query bypass denied for ' + actor);
  }
  for (const mode of ['create', 'set', 'update', 'delete']) status(await request('/api/data/write', 'POST', {
    operations: [{ path: 'clinical_charts/' + primary.id, mode, data: { version: 999, revisions: [{ signedBy: 'forged' }] } }],
  }), 403, 'generic chart write bypass denied');
  const tamperedVisit = await request('/api/records/visits/' + primary.id, 'PATCH', { ...primary.payload, clinicalChart: { signedBy: 'forged' }, chart: { version: 999 } });
  check([200, 400].includes(tamperedVisit.status), 'regular Visit request rejects or ignores unsupported chart injection');
  check(await chartBytes(primary.id) === JSON.stringify(updated.chart), 'regular Visit edit cannot forge chart state');
  check(!Object.hasOwn(await read('visits', primary.id), 'clinicalChart') && !Object.hasOwn(await read('visits', primary.id), 'chart'), 'regular Visit payload cannot store bypass chart fields');
  status(await request(chartRoute(primary.id) + '/draft', 'PUT', draftPayload(updated), 'doctor', { Origin: 'https://untrusted.invalid' }), 403, 'chart write requires trusted origin');
  status(await request(chartRoute(primary.id) + '/draft', 'PUT', draftPayload(updated), 'doctor', { Authorization: 'Bearer wrong-csrf' }), 403, 'chart write requires valid CSRF session token');

  // No default role can sign; an explicit existing capability can enable signing.
  for (const actor of ['admin', 'doctor', 'support']) status(await signChart(primary.id, updated, actor), 403, actor + ' receives no automatic finalization authority');
  await profile('doctor', { permissionOverrides: { 'clinical.finalize': 'allow' } });
  const allowed = (await getChart(primary.id, 'doctor')).body;
  check(allowed.permissions.canSign, 'explicit finalization permission enables own assigned Doctor');
  const signed = await signChart(primary.id, allowed, 'doctor'); status(signed, 200, 'explicitly authorized assigned Doctor signs chart');
  const signedEnvelope = (await getChart(primary.id, 'doctor')).body;
  check(signedEnvelope.chart.draft === null && signedEnvelope.chart.revisions.length === 1 && signedEnvelope.chart.version === 3, 'sign moves draft into one immutable revision');
  const firstRevision = JSON.stringify(signedEnvelope.chart.revisions[0]);
  check(signedEnvelope.chart.revisions[0].revision === 1 && signedEnvelope.chart.revisions[0].signedBy.uid === 'doctor', 'signed revision attribution is server-derived');
  check(signedEnvelope.chart.revisions[0].context.doctorId === 'doctor' && signedEnvelope.chart.revisions[0].context.branchId === 'A', 'signature retains authoritative Visit context');
  check(!Object.hasOwn(await read('visits', primary.id), 'signedAt') && !Object.hasOwn(await read('visits', primary.id), 'isSigned'), 'chart signing does not finalize or rewrite the Visit workflow');
  status(await signChart(primary.id, allowed, 'doctor'), 409, 'lost sign response retry cannot append another signature');
  status(await saveDraft(primary.id, signedEnvelope, 'doctor'), 409, 'signed chart cannot be edited without an attributed amendment');
  status(await request(chartRoute(primary.id) + '/sign', 'POST', { ...versionPayload(signedEnvelope), signedBy: 'forged' }, 'doctor'), 400, 'signature author cannot be client-supplied');
  check(JSON.stringify((await getChart(primary.id)).body.chart.revisions[0]) === firstRevision, 'failed signed edits never modify historical revision');

  // Amendment attribution, version conflicts and exact historical snapshots.
  for (const reason of ['', '   ', 'x'.repeat(501), null, {}]) status(await amendChart(primary.id, signedEnvelope, reason as any, 'doctor'), 400, 'amendment requires bounded descriptive reason');
  status(await request(chartRoute(primary.id) + '/amendment', 'POST', { ...versionPayload(signedEnvelope), reason: 'Synthetic correction', signedAt: 'forged' }, 'doctor'), 400, 'amendment rejects forged history fields');
  const amendment = await amendChart(primary.id, signedEnvelope, 'Synthetic correction reason', 'doctor'); status(amendment, 200, 'begin explicitly attributed amendment');
  const amended = (await getChart(primary.id, 'doctor')).body;
  check(amended.chart.draft.kind === 'amendment' && amended.chart.draft.reason === 'Synthetic correction reason', 'amendment reason is retained on its draft');
  check(amended.chart.draft.createdBy.uid === 'doctor' && amended.chart.draft.markers[0].id === 'front-1', 'amendment copies latest signed content with current actor attribution');
  status(await amendChart(primary.id, signedEnvelope, 'Synthetic duplicate', 'doctor'), 409, 'lost amendment response retry cannot create duplicate draft');
  status(await signChart(primary.id, signedEnvelope, 'doctor'), 409, 'old signed version cannot sign newer amendment');
  status(await saveDraft(primary.id, amended, 'doctor', [marker('back-2', 'body-back')], 'Amended synthetic chart note'), 200, 'edit amendment content');
  const changedAmendment = (await getChart(primary.id, 'doctor')).body;
  status(await signChart(primary.id, changedAmendment, 'doctor'), 200, 'sign amendment with explicit capability');
  const twoSigned = (await getChart(primary.id, 'doctor')).body;
  check(twoSigned.chart.revisions.length === 2 && twoSigned.chart.revisions[1].revision === 2 && twoSigned.chart.revisions[1].kind === 'amendment', 'amendment appends one new revision');
  check(twoSigned.chart.revisions[1].reason === 'Synthetic correction reason' && twoSigned.chart.revisions[1].signedBy.uid === 'doctor', 'signed amendment retains reason and signer');
  check(JSON.stringify(twoSigned.chart.revisions[0]) === firstRevision, 'earlier signed content remains byte-for-byte immutable');

  // Operational Visit changes continue, with new chart context and frozen history.
  // The optional attribution is ignored by committed HEAD; when performer support
  // is present, keep its branch eligibility valid while testing chart preservation.
  const editVisit = { ...primary.payload, branchId: 'B', doctorId: 'otherDoctor', performedByUserId: 'otherDoctor', notes: 'Unrelated Visit edit' };
  status(await request('/api/records/visits/' + primary.id, 'PATCH', editVisit), 200, 'chart signature preserves ordinary Visit edit workflow');
  const moved = (await getChart(primary.id)).body;
  check(moved.contextKey !== twoSigned.contextKey && moved.visitContext.doctorId === 'otherDoctor' && moved.visitContext.branchId === 'B', 'live Visit reassignment changes server context key');
  check(JSON.stringify(moved.chart.revisions[0]) === firstRevision && moved.chart.revisions[1].context.doctorId === 'doctor', 'Visit reassignment never rewrites signed historical context');
  status(await amendChart(primary.id, moved, 'Old doctor attempted edit', 'doctor'), 403, 'prior Doctor cannot amend after reassignment');
  status(await amendChart(primary.id, twoSigned, 'Stale context edit'), 409, 'old admin context cannot start amendment after reassignment');
  status(await amendChart(primary.id, moved, 'Synthetic new-context amendment'), 200, 'administrator keeps existing clinical draft authority in new context');
  const movedDraft = (await getChart(primary.id)).body;
  await profile('admin', { permissionOverrides: { 'clinical.finalize': 'allow' } });
  const newTime = { ...editVisit, visitDate: visitPayload().visitDate };
  status(await request('/api/records/visits/' + primary.id, 'PATCH', newTime), 200, 'reschedule Visit without rewriting draft history');
  const rescheduled = (await getChart(primary.id)).body;
  status(await signChart(primary.id, movedDraft), 409, 'stale request context cannot sign after Visit reschedule');
  status(await signChart(primary.id, rescheduled), 409, 'current request cannot sign draft captured against an older Visit context');
  status(await saveDraft(primary.id, rescheduled, 'admin', rescheduled.chart.draft.markers, rescheduled.chart.draft.notes), 200, 'review/save draft captures current authoritative Visit context');
  const reviewed = (await getChart(primary.id)).body;
  status(await signChart(primary.id, reviewed), 200, 'reviewed new-context amendment can be signed');
  const finalPrimary = (await getChart(primary.id)).body;
  check(finalPrimary.chart.revisions[2].context.doctorId === 'otherDoctor' && finalPrimary.chart.revisions[2].context.visitDate === newTime.visitDate, 'new revision captures current assigned Doctor and schedule');
  check(JSON.stringify(finalPrimary.chart.revisions[0]) === firstRevision, 'new-context amendment keeps original signed context intact');

  // Readable historical/inactive relationships are distinct from eligible draft writes.
  // Imported historical data need not satisfy today's Visit creation requirements.
  // Seed only this guarded disposable database; do not depend on Unassigned booking.
  const unassigned = { id: 'legacy-unassigned' };
  await db.collection('visits').doc(unassigned.id).set({ ...visitPayload({ doctorId: null }),
    patientName: 'Synthetic chart patient', branchName: 'Synthetic branch A', status: 'Completed', visitSource: 'Walk-in' });
  const unassignedChart = (await getChart(unassigned.id)).body;
  check(!unassignedChart.permissions.canEdit, 'legacy Visit without a Doctor or performer remains readable but requires performer selection');
  status(await saveDraft(unassigned.id, unassignedChart), 409, 'chart does not invent a missing Doctor or performer');

  // Nurse-led charts use recorded performer relationships, not a Doctor assignment.
  // Seed imported records here so the chart suite also runs on committed HEAD plus
  // charts alone. Current Visit create integration is checked separately.
  const nurseVisit = { id: 'nurse-led-chart' };
  const nurseRecord = { ...visitPayload({ doctorId: null }), patientName: 'Synthetic chart patient',
    branchName: 'Synthetic branch A', status: 'Completed', visitSource: 'Walk-in',
    performedByUserId: 'staff', performedByNameSnapshot: 'Recorded Nurse',
    performedByRoleSnapshot: 'staff', performedByDesignationSnapshot: 'Nurse', assistingStaffText: 'Synthetic assistant' };
  await db.collection('visits').doc(nurseVisit.id).set(nurseRecord);
  const nurseVisitBytes = JSON.stringify(await read('visits', nurseVisit.id));
  const nurseStart = await getChart(nurseVisit.id);
  status(nurseStart, 200, 'authorized administrator opens nurse-led Visit without a Doctor');
  check(nurseStart.body.permissions.canEdit && nurseStart.body.visitContext.doctorId === '', 'nurse-led Visit is chart eligible without assigning a Doctor');
  check(nurseStart.body.visitContext.performedByUserId === 'staff'
    && nurseStart.body.visitContext.performedByNameSnapshot === 'Recorded Nurse'
    && nurseStart.body.visitContext.performedByDesignationSnapshot === 'Nurse', 'server context captures recorded performer snapshots');
  await profile('staff', { permissionOverrides: {} });
  check((await getChart(nurseVisit.id, 'staff')).body.permissions.canEdit, 'Nurse inherits chart drafting without manual grants');
  for (const permissionOverrides of [{ 'visits.edit': 'deny' }, { 'clinical.edit_draft': 'deny' }, { 'visits.edit': 'allow', 'clinical.edit_draft': 'deny' }]) {
    await profile('staff', { permissionOverrides });
    const denied = await getChart(nurseVisit.id, 'staff'); status(denied, 200, 'Nurse retains clinical history viewing');
    check(!denied.body.permissions.canEdit, 'explicit denial overrides inherited medical Staff editing');
    status(await saveDraft(nurseVisit.id, denied.body, 'staff'), 403, 'both existing clinical and Visit edit capabilities are required');
  }
  const nurseGrants = {};
  await profile('staff', { permissionOverrides: nurseGrants });
  const nurseEligible = (await getChart(nurseVisit.id, 'staff')).body;
  check(nurseEligible.permissions.canEdit && !nurseEligible.permissions.canSign, 'authorized Nurse may draft with no automatic signing grant');
  await profile('staff', { assignedBranches: ['B'] });
  const wrongBranchNurse = (await getChart(nurseVisit.id, 'staff')).body;
  check(!wrongBranchNurse.permissions.canEdit, 'Nurse editing grants do not expand branch scope');
  status(await saveDraft(nurseVisit.id, wrongBranchNurse, 'staff'), 403, 'Nurse chart write in an unauthorized branch is server denied');
  await profile('staff', { assignedBranches: ['A'], permissionOverrides: { ...nurseGrants, 'clinical.view': 'deny' } });
  status(await getChart(nurseVisit.id, 'staff'), 403, 'explicit clinical view denial hides Nurse chart content');
  status(await saveDraft(nurseVisit.id, nurseEligible, 'staff'), 403, 'editing grants cannot bypass denied clinical viewing');
  await profile('staff', { permissionOverrides: nurseGrants });
  status(await saveDraft(nurseVisit.id, nurseEligible, 'staff', maps), 200, 'authorized Nurse saves face/front/back chart without a Doctor');
  const nurseDraft = (await getChart(nurseVisit.id, 'staff')).body;
  check(nurseDraft.chart.draft.createdBy.uid === 'staff' && nurseDraft.chart.draft.context.doctorId === '', 'Nurse chart authorship and absent Doctor are authoritative');
  check(JSON.stringify(await read('visits', nurseVisit.id)) === nurseVisitBytes, 'chart save leaves the nurse-led Visit and assisting names unchanged');
  status(await signChart(nurseVisit.id, nurseDraft, 'staff'), 403, 'Nurse cannot sign without explicit finalization capability');
  status(await saveDraft(nurseVisit.id, nurseDraft, 'otherDoctor'), 403, 'an unrelated Doctor cannot take ownership of a nurse-led chart');

  // Live eligibility is rechecked for every action; history stays available.
  for (const [label, patch] of [
    ['inactive Nurse', { active: false }], ['archived Nurse', { isArchived: true }],
    ['pending Nurse', { accountStatus: 'pending' }], ['Nurse in another branch', { assignedBranches: ['B'] }],
    ['malformed performer branches', { assignedBranches: 'A' }],
    ['reception designation', { staffDesignation: 'Reception/Admin Staff' }],
    ['missing medical designation', { staffDesignation: null }],
  ] as const) {
    await profile('staff', { active: true, isArchived: false, accountStatus: 'active', assignedBranches: ['A'], staffDesignation: 'Nurse', ...patch });
    const denied = await getChart(nurseVisit.id); status(denied, 200, label + ' retains chart history');
    check(!denied.body.permissions.canEdit && !denied.body.permissions.canSign && !denied.body.permissions.canAmend, label + ' is read-only');
    status(await saveDraft(nurseVisit.id, denied.body), 409, label + ' cannot receive a chart draft');
    status(await signChart(nurseVisit.id, denied.body), 409, label + ' cannot receive a signature');
    status(await amendChart(nurseVisit.id, denied.body), 409, label + ' cannot start an amendment');
  }
  await profile('staff', { active: true, isArchived: false, accountStatus: 'active', assignedBranches: ['A'], staffDesignation: 'Nurse', permissionOverrides: nurseGrants });
  const nurseBytes = await chartBytes(nurseVisit.id);
  await db.collection('visits').doc(nurseVisit.id).update({ performedByUserId: 'deleted-performer' });
  const deletedPerformer = (await getChart(nurseVisit.id)).body;
  check(!deletedPerformer.permissions.canEdit, 'deleted performer keeps historical content read-only');
  status(await saveDraft(nurseVisit.id, deletedPerformer), 409, 'missing performer cannot receive a chart draft');
  await db.collection('visits').doc(nurseVisit.id).update({ performedByUserId: 'staff' });
  check(await chartBytes(nurseVisit.id) === nurseBytes, 'eligibility denials never rewrite the saved Nurse chart');

  // Performer-only changes invalidate both optimistic context and signing review.
  await db.collection('users').doc('medicalStaff').set({ active: true, role: 'staff', fullName: 'Current Medical Staff',
    staffDesignation: 'Medical Staff', assignedBranches: ['A'] });
  await db.collection('visits').doc(nurseVisit.id).update({ performedByUserId: 'medicalStaff',
    performedByNameSnapshot: 'Recorded Medical Staff', performedByDesignationSnapshot: 'Medical Staff' });
  const newPerformer = (await getChart(nurseVisit.id)).body;
  check(newPerformer.permissions.canEdit && newPerformer.contextKey !== nurseDraft.contextKey, 'Medical Staff is eligible and performer-only reassignment changes chart context');
  status(await saveDraft(nurseVisit.id, nurseDraft), 409, 'old performer context cannot save into a reassigned Visit');
  status(await signChart(nurseVisit.id, newPerformer), 409, 'saved Nurse draft cannot sign against unreviewed Medical Staff context');
  status(await saveDraft(nurseVisit.id, newPerformer), 200, 'reviewed Medical Staff context can be saved without a Doctor');
  const medicalDraft = (await getChart(nurseVisit.id)).body;
  status(await signChart(nurseVisit.id, medicalDraft), 200, 'explicitly authorized administrator signs Medical Staff chart');
  const medicalSigned = (await getChart(nurseVisit.id)).body;
  const medicalRevision = JSON.stringify(medicalSigned.chart.revisions[0]);
  check(medicalSigned.chart.revisions[0].context.performedByNameSnapshot === 'Recorded Medical Staff', 'signed revision freezes authoritative recorded performer');
  await db.collection('visits').doc(nurseVisit.id).update({ performedByUserId: 'staff', performedByNameSnapshot: 'Recorded Nurse', performedByDesignationSnapshot: 'Nurse' });
  const reassignedNurse = (await getChart(nurseVisit.id, 'staff')).body;
  status(await amendChart(nurseVisit.id, reassignedNurse, 'Nurse chart correction', 'staff'), 200, 'authorized Nurse starts an attributed amendment without a Doctor');
  const nurseAmendment = (await getChart(nurseVisit.id, 'staff')).body;
  status(await signChart(nurseVisit.id, nurseAmendment, 'staff'), 403, 'amendment does not grant Nurse signing authority');
  await profile('staff', { permissionOverrides: { ...nurseGrants, 'clinical.finalize': 'allow' } });
  status(await signChart(nurseVisit.id, nurseAmendment, 'staff'), 200, 'Nurse signs only with an explicit existing finalization grant');
  const nurseSigned = (await getChart(nurseVisit.id, 'staff')).body;
  check(nurseSigned.chart.revisions[1].signedBy.uid === 'staff' && nurseSigned.chart.revisions[1].context.performedByUserId === 'staff', 'signed Nurse amendment records actual signer and performer independently');
  check(JSON.stringify(nurseSigned.chart.revisions[0]) === medicalRevision, 'performer changes and amendments preserve prior signed context exactly');

  const originalNurseTransaction = db.runTransaction;
  let revokedNurse = false;
  db.runTransaction = async callback => {
    if (!revokedNurse) { revokedNurse = true; await originalNurseTransaction(async transaction => {
      transaction.update(db.collection('users').doc('staff'), { permissionOverrides: { ...nurseGrants, 'clinical.edit_draft': 'deny' } });
    }); }
    return originalNurseTransaction(callback);
  };
  try { status(await amendChart(nurseVisit.id, nurseSigned, 'Queued Nurse amendment', 'staff'), 403, 'queued Nurse amendment rechecks revoked clinical authority'); }
  finally { db.runTransaction = originalNurseTransaction; }
  check(JSON.stringify((await getChart(nurseVisit.id)).body.chart.revisions[0]) === medicalRevision, 'queued denial preserves signed history');
  await profile('staff', { permissionOverrides: {} });

  const performerDoctorId = 'performer-doctor-chart';
  await db.collection('visits').doc(performerDoctorId).set({ ...nurseRecord, performedByUserId: 'doctor',
    performedByNameSnapshot: 'Recorded Doctor', performedByRoleSnapshot: 'doctor', performedByDesignationSnapshot: null });
  const ownPerformer = (await getChart(performerDoctorId, 'doctor')).body;
  check(ownPerformer.permissions.canEdit, 'Doctor performer owns their doctorless imported Visit chart');
  status(await saveDraft(performerDoctorId, ownPerformer, 'doctor'), 200, 'Doctor performer may draft without changing Doctor assignment');
  status(await saveDraft(performerDoctorId, ownPerformer, 'otherDoctor'), 403, 'other Doctor cannot edit the performer-owned chart');
  const archivedVisit = await createVisit();
  const archivedStart = (await getChart(archivedVisit.id)).body;
  status(await saveDraft(archivedVisit.id, archivedStart), 200, 'create chart before archive');
  const archivedBytes = await chartBytes(archivedVisit.id);
  status(await request('/api/records/visits/' + archivedVisit.id, 'DELETE', { reason: 'Synthetic chart archive test' }), 200, 'Visit archive remains supported');
  const archivedEnvelope = await getChart(archivedVisit.id); status(archivedEnvelope, 200, 'archived Visit chart history remains readable');
  check(!archivedEnvelope.body.permissions.canEdit, 'archived chart is read-only');
  status(await saveDraft(archivedVisit.id, archivedEnvelope.body), 409, 'archived Visit chart mutation denied');
  status(await request('/api/records/visits/' + archivedVisit.id + '/restore', 'POST', {}), 200, 'restore Visit with chart');
  check(await chartBytes(archivedVisit.id) === archivedBytes, 'archive/restore preserves entire chart exactly');
  const sealedVisit = await createVisit();
  await db.collection('visits').doc(sealedVisit.id).update({ isFinalized: true });
  const sealed = await getChart(sealedVisit.id); status(sealed, 200, 'clinically sealed Visit retains chart viewing');
  status(await saveDraft(sealedVisit.id, sealed.body), 409, 'sealed Visit chart mutation denied without reopening Visit');
  await db.collection('patients').doc('patient').update({ isArchived: true });
  const archivedPatient = (await getChart(archivedVisit.id)).body;
  status(await saveDraft(archivedVisit.id, archivedPatient), 409, 'archived patient blocks new chart writes');
  await db.collection('patients').doc('patient').update({ isArchived: false });
  await profile('doctor', { active: false });
  const inactiveAssigned = (await getChart(archivedVisit.id)).body;
  check(!inactiveAssigned.permissions.canEdit, 'inactive assigned Doctor does not erase history but blocks authoring');
  status(await saveDraft(archivedVisit.id, inactiveAssigned), 409, 'server validates assigned Doctor eligibility');
  await profile('doctor', { active: true });
  await db.collection('branches').doc('A').update({ status: 'Inactive' });
  const inactiveBranch = (await getChart(archivedVisit.id)).body;
  status(await saveDraft(archivedVisit.id, inactiveBranch), 409, 'inactive branch cannot receive chart edits');
  await db.collection('branches').doc('A').update({ status: 'Active' });

  // Assigned-Doctor eligibility is independent of performer/designation features.
  const eligibilityVisit = await createVisit();
  for (const [label, patch] of [
    ['archived Doctor', { isArchived: true }],
    ['pending Doctor', { accountStatus: 'pending' }],
    ['Doctor assigned elsewhere', { assignedBranches: ['B'] }],
    ['malformed branch assignments', { assignedBranches: 'A' }],
    ['Nurse designation without Doctor role', { role: 'staff', staffDesignation: 'Nurse' }],
  ] as const) {
    await profile('doctor', { active: true, isArchived: false, accountStatus: 'active', role: 'doctor', assignedBranches: ['A'], ...patch });
    const envelope = await getChart(eligibilityVisit.id);
    status(envelope, 200, label + ' retains readable historical chart');
    check(!envelope.body.permissions.canEdit, label + ' cannot author an assigned Doctor chart');
    status(await saveDraft(eligibilityVisit.id, envelope.body), 409, label + ' is server denied');
  }
  await profile('doctor', { active: true, isArchived: false, accountStatus: 'active', role: 'doctor', assignedBranches: ['A'] });

  // Fresh authority is reloaded under the same serialized transaction as mutations.
  const authority = await createVisit({}, 'doctor');
  const authorityEnvelope = (await getChart(authority.id, 'doctor')).body;
  const originalTransaction = db.runTransaction;
  for (const narrowing of [
    { permissionOverrides: { 'clinical.edit_draft': 'deny' } },
    { permissionOverrides: { 'clinical.view': 'deny' } },
    { permissionOverrides: { 'visits.edit': 'deny' } },
    { assignedBranches: ['B'] },
    { active: false },
  ]) {
    await profile('doctor', { active: true, assignedBranches: ['A'], permissionOverrides: {} });
    let intercepted = false;
    db.runTransaction = async callback => {
      if (!intercepted) { intercepted = true; await originalTransaction(async transaction => { transaction.update(db.collection('users').doc('doctor'), narrowing); }); }
      return originalTransaction(callback);
    };
    try { status(await saveDraft(authority.id, authorityEnvelope, 'doctor'), 403, 'queued chart save rechecks current authority under lock'); }
    finally { db.runTransaction = originalTransaction; }
    check(!(await db.collection('clinical_charts').doc(authority.id).get()).exists, 'denied authority change leaves no partial chart');
  }
  await profile('doctor', { active: true, assignedBranches: ['A'], permissionOverrides: { 'clinical.finalize': 'allow' } });
  status(await saveDraft(authority.id, authorityEnvelope, 'doctor'), 200, 'valid Doctor may save after authority restoration');
  const authorityDraft = (await getChart(authority.id, 'doctor')).body;
  let revokedSign = false;
  db.runTransaction = async callback => {
    if (!revokedSign) { revokedSign = true; await originalTransaction(async transaction => { transaction.update(db.collection('users').doc('doctor'), { permissionOverrides: {} }); }); }
    return originalTransaction(callback);
  };
  try { status(await signChart(authority.id, authorityDraft, 'doctor'), 403, 'queued sign rechecks revoked finalization capability'); }
  finally { db.runTransaction = originalTransaction; }
  check((await read('clinical_charts', authority.id)).revisions.length === 0, 'revoked signer cannot leave a partial signature');

  // Concurrent saves have one winner, preserving version and atomic audit evidence.
  const concurrentEnvelope = (await getChart(authority.id, 'doctor')).body;
  const racing = await Promise.all([
    saveDraft(authority.id, concurrentEnvelope, 'doctor', [marker('race-a')], 'Synthetic first editor'),
    saveDraft(authority.id, concurrentEnvelope, 'doctor', [marker('race-b')], 'Synthetic second editor'),
  ]);
  check(racing.filter(result => result.status === 200).length === 1 && racing.filter(result => result.status === 409).length === 1, 'concurrent draft saves serialize version checks');
  const winner = (await read('clinical_charts', authority.id));
  check(winner.version === concurrentEnvelope.chart.version + 1 && winner.draft.markers.length === 1, 'concurrent draft result increments once and contains one submitted draft');
  const limitVisit = await createVisit();
  const limitRecord = { ...finalPrimary.chart, visitId: limitVisit.id, version: 100, draft: null,
    revisions: Array.from({ length: 50 }, (_, index) => ({ ...finalPrimary.chart.revisions[0], revision: index + 1 })) };
  await db.collection('clinical_charts').doc(limitVisit.id).set(limitRecord);
  const limitEnvelope = (await getChart(limitVisit.id)).body;
  check(!limitEnvelope.permissions.canAmend && !limitEnvelope.permissions.canSign, 'revision limit has a clear read-only action state');
  status(await amendChart(limitVisit.id, limitEnvelope), 409, 'server enforces bounded signed revision history');
  check((await read('clinical_charts', limitVisit.id)).revisions.length === 50, 'revision-limit denial retains all historical versions');
  await db.collection('clinical_charts').doc(limitVisit.id).update({ schemaVersion: 2 });
  status(await getChart(limitVisit.id), 409, 'future chart formats are not silently rewritten by this application version');
  await db.collection('clinical_charts').doc(limitVisit.id).update({ schemaVersion: 1 });
  const auditRows = (await pool.query("SELECT data FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1", [primary.id])).rows.map(row => row.data);
  const chartAudit = auditRows.filter(row => /chart/i.test(row.eventType || '') || row.resource === 'Clinical Chart');
  check(chartAudit.length >= 7, 'draft, signatures and amendments produce transactionally attributed audit metadata');
  check(chartAudit.every(row => row.userId && row.userRole && row.timestamp && row.source === 'trusted_server'), 'chart audit records are attributable to trusted server actions');
  check(!JSON.stringify(chartAudit).includes('Synthetic private') && !JSON.stringify(chartAudit).includes('Updated synthetic chart note')
    && !JSON.stringify(chartAudit).includes('Amended synthetic chart note') && !JSON.stringify(chartAudit).includes('Synthetic correction reason'), 'audit logs omit chart marker notes, chart notes and amendment content');

  const recordsBefore = JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path IN ('visits','clinical_charts') ORDER BY collection_path,id")).rows);
  await migrateDatabase();
  check(recordsBefore === JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path IN ('visits','clinical_charts') ORDER BY collection_path,id")).rows), 'migration rerun preserves legacy Visits, drafts and signed chart history exactly');
  check((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.length === 4, 'charts require no new SQL migration or alternate schema');
  console.log(`Clinical charts API: ${checks} checks passed (disposable synthetic database)`);
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool.end();
}
