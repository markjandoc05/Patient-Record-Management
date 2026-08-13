export interface MediaSettings {
  allowedExtensions: string[];
  maxFileSizeMB: number;
  maxFilesPerRecord: number;
}

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.pdf'],
  maxFileSizeMB: 1,
  maxFilesPerRecord: 5,
};

// Images use a lower storage ceiling than other allowed files to reduce
// storage and download costs while keeping enough resolution for clinic use.
export const IMAGE_OPTIMIZATION = {
  targetSizeMB: 0.45,
  maxStoredBytes: 500 * 1024,
  maxWidthOrHeight: 1600,
  maxSourceBytes: 20 * 1024 * 1024,
} as const;

export function normalizeMediaSettings(value: Record<string, unknown> | null | undefined): MediaSettings {
  const raw = value || {};
  const configuredExtensions = Array.isArray(raw.allowedExtensions)
    ? raw.allowedExtensions
        .filter((extension): extension is string => typeof extension === 'string')
        .map(extension => extension.trim().toLowerCase())
        .filter(Boolean)
        .map(extension => extension.startsWith('.') ? extension : `.${extension}`)
    : [];
  const maxFileSizeMB = Number(raw.maxFileSizeMB);
  const rawMaxFiles = Number(raw.maxFilesPerRecord ?? raw.maxFilesPerAppointment);

  return {
    allowedExtensions: [...new Set(configuredExtensions.length > 0 ? configuredExtensions : DEFAULT_MEDIA_SETTINGS.allowedExtensions)],
    maxFileSizeMB: Number.isFinite(maxFileSizeMB)
      ? Math.min(Math.max(maxFileSizeMB, 0.1), 10)
      : DEFAULT_MEDIA_SETTINGS.maxFileSizeMB,
    maxFilesPerRecord: Number.isFinite(rawMaxFiles)
      ? Math.min(Math.max(Math.floor(rawMaxFiles), 1), 20)
      : DEFAULT_MEDIA_SETTINGS.maxFilesPerRecord,
  };
}
