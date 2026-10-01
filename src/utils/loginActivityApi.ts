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
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in again before accessing login activity.');
  const token = await currentUser.getRequestToken();
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'Login activity request failed.');
  return body as T;
}

export const recordLoginActivity = () => loginActivityRequest<{ recorded: boolean }>('/api/login-activity/record', { method: 'POST' });
export const fetchLoginActivity = () => loginActivityRequest<{ records: LoginActivityRecord[] }>('/api/login-activity');
