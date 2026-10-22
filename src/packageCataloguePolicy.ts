import { ledgerObject, ledgerText, ledgerUuid, ledgerVersion, ledgerSessions, ledgerDate, ledgerRecordId, ledgerFail, MAX_PURCHASE_LINES } from './treatmentLedgerPolicy';

export type PackageLine = { serviceId: string; serviceName: string; serviceCatalogueVersion: number; sessions: number; currentServiceVersion: number; currentServiceName: string; serviceActive: boolean };
export type CataloguePackage = { id: string; name: string; description: string; active: boolean; version: number; recordedAt: string; actor: { uid: string; name: string; role: string }; lines: PackageLine[]; eligible: boolean | null };
export type CatalogueSelection = { packageId: string; expectedVersion: number; serviceVersions: { serviceId: string; expectedServiceVersion: number }[] };
export type CataloguePurchaseInput = { commandId: string; expectedVersion: 0; branchId: string; purchaseDate: string; notes: string; orNumber?: string | null; catalogueSelection: CatalogueSelection };

export function parsePackageDefinition(value: unknown, create: boolean) {
  const p = ledgerObject(value, ['id', 'commandId', 'expectedVersion', 'name', 'description', 'active', 'lines']);
  const expectedVersion = ledgerVersion(p.expectedVersion, true);
  if (create ? expectedVersion !== 0 : expectedVersion === 0) ledgerFail(409, 'PACKAGE_VERSION_CHANGED', 'Reload and review the current package version.');
  if (typeof p.active !== 'boolean') ledgerFail(400, 'INVALID_STATUS', 'Choose an active or inactive package status.');
  if (!Array.isArray(p.lines) || p.lines.length < 1 || p.lines.length > MAX_PURCHASE_LINES) ledgerFail(400, 'INVALID_LINES', 'Include between 1 and 20 distinct Services.');
  const seen = new Set<string>();
  const lines = p.lines.map((raw: unknown) => {
    const row = ledgerObject(raw, ['serviceId', 'expectedServiceVersion', 'sessions']);
    const serviceId = ledgerUuid(row.serviceId);
    if (seen.has(serviceId)) ledgerFail(400, 'DUPLICATE_SERVICE', 'Each Service may appear once per package.');
    seen.add(serviceId);
    return { serviceId, expectedServiceVersion: ledgerVersion(row.expectedServiceVersion), sessions: ledgerSessions(row.sessions) };
  }).sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  return { id: ledgerUuid(p.id), commandId: ledgerUuid(p.commandId), expectedVersion,
    name: ledgerText(p.name, 160, 'Package name', true).replace(/\s+/g, ' '), description: ledgerText(p.description, 2000, 'Package description'), active: p.active, lines };
}
export function parseCataloguePurchase(value: unknown): CataloguePurchaseInput {
  const p = ledgerObject(value, ['commandId', 'expectedVersion', 'branchId', 'purchaseDate', 'notes', 'orNumber', 'catalogueSelection']);
  if (ledgerVersion(p.expectedVersion, true) !== 0) ledgerFail(409, 'VERSION_CONFLICT', 'New purchases require expectedVersion zero.');
  const s = ledgerObject(p.catalogueSelection, ['packageId', 'expectedVersion', 'serviceVersions']);
  if (!Array.isArray(s.serviceVersions) || s.serviceVersions.length < 1 || s.serviceVersions.length > MAX_PURCHASE_LINES) ledgerFail(400, 'INVALID_LINES', 'Review all included Services before saving.');
  const seen = new Set<string>();
  const serviceVersions = s.serviceVersions.map((raw: unknown) => {
    const row = ledgerObject(raw, ['serviceId', 'expectedServiceVersion']);
    const serviceId = ledgerUuid(row.serviceId);
    if (seen.has(serviceId)) ledgerFail(400, 'DUPLICATE_SERVICE', 'Review distinct included Services.');
    seen.add(serviceId); return { serviceId, expectedServiceVersion: ledgerVersion(row.expectedServiceVersion) };
  }).sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  return { commandId: ledgerUuid(p.commandId), expectedVersion: 0, branchId: ledgerRecordId(p.branchId), purchaseDate: ledgerDate(p.purchaseDate),
    notes: p.notes === undefined ? '' : ledgerText(p.notes, 3000, 'Package notes'),
    ...(Object.hasOwn(p, 'orNumber') ? { orNumber: p.orNumber === null ? null : ledgerText(p.orNumber, 120, 'OR number') || null } : {}),
    catalogueSelection: { packageId: ledgerUuid(s.packageId), expectedVersion: ledgerVersion(s.expectedVersion), serviceVersions } };
}
