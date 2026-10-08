import { captureProtectedRequestScope, protectedFetch, invalidateProtectedData } from '../dataClient';
import { auth } from '../platform';

type UserAccountAction = 'archive' | 'restore' | 'activate' | 'deactivate' | 'delete';

async function userAccountRequest(userId: string, action: UserAccountAction) {
  const lifetime = captureProtectedRequestScope();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in again before managing user accounts.');

  const token = await currentUser.getRequestToken();
  lifetime();
  const response = await protectedFetch(`/api/users/${encodeURIComponent(userId)}${action === 'delete' ? '' : `/${action}`}`, {
    method: action === 'delete' ? 'DELETE' : 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  lifetime();
  if (response.status === 401 || response.status === 403) invalidateProtectedData();
  if (!response.ok) throw new Error(body?.error || 'Unable to manage this user account.');
  return body;
}

export const archiveUserAccount = (userId: string) => userAccountRequest(userId, 'archive');
export const restoreUserAccount = (userId: string) => userAccountRequest(userId, 'restore');
export const activateUserAccount = (userId: string) => userAccountRequest(userId, 'activate');
export const deactivateUserAccount = (userId: string) => userAccountRequest(userId, 'deactivate');
export const deleteUserAccount = (userId: string) => userAccountRequest(userId, 'delete');
