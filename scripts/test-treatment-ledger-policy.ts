import assert from 'node:assert/strict';
import {
  assertTreatmentUsageCompatible, canEditTreatmentOrNumber, canViewTreatmentLedger,
  ledgerDate, parseSessionUsage, parseTreatmentPurchase, treatmentBalance, treatmentVisitBinding,
  TreatmentLedgerError, type TreatmentVisitSnapshot,
} from '../src/treatmentLedgerPolicy';
import { hasCapability } from '../src/permissions';

let checks = 0;
function check(run: () => void) { run(); checks++; }
function rejected(run: () => unknown, status = 400) { check(() => assert.throws(run, (error: any) => error instanceof TreatmentLedgerError && error.status === status)); }
const serviceId = '10000000-0000-4000-8000-000000000001';
const commandId = '20000000-0000-4000-8000-000000000001';
const lineId = '30000000-0000-4000-8000-000000000001';
const purchase = { commandId, expectedVersion: 0, packageName: 'Synthetic laser package', purchaseDate: '2026-10-14', branchId: 'synthetic-A', notes: 'Synthetic protected note',
  lines: [{ serviceId, expectedServiceVersion: 1, purchasedSessions: 6 }] };
const usage = { commandId, lineId, sessions: 2, expectedLineVersion: 1, expectedUsageVersion: 0 };
check(() => assert.equal(parseTreatmentPurchase(purchase).lines[0].purchasedSessions, 6));
check(() => assert.equal(parseTreatmentPurchase({ ...purchase, commandId: commandId.toUpperCase() }).commandId, commandId));
for (const value of [undefined, null, '0', -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) rejected(() => parseTreatmentPurchase({ ...purchase, expectedVersion: value }));
rejected(() => parseTreatmentPurchase({ ...purchase, expectedVersion: 1 }), 409);
for (const value of [undefined, null, 0, -1, 1.2, '1', NaN, Infinity]) rejected(() => parseTreatmentPurchase({ ...purchase, lines: [{ ...purchase.lines[0], expectedServiceVersion: value }] }));
for (const value of [0, -1, 1.2, '6', NaN, Infinity, 10001]) rejected(() => parseTreatmentPurchase({ ...purchase, lines: [{ ...purchase.lines[0], purchasedSessions: value }] }));
for (const field of ['recordedAt', 'actor', 'version', 'remainingSessions', 'patientId', 'price', 'payment']) rejected(() => parseTreatmentPurchase({ ...purchase, [field]: 'forged' }));
for (const field of ['serviceNameSnapshot', 'serviceCatalogueVersion', 'remainingSessions', 'price']) rejected(() => parseTreatmentPurchase({ ...purchase, lines: [{ ...purchase.lines[0], [field]: 'forged' }] }));
for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-10-32', '1899-12-31', '2026-10-14T10:00', 'garbage']) rejected(() => ledgerDate(date));
check(() => assert.equal(ledgerDate('2024-02-29'), '2024-02-29'));
rejected(() => parseTreatmentPurchase({ ...purchase, lines: [purchase.lines[0], purchase.lines[0]] }));
rejected(() => parseTreatmentPurchase({ ...purchase, lines: [] }));
rejected(() => parseTreatmentPurchase({ ...purchase, lines: Array.from({ length: 21 }, () => purchase.lines[0]) }));
check(() => assert.equal(parseSessionUsage(undefined), undefined));
check(() => assert.deepEqual(parseSessionUsage(usage), usage));
for (const value of [null, {}, [], 'use']) rejected(() => parseSessionUsage(value));
for (const field of ['actor', 'recordedAt', 'treatmentDate', 'remainingSessions', 'usedSessions', 'performedByUserId']) rejected(() => parseSessionUsage({ ...usage, [field]: 'forged' }));
for (const version of [undefined, null, '1', 0, -1, 1.1, NaN, Infinity]) rejected(() => parseSessionUsage({ ...usage, expectedLineVersion: version }));
rejected(() => parseSessionUsage({ ...usage, expectedUsageVersion: 1 }), 409);
check(() => assert.deepEqual(treatmentBalance(6, 0, 2), { purchasedSessions: 6, adjustmentSessions: 0, usedSessions: 2, remainingSessions: 4 }));
check(() => assert.equal(treatmentBalance(6, -4, 2).remainingSessions, 0));
check(() => assert.equal(treatmentBalance(6, 0, 0).remainingSessions, 6));
for (const values of [[6, 0, 7], [6, -7, 0], [6, 9995, 0], [6, 0, -1], [6, 0, .5], [0, 0, 0], [6, Infinity, 1]]) rejected(() => treatmentBalance(...values as [number, number, number]), 409);
const actor = (role: string, override: Record<string, string> = {}) => ({ role, active: true, accountStatus: 'active', assignedBranches: ['synthetic-A'], permissionOverrides: override });
for (const role of ['admin', 'doctor', 'staff', 'manager', 'support_developer', 'SUPPORT_DEVELOPER']) {
  check(() => assert.equal(canViewTreatmentLedger(actor(role)), true));
  for (const denied of ['treatment_ledger.view', 'patients.view', 'visits.view', 'clinical.view']) check(() => assert.equal(canViewTreatmentLedger(actor(role, { [denied]: 'deny' })), false));
}
for (const role of ['doctor', 'staff', 'manager']) check(() => assert.equal(canEditTreatmentOrNumber(actor(role, { 'treatment_ledger.reference': 'allow' }), 'synthetic-A'), false));
check(() => assert.equal(canEditTreatmentOrNumber(actor('admin'), 'synthetic-A'), true));
check(() => assert.equal(canEditTreatmentOrNumber(actor('admin', { 'treatment_ledger.reference': 'deny' }), 'synthetic-A'), false));
for (const role of ['staff', 'manager', 'admin']) check(() => assert.equal(hasCapability(actor(role), 'treatment_ledger.purchase'), true));
check(() => assert.equal(hasCapability(actor('doctor'), 'treatment_ledger.purchase'), false));
check(() => assert.equal(hasCapability(actor('staff'), 'treatment_ledger.purchase', { branchId: 'synthetic-B' }), false));
check(() => assert.equal(canViewTreatmentLedger({ ...actor('staff'), active: false }), false));
const visit = { patientId: 'synthetic-patient', branchId: 'synthetic-A', visitDate: '2026-10-14T10:00', serviceId, serviceNameSnapshot: 'Synthetic laser',
  serviceDurationMinutesSnapshot: 30, serviceCatalogueVersion: 1, doctorId: '', performedByUserId: 'synthetic-nurse', performedByNameSnapshot: 'Synthetic Nurse',
  performedByRoleSnapshot: 'staff', performedByDesignationSnapshot: 'Nurse', assistingStaffText: 'Synthetic Assistant' };
const snapshot = { ...visit, doctorId: null, branchNameSnapshot: 'Synthetic clinic', timezoneSnapshot: 'Asia/Manila' } as TreatmentVisitSnapshot;
check(() => assert.doesNotThrow(() => assertTreatmentUsageCompatible(snapshot, { ...visit, notes: 'Unrelated clinical edit', isArchived: true })));
for (const [field, value] of Object.entries({ patientId: 'other', branchId: 'synthetic-B', visitDate: '2026-10-14T11:00', serviceId: null,
  serviceNameSnapshot: 'Renamed', serviceDurationMinutesSnapshot: 40, serviceCatalogueVersion: 2, doctorId: 'other-doctor', performedByUserId: 'other-nurse',
  performedByNameSnapshot: 'Other name', performedByRoleSnapshot: 'doctor', performedByDesignationSnapshot: 'Medical Staff', assistingStaffText: 'Other assistant' })) {
  rejected(() => assertTreatmentUsageCompatible(snapshot, { ...visit, [field]: value }), 409);
}
const legacy = { ...visit, performedByUserId: undefined, performedByNameSnapshot: undefined, performedByRoleSnapshot: undefined, performedByDesignationSnapshot: undefined, doctorId: 'legacy-doctor' };
check(() => assert.deepEqual(treatmentVisitBinding(legacy), treatmentVisitBinding({ ...legacy, performedByNameSnapshot: 'Authoritative recorded doctor', performedByRoleSnapshot: 'doctor' })));
console.log(`Treatment ledger policy: ${checks}/${checks} checks passed.`);
