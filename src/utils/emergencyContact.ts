export function parseEmergencyContact(payload: any) {
  const limits = { emergencyContactName: 120, emergencyContactRelationship: 80, emergencyContactNumber: 40 };
  const result: Record<keyof typeof limits, string> = { emergencyContactName: '', emergencyContactRelationship: '', emergencyContactNumber: '' };
  for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = payload[field];
    if (value !== undefined && value !== null && typeof value !== 'string') throw new Error(`${field} must be text.`);
    result[field] = (value || '').replace(/\u0000/g, '').trim();
    if (result[field].length > limits[field]) throw new Error(`${field} is too long.`);
  }
  const digits = result.emergencyContactNumber.replace(/\D/g, '');
  if (result.emergencyContactNumber && (digits.length < 7 || digits.length > 15)) throw new Error('Enter an emergency contact number with 7 to 15 digits.');
  return result;
}
