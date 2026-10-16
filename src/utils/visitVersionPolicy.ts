// Missing metadata belongs to an unchanged historical record. Do not backfill
// records on read or treat malformed stored metadata as a fresh version.
export function visitVersion(record: { visitVersion?: unknown } | null | undefined): number | null {
  const value = record?.visitVersion;
  if (value === undefined || value === null) return 0;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export class VisitVersionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function nextVisitVersion(record: { visitVersion?: unknown }): number {
  const value = visitVersion(record);
  if (value === null || value >= Number.MAX_SAFE_INTEGER) {
    throw new VisitVersionError(409, 'VISIT_VERSION_INVALID', 'This Visit has invalid version metadata. Keep your draft and ask an administrator to review the saved record.');
  }
  return value + 1;
}

export function assertVisitSaveVersion(payload: Record<string, unknown>, record: { visitVersion?: unknown }): number {
  const current = visitVersion(record);
  if (current === null) return nextVisitVersion(record);
  const expected = payload.expectedVisitVersion;
  if (!Number.isSafeInteger(expected) || Number(expected) < 0) {
    throw new VisitVersionError(409, 'VISIT_VERSION_REQUIRED', 'Reload and review the saved Visit before saving. Your draft has been kept.');
  }
  if (expected !== current) {
    throw new VisitVersionError(409, 'VISIT_VERSION_CHANGED', 'This Visit changed since you opened it. Your draft has been kept. Review the saved Visit before saving again.');
  }
  return nextVisitVersion(record);
}
