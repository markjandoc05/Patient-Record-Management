import { auth } from '../firebase';

type RecordKind = 'patients' | 'appointments' | 'visits';

async function recordRequest(
  kind: RecordKind,
  method: 'POST' | 'PATCH' | 'DELETE',
  payload: Record<string, unknown>,
  recordId?: string,
  action?: 'restore'
) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in again before saving this record.');
  const token = await currentUser.getIdToken();
  const path = `/api/records/${kind}${recordId ? `/${encodeURIComponent(recordId)}` : ''}${action ? `/${action}` : ''}`;
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Failed to save ${kind.slice(0, -1)} record.`);
  return body as { id: string; patientID?: string };
}

export const createPatientRecord = (payload: Record<string, unknown>) =>
  recordRequest('patients', 'POST', payload);

export const updatePatientRecord = (patientId: string, payload: Record<string, unknown>) =>
  recordRequest('patients', 'PATCH', payload, patientId);

export const createAppointmentRecord = (payload: Record<string, unknown>) =>
  recordRequest('appointments', 'POST', payload);

export const updateAppointmentRecord = (appointmentId: string, payload: Record<string, unknown>) =>
  recordRequest('appointments', 'PATCH', payload, appointmentId);

export const createVisitRecord = (payload: Record<string, unknown>) =>
  recordRequest('visits', 'POST', payload);

export const updateVisitRecord = (visitId: string, payload: Record<string, unknown>) =>
  recordRequest('visits', 'PATCH', payload, visitId);

export const archiveRecord = (kind: RecordKind, recordId: string, reason: string) =>
  recordRequest(kind, 'DELETE', { reason }, recordId);

export const restoreRecord = (kind: RecordKind, recordId: string) =>
  recordRequest(kind, 'POST', {}, recordId, 'restore');
