import { auth } from '../firebase';

/**
 * Creates the caller's inactive profile through the trusted API. The server
 * derives identity from the Firebase ID token; callers cannot choose a UID,
 * role, status, or clinic access.
 */
export async function registerPendingGoogleAccount() {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Google sign-in session is unavailable. Please try again.');

  const token = await currentUser.getIdToken();
  const response = await fetch('/api/auth/register-pending-profile', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'Unable to create your pending account.');
  return body as { id: string; created: boolean; accountStatus: string; active: boolean };
}
