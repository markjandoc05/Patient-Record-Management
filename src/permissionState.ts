import { hasCapability, permissionScopeKey, type PermissionActor, type PermissionId } from './permissions';

// Ephemeral mirror of the server's own-profile response. Never an authorization source.
let profile: PermissionActor | null = null;
let initialized = false;
export function publishPermissionProfile(value: PermissionActor | null) { initialized = true; profile = value; }
export function currentPermissionProfile() { return profile; }
export function uiCan(fallback: PermissionActor | string | null | undefined, permission: PermissionId): boolean {
  const actor = initialized ? profile : typeof fallback === 'string' ? { role: fallback, active: true } : fallback;
  return hasCapability(actor, permission);
}
export function uiPermissionScope(fallback?: PermissionActor | null) { return permissionScopeKey(initialized ? profile : fallback); }
export function uiRecordPermission(role: string | null, module: string, action: string): boolean {
  const prefix = ({ patientRecord: 'patients', appointment: 'appointments', visitHistory: 'visits' } as Record<string, string>)[module];
  const verb = ({ read: 'view', create: 'create', update: 'edit', delete: 'archive' } as Record<string, string>)[action];
  return !!prefix && !!verb && uiCan(role, `${prefix}.${verb}` as PermissionId)
    && (module !== 'visitHistory' || !['create', 'update'].includes(action) || uiCan(role, 'clinical.view') && uiCan(role, 'clinical.edit_draft'));
}
