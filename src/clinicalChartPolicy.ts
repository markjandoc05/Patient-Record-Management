export const CHART_MAPS = ['face', 'body-front', 'body-back'] as const;
export type ChartMap = typeof CHART_MAPS[number];
export const MAX_CHART_MARKERS = 100;
export const MAX_CHART_REVISIONS = 50;
export interface ChartMarker { id: string; map: ChartMap; x: number; y: number; label: string; notes: string }
export interface ChartActor { uid: string; name: string; role: string }
export interface ChartVisitContext {
  visitId: string; patientId: string; patientName: string; branchId: string; branchName: string;
  doctorId: string; doctorName: string; visitDate: string; visitType: string;
  serviceId: string | null; serviceNameSnapshot: string | null;
  serviceDurationMinutesSnapshot: number | null; serviceCatalogueVersion: number | null;
  // Older signed contexts remain valid without performer attribution.
  performedByUserId?: string; performedByNameSnapshot?: string;
  performedByRoleSnapshot?: string; performedByDesignationSnapshot?: string | null;
}
export interface ChartDraft {
  markers: ChartMarker[]; notes: string; kind: 'initial' | 'amendment'; reason: string;
  createdAt: string; createdBy: ChartActor; updatedAt: string; updatedBy: ChartActor;
  context: ChartVisitContext; contextKey: string;
}
export interface ChartRevision extends ChartDraft { revision: number; signedAt: string; signedBy: ChartActor }
export interface ClinicalChart {
  schemaVersion: 1; version: number; visitId: string; draft: ChartDraft | null;
  revisions: ChartRevision[]; createdAt: string; createdBy: ChartActor;
}
export interface ChartResponse {
  visitId: string; chart: ClinicalChart | null; visitContext: ChartVisitContext; contextKey: string;
  permissions: { canEdit: boolean; canSign: boolean; canAmend: boolean }; readOnlyReason: string | null;
}
export interface ChartDraftInput {
  expectedVersion: number; expectedContextKey: string; markers: ChartMarker[]; notes: string;
}
export interface ChartVersionInput { expectedVersion: number; expectedContextKey: string }
export interface ChartAmendmentInput extends ChartVersionInput { reason: string }

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_CHART' });
}
export function validateChartContent(input: unknown): { markers: ChartMarker[]; notes: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Invalid chart content.');
  const value = input as Record<string, unknown>;
  if (typeof value.notes !== 'string' || value.notes.length > 3000) invalid('Chart notes must contain at most 3,000 characters.');
  if (!Array.isArray(value.markers) || value.markers.length > MAX_CHART_MARKERS) invalid('A chart can contain at most 100 markers.');
  const ids = new Set<string>();
  const markers = value.markers.map((marker: unknown): ChartMarker => {
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) invalid('Invalid chart marker.');
    const m = marker as Record<string, unknown>;
    if (Object.keys(m).some(key => !['id', 'map', 'x', 'y', 'label', 'notes'].includes(key))) invalid('Invalid chart marker fields.');
    if (typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(m.id) || ids.has(m.id)) invalid('Marker IDs must be unique.');
    if (!CHART_MAPS.includes(m.map as ChartMap)) invalid('Choose a face, front body or back body chart.');
    if (typeof m.x !== 'number' || typeof m.y !== 'number' || !Number.isFinite(m.x) || !Number.isFinite(m.y)
      || m.x < 0 || m.x > 1 || m.y < 0 || m.y > 1) invalid('Marker coordinates must be within the chart.');
    if (typeof m.label !== 'string' || m.label.length > 100 || typeof m.notes !== 'string' || m.notes.length > 1000) invalid('Marker label or notes are too long.');
    ids.add(m.id);
    return { id: m.id, map: m.map as ChartMap, x: m.x, y: m.y, label: m.label, notes: m.notes };
  });
  return { markers, notes: value.notes };
}
