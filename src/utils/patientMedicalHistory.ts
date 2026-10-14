export const patientHistoryLimits = { medicalHistory: 5000, healthConcerns: 2000 } as const;
export const patientHistoryFields = Object.keys(patientHistoryLimits) as (keyof typeof patientHistoryLimits)[];
export const patientHistoryMetadata = [
  'clinicalHistoryVersion', 'clinicalHistoryUpdatedAt',
  'clinicalHistoryUpdatedByUid', 'clinicalHistoryUpdatedByName',
] as const;

export function patientHistoryLabel(value: unknown): string {
  if (value === undefined || value === null || typeof value === 'string' && !value.trim()) return 'Not recorded';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function patientHistoryVersion(patient: any): number {
  const version = patient?.clinicalHistoryVersion;
  if (version === undefined) return 0;
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('The medical history version needs review. Reload the patient record.');
  return version;
}

// Omission is not a clear. Unchanged imported text is historical, including its
// whitespace and length; today's input limits apply only to a new value.
export function parsePatientHistory(payload: Record<string, unknown>, previous: any = {}) {
  const result: Record<string, string> = {};
  for (const field of patientHistoryFields) {
    if (!Object.hasOwn(payload, field)) continue;
    const value = payload[field];
    if (typeof value !== 'string') throw new Error(`${field} must be text.`);
    if (typeof previous[field] === 'string' && value.trim() === previous[field].trim()) {
      result[field] = previous[field]; continue;
    }
    if (value.length > patientHistoryLimits[field]) throw new Error(`${field} must contain ${patientHistoryLimits[field]} characters or fewer.`);
    result[field] = value.trim();
  }
  return result;
}
