import type express from 'express';
import { db, type RecordTransaction } from './database';
import { sessionIdentity, type SessionIdentity } from './auth';
import { assertDevelopmentRole } from './developmentAccess';
import { activeAccount, hasCapability, type PermissionId, type PermissionContext, normalizePermissionOverrides } from '../src/permissions';
import { isSupportDeveloper } from '../src/rbac';

export function permissionDenied(message = 'Insufficient permissions'): never { throw Object.assign(new Error(message), { status: 403 }); }
export function assertCapability(profile: any, permission: PermissionId, context?: PermissionContext) {
  assertDevelopmentRole(profile?.role);
  if (!hasCapability(profile, permission, context)) permissionDenied();
}
export async function currentActor(req: express.Request, tx: RecordTransaction) {
  const identity = await sessionIdentity(req, tx);
  const profile = (await tx.get(db.collection('users').doc(identity.uid))).data();
  assertDevelopmentRole(profile?.role);
  if (!activeAccount(profile)) permissionDenied('Account is not approved or active');
  return { identity, profile: profile! };
}
export function assertAccessTarget(identity: SessionIdentity, profile: any, targetId: string, target: any, next: any) {
  assertCapability(profile, 'access.manage');
  if (identity.uid === targetId && (Object.hasOwn(next, 'permissionOverrides') || next.role && next.role !== target.role)) permissionDenied('You cannot change your own role or permission overrides');
  if (!isSupportDeveloper(profile.role) && (isSupportDeveloper(target.role) || isSupportDeveloper(next.role))) permissionDenied('Administrators cannot manage Support / Developer access');
  assertDevelopmentRole(target.role);
  assertDevelopmentRole(next.role);
}
export function stageAccessAudit(tx: RecordTransaction, identity: SessionIdentity, profile: any, targetId: string, old: any, next: any) {
  const changes: any[] = [];
  for (const field of ['role', 'assignedBranches', 'defaultBranchId']) {
    if (JSON.stringify(old?.[field] ?? null) !== JSON.stringify(next[field] ?? null)) changes.push({ field, before: old?.[field] ?? null, after: next[field] ?? null });
  }
  const before = old?.permissionOverrides === undefined ? {} : normalizePermissionOverrides(old.permissionOverrides);
  const after = next.permissionOverrides === undefined ? {} : normalizePermissionOverrides(next.permissionOverrides);
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[id as keyof typeof before] ?? 'inherit', b = after[id as keyof typeof after] ?? 'inherit';
    if (a !== b) changes.push({ field: 'permissionOverrides.' + id, before: a, after: b });
  }
  if (!changes.length) return old?.accessRevision ?? 0;
  const accessRevision = (Number.isSafeInteger(old?.accessRevision) ? old.accessRevision : 0) + 1;
  tx.create(db.collection('audit_logs').doc(), { action: 'UPDATE', resource: 'User', resourceId: targetId,
    userId: identity.uid, userName: profile.fullName || identity.email, userRole: profile.role,
    timestamp: new Date().toISOString(), eventType: 'access_policy_changed', source: 'trusted_server',
    details: 'User access policy changed', changes, accessRevision });
  return accessRevision;
}
