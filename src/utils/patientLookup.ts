const text = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
function phone(value: unknown) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (/^00639\d{2,9}$/.test(digits)) digits = digits.slice(4);
  else if (/^639\d{2,9}$/.test(digits)) digits = digits.slice(2);
  else if (/^09\d{2,9}$/.test(digits)) digits = digits.slice(1);
  return digits;
}
export function matchesPatientLookup(patient: any, search: string): boolean {
  const needle = text(search);
  if (!needle) return true;
  if ([patient.name, patient.email, patient.patientID, patient.id, patient.contactNumber]
    .some(value => text(value).includes(needle))) return true;
  // Only a phone-shaped query uses digits: an ID/date/name containing digits
  // must not unexpectedly become a telephone search.
  if (!/^[+\d\s().-]+$/.test(needle)) return false;
  const number = phone(needle);
  return number.length >= 3 && phone(patient.contactNumber).includes(number);
}
