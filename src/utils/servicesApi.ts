import { auth } from '../platform';
import { invalidateProtectedData } from '../dataClient';
export async function servicesRequest(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, current?: () => boolean) {
  const assertCurrent = () => {
    signal?.throwIfAborted();
    if (current && !current()) throw new DOMException('Services request is no longer current.', 'AbortError');
  };
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
  const token = await user.getRequestToken();
  assertCurrent();
  const response = await fetch(path, { method, signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  // An obsolete scope must not publish data or invalidate the new scope on a
  // delayed denial, even if the transport delivered a response after abort.
  assertCurrent();
  if (!response.ok) {
    const error = Object.assign(new Error(data?.error || 'Services could not be loaded. Try again.'), { status: response.status, code: data?.code });
    if (response.status === 401 || response.status === 403) invalidateProtectedData(error);
    throw error;
  }
  return data;
}
