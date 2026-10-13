import type express from 'express';
import { createHash } from 'node:crypto';
import { db, type RecordTransaction } from './database';
import { currentActor, assertCapability } from './permissions';
import { activeAccount, hasCapability } from '../src/permissions';
import { isVisitClinicallySealed } from '../src/utils/visitServicePolicy';
import {
  MAX_CHART_REVISIONS, validateChartContent,
  type ChartActor, type ChartDraft, type ChartRevision, type ChartResponse,
  type ChartVisitContext, type ClinicalChart,
} from '../src/clinicalChartPolicy';

const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const contextPattern = /^[a-f0-9]{64}$/;
type Actor = Awaited<ReturnType<typeof currentActor>>;
type ChartState = {
  chart: ClinicalChart | null;
  visit: Record<string, any>;
  patient: Record<string, any> | null;
  branch: Record<string, any> | null;
  doctor: Record<string, any> | null;
  performer: Record<string, any> | null;
  visitContext: ChartVisitContext;
  contextKey: string;
};

function fail(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
}
function body(value: unknown, allowed: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_BODY', 'Invalid chart request.');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'UNKNOWN_FIELD', 'Unknown or server-owned chart field.');
  return value as Record<string, any>;
}
function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= Number.MAX_SAFE_INTEGER) {
    fail(400, 'VERSION_REQUIRED', 'A valid expectedVersion is required.');
  }
  return Number(value);
}
function expectedContext(value: unknown): string {
  if (typeof value !== 'string' || !contextPattern.test(value)) fail(400, 'CONTEXT_REQUIRED', 'The reviewed Visit context is required.');
  return value;
}
function actorSnapshot(actor: Actor): ChartActor {
  return { uid: actor.identity.uid, name: String(actor.profile.fullName || actor.identity.email || 'Unknown user').slice(0, 120), role: actor.profile.role };
}
function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function nullableText(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function nullableNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

async function readState(tx: RecordTransaction, visitId: string): Promise<ChartState> {
  const snapshot = await tx.get(db.collection('visits').doc(visitId));
  if (!snapshot.exists) fail(404, 'NOT_FOUND', 'Visit not found.');
  const visit = snapshot.data()!;
  const readRelated = async (collection: string, id: unknown) => typeof id === 'string' && idPattern.test(id)
    ? (await tx.get(db.collection(collection).doc(id))).data() || null : null;
  const [patient, branch, doctor, performer, chartSnapshot] = await Promise.all([
    readRelated('patients', visit.patientId), readRelated('branches', visit.branchId), readRelated('users', visit.doctorId),
    readRelated('users', visit.performedByUserId),
    tx.get(db.collection('clinical_charts').doc(visitId)),
  ]);
  const visitContext: ChartVisitContext = {
    visitId, patientId: text(visit.patientId), patientName: text(visit.patientName, text(patient?.name)),
    branchId: text(visit.branchId), branchName: text(branch?.branchName, text(visit.branchName)),
    doctorId: text(visit.doctorId), doctorName: text(doctor?.fullName, text(visit.doctorName)),
    visitDate: text(visit.visitDate), visitType: text(visit.visitType),
    serviceId: nullableText(visit.serviceId), serviceNameSnapshot: nullableText(visit.serviceNameSnapshot),
    serviceDurationMinutesSnapshot: nullableNumber(visit.serviceDurationMinutesSnapshot),
    serviceCatalogueVersion: nullableNumber(visit.serviceCatalogueVersion),
    ...(visit.performedByUserId ? {
      performedByUserId: text(visit.performedByUserId),
      performedByNameSnapshot: text(visit.performedByNameSnapshot, 'Recorded performer'),
      performedByRoleSnapshot: text(visit.performedByRoleSnapshot),
      performedByDesignationSnapshot: nullableText(visit.performedByDesignationSnapshot),
    } : {}),
  };
  const contextKey = createHash('sha256').update(JSON.stringify(visitContext)).digest('hex');
  const chart = chartSnapshot.exists ? chartSnapshot.data() as ClinicalChart : null;
  if (chart && (chart.schemaVersion !== 1 || chart.visitId !== visitId || !Number.isSafeInteger(chart.version)
    || chart.version < 1 || !Array.isArray(chart.revisions) || chart.revisions.length > MAX_CHART_REVISIONS)) {
    fail(409, 'CHART_FORMAT', 'This chart cannot be edited by this application version.');
  }
  return { chart, visit, patient, branch, doctor, performer, visitContext, contextKey };
}

// Viewing follows the existing shared clinical history policy. Editing keeps the
// Visit's branch scope and Doctor ownership. Medical Staff/Nurse defaults are
// resolved by the common capability policy, including denials and branch scope.
// Without a Doctor assignment, an eligible performer supplies the Visit linkage.
function ownsDoctorChart(actor: Actor, state: ChartState): boolean {
  return actor.profile.role !== 'doctor'
    || (state.visit.doctorId || state.visit.performedByUserId) === actor.identity.uid;
}
function writeBlocker(actor: Actor, state: ChartState): string | null {
  if (!hasCapability(actor.profile, 'visits.edit') || !hasCapability(actor.profile, 'clinical.edit_draft')) {
    return 'You do not have permission to edit clinical charts.';
  }
  if (!hasCapability(actor.profile, 'visits.edit', { branchId: state.visit.branchId })) {
    return 'You cannot edit charts outside your authorized branches.';
  }
  if (!ownsDoctorChart(actor, state)) {
    return 'Doctors can only edit charts for their own Visits.';
  }
  if (state.visit.isArchived === true) return 'Restore this Visit before editing its chart.';
  if (!state.patient) return 'The patient record is unavailable.';
  if (state.patient.isArchived === true) return 'Restore the patient before editing this chart.';
  if (isVisitClinicallySealed(state.visit)) return 'This Visit is signed or finalized and remains read-only.';
  if (state.visit.doctorId) {
    if (!state.doctor || state.doctor.role !== 'doctor' || !activeAccount(state.doctor)
      || !state.visit.branchId || !Array.isArray(state.doctor.assignedBranches)
      || !state.doctor.assignedBranches.includes(state.visit.branchId)) {
      return 'The assigned doctor must be active in this branch before editing the chart.';
    }
  } else {
    if (!state.visit.performedByUserId) return 'Select who performed this Visit before editing its chart.';
    const performer = state.performer;
    if (!performer || !activeAccount(performer) || !state.visit.branchId
      || !Array.isArray(performer.assignedBranches) || !performer.assignedBranches.includes(state.visit.branchId)
      || !(performer.role === 'doctor' || performer.role === 'staff'
        && ['Nurse', 'Medical Staff'].includes(performer.staffDesignation))) {
      return 'The recorded performer must be an active doctor, nurse or medical staff member in this branch before editing the chart.';
    }
  }
  if (!state.branch || state.branch.status !== 'Active') return 'The Visit branch must be active before editing its chart.';
  return null;
}
function response(actor: Actor, state: ChartState): ChartResponse {
  const reason = writeBlocker(actor, state);
  const editable = !reason;
  const signed = !!state.chart?.revisions.length;
  const draft = state.chart?.draft || null;
  const withinLimit = (state.chart?.revisions.length || 0) < MAX_CHART_REVISIONS;
  return {
    visitId: state.visitContext.visitId, chart: state.chart, visitContext: state.visitContext, contextKey: state.contextKey,
    permissions: {
      canEdit: editable && (!signed || !!draft),
      canSign: editable && !!draft && withinLimit && draft.contextKey === state.contextKey && hasCapability(actor.profile, 'clinical.finalize'),
      canAmend: editable && signed && !draft && withinLimit,
    },
    readOnlyReason: reason || (signed && !draft ? 'This chart is signed. Start an attributed amendment to make changes.' : null),
  };
}
function assertWritable(actor: Actor, state: ChartState) {
  assertCapability(actor.profile, 'visits.edit', { branchId: state.visit.branchId });
  assertCapability(actor.profile, 'clinical.edit_draft');
  if (!ownsDoctorChart(actor, state)) {
    fail(403, 'FORBIDDEN', 'Doctors can only edit charts for their own Visits.');
  }
  const reason = writeBlocker(actor, state);
  if (reason) fail(409, 'CHART_READ_ONLY', reason);
}
function assertExpected(state: ChartState, submitted: Record<string, any>) {
  const version = expectedVersion(submitted.expectedVersion);
  const context = expectedContext(submitted.expectedContextKey);
  if (version !== (state.chart?.version || 0)) fail(409, 'CHART_VERSION_CONFLICT', 'The chart changed. Reload it before saving.');
  if (context !== state.contextKey) fail(409, 'CHART_VISIT_CHANGED', 'The Visit changed. Reload and review its current details.');
}
function initialChart(state: ChartState, actor: ChartActor, now: string): ClinicalChart {
  return state.chart || { schemaVersion: 1, version: 0, visitId: state.visitContext.visitId, draft: null, revisions: [], createdAt: now, createdBy: actor };
}
function persist(tx: RecordTransaction, actor: Actor, state: ChartState, chart: ClinicalChart, eventType: string, now: string) {
  tx.set(db.collection('clinical_charts').doc(state.visitContext.visitId), chart);
  tx.create(db.collection('audit_logs').doc(), {
    action: 'UPDATE', resource: 'Visit', resourceId: state.visitContext.visitId,
    branchId: state.visitContext.branchId, timestamp: now, source: 'trusted_server', eventType,
    userId: actor.identity.uid, userName: actorSnapshot(actor).name, userEmail: actor.identity.email, userRole: actor.profile.role,
    details: eventType.replaceAll('_', ' '), changes: [{ field: 'clinicalChart' }], chartVersion: chart.version,
  });
  state.chart = chart;
}

export function mountClinicalCharts(app: express.Express) {
  const route = (method: 'get' | 'put' | 'post', suffix: string,
    handler: (req: express.Request, tx: RecordTransaction, actor: Actor, state: ChartState) => Promise<ChartResponse>) => {
    app[method]('/api/records/visits/:visitId/chart' + suffix, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const result = await db.runTransaction(async tx => {
          const actor = await currentActor(req, tx);
          assertCapability(actor.profile, 'visits.view');
          assertCapability(actor.profile, 'clinical.view');
          if (!idPattern.test(String(req.params.visitId))) fail(400, 'INVALID_ID', 'Invalid Visit ID.');
          const state = await readState(tx, String(req.params.visitId));
          return handler(req, tx, actor, state);
        });
        res.json(result);
      } catch (error: any) {
        if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Please sign in again.', code: 'UNAUTHORIZED' });
        if (error.message === 'Invalid request origin or CSRF token') return res.status(403).json({ error: 'Invalid origin or CSRF token.', code: 'CSRF' });
        if (error.status) return res.status(error.status).json({ error: error.message, code: error.code || (error.status === 403 ? 'FORBIDDEN' : 'INVALID_CHART') });
        if (['ECONNREFUSED', 'ETIMEDOUT', '57P01', '53300', '08006'].includes(error.code)) {
          return res.status(503).json({ error: 'Clinical charts are temporarily unavailable. Try again.', code: 'UNAVAILABLE' });
        }
        // Do not log chart bodies, clinical notes, credentials or session values.
        console.error('Clinical chart request failed', error.code || error.name);
        res.status(500).json({ error: 'The clinical chart could not be loaded or saved. Try again.', code: 'SERVER_ERROR' });
      }
    });
  };
  route('get', '', async (_req, _tx, actor, state) => response(actor, state));
  route('put', '/draft', async (req, tx, actor, state) => {
    assertWritable(actor, state);
    const submitted = body(req.body, ['expectedVersion', 'expectedContextKey', 'markers', 'notes']);
    assertExpected(state, submitted);
    if (state.chart?.revisions.length && !state.chart.draft) {
      fail(409, 'CHART_SIGNED', 'This chart is signed. Start an attributed amendment before editing.');
    }
    const content = validateChartContent({ markers: submitted.markers, notes: submitted.notes });
    const now = new Date().toISOString(), snapshot = actorSnapshot(actor);
    const chart = initialChart(state, snapshot, now);
    const draft: ChartDraft = {
      ...content, kind: chart.draft?.kind || 'initial', reason: chart.draft?.reason || '',
      createdAt: chart.draft?.createdAt || now, createdBy: chart.draft?.createdBy || snapshot,
      updatedAt: now, updatedBy: snapshot, context: state.visitContext, contextKey: state.contextKey,
    };
    persist(tx, actor, state, { ...chart, version: chart.version + 1, draft }, 'clinical_chart_draft_saved', now);
    return response(actor, state);
  });
  route('post', '/sign', async (req, tx, actor, state) => {
    assertWritable(actor, state);
    assertCapability(actor.profile, 'clinical.finalize');
    const submitted = body(req.body, ['expectedVersion', 'expectedContextKey']);
    assertExpected(state, submitted);
    if (!state.chart?.draft) fail(409, 'CHART_DRAFT_REQUIRED', 'Save a chart draft before signing.');
    if (state.chart.revisions.length >= MAX_CHART_REVISIONS) fail(409, 'CHART_REVISION_LIMIT', 'This chart has reached its supported revision limit.');
    if (state.chart.draft.contextKey !== state.contextKey) {
      fail(409, 'CHART_VISIT_CHANGED', 'The Visit changed after the draft was saved. Review and save the draft again.');
    }
    const now = new Date().toISOString();
    const revision: ChartRevision = {
      ...state.chart.draft, revision: state.chart.revisions.length + 1, signedAt: now, signedBy: actorSnapshot(actor),
    };
    persist(tx, actor, state, { ...state.chart, version: state.chart.version + 1, draft: null,
      revisions: [...state.chart.revisions, revision] }, 'clinical_chart_signed', now);
    return response(actor, state);
  });
  route('post', '/amendment', async (req, tx, actor, state) => {
    assertWritable(actor, state);
    const submitted = body(req.body, ['expectedVersion', 'expectedContextKey', 'reason']);
    assertExpected(state, submitted);
    if (typeof submitted.reason !== 'string' || !submitted.reason.trim() || submitted.reason.length > 500) {
      fail(400, 'REASON_REQUIRED', 'Enter an amendment reason of at most 500 characters.');
    }
    if (!state.chart?.revisions.length) fail(409, 'CHART_NOT_SIGNED', 'Only signed charts can be amended.');
    if (state.chart.draft) fail(409, 'CHART_DRAFT_EXISTS', 'An amendment draft already exists. Reload it to continue.');
    if (state.chart.revisions.length >= MAX_CHART_REVISIONS) fail(409, 'CHART_REVISION_LIMIT', 'This chart has reached its supported revision limit.');
    const latest = state.chart.revisions.at(-1)!;
    const now = new Date().toISOString(), snapshot = actorSnapshot(actor);
    const draft: ChartDraft = {
      markers: latest.markers.map(marker => ({ ...marker })), notes: latest.notes, kind: 'amendment', reason: submitted.reason.trim(),
      createdAt: now, createdBy: snapshot, updatedAt: now, updatedBy: snapshot, context: state.visitContext, contextKey: state.contextKey,
    };
    persist(tx, actor, state, { ...state.chart, version: state.chart.version + 1, draft }, 'clinical_chart_amendment_started', now);
    return response(actor, state);
  });
}
