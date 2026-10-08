import { auth } from '../platform';
import { captureProtectedRequestScope, protectedFetch, invalidateProtectedData } from '../dataClient';

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
  return body as { id: string; accessRevision: number; permissionOverrides: Record<string, 'allow' | 'deny'> };
}
