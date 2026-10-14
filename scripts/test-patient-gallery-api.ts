import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
import { assertCurrentMigrationChain, resetDisposablePlatformRecords } from './platform-test-support';

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const configuredOrigin = new URL(process.env.APP_URL || 'https://invalid');
const storage = path.resolve(process.env.STORAGE_DIR || '/');
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_gallery_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.NODE_ENV !== 'production'
  || !configuredOrigin.hostname.endsWith('.invalid')
  || ![tmpdir(), '/private/tmp', '/tmp'].some(root => storage.startsWith(path.resolve(root) + path.sep))) {
  throw Error('Use disposable loopback vine_gallery_test, ALLOW_TEST_DATABASE=yes, production middleware, .invalid APP_URL and temporary STORAGE_DIR only.');
}
const origin = configuredOrigin.origin;
const credentials = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen> | undefined, checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
type Result = { status: number; body: any; headers: Headers };
async function jsonRequest(route: string, method: string, body?: any, actor = 'admin'): Promise<Result> {
  const c = credentials.get(actor);
  const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json',
      ...(c ? { Cookie: c.cookie, Authorization: `Bearer ${c.csrf}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}
const status = (result: Result, expected: number, message: string) => check(result.status === expected,
  `${message}: expected ${expected}, got ${result.status} ${result.body?.error || ''}`);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pdf = Buffer.from('%PDF-1.4\nSynthetic Gallery document');
const photoDetails = { photoStage: 'before', photoTakenAt: '2036-01-01T10:00', photoArea: 'Face front' };
let uploadRequests = 0, uploadWindowStarted = 0;
async function upload(resourceId: string, actor = 'admin', fields: Record<string, any> = photoDetails,
  resourceType = 'visit', name = 'synthetic.png', bytes = png, patientId = 'patient'): Promise<Result> {
  // Exercise the production request limiter rather than weakening it for tests.
  // Keep a small margin for concurrently submitted uploads in the same window.
  if (!uploadWindowStarted) uploadWindowStarted = Date.now();
  if (uploadRequests >= 28) {
    const remaining = 60_500 - (Date.now() - uploadWindowStarted);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    uploadRequests = 0; uploadWindowStarted = Date.now();
  }
  uploadRequests++;
  const c = credentials.get(actor);
  const form = new FormData(); form.append('file', new Blob([bytes], { type: name.endsWith('.pdf') ? 'application/pdf' : 'image/png' }), name);
  form.append('patientId', patientId); form.append('resourceType', resourceType); form.append('resourceId', resourceId);
  form.append('note', 'PRIVATE SYNTHETIC PHOTO NOTE');
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}/api/attachments/upload`, {
    method: 'POST', headers: { Origin: origin, ...(c ? { Cookie: c.cookie, Authorization: `Bearer ${c.csrf}` } : {}) }, body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}
async function createVisit(id: string, branchId = 'A', attachments: any[] = []) {
  await db.collection('visits').doc(id).set({ patientId: 'patient', branchId, doctorId: '', performedByUid: 'nurse',
    visitDate: '2036-01-01T10:00', timezoneSnapshot: 'Asia/Manila', status: 'Completed', attachments });
}
const stored = async (id: string) => (await db.collection('visits').doc(id).get()).data()!;
const metadata = (storagePath: string, expectedVersion = 1, extra: Record<string, any> = {}) => ({ storagePath, expectedVersion,
  stage: 'after', takenAt: '2036-01-15T11:30', area: 'Face matching angle', note: 'PRIVATE SYNTHETIC EDIT NOTE', ...extra });
const patch = (storagePath: string, expectedVersion = 1, actor = 'admin', extra: Record<string, any> = {}) =>
  jsonRequest('/api/attachments/photo', 'PATCH', metadata(storagePath, expectedVersion, extra), actor);
async function files(directory = storage): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const found = await Promise.all(entries.map(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return found.flat();
}
async function gatedRequest(run: () => Promise<Result>, change: () => Promise<unknown>) {
  const original = db.runTransaction;
  let arrival!: () => void, release!: () => void, intercepted = false;
  const entered = new Promise<void>(resolve => { arrival = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  db.runTransaction = async callback => { if (!intercepted) { intercepted = true; arrival(); await gate; } return original(callback); };
  try { const pending = run(); await entered; await change(); release(); return await pending; }
  finally { release(); db.runTransaction = original; }
}

try {
  await migrateDatabase(); await resetDisposablePlatformRecords();
  check(await assertCurrentMigrationChain(), 'Unchanged complete committed migration chain/checksums');
  for (const id of ['A', 'B']) await db.collection('branches').doc(id).set({ branchName: 'Synthetic ' + id, status: 'Active', timezone: 'Asia/Manila' });
  await db.collection('patients').doc('patient').set({ name: 'Synthetic Gallery Patient', patientID: 'SYNTHETIC-GALLERY', homeBranchId: 'A', status: 'Active' });
  await db.collection('patients').doc('other-patient').set({ name: 'Synthetic Other Patient', homeBranchId: 'B', status: 'Active' });
  await db.collection('settings').doc('media').set({ allowedExtensions: ['.png', '.jpg', '.pdf'], maxFileSizeMB: 1, maxFilesPerRecord: 12 });
  const actors: Record<string, any> = {
    admin: { role: 'admin' }, doctor: { role: 'doctor' }, nurse: { role: 'staff', staffDesignation: 'Nurse' },
    medical: { role: 'staff', staffDesignation: 'Medical Staff' }, staff: { role: 'staff' }, manager: { role: 'manager' },
    support: { role: 'support_developer' },
    deniedView: { role: 'admin', permissionOverrides: { 'clinical.view': 'deny' } },
    deniedAttachments: { role: 'staff', staffDesignation: 'Nurse', permissionOverrides: { 'visits.attachments.manage': 'deny' } },
  };
  for (const [id, actor] of Object.entries(actors)) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(id).set({ active: true, assignedBranches: ['A'], fullName: 'Synthetic ' + id, ...actor });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [createHash('sha256').update(token).digest('hex'), id, csrf]);
    credentials.set(id, { cookie: `__Host-vine_session=${token}`, csrf });
  }
  await createVisit('main'); await createVisit('branch-B', 'B');
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');

  const attachments: any[] = [];
  for (const [actor, stage] of [['nurse', 'before'], ['medical', 'after'], ['doctor', 'progress'], ['admin', 'before']]) {
    const result = await upload('main', actor, { ...photoDetails, photoStage: stage });
    status(result, 201, actor + ': eligible Visit photo upload');
    const attachment = result.body.attachment; attachments.push(attachment);
    check(attachment.photo.schemaVersion === 1 && attachment.photo.stage === stage && attachment.photo.version === 1,
      'Authoritative photo metadata stamped at upload');
    check(attachment.photo.updatedByUid === actor && attachment.uploadedByUid === actor && attachment.photo.timezone === 'Asia/Manila'
      && Number.isFinite(Date.parse(attachment.photo.updatedAt)), 'Server owns actor/timezone/time');
    check(attachment.photo.takenAt === photoDetails.photoTakenAt && attachment.photo.area === photoDetails.photoArea,
      'Clinic-local photo minute and treatment angle retained');
  }
  const first = attachments[0];
  status(await patch(first.storagePath, 1, 'anonymous'), 401, 'Anonymous photo metadata mutation denied');
  status(await upload('branch-B', 'anonymous'), 401, 'Anonymous upload denied before file processing');
  status(await jsonRequest('/api/attachments/content?path=' + encodeURIComponent(first.storagePath), 'GET', undefined, 'anonymous'),
    401, 'Anonymous photo content denied');
  const filesBeforeFifth = (await files()).length;
  status(await upload('main', 'admin', {}), 409, 'Generic attachment endpoint cannot bypass four Visit photos');
  check((await stored('main')).attachments.length === 4 && (await files()).length === filesBeforeFifth, 'Rejected fifth retains originals and leaves no orphan files');
  status(await upload('main', 'admin', {}, 'visit', 'synthetic.pdf', pdf), 201, 'Documents retain separate existing attachment workflow after photo cap');
  check((await stored('main')).attachments.filter((file: any) => file.contentType.startsWith('image/')).length === 4, 'Document does not count as photo');

  const read = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/attachments/content?path=${encodeURIComponent(first.storagePath)}`, {
    headers: { Cookie: credentials.get('staff')!.cookie, Authorization: `Bearer ${credentials.get('staff')!.csrf}` },
  });
  check(read.status === 200 && Buffer.from(await read.arrayBuffer()).equals(png), 'Existing shared clinical image reading remains authorized');
  check(read.headers.get('cache-control') === 'private, no-store' && read.headers.get('x-content-type-options') === 'nosniff', 'Private content delivery headers retained');

  for (const actor of ['staff', 'manager', 'deniedView', 'deniedAttachments']) {
    status(await upload('branch-B', actor), 403, actor + ': unauthorized upload denied');
    status(await patch(first.storagePath, 1, actor), 403, actor + ': metadata mutation denied');
    status(await jsonRequest('/api/attachments', 'DELETE', { storagePath: first.storagePath }, actor), 403, actor + ': deletion denied');
  }
  for (const actor of ['doctor', 'nurse', 'medical']) {
    status(await upload('branch-B', actor), 403, actor + ': branch B write denied');
  }
  const branchB = await upload('branch-B', 'admin'); status(branchB, 201, 'Global Admin can write authorized branch B');
  for (const actor of ['doctor', 'nurse', 'medical', 'staff']) {
    const c = credentials.get(actor)!;
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/attachments/content?path=${encodeURIComponent(branchB.body.attachment.storagePath)}`,
      { headers: { Cookie: c.cookie, Authorization: `Bearer ${c.csrf}` } });
    check(response.status === 200, actor + ': shared clinical branch B reading unchanged'); await response.arrayBuffer();
    if (actor !== 'staff') {
      status(await patch(branchB.body.attachment.storagePath, 1, actor), 403, actor + ': branch B metadata denied');
      status(await jsonRequest('/api/attachments', 'DELETE', { storagePath: branchB.body.attachment.storagePath }, actor), 403, actor + ': branch B removal denied');
    }
  }
  const deniedContent = await jsonRequest('/api/attachments/content?path=' + encodeURIComponent(first.storagePath), 'GET', undefined, 'deniedView');
  status(deniedContent, 403, 'Explicit clinical denial blocks file delivery');

  const edits = await Promise.all(['Winner A', 'Winner B'].map(area => patch(first.storagePath, 1, 'nurse', { area })));
  check(edits.filter(result => result.status === 200).length === 1 && edits.filter(result => result.status === 409).length === 1,
    'Concurrent same-version metadata changes yield exactly one winner');
  const winner = (await stored('main')).attachments.find((file: any) => file.storagePath === first.storagePath);
  check(winner.photo.version === 2 && winner.photo.updatedByUid === 'nurse' && winner.id === first.id
    && winner.uploadedAt === first.uploadedAt && winner.uploadedByUid === first.uploadedByUid, 'Editing details keeps binary identity and original upload attribution');
  status(await patch(first.storagePath, 1, 'admin', { note: 'Stale forbidden overwrite' }), 409, 'Old metadata draft cannot overwrite newer photo details');
  check(JSON.stringify((await stored('main')).attachments.find((file: any) => file.storagePath === first.storagePath)) === JSON.stringify(winner), 'Conflict preserves winning metadata exactly');
  for (const expectedVersion of [undefined, null, -1, 1.2, '2']) {
    status(await jsonRequest('/api/attachments/photo', 'PATCH', { ...metadata(first.storagePath), expectedVersion }), 400, 'Malformed metadata version rejected');
  }
  for (const extra of [{ stage: ['before'] }, { stage: 'dental' }, { takenAt: '2035-02-29T10:00' }, { area: 'x'.repeat(121) }, { note: 'x'.repeat(501) }]) {
    status(await patch(first.storagePath, 2, 'admin', extra), 400, 'Invalid photo detail rejected without write');
  }
  status(await patch(first.storagePath, 2, 'medical', { stage: 'progress', note: '', area: '' }), 200, 'Medical Staff can explicitly clear descriptors and mark Progress');
  check((await stored('main')).attachments.find((file: any) => file.storagePath === first.storagePath).note === '', 'Clear persisted without changing photo content');

  const legacy = Array.from({ length: 5 }, (_, index) => ({ id: 'legacy-' + index, name: `legacy-${index}.jpg`,
    storagePath: `uploads/patient/visits/legacy/legacy-${index}.jpg`, note: 'Retained historical note', size: 123, legacyCustom: { retained: true } }));
  await createVisit('legacy', 'A', legacy);
  const legacySnapshot = (await stored('legacy')).attachments;
  const legacyBytes = JSON.stringify(legacySnapshot);
  status(await upload('legacy', 'admin'), 409, 'Existing over-limit legacy photos remain readable but cannot gain fifth-plus photos');
  check(JSON.stringify((await stored('legacy')).attachments) === legacyBytes, 'Over-limit denial never rewrites legacy photos');
  status(await patch(legacy[0].storagePath, 0, 'doctor'), 200, 'Legacy unclassified photo can receive metadata explicitly at version zero');
  const classified = (await stored('legacy')).attachments;
  check(classified[0].photo.version === 1 && classified[0].legacyCustom.retained && classified[0].size === 123
    && JSON.stringify(classified.slice(1)) === JSON.stringify(legacySnapshot.slice(1)), 'Explicit legacy classification retains original fields and every other attachment');
  const legacyDocument = await upload('legacy', 'doctor', {}, 'visit', 'legacy-note.pdf', pdf);
  status(legacyDocument, 201, 'Over-limit legacy photos still allow nonimage uploads within the configured total-file limit');
  const legacyWithDocument = (await stored('legacy')).attachments;
  check(legacyWithDocument.length === 6 && legacyWithDocument[5].contentType === 'application/pdf'
    && JSON.stringify(legacyWithDocument.slice(0, 5)) === JSON.stringify(classified), 'PDF addition preserves all retained legacy images and metadata');
  status(await upload('legacy', 'doctor', {}), 409, 'Nonimage legacy addition never reopens the full image allowance');

  await createVisit('concurrent');
  for (let index = 0; index < 3; index++) status(await upload('concurrent', 'admin', {}), 201, 'Prepare three generic Visit images');
  const concurrent = await Promise.all([upload('concurrent', 'admin'), upload('concurrent', 'admin')]);
  check(concurrent.filter(result => result.status === 201).length === 1 && concurrent.filter(result => result.status === 409).length === 1,
    'Concurrent fourth/fifth uploads obey one serialized cap');
  check((await stored('concurrent')).attachments.length === 4, 'Concurrent Visit contains exactly four accepted photos');
  status(await jsonRequest('/api/attachments', 'DELETE', { storagePath: (await stored('concurrent')).attachments[0].storagePath }, 'nurse'), 204, 'Authorized deletion frees one photo slot');
  const partial = [await upload('concurrent'), await upload('concurrent')];
  check(partial[0].status === 201 && partial[1].status === 409 && (await stored('concurrent')).attachments.length === 4,
    'Partial multi-upload keeps accepted photo, rejects excess, and retains original count');

  await createVisit('invalid');
  for (const fields of [{ photoStage: 'before' }, { photoTakenAt: '2036-01-01T10:00' }, { ...photoDetails, photoTakenAt: '2036-02-30T10:00' }]) {
    status(await upload('invalid', 'admin', fields), 400, 'Incomplete/invalid gallery metadata rejected');
  }
  status(await upload('invalid', 'admin', photoDetails, 'visit', 'synthetic.pdf', pdf), 400, 'Photo metadata cannot be attached to document');
  status(await upload('patient', 'admin', photoDetails, 'patient'), 400, 'Gallery upload requires saved Visit association');
  status(await upload('main', 'admin', photoDetails, 'visit', 'synthetic.png', png, 'other-patient'), 403, 'Cross-patient Visit upload denied');
  const forgedPath = first.storagePath.replace('/patient/', '/other-patient/');
  status(await patch(forgedPath), 403, 'Forged cross-patient photo path denied');
  for (const storagePath of ['../outside.png', 'uploads/patient/visits/main/../../outside.png', 'https://example.invalid/photo.png']) {
    status(await patch(storagePath), 400, 'Malformed photo path rejected');
  }
  const emptyPath = 'uploads/patient/visits/main/nonregistered.png';
  status(await patch(emptyPath), 404, 'Unregistered file cannot gain Gallery metadata');

  for (let index = 0; index < 5; index++) status(await upload('patient', 'admin', {}, 'patient'), 201, 'Legacy general-patient attachments retain previous count policy');
  await db.collection('appointments').doc('appointment').set({ patientId: 'patient', branchId: 'A', doctorId: 'doctor', status: 'Scheduled', attachments: [] });
  for (let index = 0; index < 5; index++) status(await upload('appointment', 'admin', {}, 'appointment'), 201, 'Appointment attachments retain previous count policy');

  await createVisit('revoked');
  const filesBeforeRevoke = (await files()).length;
  status(await gatedRequest(() => upload('revoked', 'nurse'), () => db.collection('users').doc('nurse').update({
    permissionOverrides: { 'visits.attachments.manage': 'deny' } })), 403, 'Upload transaction rechecks permission revoked while queued');
  check((await stored('revoked')).attachments.length === 0 && (await files()).length === filesBeforeRevoke, 'Revoked upload writes no record or orphan file');
  await db.collection('users').doc('nurse').update({ permissionOverrides: {} });
  status(await gatedRequest(() => patch(first.storagePath, 3, 'nurse'), () => db.collection('users').doc('nurse').update({ assignedBranches: ['B'] })),
    403, 'Metadata transaction rechecks branch removed while queued');
  check((await stored('main')).attachments.find((file: any) => file.storagePath === first.storagePath).photo.version === 3, 'Queued denied metadata leaves version/content unchanged');
  await db.collection('users').doc('nurse').update({ assignedBranches: ['A'] });
  status(await gatedRequest(() => jsonRequest('/api/attachments', 'DELETE', { storagePath: first.storagePath }, 'nurse'),
    () => db.collection('visits').doc('main').update({ isArchived: true })), 403, 'Deletion transaction rechecks archived Visit');
  check((await stored('main')).attachments.some((file: any) => file.storagePath === first.storagePath), 'Queued denied removal retains photo');
  status(await upload('main', 'admin'), 403, 'Archived Visit blocks new photos');
  status(await patch(first.storagePath, 3), 403, 'Archived Visit blocks photo edits');
  await db.collection('visits').doc('main').update({ isArchived: false });
  await db.collection('patients').doc('patient').update({ isArchived: true });
  status(await upload('invalid'), 403, 'Archived patient blocks new Visit photos');
  status(await patch(first.storagePath, 3), 403, 'Archived patient blocks photo edits');
  status(await jsonRequest('/api/attachments', 'DELETE', { storagePath: first.storagePath }), 403, 'Archived patient blocks photo removal');

  const logs = (await db.collection('audit_logs').get()).docs.map(doc => doc.data());
  check(logs.some(log => log?.eventType === 'attachment_uploaded' && log.resourceId === 'main')
    && logs.some(log => log?.eventType === 'attachment_photo_updated' && log.resourceId === 'main'), 'Upload/detail edit attribution audited');
  check(!JSON.stringify(logs).includes('PRIVATE SYNTHETIC PHOTO NOTE') && !JSON.stringify(logs).includes('PRIVATE SYNTHETIC EDIT NOTE'), 'Audit metadata omits private photo narratives');
  console.log(`${checks} patient Gallery HTTP/concurrency/branch/legacy checks passed (disposable synthetic PostgreSQL and files).`);
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool.end();
}
