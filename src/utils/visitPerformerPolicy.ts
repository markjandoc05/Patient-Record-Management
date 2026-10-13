import { activeAccount } from '../permissions';
import { isMedicalStaffDesignation } from '../staffDesignation';

export { STAFF_DESIGNATIONS, isStaffDesignation, type StaffDesignation } from '../staffDesignation';
export const ASSISTING_STAFF_MAX_LENGTH = 500;
export const visitPerformerSnapshotFields = ['performedByNameSnapshot', 'performedByRoleSnapshot', 'performedByDesignationSnapshot'] as const;

// Performer eligibility is separate from the actor's effective access and branch scope.
export function isEligibleVisitPerformer(user: any, branchId: string): boolean {
  return activeAccount(user) && !!branchId && Array.isArray(user.assignedBranches)
    && user.assignedBranches.includes(branchId)
    && (user.role === 'doctor' || user.role === 'staff'
      && isMedicalStaffDesignation(user.staffDesignation));
}

export function visitPerformerLabel(user: any): string {
  const name = user?.fullName || user?.name || 'Unnamed staff';
  const designation = user?.role === 'doctor' ? 'Doctor' : user?.staffDesignation;
  return designation ? `${name} · ${designation}` : name;
}

// Recorded snapshots remain authoritative when accounts are renamed or removed.
export function visitPerformerName(visit: any, users: any[] = []): string {
  if (visit?.performedByUserId) return visit.performedByNameSnapshot || 'Recorded performer';
  const doctor = users.find(user => user.id === visit?.doctorId);
  return visit?.doctorName || doctor?.fullName || doctor?.name || (visit?.doctorId ? 'Recorded doctor' : 'Unassigned');
}

export function visitDoctorIds(visit: any): string[] {
  return [...new Set([visit?.doctorId,
    visit?.performedByRoleSnapshot === 'doctor' ? visit?.performedByUserId : null]
    .filter((id): id is string => typeof id === 'string' && !!id))];
}
