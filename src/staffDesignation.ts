export const STAFF_DESIGNATIONS = ['Nurse', 'Medical Staff', 'Reception/Admin Staff'] as const;
export type StaffDesignation = typeof STAFF_DESIGNATIONS[number];

export function isStaffDesignation(value: unknown): value is StaffDesignation {
  return typeof value === 'string' && (STAFF_DESIGNATIONS as readonly string[]).includes(value);
}

export function isMedicalStaffDesignation(value: unknown): boolean {
  return value === 'Nurse' || value === 'Medical Staff';
}
