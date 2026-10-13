import { auth } from '../platform';
import { captureProtectedRequestScope, protectedFetch, invalidateProtectedData } from '../dataClient';

export type UserAccessResult = { id: string; accessRevision: number; staffDesignation?: string | null; permissionOverrides: Record<string, 'allow' | 'deny'> };

// Compare with the state at merge time: a profile refresh may already be queued
// even when an editor still holds the previous rendered target.
export function mergeUserAccessResult<T extends { id: string; accessRevision?: number }>(users: T[], result: UserAccessResult): T[] {
  return users.map(user => user.id === result.id && (user.accessRevision ?? 0) <= result.accessRevision
    ? { ...user, ...result } : user);
}

export async function updateUserAccess(userId: string, expectedAccessRevision: number, changes: Record<string, unknown>) {
  const current = captureProtectedRequestScope();
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  const token = await user.getRequestToken();
  current();
  const response = await protectedFetch(`/api/users/${encodeURIComponent(userId)}/access`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedAccessRevision, ...changes }),
  }, current);
  const body = await response.json();
  current();
  if (!response.ok) {
    const error = Object.assign(new Error(body.error || 'Access could not be saved.'), { status: response.status });
    if ([401, 403].includes(response.status)) invalidateProtectedData(error);
    throw error;
  }
  return body as UserAccessResult;
}
