import assert from 'node:assert/strict';
import { hasCapability, normalizePermissionOverrides, permissionDefinitions, permissionScopeKey, roleAllows } from '../src/permissions';
import { RBAC, administrativeRoles } from '../src/rbac';
import { redactClinicalData, assertClinicalQuery } from '../backend/clinicalRedaction';
import { assertCapability } from '../backend/permissions';

let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; };
for (const role of Object.keys(RBAC)) {
  const actor = { role, active: true, assignedBranches: ['A'] };
  for (const id of ['patients.view', 'patients.create', 'patients.edit', 'appointments.view', 'appointments.create', 'appointments.edit', 'visits.view', 'clinical.view', 'services.view', 'users.view'] as const) check(hasCapability(actor, id), `${role} compatibility ${id}`);
  check(hasCapability(actor, 'services.manage') === (administrativeRoles as readonly string[]).includes(role), `${role} catalogue defaults`);
  check(hasCapability({ ...actor, permissionOverrides: { 'patients.view': 'deny' } }, 'patients.view') === false, `${role} explicit denial`);
  check(!hasCapability({ ...actor, active: false }, 'patients.view'), `${role} inactive denied`);
  check(!hasCapability({ ...actor, accountStatus: 'pending_activation' }, 'patients.view'), `${role} pending denied even with inconsistent active flag`);
}
const manager = { role: 'manager', active: true, assignedBranches: ['A'], permissionOverrides: { 'services.manage': 'allow', 'access.manage': 'allow' } };
check(hasCapability(manager, 'services.manage'), 'allow supplements role');
check(!hasCapability(manager, 'access.manage'), 'access policy authority is not delegable');
check(hasCapability(manager, 'services.manage', { branchId: 'A' }) && !hasCapability(manager, 'services.manage', { branchId: 'B' }), 'permission grants do not change branches');
check(!hasCapability({ ...manager, permissionOverrides: normalizePermissionOverrides({ 'services.manage': 'inherit' }) }, 'services.manage'), 'inherit removes explicit grant');
check(!hasCapability({ ...manager, permissionOverrides: { 'services.manage': 'deny' } }, 'services.manage'), 'deny wins');
check(!hasCapability({ ...manager, permissionOverrides: { 'clinical.view': true } }, 'patients.view'), 'corrupt override maps fail closed');
for (const invalid of [null, [], true, { 'not.real': 'allow' }, { 'clinical.view': 'ALLOW' }, { 'clinical.view': {} }]) {
  assert.throws(() => normalizePermissionOverrides(invalid)); checks++;
}
check(permissionScopeKey({ permissionOverrides: { 'patients.view': 'deny', 'clinical.view': 'allow' } }) === permissionScopeKey({ permissionOverrides: { 'clinical.view': 'allow', 'patients.view': 'deny' } }), 'override ordering does not change scope');
check(permissionScopeKey(manager) !== permissionScopeKey({ ...manager, permissionOverrides: {} }), 'permission changes alter protected scope');
const restricted = { role: 'staff', active: true, permissionOverrides: { 'clinical.view': 'deny' } };
for (const collection of ['patients', 'appointments', 'visits']) {
  const data = { id: 'record', patientId: 'patient', patientName: 'Synthetic', branchId: 'A', doctorId: 'doctor', visitDate: '2028-01-01T09:00', status: 'Completed',
    serviceId: 'service', serviceNameSnapshot: 'Booked/performed', serviceDurationMinutesSnapshot: 30, serviceCatalogueVersion: 1,
    diagnosis: 'secret', notes: 'secret', treatmentPlan: 'secret', allergies: 'secret', medications: 'secret', medicalConditions: 'secret', healthConcerns: 'secret', prescriptionDraft: { text: 'secret' },
    clinicianFindings: { nested: { notes: 'secret' } }, attachments: [{ name: 'secret' }], customPayload: { clinical: 'secret' }, createdAt: { __timestamp: '2028-01-01', nested: 'secret' } };
  const result = redactClinicalData(collection, data, restricted);
  check(!JSON.stringify(result).includes('secret'), `${collection} no clinical value in payload`);
  check(result.patientName === 'Synthetic' && result.branchId === 'A' && result.status === 'Completed' && result.serviceNameSnapshot === 'Booked/performed' && result.doctorId === 'doctor', `${collection} operational workflow preserved`);
  check(!Object.hasOwn(result, 'notes') && !Object.hasOwn(result, 'attachments') && !Object.hasOwn(result, 'prescriptionDraft'), `${collection} forbidden keys absent`);
  check(redactClinicalData(collection, data, { role: 'staff', active: true }) === data, `${collection} Staff compatibility default retains clinical read`);
  assert.throws(() => assertClinicalQuery(restricted, collection, [{ type: 'where', field: 'diagnosis', value: 'secret' }])); checks++;
  assertClinicalQuery(restricted, collection, [{ type: 'where', field: 'patientId', value: 'patient' }]); checks++;
  check(!JSON.stringify(redactClinicalData(collection, { patientName: { diagnosis: 'secret' } }, restricted)).includes('secret'), `${collection} nested values in nominally scalar operational fields blocked`);
}
check(new Set(permissionDefinitions.map(entry => entry[0])).size === permissionDefinitions.length, 'stable IDs unique');
check(!roleAllows('doctor', 'clinical.finalize'), 'new finalize workflow not silently enabled by a role default');
assert.throws(() => assertCapability({ role: 'doctor', active: true, permissionOverrides: { 'clinical.finalize': 'deny' } }, 'clinical.finalize')); checks++;
assertCapability({ role: 'doctor', active: true, assignedBranches: ['A'], permissionOverrides: { 'clinical.finalize': 'allow' } }, 'clinical.finalize', { branchId: 'A' }); checks++;
console.log(`${checks} permission policy/redaction/backend-hook checks passed; no clinical workflow implemented.`);
