import { RBAC, hasAdministrativeAccess } from '../rbac';

export const PENDING_APPROVAL_MESSAGE = 'Your Google account is registered and awaiting administrator approval. Ask your clinic administrator to assign your role and clinic access, then activate your account. Sign in again with the same Google account after approval.';

export type UserAccessView = 'active' | 'pending' | 'inactive' | 'archived';

export function matchesUserAccessView(profile: { active?: boolean; isArchived?: boolean; accountStatus?: string }, view: UserAccessView): boolean {
  if (view === 'archived') return profile.isArchived === true;
  if (profile.isArchived === true) return false;
  if (view === 'pending') return profile.accountStatus === 'pending_activation';
  if (view === 'inactive') return profile.active !== true && profile.accountStatus !== 'pending_activation';
  return profile.active === true;
}

export function accountAccessMessage(profile: { accountStatus?: string; isArchived?: boolean }) {
  if (profile.isArchived || profile.accountStatus === 'archived') return 'Your account is archived. Contact your clinic administrator about restoring access.';
  return profile.accountStatus === 'pending_activation'
    ? PENDING_APPROVAL_MESSAGE
    : 'Your account is inactive. Contact your clinic administrator about reactivating access.';
}

export interface ActivationProfile {
  role?: unknown;
  assignedBranches?: unknown;
  defaultBranchId?: unknown;
}
export interface ActivationBranch { id: string; status?: string }

// Shared guidance only; the backend loads current records and enforces these
// requirements inside the mutation transaction. Defaults are optional.
export function assignmentIssues(profile: ActivationProfile, branches: ActivationBranch[], requireActive = false): string[] {
  const assigned = profile.assignedBranches === undefined ? [] : profile.assignedBranches;
  if (!Array.isArray(assigned) || assigned.some(id => typeof id !== 'string' || !id.trim())) return ['Clinic assignments must contain valid clinic IDs.'];
  const issues: string[] = [];
  const defaultId = profile.defaultBranchId;
  if (defaultId !== undefined && defaultId !== null && defaultId !== ''
      && (typeof defaultId !== 'string' || !assigned.includes(defaultId))) issues.push('The default clinic must be one of the assigned clinics.');
  if (assigned.some(id => !branches.some(branch => branch.id === id))) issues.push('An assigned clinic no longer exists. Remove it or assign another clinic.');
  else if (requireActive && assigned.some(id => branches.find(branch => branch.id === id)?.status !== 'Active')) issues.push('All assigned clinics must be active before activating this user.');
  return issues;
}

export function activationIssues(profile: ActivationProfile, branches: ActivationBranch[]): string[] {
  const roleValid = typeof profile.role === 'string' && Object.prototype.hasOwnProperty.call(RBAC, profile.role);
  const global = roleValid && hasAdministrativeAccess(profile.role);
  const issues = assignmentIssues(profile, branches, !global);
  if (!roleValid) issues.unshift('Assign a valid role before activating this user.');
  if (!global && (profile.assignedBranches === undefined
      || Array.isArray(profile.assignedBranches) && profile.assignedBranches.length === 0)) issues.push('Assign at least one active clinic before activating this user.');
  return issues;
}
