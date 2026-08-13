import assert from 'node:assert/strict';
import { canEditPatient, getPatientEditScope, hasPermission } from '../src/rbac';

assert.equal(hasPermission('doctor', 'visitHistory', 'create'), true, 'Doctors must be able to create visits');
assert.equal(hasPermission('doctor', 'visitHistory', 'update'), true, 'Doctors must be able to update visits');
assert.equal(hasPermission('manager', 'visitHistory', 'create'), false, 'Managers must not create clinical visits');
assert.equal(hasPermission('manager', 'visitHistory', 'update'), false, 'Managers must not edit clinical visits');
assert.equal(hasPermission('staff', 'patientRecord', 'update'), false, 'Staff must not receive unrestricted patient updates');
assert.equal(canEditPatient('staff'), true, 'Staff must be able to make limited demographic corrections');
assert.equal(getPatientEditScope('staff'), 'demographic');
assert.equal(getPatientEditScope('manager'), 'operational');
assert.equal(getPatientEditScope('doctor'), 'full');

for (const module of ['patientRecord', 'appointment', 'visitHistory'] as const) {
  for (const permission of ['create', 'read', 'update', 'delete'] as const) {
    assert.equal(
      hasPermission('support_developer', module, permission),
      true,
      `Support Developer must retain ${permission} on ${module}`,
    );
  }
}

console.log('RBAC assertions passed');
