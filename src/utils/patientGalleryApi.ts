import type { GalleryPhotoStage } from '../patientGalleryPolicy';
import { requestAttachmentJson, type AttachmentRequestOptions, type StoredAttachment } from './attachmentApi';

export { AttachmentApiError as PatientGalleryApiError } from './attachmentApi';
export type PatientGalleryRequestOptions = AttachmentRequestOptions;
export interface GalleryPhotoUpdate {
  storagePath: string;
  expectedVersion: number;
  stage: GalleryPhotoStage;
  takenAt: string;
  area: string;
  note: string;
}

export function updateAttachmentPhoto(input: GalleryPhotoUpdate, options: PatientGalleryRequestOptions = {}) {
  return requestAttachmentJson<{ attachment: StoredAttachment }>('/api/attachments/photo', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }, 'Photo details could not be saved. Please retry.', options);
}

export async function getGalleryVisit(visitId: string, options: PatientGalleryRequestOptions = {}): Promise<(Record<string, any> & { id: string }) | null> {
  const data = await requestAttachmentJson<{ document?: { id: string; data: Record<string, any> | null } }>('/api/data/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'document', path: `visits/${visitId}`, constraints: [] }),
  }, 'The Visit could not be reloaded. Please retry.', options);
  if (data.document?.id !== visitId || data.document.data !== null
    && (!data.document.data || typeof data.document.data !== 'object' || Array.isArray(data.document.data))) {
    throw new Error('Invalid Visit response. Please reload.');
  }
  return data.document.data === null ? null : { ...data.document.data, id: visitId };
}
