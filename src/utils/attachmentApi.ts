import { captureProtectedRequestScope, protectedFetch, invalidateProtectedData, subscribeProtectedDataInvalidation } from '../dataClient';
import { auth } from '../platform';
import imageCompression from 'browser-image-compression';
import { DEFAULT_MEDIA_SETTINGS, IMAGE_OPTIMIZATION } from '../mediaSettings';
import { uiPermissionScope } from '../permissionState';
import type { GalleryPhotoMetadata, GalleryPhotoStage } from '../patientGalleryPolicy';

export interface AttachmentRequestOptions { signal?: AbortSignal; isCurrent?: () => boolean }
export class AttachmentApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'AttachmentApiError'; }
}

export interface StoredAttachment {
  id: string;
  name: string;
  storagePath: string;
  note?: string;
  contentType?: string;
  size?: number;
  uploadedAt?: string;
  uploadedByUid?: string;
  photo?: GalleryPhotoMetadata;
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

function captureAttachmentScope(options: AttachmentRequestOptions) {
  const lifetime = captureProtectedRequestScope();
  const permissionScope = uiPermissionScope();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new AttachmentApiError('Please sign in again to access attachments.', 401);
  return () => {
    lifetime();
    options.signal?.throwIfAborted();
    if (auth.currentUser?.uid !== currentUser.uid || uiPermissionScope() !== permissionScope
      || options.isCurrent && !options.isCurrent()) throw new DOMException('Attachment request is no longer current.', 'AbortError');
  };
}

async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit, options: AttachmentRequestOptions,
  current = captureAttachmentScope(options)) {
  current();
  const currentUser = auth.currentUser!;
  const token = await currentUser.getRequestToken().catch(error => { current(); throw error; });
  current();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return protectedFetch(input, { ...init, signal: options.signal, headers }, current);
}

async function attachmentError(response: Response, fallback: string) {
  let body: any;
  try {
    body = await response.json();
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
  }
  const error = new AttachmentApiError(typeof body?.error === 'string' ? body.error : fallback, response.status, body?.code);
  if (response.status === 401 || response.status === 403) invalidateProtectedData(error);
  return error;
}

export async function requestAttachmentJson<T>(input: string, init: RequestInit, fallback: string,
  options: AttachmentRequestOptions = {}): Promise<T> {
  const response = await authenticatedFetch(input, init, options);
  if (!response.ok) throw await attachmentError(response, fallback);
  return response.json();
}

export async function uploadAttachment(options: {
  file: File | Blob;
  originalName: string;
  maxFileSizeMB: number;
  note: string;
  patientId: string;
  resourceType: 'patient' | 'appointment' | 'visit';
  resourceId: string;
  photoStage?: GalleryPhotoStage;
  photoTakenAt?: string;
  photoArea?: string;
}, requestOptions: AttachmentRequestOptions = {}): Promise<{ attachment: StoredAttachment }> {
  const current = captureAttachmentScope(requestOptions);
  current();
  const fileToUpload = isOptimizableImageUpload(options.file, options.originalName)
    ? await optimizeAttachmentImage(options.file, options.originalName, options.maxFileSizeMB).catch(error => { current(); throw error; })
    : options.file;
  current();
  const formData = new FormData();
  formData.append('file', fileToUpload, options.originalName);
  formData.append('note', options.note);
  formData.append('patientId', options.patientId);
  formData.append('resourceType', options.resourceType);
  formData.append('resourceId', options.resourceId);
  if (options.photoStage !== undefined) formData.append('photoStage', options.photoStage);
  if (options.photoTakenAt !== undefined) formData.append('photoTakenAt', options.photoTakenAt);
  if (options.photoArea !== undefined) formData.append('photoArea', options.photoArea);

  const response = await authenticatedFetch('/api/attachments/upload', {
    method: 'POST',
    body: formData,
  }, requestOptions, current);
  if (!response.ok) throw await attachmentError(response, 'Attachment upload failed.');
  return response.json();
}

export async function fetchAttachmentBlob(storagePath: string, options: AttachmentRequestOptions = {}) {
  const response = await authenticatedFetch(`/api/attachments/content?path=${encodeURIComponent(storagePath)}`, {}, options);
  if (!response.ok) throw await attachmentError(response, 'Attachment download failed.');
  return response.blob();
}

export async function deleteAttachment(storagePath: string, options: AttachmentRequestOptions = {}) {
  const response = await authenticatedFetch('/api/attachments', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storagePath }),
  }, options);
  if (!response.ok) throw await attachmentError(response, 'Attachment deletion failed.');
}

export function isImageAttachment(file: Pick<StoredAttachment, 'name' | 'contentType'>) {
  return file.contentType?.startsWith('image/') === true
    || /\.(jpg|jpeg|png|webp)$/i.test(file.name || '');
}

export async function openAttachment(file: StoredAttachment, options: AttachmentRequestOptions = {}) {
  const current = captureAttachmentScope(options);
  current();
  const placeholder = window.open('', '_blank');
  try {
    const blob = await fetchAttachmentBlob(file.storagePath, options);
    current();
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

export async function downloadAttachment(file: StoredAttachment, options: AttachmentRequestOptions = {}) {
  const current = captureAttachmentScope(options);
  const blob = await fetchAttachmentBlob(file.storagePath, options);
  current();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = file.name || 'attachment';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
