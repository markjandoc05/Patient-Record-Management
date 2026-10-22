import assert from 'node:assert/strict';
import { parseCataloguePurchase, parsePackageDefinition } from '../src/packageCataloguePolicy';
import { hasCapability } from '../src/permissions';
import { parseTreatmentPurchase } from '../src/treatmentLedgerPolicy';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', service = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const body = { id, commandId: id, expectedVersion: 0, name: ' Synthetic\tpackage ', description: ' Details ', active: true, lines: [{ serviceId: service, expectedServiceVersion: 1, sessions: 6 }] };
let checks = 0;
function check(run: () => void) { run(); checks++; }
check(() => { const p = parsePackageDefinition(body, true); assert.equal(p.name, 'Synthetic package'); assert.equal(p.description, 'Details'); });
for (const extra of [{ actor: {} }, { recordedAt: 'Spoofed' }, { version: 2 }, { price: 100 }, { name: '' }, { active: 1 }, { expectedVersion: undefined }, { lines: [] }, { lines: [{ ...body.lines[0], sessions: -1 }] }, { lines: [{ ...body.lines[0], sessions: 0 }] }, { lines: [{ ...body.lines[0], sessions: 10001 }] }, { lines: [{ ...body.lines[0], sessions: 1.1 }] }, { lines: [...body.lines, ...body.lines] }, { lines: [{ ...body.lines[0], serviceName: 'Spoofed' }] }]) {
  check(() => assert.throws(() => parsePackageDefinition({ ...body, ...extra }, true)));
}
check(() => assert.throws(() => parsePackageDefinition(body, false)));
check(() => assert.throws(() => parsePackageDefinition({ ...body, expectedVersion: 1 }, true)));
check(() => assert.equal(parsePackageDefinition({ ...body, expectedVersion: 1 }, false).expectedVersion, 1));
const purchase = { commandId: id, expectedVersion: 0, branchId: 'A', purchaseDate: '2035-02-01', notes: ' Notes ', orNumber: '00005', catalogueSelection: { packageId: id, expectedVersion: 1, serviceVersions: [{ serviceId: service, expectedServiceVersion: 2 }] } };
check(() => { const p = parseCataloguePurchase(purchase); assert.equal(p.orNumber, '00005'); assert.equal(p.notes, 'Notes'); assert.equal(p.catalogueSelection.expectedVersion, 1); });
for (const extra of [{ lines: [] }, { packageName: 'Override terms' }, { catalogue: {} }, { actor: {} }, { purchaseDate: '2035-02-30' }, { expectedVersion: 1 }, { branchId: '../B' }]) {
  check(() => assert.throws(() => parseCataloguePurchase({ ...purchase, ...extra })));
}
for (const selection of [{ ...purchase.catalogueSelection, sessions: 100 }, { ...purchase.catalogueSelection, expectedVersion: 0 }, { ...purchase.catalogueSelection, serviceVersions: [] }, { ...purchase.catalogueSelection, serviceVersions: [...purchase.catalogueSelection.serviceVersions, ...purchase.catalogueSelection.serviceVersions] }, { ...purchase.catalogueSelection, serviceVersions: [{ serviceId: service, expectedServiceVersion: 1, sessions: 999 }] }]) {
  check(() => assert.throws(() => parseCataloguePurchase({ ...purchase, catalogueSelection: selection })));
}
check(() => {
  const a = { ...purchase, catalogueSelection: { ...purchase.catalogueSelection, serviceVersions: [{ serviceId: other, expectedServiceVersion: 1 }, { serviceId: service, expectedServiceVersion: 2 }] } };
  assert.deepEqual(parseCataloguePurchase(a), parseCataloguePurchase({ ...a, catalogueSelection: { ...a.catalogueSelection, serviceVersions: [...a.catalogueSelection.serviceVersions].reverse() } }));
});
for (const role of ['staff', 'manager', 'doctor', 'admin']) {
  const actor = { role, active: true, assignedBranches: ['A'] };
  check(() => assert.ok(hasCapability(actor, 'packages.view')));
  check(() => assert.equal(hasCapability(actor, 'packages.manage'), role === 'admin'));
  check(() => assert.ok(!hasCapability({ ...actor, permissionOverrides: { 'packages.view': 'deny' } }, 'packages.view')));
}
check(() => assert.ok(hasCapability({ role: 'staff', active: true, permissionOverrides: { 'packages.manage': 'allow' } }, 'packages.manage')));
check(() => assert.ok(!hasCapability({ role: 'staff', active: true, assignedBranches: ['A'], permissionOverrides: { 'packages.manage': 'allow' } }, 'packages.manage', { branchId: 'B' })));
check(() => assert.ok(!hasCapability({ role: 'admin', active: false }, 'packages.manage')));
check(() => {
  const manual = parseTreatmentPurchase({ commandId: id, expectedVersion: 0, branchId: 'A', purchaseDate: '2035-02-01', packageName: 'Manual', lines: [{ serviceId: service, expectedServiceVersion: 1, purchasedSessions: 3 }] });
  assert.equal(manual.packageName, 'Manual'); assert.ok(!Object.hasOwn(manual, 'catalogueSelection'));
});
console.log(`Package catalogue policy: ${checks} checks passed.`);
