import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { moneyCents, centsText, invoiceTotal, parsePosDraft, parsePosPayment } from '../src/posPolicy';
import { hasCapability } from '../src/permissions';
assert.equal(moneyCents('0'), 0);
assert.equal(moneyCents('0.10') + moneyCents('0.20'), 30);
assert.equal(centsText(30), '0.30');
assert.equal(moneyCents('9999999999.99'), 999999999999);
for (const value of [null, undefined, '', '-1', '1.001', '1e2', 'NaN', '10000000000.00', Infinity, {}])
    assert.throws(() => moneyCents(value));
assert.throws(() => invoiceTotal([{ amount: 999999999999 }, { amount: 1 }]));
const draft = { commandId: randomUUID(), expectedVersion: 0, patientId: 'synthetic', branchId: 'A', notes: 'Retain notes', items: [{ kind: 'service', id: randomUUID(), expectedVersion: 1 }] };
assert.equal(parsePosDraft(draft).notes, draft.notes);
assert.throws(() => parsePosDraft({ ...draft, items: [draft.items[0], draft.items[0]] }));
assert.throws(() => parsePosDraft({ ...draft, total: 1 }));
const payment = { commandId: randomUUID(), expectedVersion: 1, method: 'cash', amount: '100', tender: '200', reference: '' };
assert.equal(parsePosPayment(payment).tender - parsePosPayment(payment).amount, 10000);
for (const patch of [{ amount: '0' }, { tender: '99' }, { method: 'unknown' }, { method: 'card', reference: '' }])
    assert.throws(() => parsePosPayment({ ...payment, ...patch }));
const staff = { active: true, role: 'staff', assignedBranches: ['A'] };
for (const id of ['pos.view', 'pos.manage', 'pos.collect'] as const) {
    assert.ok(hasCapability(staff, id, { branchId: 'A' }));
    assert.equal(hasCapability(staff, id, { branchId: 'B' }), false);
    assert.equal(hasCapability({ ...staff, permissionOverrides: { [id]: 'deny' } }, id), false);
}
assert.equal(hasCapability(staff, 'pos.sales'), false);
assert.equal(hasCapability({ ...staff, role: 'manager' }, 'pos.sales'), true);
assert.equal(hasCapability({ ...staff, permissionOverrides: { 'pos.adjust': 'allow' } }, 'pos.adjust'), false);
assert.equal(hasCapability({ ...staff, role: 'doctor' }, 'pos.view'), false);
console.log('POS policy: exact money, parsing, retry identity and permission checks passed');
