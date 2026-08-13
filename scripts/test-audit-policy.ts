import assert from 'node:assert/strict';
import { shouldRecordAuditEvent } from '../src/auditPolicy';

assert.equal(shouldRecordAuditEvent({ actorRole: 'support_developer', action: 'DELETE', resource: 'Patient' }), false);
assert.equal(shouldRecordAuditEvent({ actorRole: 'support_developer', action: 'UPDATE', resource: 'Settings' }), false);
assert.equal(shouldRecordAuditEvent({ actorRole: 'admin', action: 'VIEW', resource: 'Patient' }), false);
assert.equal(shouldRecordAuditEvent({ actorRole: 'doctor', action: 'UPDATE', resource: 'Visit', eventType: 'attachment_uploaded' }), false);
assert.equal(shouldRecordAuditEvent({ actorRole: 'doctor', action: 'UPDATE', resource: 'Visit', eventType: 'attachment_deleted' }), true);
assert.equal(shouldRecordAuditEvent({ actorRole: 'staff', action: 'CREATE', resource: 'Appointment' }), true);
assert.equal(shouldRecordAuditEvent({ actorRole: 'admin', action: 'DELETE', resource: 'User' }), true);
assert.equal(shouldRecordAuditEvent({ actorRole: 'staff', action: 'AUTH', resource: 'User' }), true);
assert.equal(shouldRecordAuditEvent({ actorRole: 'staff', action: 'AUTH', resource: 'Settings' }), false);

console.log('Audit policy tests passed.');
