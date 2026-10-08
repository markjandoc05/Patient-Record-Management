export const birthModes = ['exact', 'estimated_age', 'estimated_year', 'unknown'] as const;
export function birthMode(patient: any): string {
  return patient.birthDateStatus || (patient.birthday ? 'exact' : 'unknown');
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parsePatientBirth(patient: any, today: string) {
  const mode = birthMode(patient);
  if (!birthModes.includes(mode as any)) throw new Error('Select a valid date-of-birth status.');
  const result = { birthDateStatus: mode, birthday: '', age: null as number | null,
    estimatedAge: null as number | null, estimatedAgeAsOf: '', estimatedBirthYear: null as number | null };
  if (mode === 'exact') {
    if (!validDate(patient.birthday) || patient.birthday > today) throw new Error('Enter a valid date of birth that is not in the future.');
    const [y, m, d] = patient.birthday.split('-').map(Number);
    const [ty, tm, td] = today.split('-').map(Number);
    const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
    if (age < 0 || age > 130) throw new Error('Date of birth must give an age between 0 and 130.');
    result.birthday = patient.birthday; result.age = age;
  } else if (mode === 'estimated_age') {
    const value = patient.estimatedAge;
    const age = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(age) || age < 0 || age > 130) throw new Error('Enter an estimated age between 0 and 130.');
    if (!validDate(patient.estimatedAgeAsOf) || patient.estimatedAgeAsOf > today) throw new Error('Enter a valid age “as of” date that is not in the future.');
    result.estimatedAge = age; result.estimatedAgeAsOf = patient.estimatedAgeAsOf;
  } else if (mode === 'estimated_year') {
    const value = patient.estimatedBirthYear;
    const year = typeof value === 'number' ? value : typeof value === 'string' && /^\d{4}$/.test(value) ? Number(value) : NaN;
    const current = Number(today.slice(0, 4));
    if (!Number.isInteger(year) || year < current - 130 || year > current) throw new Error('Enter a valid estimated birth year.');
    result.estimatedBirthYear = year;
  }
  return result;
}
export function patientBirthLabel(patient: any) {
  const mode = birthMode(patient);
  if (mode === 'estimated_age') return `Estimated age ${patient.estimatedAge ?? 'unknown'} as of ${patient.estimatedAgeAsOf || 'unknown'}`;
  if (mode === 'estimated_year') return `Estimated birth year ${patient.estimatedBirthYear ?? 'unknown'}`;
  if (mode === 'exact') return patient.birthday || 'Exact date not provided';
  return 'Date of birth unknown';
}
