import { birthMode } from './patientBirth';
const text = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
function fullPhone(value: unknown) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (/^00639\d{9}$/.test(digits)) digits = digits.slice(4);
  else if (/^639\d{9}$/.test(digits)) digits = digits.slice(2);
  else if (/^09\d{9}$/.test(digits)) digits = digits.slice(1);
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}
export function patientDuplicateReasons(draft: any, existing: any): string[] {
  const name = text(draft.name);
  const sameName = name.length >= 2 && name === text(existing.name);
  const reasons: string[] = [];
  if (sameName) reasons.push('Same full name');
  const phone = fullPhone(draft.contactNumber);
  if (phone && phone === fullPhone(existing.contactNumber)) reasons.push('Same mobile number');
  const email = text(draft.email);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email === text(existing.email)) reasons.push('Same email address');
  if (sameName && birthMode(draft) === 'exact' && birthMode(existing) === 'exact'
    && /^\d{4}-\d{2}-\d{2}$/.test(draft.birthday || '') && draft.birthday === existing.birthday) reasons.push('Same full name and exact date of birth');
  return reasons;
}
export function possiblePatientDuplicates(draft: any, patients: any[]) {
  return patients.filter(patient => patient.id !== draft.id)
    .map(patient => ({ patient, reasons: patientDuplicateReasons(draft, patient) }))
    .filter(match => match.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length || String(a.patient.id).localeCompare(String(b.patient.id)));
}
