import { captureProtectedRequestScope, protectedFetch, invalidateProtectedData } from '../dataClient';
import { auth } from '../platform';
import type { DeveloperActivityEvent } from '../developerToolsPolicy';

export class DeveloperToolsApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'DeveloperToolsApiError';
  }
}

async function developerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const lifetime = captureProtectedRequestScope();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new DeveloperToolsApiError('Please sign in again before using Developer Tools.');

  const token = await currentUser.getRequestToken();
  lifetime();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  const response = await protectedFetch(path, { ...init, headers, credentials: 'same-origin' });
  const body = await response.json().catch(() => null);
  lifetime();
  if (response.status === 401 || response.status === 403) invalidateProtectedData();
  if (!response.ok) {
    const fallback = response.status === 404
      ? 'Diagnostics service is unavailable. Refresh after the current server deployment is complete.'
      : response.status === 401 || response.status === 403
        ? 'Your current account is not authorized for this Developer Tools action.'
        : response.status === 429
          ? 'Too many diagnostic requests. Please wait a moment and try again.'
          : 'Developer Tools request failed.';
    throw new DeveloperToolsApiError(body?.error || fallback, response.status);
  }
  return body as T;
}

export const fetchDeveloperMetrics = () => developerRequest<{ users: number; patients: number; appointments: number; visits: number }>('/api/developer/metrics');
export const runDeveloperDiagnostics = () => developerRequest<{ databaseLatencyMs: number; serverTime: string }>('/api/developer/diagnostics', { method: 'POST' });
export const setDeveloperMaintenanceMode = (maintenanceMode: boolean) => developerRequest('/api/developer/maintenance', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ maintenanceMode }),
});
export const recordDeveloperActivity = (event: DeveloperActivityEvent) => developerRequest<{ recorded: true }>('/api/developer/activity', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event }),
});
