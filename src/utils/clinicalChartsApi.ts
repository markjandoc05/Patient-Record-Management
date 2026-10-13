import { captureProtectedRequestScope, invalidateProtectedData, protectedFetch } from '../dataClient';
import { auth } from '../platform';
import type { ChartResponse, ChartDraftInput, ChartVersionInput, ChartAmendmentInput } from '../clinicalChartPolicy';

export interface ClinicalChartRequestOptions { signal?: AbortSignal; isCurrent?: () => boolean }
export class ClinicalChartApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ClinicalChartApiError'; }
}
async function chartRequest(visitId: string, suffix: string, method: string, body: unknown, options: ClinicalChartRequestOptions = {}): Promise<ChartResponse> {
  const lifetime = captureProtectedRequestScope();
  const assertCurrent = () => {
    lifetime();
    options.signal?.throwIfAborted();
    if (options.isCurrent && !options.isCurrent()) throw new DOMException('Chart request is no longer current.', 'AbortError');
  };
  const user = auth.currentUser;
  if (!user) throw new ClinicalChartApiError('Please sign in again.', 401);
  const token = await user.getRequestToken();
  assertCurrent();
  const response = await protectedFetch(`/api/records/visits/${encodeURIComponent(visitId)}/chart${suffix}`, {
    method, signal: options.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  // Late replies must neither restore clinical data nor invalidate a newer session.
  assertCurrent();
  if (!response.ok) {
    const error = new ClinicalChartApiError(data?.error || 'The chart could not be loaded. Please reload and try again.', response.status, data?.code);
    if (response.status === 401 || response.status === 403) invalidateProtectedData(error);
    throw error;
  }
  if (!data || data.visitId !== visitId) throw new ClinicalChartApiError('Invalid chart response. Please reload.', 502);
  return data as ChartResponse;
}
export const getClinicalChart = (visitId: string, options?: ClinicalChartRequestOptions) => chartRequest(visitId, '', 'GET', undefined, options);
export const saveClinicalChartDraft = (visitId: string, input: ChartDraftInput, options?: ClinicalChartRequestOptions) => chartRequest(visitId, '/draft', 'PUT', input, options);
export const signClinicalChart = (visitId: string, input: ChartVersionInput, options?: ClinicalChartRequestOptions) => chartRequest(visitId, '/sign', 'POST', input, options);
export const startClinicalChartAmendment = (visitId: string, input: ChartAmendmentInput, options?: ClinicalChartRequestOptions) => chartRequest(visitId, '/amendment', 'POST', input, options);
