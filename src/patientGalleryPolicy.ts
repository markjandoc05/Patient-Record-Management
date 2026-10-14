export const GALLERY_PHOTO_LIMIT = 4;

export type GalleryPhotoStage = 'before' | 'after' | 'progress';

export interface GalleryPhotoMetadata {
  schemaVersion: 1;
  stage: GalleryPhotoStage;
  // A literal clinic date/time, independent of the device timezone.
  takenAt: string;
  area: string;
  timezone: string;
  version: number;
  updatedAt: string;
  updatedByUid: string;
}

export class GalleryPhotoInputError extends Error {
  readonly status = 400;
}

export function isGalleryImage(file: { name?: unknown; contentType?: unknown } | null | undefined) {
  if (!file || typeof file !== 'object') return false;
  return typeof file.contentType === 'string' && file.contentType.toLowerCase().startsWith('image/')
    || typeof file.name === 'string' && /\.(jpe?g|png|webp|ico)$/i.test(file.name);
}

export function galleryPhotoCount(attachments: unknown) {
  return Array.isArray(attachments) ? attachments.filter(isGalleryImage).length : 0;
}

function photoText(value: unknown, name: string, limit: number) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new GalleryPhotoInputError(`${name} must be text`);
  const text = value.replace(/\u0000/g, '').replace(/[\r\n]/g, ' ').trim();
  if (text.length > limit) throw new GalleryPhotoInputError(`${name} is too long`);
  return text;
}

export function parsePhotoInput(value: unknown): { stage: GalleryPhotoStage; takenAt: string; area: string; note: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GalleryPhotoInputError('Invalid photo details');
  const input = value as Record<string, unknown>;
  if (typeof input.stage !== 'string' || !['before', 'after', 'progress'].includes(input.stage)) throw new GalleryPhotoInputError('Choose Before, After, or Progress');
  if (typeof input.takenAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.takenAt)) {
    throw new GalleryPhotoInputError('Photo date and time must use YYYY-MM-DDTHH:mm');
  }
  const [year, month, day, hour, minute] = input.takenAt.split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59) {
    throw new GalleryPhotoInputError('Photo date and time is invalid');
  }
  return {
    stage: input.stage as GalleryPhotoStage,
    takenAt: input.takenAt,
    area: photoText(input.area, 'Treatment area or angle', 120),
    note: photoText(input.note, 'Photo note', 500),
  };
}
