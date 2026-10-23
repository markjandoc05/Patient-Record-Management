import { hasCapability, hasBranchScope, type PermissionActor } from './permissions';
import { administrativeRoles } from './rbac';

export const MAX_LEDGER_SESSIONS = 10000;
export const MAX_PURCHASE_LINES = 20;
export type TreatmentActor = { uid: string; name: string; role: string };
export type TreatmentVisitSnapshot = {
  patientId: string; branchId: string; branchNameSnapshot: string; timezoneSnapshot: string;
  visitDate: string; serviceId: string; serviceNameSnapshot: string;
  serviceDurationMinutesSnapshot: number | null; serviceCatalogueVersion: number;
  doctorId: string | null; performedByUserId: string | null;
  performedByNameSnapshot: string; performedByRoleSnapshot: string | null;
  performedByDesignationSnapshot: string | null; assistingStaffText: string;
};
export type TreatmentLine = {
  id: string; serviceId: string; serviceNameSnapshot: string; serviceCatalogueVersion: number;
  purchasedSessions: number; adjustmentSessions: number; usedSessions: number; remainingSessions: number; version: number;
};
export type TreatmentPurchase = {
  usable?: boolean;
  id: string; patientId: string; packageName: string; purchaseDate: string; branchId: string;
  branchNameSnapshot: string; timezoneSnapshot: string; notes: string; orNumber: string | null;
  version: number; recordedAt: string; actor: TreatmentActor; lines: TreatmentLine[]; metadataRedacted: boolean;
  catalogue?: { packageId: string; version: number } | null;
  capabilities: { canEditNotes: boolean; canAdjust: boolean; canEditOrNumber: boolean };
};
export type TreatmentLedgerEvent = {
  id: string; type: 'purchase' | 'usage' | 'reversal' | 'adjustment' | 'metadata'; purchaseId: string;
  lineId: string | null; visitId: string | null; purchaseBranchId: string; branchId: string;
  sessionsDelta: number; usedDelta: number; recordedAt: string; treatmentDate: string | null;
  actor: TreatmentActor; reason: string | null; visitSnapshot: TreatmentVisitSnapshot | null;
  reversesEventId: string | null; metadata: Record<string, unknown> | null;
  balanceAfter: { purchasedSessions: number; adjustmentSessions: number; usedSessions: number; remainingSessions: number } | null;
};
export type TreatmentUsage = {
  visitId: string; eventId: string; lineId: string; sessions: number; version: number; visitSnapshot: TreatmentVisitSnapshot;
};
export type TreatmentLedgerResponse = {
  patientId: string; patientName: string; purchases: TreatmentPurchase[]; events: TreatmentLedgerEvent[]; activeVisitUsages: TreatmentUsage[];
  branches: { id: string; name: string; status: string }[];
  capabilities: { canPurchase: boolean; canAdjust: boolean; canEditOrNumber: boolean };
  redemptionPolicy: 'authorized_branches';
  command?: { id: string; eventId: string; replayed: boolean };
};
export type SessionUsageInput = { commandId: string; lineId: string; sessions: number; expectedLineVersion: number; expectedUsageVersion: 0 };
export type TreatmentPurchaseInput = {
  commandId: string; expectedVersion: 0; packageName: string; purchaseDate: string; branchId: string;
  notes: string; orNumber?: string | null;
  lines: { serviceId: string; expectedServiceVersion: number; purchasedSessions: number }[];
};
export class TreatmentLedgerError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function ledgerFail(status: number, code: string, message: string): never { throw new TreatmentLedgerError(status, code, message); }
export function ledgerObject(value: unknown, allowed: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) ledgerFail(400, 'INVALID_BODY', 'Invalid treatment ledger request.');
  if (Object.keys(value).some(key => !allowed.includes(key))) ledgerFail(400, 'UNKNOWN_FIELD', 'Unknown or server-owned treatment ledger field.');
  return value as Record<string, any>;
}
export function ledgerUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ledgerFail(400, 'INVALID_ID', 'A valid command or ledger identifier is required.');
  return value.toLowerCase();
}
export function ledgerRecordId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) ledgerFail(400, 'INVALID_ID', 'A valid patient, Visit or branch identifier is required.');
  return value;
}
export function ledgerVersion(value: unknown, zero = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (zero ? 0 : 1) || Number(value) >= 2147483647) ledgerFail(400, 'VERSION_REQUIRED', 'A valid expected version is required.');
  return Number(value);
}
export function ledgerText(value: unknown, max: number, label: string, required = false): string {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) ledgerFail(400, 'INVALID_TEXT', `${label} must ${required ? 'be provided and ' : ''}contain at most ${max} characters.`);
  return value.trim();
}
export function ledgerSessions(value: unknown, signed = false): number {
  if (!Number.isSafeInteger(value) || Number(value) === 0 || Math.abs(Number(value)) > MAX_LEDGER_SESSIONS || !signed && Number(value) < 1) ledgerFail(400, 'INVALID_SESSIONS', `Sessions must be whole numbers from ${signed ? '-' + MAX_LEDGER_SESSIONS + ' to ' : '1 to '}${MAX_LEDGER_SESSIONS}${signed ? ', excluding zero' : ''}.`);
  return Number(value);
}
export function ledgerDate(value: unknown): string {
  const parsed = typeof value === 'string' ? new Date(value + 'T00:00:00Z') : new Date(NaN);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31' || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) ledgerFail(400, 'INVALID_DATE', 'Enter a valid purchase date.');
  return value;
}
export function parseTreatmentPurchase(value: unknown): TreatmentPurchaseInput {
  const p = ledgerObject(value, ['commandId', 'expectedVersion', 'packageName', 'purchaseDate', 'branchId', 'notes', 'orNumber', 'lines']);
  const expectedVersion = ledgerVersion(p.expectedVersion, true);
  if (expectedVersion !== 0) ledgerFail(409, 'VERSION_CONFLICT', 'New purchases require expectedVersion zero.');
  if (!Array.isArray(p.lines) || p.lines.length < 1 || p.lines.length > MAX_PURCHASE_LINES) ledgerFail(400, 'INVALID_LINES', 'Select between 1 and 20 Service lines.');
  const seen = new Set<string>();
  const lines = p.lines.map((raw: unknown) => {
    const line = ledgerObject(raw, ['serviceId', 'expectedServiceVersion', 'purchasedSessions']);
    const serviceId = ledgerUuid(line.serviceId);
    if (seen.has(serviceId)) ledgerFail(400, 'DUPLICATE_SERVICE', 'Each Service may appear once per package.');
    seen.add(serviceId);
    return { serviceId, expectedServiceVersion: ledgerVersion(line.expectedServiceVersion), purchasedSessions: ledgerSessions(line.purchasedSessions) };
  });
  return { commandId: ledgerUuid(p.commandId), expectedVersion: 0, packageName: ledgerText(p.packageName, 160, 'Package name', true),
    purchaseDate: ledgerDate(p.purchaseDate), branchId: ledgerRecordId(p.branchId), notes: p.notes === undefined ? '' : ledgerText(p.notes, 3000, 'Package notes'),
    ...(Object.hasOwn(p, 'orNumber') ? { orNumber: p.orNumber === null ? null : ledgerText(p.orNumber, 120, 'OR number') || null } : {}), lines };
}
export function parseSessionUsage(value: unknown): SessionUsageInput | undefined {
  if (value === undefined) return undefined;
  const p = ledgerObject(value, ['commandId', 'lineId', 'sessions', 'expectedLineVersion', 'expectedUsageVersion']);
  if (ledgerVersion(p.expectedUsageVersion, true) !== 0) ledgerFail(409, 'USAGE_VERSION_CONFLICT', 'A new session usage requires expectedUsageVersion zero.');
  return { commandId: ledgerUuid(p.commandId), lineId: ledgerUuid(p.lineId), sessions: ledgerSessions(p.sessions), expectedLineVersion: ledgerVersion(p.expectedLineVersion), expectedUsageVersion: 0 };
}
export function treatmentBalance(purchasedSessions: number, adjustmentSessions: number, usedSessions: number) {
  const capacity = purchasedSessions + adjustmentSessions, remainingSessions = capacity - usedSessions;
  if (![purchasedSessions, adjustmentSessions, usedSessions, capacity, remainingSessions].every(Number.isSafeInteger)
    || purchasedSessions < 1 || purchasedSessions > MAX_LEDGER_SESSIONS || capacity < 0 || capacity > MAX_LEDGER_SESSIONS || usedSessions < 0 || remainingSessions < 0) ledgerFail(409, 'INSUFFICIENT_SESSIONS', 'This command would create an invalid session balance. Reload the ledger.');
  return { purchasedSessions, adjustmentSessions, usedSessions, remainingSessions };
}
export function canViewTreatmentLedger(actor: PermissionActor | null | undefined): boolean {
  return ['treatment_ledger.view', 'patients.view', 'visits.view', 'clinical.view'].every(id => hasCapability(actor, id as any));
}
export function canEditTreatmentOrNumber(actor: PermissionActor | null | undefined, branchId?: string): boolean {
  return !!actor && (administrativeRoles as readonly string[]).includes(actor.role || '')
    && hasCapability(actor, 'treatment_ledger.reference' as any) && (branchId === undefined || hasBranchScope(actor, branchId));
}
export function treatmentVisitBinding(visit: Record<string, any>): Record<string, unknown> {
  return Object.fromEntries(['patientId', 'branchId', 'visitDate', 'serviceId', 'serviceNameSnapshot', 'serviceDurationMinutesSnapshot',
    'serviceCatalogueVersion', 'doctorId', 'performedByUserId', 'performedByNameSnapshot', 'performedByRoleSnapshot',
    'performedByDesignationSnapshot', 'assistingStaffText'].map(key => [key,
      key.startsWith('performedBy') && key !== 'performedByUserId' && !visit.performedByUserId ? null
        : key === 'doctorId' || key === 'performedByUserId' ? visit[key] || null : visit[key] ?? (key === 'assistingStaffText' ? '' : null)]));
}
export function assertTreatmentUsageCompatible(snapshot: TreatmentVisitSnapshot, visit: Record<string, any>) {
  if (JSON.stringify(treatmentVisitBinding(snapshot)) !== JSON.stringify(treatmentVisitBinding(visit))) ledgerFail(409, 'ACTIVE_SESSION_USAGE', 'Reverse the recorded session usage before changing its patient, Service, clinic, treatment time or performance attribution.');
}
