export const findingFields = ['allergies', 'medications', 'medicalConditions'] as const;
export const findingStates = ['unknown', 'none_known', 'present'] as const;
export function findingState(patient: any, field: string): string {
  return patient[`${field}Status`] || 'unknown';
}
// Free-text edits cannot establish a structured positive or negative finding.
// Preserve an existing status only while its reported details remain unchanged.
export function reportedFindingEdit(patient: any, field: typeof findingFields[number], details: string) {
  return {
    [field]: details,
    [`${field}Status`]: String(patient[field] || '').trim() === details.trim()
      ? findingState(patient, field) : 'unknown',
  };
}
export function parseClinicalFindings(patient: any) {
  const result: Record<string, string> = {};
  for (const field of findingFields) {
    const state = findingState(patient, field);
    if (!findingStates.includes(state as any)) throw new Error(`Select a valid ${field} status.`);
    const details = String(patient[field] || '').trim();
    if (state === 'present' && !details) throw new Error(`Provide details for ${field} marked Present.`);
    if (state === 'none_known' && details) throw new Error(`${field} cannot be None Known while details are entered. Review the information before changing it.`);
    result[`${field}Status`] = state;
  }
  return result;
}
export function clinicalFindingLabel(patient: any, field: string): string {
  const state = findingState(patient, field);
  const details = String(patient[field] || '').trim();
  if (state === 'none_known') return details ? `Conflicting record: None Known; details: ${details}` : 'None Known (reported)';
  if (state === 'present') return details ? `Present: ${details}` : 'Present — details not recorded';
  return details ? `Unknown / unconfirmed details: ${details}` : 'Unknown';
}
