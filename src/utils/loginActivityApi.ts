import { captureProtectedRequestScope, protectedFetch, invalidateProtectedData } from '../dataClient';
import { auth } from '../platform';

export type LoginActivityRecord = {
  id: string;
  userName: string;
  userEmail: string;
  timestamp: string;
  ipAddress: string;
  location: string;
  browser: string;
  operatingSystem: string;
  deviceType: string;
};

async function loginActivityRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const lifetime = captureProtectedRequestScope();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in again before accessing login activity.');
  const token = await currentUser.getRequestToken();
  lifetime();
  const response = await protectedFetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const body = await response.json().catch(() => null);
  lifetime();
  if (response.status === 401 || response.status === 403) invalidateProtectedData();
  if (!response.ok) throw new Error(body?.error || 'Login activity request failed.');
  return body as T;
}

export const recordLoginActivity = () => loginActivityRequest<{ recorded: boolean }>('/api/login-activity/record', { method: 'POST' });
export const fetchLoginActivity = () => loginActivityRequest<{ records: LoginActivityRecord[] }>('/api/login-activity');
