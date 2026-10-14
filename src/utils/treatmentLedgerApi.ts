import { captureProtectedRequestScope, invalidateProtectedData, protectedFetch } from '../dataClient';
import { auth } from '../platform';
import { uiPermissionScope } from '../permissionState';
import type { TreatmentLedgerResponse } from '../treatmentLedgerPolicy';

export interface TreatmentLedgerRequestOptions { signal?: AbortSignal; isCurrent?: () => boolean }
export class TreatmentLedgerApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'TreatmentLedgerApiError'; }
}

async function request(patientId: string, suffix: string, method: string, body: unknown, options: TreatmentLedgerRequestOptions = {}): Promise<TreatmentLedgerResponse> {
  const lifetime = captureProtectedRequestScope();
  const permissionScope = uiPermissionScope();
  const user = auth.currentUser;
  if (!user) throw new TreatmentLedgerApiError('Please sign in again.', 401);
  const assertCurrent = () => {
    lifetime(); options.signal?.throwIfAborted();
    if (auth.currentUser?.uid !== user.uid || uiPermissionScope() !== permissionScope || options.isCurrent && !options.isCurrent()) throw new DOMException('Treatment ledger request is no longer current.', 'AbortError');
  };
  const token = await user.getRequestToken(); assertCurrent();
  const response = await protectedFetch(`/api/records/patients/${encodeURIComponent(patientId)}/treatment-ledger${suffix}`, {
    method, signal: options.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  // Scope guards run before a late response can clear a newer account's data.
  assertCurrent();
  if (!response.ok) {
    const error = new TreatmentLedgerApiError(data?.error || 'The treatment ledger could not be loaded. Please retry.', response.status, data?.code);
    if (response.status === 401 || response.status === 403) invalidateProtectedData(error);
    throw error;
  }
  if (data?.patientId !== patientId || !Array.isArray(data.purchases) || !Array.isArray(data.events) || !Array.isArray(data.activeVisitUsages) || !data.capabilities) throw new TreatmentLedgerApiError('Invalid treatment ledger response. Please reload.', 502);
  return data as TreatmentLedgerResponse;
}
export const getTreatmentLedger = (patientId: string, options?: TreatmentLedgerRequestOptions) => request(patientId, '', 'GET', undefined, options);
export const createTreatmentPurchase = (patientId: string, input: Record<string, unknown>, options?: TreatmentLedgerRequestOptions) => request(patientId, '/purchases', 'POST', input, options);
export const updateTreatmentPurchase = (patientId: string, purchaseId: string, input: Record<string, unknown>, options?: TreatmentLedgerRequestOptions) => request(patientId, `/purchases/${encodeURIComponent(purchaseId)}`, 'PATCH', input, options);
export const adjustTreatmentSessions = (patientId: string, lineId: string, input: Record<string, unknown>, options?: TreatmentLedgerRequestOptions) => request(patientId, `/lines/${encodeURIComponent(lineId)}/adjustments`, 'POST', input, options);
export const reverseTreatmentUsage = (patientId: string, eventId: string, input: Record<string, unknown>, options?: TreatmentLedgerRequestOptions) => request(patientId, `/usage/${encodeURIComponent(eventId)}/reversal`, 'POST', input, options);
