import { parsePatientHistory, patientHistoryFields, patientHistoryMetadata, patientHistoryVersion } from '../src/utils/patientMedicalHistory';
import { hasCapability, type PermissionActor } from '../src/permissions';

export class PatientHistoryError extends Error {
  constructor(public status: 400 | 403 | 409, message: string, public code?: string) { super(message); }
}

export function patientHistoryInput(payload: Record<string, unknown>, previous: Record<string, any> | undefined, actor: PermissionActor) {
  // A denied reader must never reach stored-value comparisons, even the parser's
  // unchanged legacy path. Empty form defaults preserve history; every other
  // supplied representation receives the same permission denial.
  if (!hasCapability(actor, 'clinical.view')) {
    for (const field of patientHistoryFields) {
      if (!Object.hasOwn(payload, field)) continue;
      if (typeof payload[field] !== 'string' || payload[field].trim() !== '') {
        throw new PatientHistoryError(403, 'Clinical changes are not permitted');
      }
    }
    return {};
  }
  try { return parsePatientHistory(payload, previous); }
  catch (error) { throw new PatientHistoryError(400, (error as Error).message); }
}

export function assertPatientHistoryMetadata(payload: Record<string, unknown>) {
  if (patientHistoryMetadata.some(field => Object.hasOwn(payload, field))) {
    throw new PatientHistoryError(400, 'Medical history attribution and version are supplied by the server.');
  }
}

// Invoke only after current transaction authorization and clinical write checks.
// A revision describes edits to these background notes, not a clinical review.
export function patientHistoryAttribution(payload: Record<string, unknown>, updates: Record<string, any>,
  previous: Record<string, any> | undefined, actor: { uid: string; name: string }, now: string) {
  const changed = patientHistoryFields.some(field => Object.hasOwn(updates, field)
    && updates[field] !== (previous?.[field] ?? ''));
  if (!changed) return {};
  let version: number;
  try { version = patientHistoryVersion(previous); }
  catch (error) { throw new PatientHistoryError(409, (error as Error).message, 'PATIENT_HISTORY_VERSION_CHANGED'); }
  if (previous && (!Number.isSafeInteger(payload.expectedClinicalHistoryVersion)
    || payload.expectedClinicalHistoryVersion !== version)) {
    throw new PatientHistoryError(409, 'Medical history changed. Reload the patient and review your changes before saving.', 'PATIENT_HISTORY_VERSION_CHANGED');
  }
  if (version === Number.MAX_SAFE_INTEGER) throw new PatientHistoryError(409, 'The medical history version needs review.');
  return { clinicalHistoryVersion: version + 1, clinicalHistoryUpdatedAt: now,
    clinicalHistoryUpdatedByUid: actor.uid, clinicalHistoryUpdatedByName: actor.name };
}
