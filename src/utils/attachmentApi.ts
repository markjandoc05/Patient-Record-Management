import { auth } from '../firebase';

export interface StoredAttachment {
  id: string;
  name: string;
  storagePath: string;
  note?: string;
  contentType?: string;
  size?: number;
  uploadedAt?: string;
  uploadedByUid?: string;
}

async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in again to access attachments.');
  const token = await currentUser.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

async function getErrorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function uploadAttachment(options: {
  file: File | Blob;
  originalName: string;
  note: string;
  patientId: string;
  resourceType: 'patient' | 'appointment' | 'visit';
  resourceId: string;
}) {
  const formData = new FormData();
  formData.append('file', options.file, options.originalName);
  formData.append('note', options.note);
  formData.append('patientId', options.patientId);
  formData.append('resourceType', options.resourceType);
  formData.append('resourceId', options.resourceId);

  const response = await authenticatedFetch('/api/attachments/upload', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error(await getErrorMessage(response, 'Attachment upload failed.'));
  return response.json();
}

export async function fetchAttachmentBlob(storagePath: string) {
  const response = await authenticatedFetch(`/api/attachments/content?path=${encodeURIComponent(storagePath)}`);
  if (!response.ok) throw new Error(await getErrorMessage(response, 'Attachment download failed.'));
  return response.blob();
}

export async function deleteAttachment(storagePath: string) {
  const response = await authenticatedFetch('/api/attachments', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storagePath }),
  });
  if (!response.ok) throw new Error(await getErrorMessage(response, 'Attachment deletion failed.'));
}

export function isImageAttachment(file: Pick<StoredAttachment, 'name' | 'contentType'>) {
  return file.contentType?.startsWith('image/') === true
    || /\.(jpg|jpeg|png)$/i.test(file.name || '');
}

export async function openAttachment(file: StoredAttachment) {
  const placeholder = window.open('', '_blank');
  try {
    const blob = await fetchAttachmentBlob(file.storagePath);
    const objectUrl = URL.createObjectURL(blob);
    if (placeholder) {
      placeholder.location.href = objectUrl;
    } else {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    placeholder?.close();
    throw error;
  }
}

export async function downloadAttachment(file: StoredAttachment) {
  const blob = await fetchAttachmentBlob(file.storagePath);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = file.name || 'attachment';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
