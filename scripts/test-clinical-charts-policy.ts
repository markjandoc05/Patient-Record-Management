import assert from 'node:assert/strict';
import { validateChartContent } from '../src/clinicalChartPolicy';
import { hasCapability } from '../src/permissions';

let checks = 0;
function check(run: () => void) { run(); checks++; }
const marker = { id: 'point-1', map: 'face', x: .5, y: .4, label: 'Observation', notes: 'Synthetic chart note' };
for (const map of ['face', 'body-front', 'body-back']) check(() => assert.equal(validateChartContent({ markers: [{ ...marker, map }], notes: '' }).markers[0].map, map));
for (const patch of [{ map: 'dental' }, { map: 'body' }, { x: -1 }, { y: 1.01 }, { x: NaN }, { y: Infinity },
  { x: '0.5' }, { id: '' }, { id: '../escape' }, { id: 'x'.repeat(65) }, { label: 'x'.repeat(101) },
  { notes: 'x'.repeat(1001) }, { signedBy: 'forged' }, { createdAt: 'forged' }]) {
  check(() => assert.throws(() => validateChartContent({ markers: [{ ...marker, ...patch }], notes: '' })));
}
for (const input of [null, [], {}, { markers: {}, notes: '' }, { markers: [null], notes: '' },
  { markers: [marker, marker], notes: '' }, { markers: [], notes: 'x'.repeat(3001) },
  { markers: Array.from({ length: 101 }, (_, i) => ({ ...marker, id: 'point-' + i })), notes: '' }]) {
  check(() => assert.throws(() => validateChartContent(input)));
}
check(() => assert.equal(validateChartContent({ markers: [{ ...marker, x: 0, y: 1 }], notes: '' }).markers.length, 1));
check(() => assert.equal(validateChartContent({ markers: [], notes: '' }).markers.length, 0));
for (const role of ['admin', 'support_developer', 'doctor', 'staff', 'manager']) {
  check(() => assert.equal(hasCapability({ role, active: true, assignedBranches: ['A'] }, 'clinical.finalize'), false));
}
check(() => assert.equal(hasCapability({ role: 'doctor', active: true, permissionOverrides: { 'clinical.finalize': 'allow' } }, 'clinical.finalize'), true));
console.log(`${checks}/${checks} clinical chart policy checks passed.`);
