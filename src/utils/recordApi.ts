import { captureProtectedRequestScope, protectedFetch } from '../dataClient';
import { auth } from '../platform';
import { invalidateProtectedData } from '../dataClient';

export type RecordRequestScope = { signal: AbortSignal; current: () => boolean };

type RecordKind = 'patients' | 'appointments' | 'visits';

async function recordRequest(
  kind: RecordKind,
  method: 'POST' | 'PATCH' | 'DELETE',
  payload: Record<string, unknown>,
  recordId?: string,
  action?: 'restore',
  scope?: RecordRequestScope
) {
  const lifetime = captureProtectedRequestScope();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in again before saving this record.');
  const assertCurrent = () => {
    lifetime();
    if (!scope) return;
    scope.signal.throwIfAborted();
    if (!scope.current() || auth.currentUser?.uid !== currentUser.uid) throw new DOMException('Protected record request is no longer current.', 'AbortError');
  };
  const token = await currentUser.getRequestToken();
  lifetime();
  assertCurrent();
  const path = `/api/records/${kind}${recordId ? `/${encodeURIComponent(recordId)}` : ''}${action ? `/${action}` : ''}`;
  const response = await protectedFetch(path, {
    method,
    signal: scope?.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => null);
  assertCurrent();
  lifetime();
  if (!response.ok) {
    const error = Object.assign(new Error(body?.error || `Failed to save ${kind.slice(0, -1)} record.`), { status: response.status, code: body?.code });
    if (response.status === 401 || response.status === 403) invalidateProtectedData(error);
    throw error;
  }
  return body as { id: string; patientID?: string };
}

export const createPatientRecord = (payload: Record<string, unknown>) =>
  recordRequest('patients', 'POST', payload);

export const updatePatientRecord = (patientId: string, payload: Record<string, unknown>) =>
  recordRequest('patients', 'PATCH', payload, patientId);

export const createAppointmentRecord = (payload: Record<string, unknown>, scope?: RecordRequestScope) =>
  recordRequest('appointments', 'POST', payload, undefined, undefined, scope);

export const updateAppointmentRecord = (appointmentId: string, payload: Record<string, unknown>, scope?: RecordRequestScope) =>
  recordRequest('appointments', 'PATCH', payload, appointmentId, undefined, scope);

export const createVisitRecord = (payload: Record<string, unknown>, scope?: RecordRequestScope) =>
  recordRequest('visits', 'POST', payload, undefined, undefined, scope);

export const updateVisitRecord = (visitId: string, payload: Record<string, unknown>, scope?: RecordRequestScope) =>
  recordRequest('visits', 'PATCH', payload, visitId, undefined, scope);

export const archiveRecord = (kind: RecordKind, recordId: string, reason: string) =>
  recordRequest(kind, 'DELETE', { reason }, recordId);

export const restoreRecord = (kind: RecordKind, recordId: string) =>
  recordRequest(kind, 'POST', {}, recordId, 'restore');
