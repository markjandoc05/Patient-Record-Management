import { captureProtectedRequestScope, protectedFetch, invalidateProtectedData, subscribeProtectedDataInvalidation } from '../dataClient';
import { auth } from '../platform';
import imageCompression from 'browser-image-compression';
import { DEFAULT_MEDIA_SETTINGS, IMAGE_OPTIMIZATION } from '../mediaSettings';

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

export function isOptimizableImageUpload(file: File | Blob, originalName: string) {
  return file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(originalName);
}

export async function optimizeAttachmentImage(file: File | Blob, originalName: string, maxFileSizeMB: number) {
  if (file.size > IMAGE_OPTIMIZATION.maxSourceBytes) {
    throw new Error('Image is too large to optimize. Choose an image smaller than 20 MB.');
  }

  const sourceFile = file instanceof File
    ? file
    : new File([file], originalName, { type: file.type || 'application/octet-stream' });

  let optimizedFile: File;
  try {
    optimizedFile = await imageCompression(sourceFile, {
      maxSizeMB: IMAGE_OPTIMIZATION.targetSizeMB,
      maxWidthOrHeight: IMAGE_OPTIMIZATION.maxWidthOrHeight,
      initialQuality: 0.82,
      maxIteration: 15,
      preserveExif: false,
      useWebWorker: true,
    });
  } catch (error) {
    console.error('Patient attachment image optimization failed:', error);
    throw new Error('Image optimization failed. The original image was not uploaded.');
  }

  const configuredLimitMB = Number.isFinite(maxFileSizeMB) && maxFileSizeMB > 0
    ? maxFileSizeMB
    : DEFAULT_MEDIA_SETTINGS.maxFileSizeMB;
  const storedLimitBytes = Math.min(
    Math.floor(configuredLimitMB * 1024 * 1024),
    IMAGE_OPTIMIZATION.maxStoredBytes,
  );
  if (optimizedFile.size > storedLimitBytes) {
    throw new Error('The image could not be optimized below the storage limit. Try a smaller image.');
  }

  return optimizedFile;
}

async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const lifetime = captureProtectedRequestScope();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in again to access attachments.');
  const token = await currentUser.getRequestToken();
  lifetime();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return protectedFetch(input, { ...init, headers }, lifetime);
}

async function getErrorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json();
    if (response.status === 401 || response.status === 403) invalidateProtectedData();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
    if (response.status === 401 || response.status === 403) invalidateProtectedData();
    return fallback;
  }
}

export async function uploadAttachment(options: {
  file: File | Blob;
  originalName: string;
  maxFileSizeMB: number;
  note: string;
  patientId: string;
  resourceType: 'patient' | 'appointment' | 'visit';
  resourceId: string;
}) {
  const lifetime = captureProtectedRequestScope();
  const fileToUpload = isOptimizableImageUpload(options.file, options.originalName)
    ? await optimizeAttachmentImage(options.file, options.originalName, options.maxFileSizeMB)
    : options.file;
  lifetime();
  const formData = new FormData();
  formData.append('file', fileToUpload, options.originalName);
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
    const stop = subscribeProtectedDataInvalidation(() => { URL.revokeObjectURL(objectUrl); placeholder?.close(); stop(); });
    window.setTimeout(() => { URL.revokeObjectURL(objectUrl); stop(); }, 60_000);
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
