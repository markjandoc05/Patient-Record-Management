import { createHash } from 'node:crypto';

// Frozen pre-Visit-quote contract from HEAD 469ff1fb. Do not import the current
// fingerprint function or field lists: upgrade tests must detect contract drift.
export function legacyVisitIntentFingerprint469ff1f(value: any): string {
  const canonical = (input: any): any => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === 'object'
      ? Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])])) : input;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function legacyVisitFingerprint469ff1f(record: any): string {
  const fields = ['visitType', 'treatmentService', 'mainConcern', 'notes', 'diagnosis', 'treatmentPlan',
    'visitOutcome', 'visitSource', 'nextVisitDate', 'followUpInstructions', 'patientId', 'branchId',
    'doctorId', 'visitDate', 'appointmentId', 'followUpRequired', 'status', 'serviceId',
    'serviceNameSnapshot', 'serviceDurationMinutesSnapshot', 'serviceCatalogueVersion',
    'performedByUserId', 'performedByNameSnapshot', 'performedByRoleSnapshot',
    'performedByDesignationSnapshot', 'assistingStaffText'];
  return legacyVisitIntentFingerprint469ff1f(Object.fromEntries(fields.map(field => [field, record[field] ?? null])));
}
