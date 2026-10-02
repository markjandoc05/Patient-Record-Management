import { administrativeRoles } from '../src/rbac';
import type { RecordQuery } from './database';

// Match the existing operating-branch policy: administrative roles have global
// access; every other approved role is limited to its current assignments.
const globalAppointmentRoles = new Set<string>(administrativeRoles);
type Profile = { role?: string; assignedBranches?: unknown };
function appointmentBranches(profile: Profile): string[] | null {
  if (globalAppointmentRoles.has(profile.role || '')) return null;
  if (!Array.isArray(profile.assignedBranches)) return [];
  return [...new Set(profile.assignedBranches.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  ))];
}

export function scopeAppointmentRead(query: RecordQuery, profile: Profile): RecordQuery {
  const branches = appointmentBranches(profile);
  // This server constraint is ANDed with client filters before sorting/limits.
  // Strict string membership also excludes malformed or missing branch IDs.
  return branches === null ? query : query.where('branchId', 'string-in', branches);
}

export function assertAppointmentRead(profile: Profile, data: Record<string, any>) {
  const branches = appointmentBranches(profile);
  if (branches !== null && (typeof data.branchId !== 'string' || !branches.includes(data.branchId))) {
    throw Object.assign(new Error('Branch access denied'), { status: 403 });
  }
}
