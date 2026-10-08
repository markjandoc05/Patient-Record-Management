import { administrativeRoles, clinicalPatientRoles, developerRoles, RBAC } from './rbac';

const all = Object.keys(RBAC);
const admin = administrativeRoles;
const clinical = clinicalPatientRoles;
export const permissionDefinitions = [
  ['dashboard.view', 'Dashboard', 'View dashboard', all],
  ['patients.view', 'Patients', 'View patients', all],
  ['patients.create', 'Patients', 'Register patients', all],
  ['patients.edit', 'Patients', 'Edit permitted patient fields', all],
  ['patients.archive', 'Patients', 'Archive and restore patients', admin],
  ['patients.attachments.manage', 'Patients', 'Manage patient files', clinical],
  ['appointments.view', 'Appointments', 'View appointments', all],
  ['appointments.create', 'Appointments', 'Book appointments', all],
  ['appointments.edit', 'Appointments', 'Edit appointments', all],
  ['appointments.archive', 'Appointments', 'Archive and restore appointments', admin],
  ['appointments.attachments.manage', 'Appointments', 'Manage appointment files', all],
  ['visits.view', 'Visits', 'View operational Visit records', all],
  ['visits.create', 'Visits', 'Create Visits', clinical],
  ['visits.edit', 'Visits', 'Edit Visits', clinical],
  ['visits.archive', 'Visits', 'Archive and restore Visits', admin],
  ['visits.attachments.manage', 'Visits', 'Manage Visit files', clinical],
  ['services.view', 'Services', 'View catalogue and permitted prices', all],
  ['services.manage', 'Services', 'Manage catalogue', admin],
  ['services.pricing', 'Services', 'Change prices', admin],
  ['clinical.view', 'Clinical', 'View clinical information', all],
  ['clinical.edit_draft', 'Clinical', 'Edit clinical documentation', clinical],
  ['clinical.finalize', 'Clinical', 'Finalize records (Clinical R1)', []],
  ['clinical.prescription_draft', 'Clinical', 'Author prescription drafts (Clinical R1)', []],
  ['clinical.private_notes.view', 'Clinical', 'Read private notes', clinical],
  ['clinical.private_notes.create', 'Clinical', 'Add private notes', clinical],
  ['users.view', 'Users', 'View user directory', all],
  ['users.manage', 'Users', 'Manage operational user details', admin],
  ['access.manage', 'Access', 'Administer roles, branches and permissions', admin],
  ['branches.view', 'Branches', 'View branch directory', all],
  ['branches.manage', 'Branches', 'Manage branches', admin],
  ['settings.view', 'Settings', 'View settings', admin],
  ['settings.manage', 'Settings', 'Manage application settings', admin],
  ['audit.view', 'Audit', 'View audit and login activity', admin],
  ['audit.export', 'Audit', 'Export audit records', admin],
  ['reports.view', 'Reports', 'View Insights', all],
  ['inventory.view', 'Inventory', 'View existing inventory', admin],
  ['inventory.manage', 'Inventory', 'Manage existing items and suppliers', admin],
  ['inventory.transfer', 'Inventory', 'Manage existing stock transfers', admin],
  ['developer.access', 'Developer', 'Use guarded Developer tools', developerRoles],
] as const;

export type PermissionId = typeof permissionDefinitions[number][0];
export type PermissionOverride = 'allow' | 'deny';
export type PermissionOverrides = Partial<Record<PermissionId, PermissionOverride>>;
export type PermissionActor = { role?: string; active?: boolean; accountStatus?: string; isArchived?: boolean; assignedBranches?: unknown; permissionOverrides?: unknown; accessRevision?: unknown };
export type PermissionContext = { branchId?: unknown };
const definitions = new Map<string, typeof permissionDefinitions[number]>(permissionDefinitions.map(entry => [entry[0], entry]));
export function isPermissionId(value: string): value is PermissionId { return definitions.has(value); }
export function roleAllows(role: unknown, id: PermissionId): boolean {
  return typeof role === 'string' && (definitions.get(id)?.[3] as readonly string[] | undefined)?.includes(role) === true;
}
export function activeAccount(actor?: PermissionActor | null): boolean {
  return !!actor && actor.active === true && !actor.isArchived && typeof actor.role === 'string' && Object.hasOwn(RBAC, actor.role)
    && (actor.accountStatus === undefined || actor.accountStatus === 'active');
}
export function hasGlobalBranchScope(actor?: PermissionActor | null) {
  return !!actor && (administrativeRoles as readonly string[]).includes(actor.role || '');
}
export function hasBranchScope(actor: PermissionActor, branchId: unknown): boolean {
  return typeof branchId === 'string' && !!branchId && (hasGlobalBranchScope(actor)
    || Array.isArray(actor.assignedBranches) && actor.assignedBranches.includes(branchId));
}
export function normalizePermissionOverrides(value: unknown): PermissionOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Invalid permission overrides');
  const result: PermissionOverrides = {};
  for (const [id, state] of Object.entries(value)) {
    if (!isPermissionId(id) || !['inherit', 'allow', 'deny'].includes(state as string)) throw new Error('Invalid permission override');
    if (state !== 'inherit') result[id] = state as PermissionOverride;
  }
  return result;
}
export function hasCapability(actor: PermissionActor | null | undefined, id: PermissionId, context: PermissionContext = {}): boolean {
  if (!activeAccount(actor) || !isPermissionId(id)) return false;
  let overrides: PermissionOverrides;
  try { overrides = actor!.permissionOverrides === undefined ? {} : normalizePermissionOverrides(actor!.permissionOverrides); }
  catch { return false; }
  if (overrides[id] === 'deny') return false;
  if (overrides[id] !== 'allow' && !roleAllows(actor!.role, id)) return false;
  // Security administration and Developer safeguards are not delegable by a map.
  if (id === 'access.manage' && !(administrativeRoles as readonly string[]).includes(actor!.role!)) return false;
  if (id === 'developer.access' && !(developerRoles as readonly string[]).includes(actor!.role!)) return false;
  return context.branchId === undefined || hasBranchScope(actor!, context.branchId);
}
export function permissionScopeKey(actor?: PermissionActor | null): string {
  const overrides = actor?.permissionOverrides;
  return JSON.stringify([actor?.accessRevision ?? 0, overrides && typeof overrides === 'object'
    ? Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)) : overrides ?? null]);
}

export const viewPermissions: Record<string, PermissionId> = {
  BranchDashboard: 'dashboard.view', Records: 'patients.view', Appointments: 'appointments.view',
  VisitHistory: 'visits.view', Services: 'services.view', Insights: 'reports.view',
  Inventory: 'inventory.view', AuditTrail: 'audit.view', DeveloperTools: 'developer.access',
};
export function canOpenView(actor: PermissionActor | null | undefined, view: string): boolean {
  if (view === 'Settings') return ['settings.view', 'users.manage', 'access.manage'].some(id => hasCapability(actor, id as PermissionId));
  return viewPermissions[view] ? hasCapability(actor, viewPermissions[view]) : activeAccount(actor);
}
