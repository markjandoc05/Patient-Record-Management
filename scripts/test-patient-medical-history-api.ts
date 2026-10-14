import { resetDisposablePlatformRecords } from './platform-test-support';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
import { patientHistoryFields, patientHistoryLimits, patientHistoryMetadata } from '../src/utils/patientMedicalHistory';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_clinical_history_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.NODE_ENV !== 'production' || !process.env.STORAGE_DIR
  || !new URL(process.env.APP_URL || 'https://invalid').hostname.endsWith('.invalid')) {
  throw new Error('Use a disposable loopback vine_clinical_history_test, synthetic .invalid origin and temporary storage only.');
}
const credentials = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen> | undefined, checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
async function request(path: string, body: any, user = 'admin', method = 'PATCH') {
  const c = credentials.get(user)!;
  return fetch(`http://127.0.0.1:${(server!.address() as any).port}${path}`, { method,
    headers: { Origin: new URL(process.env.APP_URL!).origin, Cookie: c.cookie, Authorization: `Bearer ${c.csrf}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
const patient = (name: string) => ({ name, contactNumber: '09171234567', email: '', gender: 'Female', address: '',
  birthDateStatus: 'unknown', mainConcern: 'Synthetic concern', homeBranchId: 'A', status: 'Active' });
const stored = async (id: string) => (await db.collection('patients').doc(id).get()).data()!;
try {
  await migrateDatabase();
  await resetDisposablePlatformRecords();
  for (const id of ['A', 'B']) await db.collection('branches').doc(id).set({ branchName: 'Synthetic ' + id, status: 'Active' });
  for (const [id, role, designation, overrides] of [
    ['admin', 'admin', undefined, {}], ['doctor', 'doctor', undefined, {}], ['nurse', 'staff', 'Nurse', {}],
    ['medical', 'staff', 'Medical Staff', {}], ['staff', 'staff', undefined, {}], ['manager', 'manager', undefined, {}],
    ['denied-view', 'admin', undefined, { 'clinical.view': 'deny' }], ['denied-edit', 'doctor', undefined, { 'clinical.edit_draft': 'deny' }],
  ] as const) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(id).set({ active: true, role, fullName: 'Synthetic ' + id, assignedBranches: ['A'],
      ...(designation ? { staffDesignation: designation } : {}), permissionOverrides: overrides });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [createHash('sha256').update(token).digest('hex'), id, csrf]);
    credentials.set(id, { cookie: `__Host-vine_session=${token}`, csrf });
  }
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = patient('Synthetic Medical History');
  const create = await request('/api/records/patients', { ...base, medicalHistory: '  PRIVATE_HISTORY_VALUE  ', healthConcerns: 'PRIVATE_CONCERN_VALUE' }, 'doctor', 'POST');
  check(create.status === 201, 'Doctor can create reported history'); const id = (await create.json()).id, path = '/api/records/patients/' + id;
  let record = await stored(id);
  check(record.medicalHistory === 'PRIVATE_HISTORY_VALUE' && record.healthConcerns === 'PRIVATE_CONCERN_VALUE', 'Server validates/normalizes new text');
  check(record.clinicalHistoryVersion === 1 && record.clinicalHistoryUpdatedByUid === 'doctor' && record.clinicalHistoryUpdatedByName === 'Synthetic doctor', 'Server owns initial version/author');
  check(typeof record.clinicalHistoryUpdatedAt === 'string' && record.allergiesStatus === 'unknown', 'Timestamp stored; blank allergies not negative');
  const metadata = Object.fromEntries(patientHistoryMetadata.map(field => [field, record[field]]));
  check((await request(path, { ...base, address: 'Updated address' })).status === 200, 'Old full client can omit new fields');
  record = await stored(id);
  check(record.medicalHistory === 'PRIVATE_HISTORY_VALUE' && patientHistoryMetadata.every(field => record[field] === metadata[field]), 'Omission preserves text and attribution exactly');
  check((await request(path, { ...base, medicalHistory: '  PRIVATE_HISTORY_VALUE  ' })).status === 200, 'Unchanged history does not require a new revision');
  check((await stored(id)).clinicalHistoryVersion === 1, 'Unchanged value does not stamp/revise');
  for (const version of [undefined, -1, null, '1', 1.1, 0]) {
    const r = await request(path, { ...base, medicalHistory: 'Changed', ...(version === undefined ? {} : { expectedClinicalHistoryVersion: version }) });
    check(r.status === 409 && (await r.json()).code === 'PATIENT_HISTORY_VERSION_CHANGED', 'Missing/malformed/stale history revision denied');
  }
  const edits = await Promise.all(['Concurrent A', 'Concurrent B'].map(medicalHistory => request(path, { ...base, medicalHistory, expectedClinicalHistoryVersion: 1 })));
  check(edits.filter(r => r.status === 200).length === 1 && edits.filter(r => r.status === 409).length === 1, 'Concurrent history edits: exactly one winner');
  record = await stored(id); check(record.clinicalHistoryVersion === 2 && record.clinicalHistoryUpdatedByUid === 'admin', 'Winner stamped with current actor and next version');
  const winner = record.medicalHistory;
  check((await request(path, { ...base, medicalHistory: winner, expectedClinicalHistoryVersion: 1 })).status === 200, 'Lost-response retry with identical text is safe no-op');
  check((await stored(id)).clinicalHistoryVersion === 2, 'Identical retry does not create duplicate revision');
  check((await request(path, { ...base, medicalHistory: '', expectedClinicalHistoryVersion: 2 })).status === 200, 'Authorized explicit clear succeeds');
  record = await stored(id); check(record.medicalHistory === '' && record.clinicalHistoryVersion === 3 && record.healthConcerns === 'PRIVATE_CONCERN_VALUE', 'Clear versions one field and preserves omitted concern');
  check((await request(path, { ...base, medicalHistory: winner, expectedClinicalHistoryVersion: 1 })).status === 409, 'Old retry cannot restore text after newer clear');
  for (const user of ['staff', 'manager', 'nurse', 'medical', 'denied-view', 'denied-edit']) {
    check((await request(path, { ...base, medicalHistory: 'Forbidden', expectedClinicalHistoryVersion: 3 }, user)).status === 403, user + ': full history edit remains denied');
  }
  check((await request(path, { address: 'Reception update' }, 'nurse')).status === 200, 'Nurse retains existing demographic edit workflow');
  check((await stored(id)).clinicalHistoryVersion === 3, 'Restricted demographic edit leaves history untouched');
  check((await request('/api/records/patients', { ...patient('Synthetic Nurse Intake'), medicalHistory: 'Reported by patient' }, 'nurse', 'POST')).status === 201, 'Existing Nurse registration/intake is preserved');
  check((await request('/api/records/patients', { ...patient('Synthetic Other Branch'), homeBranchId: 'B', medicalHistory: 'Reported' }, 'doctor', 'POST')).status === 403, 'Doctor registration branch restriction remains');
  for (const field of patientHistoryMetadata) check((await request(path, { ...base, [field]: 'spoof' })).status === 400, 'Client cannot spoof ' + field);
  for (const medicalHistory of [null, {}, 'x'.repeat(5001)]) check((await request(path, { ...base, medicalHistory, expectedClinicalHistoryVersion: 3 })).status === 400, 'Invalid history input returns 400');
  const legacy = '  ' + 'L'.repeat(5100) + '  ';
  await db.collection('patients').doc(id).update({ medicalHistory: legacy });
  check((await request(path, { ...base, medicalHistory: legacy.trim(), expectedClinicalHistoryVersion: 3 })).status === 200, 'Unchanged over-limit legacy text stays editable on unrelated changes');
  check((await stored(id)).medicalHistory === legacy, 'Legacy text bytes retained');
  const structured = { reported: ['Synthetic retained legacy content'] };
  await db.collection('patients').doc(id).update({ medicalHistory: structured });
  check((await request(path, { ...base, address: 'Legacy-compatible edit' })).status === 200, 'Old non-text history does not block unrelated edits');
  check(JSON.stringify((await stored(id)).medicalHistory) === JSON.stringify(structured), 'Omitted structured historical data retained exactly');
  await db.collection('patients').doc(id).update({ medicalHistory: legacy });
  const deniedRead = await request('/api/data/query', { path: 'patients/' + id, kind: 'document', constraints: [] }, 'denied-view', 'POST');
  check(deniedRead.status === 200, 'Operational patient read retained');
  const data = (await deniedRead.json()).document.data;
  check(!Object.hasOwn(data, 'medicalHistory') && !Object.hasOwn(data, 'healthConcerns') && patientHistoryMetadata.every(field => !Object.hasOwn(data, field)), 'History and attribution redacted server-side');
  // A full operational editor without clinical viewing cannot distinguish a
  // correct private-value guess from an incorrect one through PATCH outcomes.
  const { mainConcern: _clinicalConcern, ...operationalBase } = base;
  for (const field of patientHistoryFields) {
    for (const historical of ['PRIVATE_' + field, '  ' + 'L'.repeat(patientHistoryLimits[field] + 1) + '  ',
      { reported: ['Private structured history'] }]) {
      await db.collection('patients').doc(id).update({ [field]: historical });
      const before = await stored(id);
      for (const guess of [historical, typeof historical === 'string' ? historical.trim() : JSON.stringify(historical),
        'INCORRECT_GUESS', null, ['Alternate representation']]) {
        const response = await request(path, { ...operationalBase, [field]: guess }, 'denied-view');
        check(response.status === 403 && (await response.json()).error === 'Clinical changes are not permitted',
          field + ': correct, incorrect, over-limit and alternate guesses receive the same denial');
      }
      check(JSON.stringify(await stored(id)) === JSON.stringify(before), field + ': denied guesses do not write any record data');
      for (const defaults of [{}, { [field]: '' }, { [field]: '   ' }]) {
        check((await request(path, { ...operationalBase, ...defaults, address: 'Permitted operational edit' }, 'denied-view')).status === 200,
          field + ': omission and blank defaults retain the operational edit workflow');
        const after = await stored(id);
        check(JSON.stringify(after[field]) === JSON.stringify(historical)
          && patientHistoryMetadata.every(key => after[key] === before[key]), field + ': defaults preserve private data and attribution');
      }
    }
  }
  await db.collection('patients').doc(id).update({ medicalHistory: legacy, healthConcerns: 'PRIVATE_CONCERN_VALUE' });
  check((await request(path, { ...base, medicalHistory: legacy.trim(), healthConcerns: 'PRIVATE_CONCERN_VALUE' }, 'denied-edit')).status === 200,
    'Clinical reader without edit permission can retain unchanged legacy text');
  for (const field of patientHistoryFields) {
    check((await request('/api/records/patients', { ...patient('Synthetic Denied Intake ' + field), mainConcern: '', [field]: 'Private input' }, 'denied-view', 'POST')).status === 403,
      'Denied clinical reader cannot supply new reported ' + field);
  }
  const blankIntake = await request('/api/records/patients', { ...patient('Synthetic Operational Intake'), mainConcern: '',
    medicalHistory: '', healthConcerns: '   ' }, 'denied-view', 'POST');
  check(blankIntake.status === 201, 'Operational registration with blank defaults remains permitted');
  const blankRecord = await stored((await blankIntake.json()).id);
  check(!Object.hasOwn(blankRecord, 'medicalHistory') && !Object.hasOwn(blankRecord, 'healthConcerns')
    && patientHistoryMetadata.every(field => !Object.hasOwn(blankRecord, field)), 'Denied-reader intake does not stamp clinical history');
  for (const field of ['medicalHistory', 'clinicalHistoryUpdatedByUid']) check((await request('/api/data/query', { path: 'patients', kind: 'collection', constraints: [{ type: 'orderBy', field, direction: 'asc' }] }, 'denied-view', 'POST')).status === 403, 'Denied clinical query cannot infer ' + field);
  check((await request('/api/data/write', { operations: [{ path: 'patients/' + id, mode: 'update', data: { medicalHistory: 'Bypass' } }] }, 'admin', 'POST')).status >= 400, 'Generic data write cannot bypass history API');
  const originalTransaction = db.runTransaction;
  let release!: () => void, entered!: () => void, intercepted = false;
  const gate = new Promise<void>(resolve => { release = resolve; }), arrival = new Promise<void>(resolve => { entered = resolve; });
  db.runTransaction = async callback => { if (!intercepted) { intercepted = true; entered(); await gate; } return originalTransaction(callback); };
  try {
    const pending = request(path, { ...base, medicalHistory: 'Pending authorized draft', expectedClinicalHistoryVersion: 3 }, 'doctor');
    await arrival;
    await db.collection('users').doc('doctor').update({ permissionOverrides: { 'clinical.edit_draft': 'deny' } });
    release(); check((await pending).status === 403, 'Permission revoked before transaction is rechecked before history commit');
    check((await stored(id)).medicalHistory === legacy, 'Queued unauthorized edit leaves history untouched');
  } finally { release(); db.runTransaction = originalTransaction; }
  let releaseCreate!: () => void, enteredCreate!: () => void;
  const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
  const createArrival = new Promise<void>(resolve => { enteredCreate = resolve; });
  let interceptedCreate = false;
  db.runTransaction = async callback => {
    if (!interceptedCreate) { interceptedCreate = true; enteredCreate(); await createGate; }
    return originalTransaction(callback);
  };
  try {
    const pending = request('/api/records/patients', { ...patient('Synthetic Queued Intake'), medicalHistory: 'Reported history' }, 'doctor', 'POST');
    await createArrival;
    await db.collection('users').doc('doctor').update({ permissionOverrides: { 'clinical.view': 'deny' } });
    releaseCreate(); check((await pending).status === 403, 'Queued intake rechecks clinical viewing inside the creation transaction');
    check((await db.collection('patients').where('name', '==', 'Synthetic Queued Intake').get()).empty,
      'Permission loss leaves no queued patient/history record');
  } finally { releaseCreate(); db.runTransaction = originalTransaction; }
  await db.collection('patients').doc(id).update({ isArchived: true });
  check((await request(path, { ...base, healthConcerns: 'Changed', expectedClinicalHistoryVersion: 3 })).status === 409, 'Archived patient write denied');
  const logs = (await db.collection('audit_logs').get()).docs.map(doc => doc.data());
  check(logs.some(log => log.resourceId === id && log.changes?.some((change: any) => change.field === 'medicalHistory')), 'History change audited by field name');
  check(!JSON.stringify(logs).includes('PRIVATE_HISTORY_VALUE') && !JSON.stringify(logs).includes('PRIVATE_CONCERN_VALUE'), 'Generic audit contains no new clinical narrative');
  console.log(`${checks} patient medical history API/concurrency/permission checks passed (disposable synthetic PostgreSQL).`);
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await pool.end();
}
