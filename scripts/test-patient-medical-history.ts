import assert from 'node:assert/strict';
import { parsePatientHistory, patientHistoryFields, patientHistoryLimits, patientHistoryVersion, patientHistoryMetadata, patientHistoryLabel } from '../src/utils/patientMedicalHistory';
import { assertPatientHistoryMetadata, patientHistoryAttribution, patientHistoryInput } from '../backend/patientMedicalHistory';
import { redactClinicalData, assertClinicalQuery, protectClinicalWrite } from '../backend/clinicalRedaction';

let checks = 0;
const check = (fn: () => void) => { fn(); checks++; };
const actor = { uid: 'synthetic-author', name: 'Synthetic author' }, now = '2035-01-01T10:00:00Z';
check(() => assert.equal(patientHistoryVersion({}), 0));
check(() => assert.equal(patientHistoryLabel(undefined), 'Not recorded'));
check(() => assert.equal(patientHistoryLabel('   '), 'Not recorded'));
check(() => assert.equal(patientHistoryLabel('  Old reported history  '), '  Old reported history  '));
check(() => assert.equal(patientHistoryLabel({ reported: ['Retained'] }), '{"reported":["Retained"]}'));
for (const version of [null, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) check(() => assert.throws(() => patientHistoryVersion({ clinicalHistoryVersion: version })));
for (const field of patientHistoryFields) {
  const old = { [field]: '  Historical reported text  ' };
  check(() => assert.deepEqual(parsePatientHistory({}, old), {}));
  check(() => assert.deepEqual(parsePatientHistory({ [field]: old[field].trim() }, old), old));
  check(() => assert.deepEqual(parsePatientHistory({ [field]: '  New reported text  ' }, old), { [field]: 'New reported text' }));
  check(() => assert.deepEqual(parsePatientHistory({ [field]: '' }, old), { [field]: '' }));
  for (const value of [null, 1, {}, []]) check(() => assert.throws(() => parsePatientHistory({ [field]: value })));
  const long = 'x'.repeat(patientHistoryLimits[field] + 1);
  check(() => assert.throws(() => parsePatientHistory({ [field]: long })));
  check(() => assert.deepEqual(parsePatientHistory({ [field]: long }, { [field]: long }), { [field]: long }));
}
check(() => assert.deepEqual(patientHistoryAttribution({}, { medicalHistory: '', healthConcerns: '' }, undefined, actor, now), {}));
check(() => assert.deepEqual(patientHistoryAttribution({}, { medicalHistory: 'Reported' }, undefined, actor, now), {
  clinicalHistoryVersion: 1, clinicalHistoryUpdatedAt: now, clinicalHistoryUpdatedByUid: actor.uid, clinicalHistoryUpdatedByName: actor.name,
}));
check(() => assert.deepEqual(patientHistoryAttribution({}, { medicalHistory: 'Same' }, { medicalHistory: 'Same', clinicalHistoryVersion: 4 }, actor, now), {}));
for (const expected of [undefined, null, -1, '4', 3]) check(() => assert.throws(() => patientHistoryAttribution({ expectedClinicalHistoryVersion: expected },
  { medicalHistory: 'Changed' }, { medicalHistory: 'Same', clinicalHistoryVersion: 4 }, actor, now), { status: 409, code: 'PATIENT_HISTORY_VERSION_CHANGED' }));
check(() => assert.equal(patientHistoryAttribution({ expectedClinicalHistoryVersion: 4 }, { medicalHistory: '' },
  { medicalHistory: 'Same', clinicalHistoryVersion: 4 }, actor, now).clinicalHistoryVersion, 5));
for (const field of patientHistoryMetadata) check(() => assert.throws(() => assertPatientHistoryMetadata({ [field]: 'spoof' }), { status: 400 }));
const denied = { role: 'admin', active: true, permissionOverrides: { 'clinical.view': 'deny' } } as const;
const secret = { name: 'Synthetic', medicalHistory: 'PRIVATE_HISTORY', healthConcerns: 'PRIVATE_CONCERN',
  clinicalHistoryVersion: 4, clinicalHistoryUpdatedAt: now, clinicalHistoryUpdatedByUid: actor.uid, clinicalHistoryUpdatedByName: actor.name };
// Both correct and incorrect guesses must be denied before legacy parsing can
// compare them with stored history (including its unchanged over-limit path).
for (const field of patientHistoryFields) {
  for (const previous of [secret, { [field]: '  ' + 'L'.repeat(patientHistoryLimits[field] + 1) + '  ' },
    { [field]: { reported: ['Private structured history'] } }]) {
    for (const guess of [previous[field], typeof previous[field] === 'string' ? previous[field].trim() : JSON.stringify(previous[field]),
      'INCORRECT_GUESS', null, ['Alternate representation']]) {
      check(() => assert.throws(() => patientHistoryInput({ [field]: guess }, previous, denied),
        { status: 403, message: 'Clinical changes are not permitted' }));
    }
  }
  const unreadablePrevious = new Proxy({}, { get() { throw new Error('Denied reader accessed stored history'); } });
  check(() => assert.deepEqual(patientHistoryInput({}, unreadablePrevious, denied), {}));
  check(() => assert.deepEqual(patientHistoryInput({ [field]: '' }, unreadablePrevious, denied), {}));
  check(() => assert.deepEqual(patientHistoryInput({ [field]: '   ' }, unreadablePrevious, denied), {}));
  check(() => assert.throws(() => patientHistoryInput({ [field]: 'GUESS' }, unreadablePrevious, denied), { status: 403 }));
  const viewer = { role: 'doctor', active: true, permissionOverrides: { 'clinical.edit_draft': 'deny' } } as const;
  const previous = { [field]: '  Historical text  ', clinicalHistoryVersion: 4 };
  const unchanged = patientHistoryInput({ [field]: 'Historical text' }, previous, viewer);
  protectClinicalWrite(viewer, unchanged, previous);
  check(() => assert.deepEqual(unchanged, {}));
  check(() => assert.deepEqual(patientHistoryAttribution({}, unchanged, previous, actor, now), {}));
  check(() => assert.throws(() => protectClinicalWrite(viewer,
    patientHistoryInput({ [field]: 'Changed' }, previous, viewer), previous), { status: 403 }));
}
check(() => assert.deepEqual(redactClinicalData('patients', secret, denied), { name: 'Synthetic' }));
for (const field of [...patientHistoryFields, ...patientHistoryMetadata]) check(() => assert.throws(() => assertClinicalQuery(denied, 'patients', [{ type: 'orderBy', field }]), { status: 403 }));
console.log(`${checks} patient medical history preservation/version/redaction checks passed.`);
