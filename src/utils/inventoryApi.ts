import { captureProtectedRequestScope, protectedFetch, invalidateProtectedData } from '../dataClient';
import { auth } from '../platform';
export async function transferRequest(action: 'create' | 'complete', payload: Record<string, unknown>) {
  const lifetime = captureProtectedRequestScope();
  if (!auth.currentUser) throw new Error('Please sign in');
  const token = await auth.currentUser.getRequestToken(); lifetime();
  const response = await protectedFetch(`/api/inventory/transfers/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  const body = await response.json(); lifetime(); if (response.status === 401 || response.status === 403) invalidateProtectedData();
  if (!response.ok) throw new Error(body.error || 'Transfer failed'); return body;
}
