import { hasCapability, type PermissionActor } from '../src/permissions';

// Closed operational projections: new/unknown JSONB fields are never assumed safe.
const common = `id patientId patientID patientName name branchId branchName homeBranchId homeBranchName
  doctorId doctorName providerId providerName appointmentId visitId appointmentDate visitDate date time
  visitType status isArchived totalVisits lastVisitDate dateRegistered totalCompletedVisits totalNoShowVisits firstVisitDate lastVisitBranch lastVisitStatus lastVisitType currentPatientStatus lastStatusChangedAt lastStatusChangedByUid lastStatusChangedByName visitHistoryCreated visitHistoryId createdAt updatedAt lastUpdatedAt
  createdBy createdByUid createdByName updatedBy updatedByUid updatedByName lastUpdatedBy lastUpdatedByUid lastUpdatedByName
  createdBranchId createdBranchName lastUpdatedBranchId lastUpdatedBranchName createdByUserDefaultBranchId createdByUserDefaultBranchName
  archivedAt archivedByUid archivedByName restoredAt restoredByUid restoredByName
  serviceId serviceNameSnapshot serviceDurationMinutesSnapshot serviceCatalogueVersion servicePerformed treatmentService
  serviceVersion recordVersion version`;
const fields: Record<string, Set<string>> = {
  patients: new Set((common + ` firstName middleName lastName suffix fullName sex gender birthdate dateOfBirth birthdateType birthYear birthMonth
    birthDateSource birthDatePrecision birthday birthDateStatus estimatedAge estimatedAgeAsOf estimatedBirthYear emergencyContact age ageAtRegistration recordedAge ageRecordedAt ageAsOfDate contactNumber email address
    emergencyContactName emergencyContactRelationship emergencyContactNumber referralSource occupation civilStatus nationality`).split(/\s+/)),
  appointments: new Set(common.split(/\s+/)),
  visits: new Set(common.split(/\s+/)),
};
export const safeAuditQueryFields = new Set(['action', 'resource', 'resourceId', 'branchId', 'timestamp', 'userId', 'userName', 'userRole', 'eventType', 'source']);
function scalar(value: any): any {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value && typeof value === 'object' && typeof value.__timestamp === 'string') return { __timestamp: value.__timestamp };
  return undefined;
}
export function operationalField(collection: string, field: string): boolean { return fields[collection]?.has(field) === true; }
export function redactClinicalData(collection: string, data: any, actor: PermissionActor): any {
  if (!data || hasCapability(actor, 'clinical.view')) return data;
  if (fields[collection]) return Object.fromEntries(Object.entries(data)
    .filter(([key, value]) => operationalField(collection, key) && scalar(value) !== undefined)
    .map(([key, value]) => [key, scalar(value)]));
  if (/\/privateNotes$/.test(collection)) return null;
  if (collection === 'audit_logs') {
    // Legacy audit bodies can contain clinical text. Access events contain only validated policy metadata.
    const safe = Object.fromEntries(Object.entries(data).filter(([key]) => ['action', 'resource', 'resourceId', 'branchId', 'timestamp', 'userId', 'userName', 'userRole', 'eventType', 'source'].includes(key)));
    if (data.eventType === 'access_policy_changed') return { ...safe, changes: data.changes, accessRevision: data.accessRevision };
    return { ...safe, details: 'Activity recorded', changes: Array.isArray(data.changes) ? data.changes.map((change: any) => ({ field: typeof change?.field === 'string' ? change.field : '' })) : [] };
  }
  return data;
}
export function assertClinicalQuery(actor: PermissionActor, collection: string, constraints: any[]) {
  if (hasCapability(actor, 'clinical.view')) return;
  const permitted = collection === 'audit_logs' ? safeAuditQueryFields : fields[collection];
  if (!permitted) return;
  if (constraints.some(constraint => constraint.field && !permitted.has(constraint.field))) {
    throw Object.assign(new Error('Clinical query fields are not permitted'), { status: 403 });
  }
}
export const clinicalWriteFields = new Set(['skinType', 'followUpInstructions', 'diagnosis', 'notes', 'mainConcern', 'clinicalNotes', 'treatmentPlan', 'allergies', 'medications', 'medicalConditions', 'medicalHistory', 'healthConcerns', 'clinicalFindings', 'allergiesStatus', 'medicationsStatus', 'medicalConditionsStatus', 'medicalHistoryStatus', 'prescriptionDraft', 'prescriptions']);
// Only surrounding whitespace is presentation-only; structured clinical values stay exact.
export function sameClinicalRepresentation(submitted: unknown, stored: unknown) {
  return typeof submitted === 'string' && typeof stored === 'string'
    ? submitted.trim() === stored.trim()
    : JSON.stringify(submitted) === JSON.stringify(stored);
}
export function protectClinicalWrite(actor: PermissionActor, submitted: any, previous: any, requiredEdit = true) {
  if (hasCapability(actor, 'clinical.view') && (!requiredEdit || hasCapability(actor, 'clinical.edit_draft'))) return;
  for (const field of clinicalWriteFields) {
    if (!Object.hasOwn(submitted, field)) continue;
    const value = submitted[field];
    // Empty omitted UI defaults must not erase the protected stored value.
    if (value === '' || value === null || value === undefined || value === 'unknown' && field.endsWith('Status')) { delete submitted[field]; continue; }
    if (!sameClinicalRepresentation(value, previous?.[field])) throw Object.assign(new Error('Clinical changes are not permitted'), { status: 403 });
    delete submitted[field];
  }
}
