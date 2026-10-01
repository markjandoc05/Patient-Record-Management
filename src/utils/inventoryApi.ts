import { auth } from '../platform';
export async function transferRequest(action: 'create' | 'complete', payload: Record<string, unknown>) {
  if (!auth.currentUser) throw new Error('Please sign in');
  const response = await fetch(`/api/inventory/transfers/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await auth.currentUser.getRequestToken()}` }, body: JSON.stringify(payload) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Transfer failed'); return body;
}
