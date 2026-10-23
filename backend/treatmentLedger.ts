import type express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { db, type RecordTransaction } from './database';
import { currentActor, assertCapability } from './permissions';
import { hasBranchScope, hasCapability, hasGlobalBranchScope } from '../src/permissions';
import { appointmentServiceSnapshot } from './appointmentServices';
import { resolveCataloguePurchase } from './packageCatalogue';
import { parseCataloguePurchase } from '../src/packageCataloguePolicy';
import {
  TreatmentLedgerError, assertTreatmentUsageCompatible, canEditTreatmentOrNumber, canViewTreatmentLedger,
  ledgerFail, ledgerObject, ledgerRecordId, ledgerSessions, ledgerText, ledgerUuid, ledgerVersion,
  parseSessionUsage, parseTreatmentPurchase, treatmentBalance, treatmentVisitBinding,
  type TreatmentActor, type TreatmentLedgerResponse, type TreatmentUsage, type TreatmentVisitSnapshot,
  type TreatmentPurchaseInput,
} from '../src/treatmentLedgerPolicy';

export { TreatmentLedgerError } from '../src/treatmentLedgerPolicy';
type Actor = Awaited<ReturnType<typeof currentActor>>;
type EventInput = {
  commandId: string; requestHash: string; type: string; purchaseId: string; lineId?: string;
  visitId?: string; branchId: string; sessionsDelta?: number; usedDelta?: number; treatmentDate?: string;
  reason?: string; visitSnapshot?: TreatmentVisitSnapshot; metadata?: Record<string, unknown>; reversesEventId?: string;
};
const dateText = (value: any) => value instanceof Date ? value.toISOString() : String(value);
const purchaseDate = (value: any) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const commandHash = (operation: string, target: string, value: unknown) => createHash('sha256').update(JSON.stringify([operation, target, value])).digest('hex');
function actorSnapshot(actor: Actor): TreatmentActor {
  return { uid: actor.identity.uid, name: String(actor.profile.fullName || actor.identity.email || 'Recorded user').slice(0, 120), role: actor.profile.role };
}
function assertRead(actor: Actor) {
  if (!canViewTreatmentLedger(actor.profile)) ledgerFail(403, 'FORBIDDEN', 'Treatment ledger access requires patient, Visit and clinical viewing permission.');
}
async function patient(tx: RecordTransaction, patientId: string, write = false) {
  const record = (await tx.get(db.collection('patients').doc(patientId))).data();
  if (!record) ledgerFail(404, 'NOT_FOUND', 'Patient not found.');
  if (write && record.isArchived === true) ledgerFail(409, 'PATIENT_ARCHIVED', 'Restore the patient before changing the treatment ledger.');
  return record;
}
async function timezone(tx: RecordTransaction): Promise<string> {
  const settings = (await tx.get(db.collection('settings').doc('timezone'))).data();
  const value = typeof settings?.timezone === 'string' ? settings.timezone : 'Asia/Manila';
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; }
  catch { return 'Asia/Manila'; }
}
async function branch(tx: RecordTransaction, branchId: string) {
  const record = (await tx.get(db.collection('branches').doc(branchId))).data();
  if (!record) ledgerFail(404, 'NOT_FOUND', 'Clinic not found.');
  return record;
}
function assertBranch(actor: Actor, branchId: string) {
  if (!hasBranchScope(actor.profile, branchId)) ledgerFail(403, 'BRANCH_FORBIDDEN', 'Treatment ledger access denied for this clinic.');
}
function assertReference(actor: Actor, branchId: string) {
  if (!canEditTreatmentOrNumber(actor.profile, branchId)) ledgerFail(403, 'OR_FORBIDDEN', 'Only an authorized Administrator or guarded Support / Developer may change an OR number.');
}
async function replay(tx: RecordTransaction, actor: Actor, commandId: string, requestHash: string) {
  const event = (await tx.sql('SELECT * FROM treatment_ledger_events WHERE command_id=$1', [commandId])).rows[0];
  if (!event) return null;
  if (event.request_hash !== requestHash || event.actor.uid !== actor.identity.uid) ledgerFail(409, 'COMMAND_CONFLICT', 'This command identifier was already used with different content or by another actor.');
  return event;
}
function assertVersion(current: number, expected: number, code = 'VERSION_CONFLICT') {
  if (current !== expected) ledgerFail(409, code, 'The treatment ledger changed. Reload and review before saving.');
}
async function line(tx: RecordTransaction, lineId: string, patientId: string) {
  const row = (await tx.sql(`SELECT l.*,p.patient_id,p.branch_id,p.id AS owner_purchase_id, pos_purchase_usable(p.id) AS usable FROM treatment_ledger_lines l
    JOIN treatment_ledger_purchases p ON p.id=l.purchase_id WHERE l.id=$1 FOR UPDATE OF l`, [lineId])).rows[0];
  if (!row || row.patient_id !== patientId) ledgerFail(404, 'NOT_FOUND', 'Treatment package Service line not found for this patient.');
  const totals = (await tx.sql('SELECT COALESCE(sum(sessions_delta),0)::integer AS adjustment,COALESCE(sum(used_delta),0)::integer AS used FROM treatment_ledger_events WHERE line_id=$1', [lineId])).rows[0];
  return { ...row, ...treatmentBalance(row.purchased_sessions, totals.adjustment, totals.used) };
}
async function addEvent(tx: RecordTransaction, actor: Actor, input: EventInput) {
  const id = randomUUID();
  const currentLine = input.lineId ? (await tx.sql(`SELECT l.purchased_sessions,COALESCE(sum(e.sessions_delta),0)::integer AS adjustment,COALESCE(sum(e.used_delta),0)::integer AS used
    FROM treatment_ledger_lines l LEFT JOIN treatment_ledger_events e ON e.line_id=l.id WHERE l.id=$1 GROUP BY l.id`, [input.lineId])).rows[0] : null;
  const balanceAfter = currentLine ? treatmentBalance(currentLine.purchased_sessions, currentLine.adjustment + (input.sessionsDelta ?? 0), currentLine.used + (input.usedDelta ?? 0)) : null;
  await tx.sql(`INSERT INTO treatment_ledger_events(id,command_id,request_hash,type,purchase_id,line_id,visit_id,branch_id,
    sessions_delta,used_delta,treatment_date,actor,reason,visit_snapshot,metadata,reverses_event_id,balance_after)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15::jsonb,$16,$17::jsonb)`,
  [id, input.commandId, input.requestHash, input.type, input.purchaseId, input.lineId ?? null, input.visitId ?? null,
    input.branchId, input.sessionsDelta ?? 0, input.usedDelta ?? 0, input.treatmentDate ?? null,
    JSON.stringify(actorSnapshot(actor)), input.reason ?? null, input.visitSnapshot ? JSON.stringify(input.visitSnapshot) : null,
    JSON.stringify(input.metadata ?? {}), input.reversesEventId ?? null, balanceAfter ? JSON.stringify(balanceAfter) : null]);
  // General audit identifies the mutation without copying private notes, OR
  // metadata, adjustment reasons or clinical performance into its broad feed.
  tx.create(db.collection('audit_logs').doc(), {
    action: input.type === 'purchase' ? 'CREATE' : 'UPDATE', resource: 'Treatment Ledger', resourceId: input.purchaseId,
    branchId: input.branchId, timestamp: new Date().toISOString(), source: 'trusted_server', eventType: 'treatment_ledger_' + input.type,
    userId: actor.identity.uid, userName: actorSnapshot(actor).name, userEmail: actor.identity.email, userRole: actor.profile.role,
    details: 'Treatment ledger ' + input.type + ' recorded', ledgerEventId: id,
    changes: [{ field: input.type === 'metadata' ? 'packageMetadata' : 'sessionLedger' }],
  });
  return id;
}
async function activeUsage(tx: RecordTransaction, visitId: string): Promise<TreatmentUsage | null> {
  const row = (await tx.sql('SELECT * FROM treatment_ledger_visit_usage WHERE visit_id=$1 FOR UPDATE', [visitId])).rows[0];
  return row ? { visitId: row.visit_id, eventId: row.event_id, lineId: row.line_id, sessions: row.sessions, version: row.version, visitSnapshot: row.visit_snapshot } : null;
}
async function visitSnapshot(tx: RecordTransaction, visit: Record<string, any>): Promise<TreatmentVisitSnapshot> {
  if (!visit.performedByUserId && !visit.doctorId) ledgerFail(400, 'PERFORMER_REQUIRED', 'Select who performed the Visit before recording session usage.');
  const clinic = await branch(tx, visit.branchId);
  let performerName = visit.performedByNameSnapshot;
  if (!performerName && visit.doctorId) {
    const doctor = (await tx.get(db.collection('users').doc(visit.doctorId))).data();
    performerName = doctor?.fullName || visit.doctorName || 'Recorded doctor';
  }
  return {
    patientId: visit.patientId, branchId: visit.branchId, branchNameSnapshot: String(clinic.branchName || ''), timezoneSnapshot: await timezone(tx),
    visitDate: visit.visitDate, serviceId: visit.serviceId, serviceNameSnapshot: visit.serviceNameSnapshot,
    serviceDurationMinutesSnapshot: visit.serviceDurationMinutesSnapshot ?? null, serviceCatalogueVersion: visit.serviceCatalogueVersion,
    doctorId: visit.doctorId || null, performedByUserId: visit.performedByUserId || null,
    performedByNameSnapshot: String(performerName || 'Recorded performer'), performedByRoleSnapshot: visit.performedByRoleSnapshot || (visit.doctorId ? 'doctor' : null),
    performedByDesignationSnapshot: visit.performedByDesignationSnapshot || null, assistingStaffText: visit.assistingStaffText || '',
  };
}

// Called inside the existing Visit mutation after its current authorization,
// Service, clinic and performer checks. The deferred Visit FK allows a new Visit
// and its explicit usage to commit together despite queued JSONB record writes.
export async function applyVisitSessionUsage(tx: RecordTransaction, actor: Actor, visitId: string,
  prospectiveVisit: Record<string, any>, submitted: unknown, previousVisit?: Record<string, any>): Promise<TreatmentUsage | null> {
  const usage = parseSessionUsage(submitted);
  const active = await activeUsage(tx, visitId);
  if (!usage) {
    if (active) assertTreatmentUsageCompatible(active.visitSnapshot, prospectiveVisit);
    return active;
  }
  assertRead(actor);
  assertCapability(actor.profile, previousVisit ? 'visits.edit' : 'visits.create', { branchId: prospectiveVisit.branchId });
  assertBranch(actor, prospectiveVisit.branchId);
  if (actor.profile.role === 'doctor' && (prospectiveVisit.doctorId || prospectiveVisit.performedByUserId) !== actor.identity.uid) ledgerFail(403, 'FORBIDDEN', 'Doctors may record session usage only for their own Visits.');
  await patient(tx, ledgerRecordId(prospectiveVisit.patientId), true);
  if (prospectiveVisit.isArchived === true) ledgerFail(409, 'VISIT_ARCHIVED', 'Restore the Visit before recording session usage.');
  const billed = (await tx.sql(`SELECT 1 FROM pos_source_claims c JOIN pos_invoices i ON i.id=c.invoice_id
    WHERE i.state='posted' AND ((c.collection_path='visits' AND c.record_id=$1) OR (c.collection_path='appointments' AND c.record_id=$2)) LIMIT 1`, [visitId, prospectiveVisit.appointmentId || null])).rowCount;
  if (billed) ledgerFail(409, 'VISIT_ALREADY_BILLED', 'This Visit or booking has a posted invoice. Resolve its billing before using package sessions.');
  const selectedLine = await line(tx, usage.lineId, prospectiveVisit.patientId);
  if (!selectedLine.usable) ledgerFail(409, 'PACKAGE_UNPAID', 'This package is locked until its invoice is fully paid.');
  const requestHash = commandHash('usage', visitId, { ...usage, visit: treatmentVisitBinding(prospectiveVisit) });
  const prior = await replay(tx, actor, usage.commandId, requestHash);
  if (prior) {
    if (active) assertTreatmentUsageCompatible(active.visitSnapshot, prospectiveVisit);
    return active; // A retry after reversal never recreates the original usage.
  }
  if (active) ledgerFail(409, 'ACTIVE_SESSION_USAGE', 'This Visit already records session usage. Reverse it before selecting another package.');
  assertVersion(selectedLine.version, usage.expectedLineVersion, 'LINE_VERSION_CONFLICT');
  if (!prospectiveVisit.serviceId || prospectiveVisit.serviceId !== selectedLine.service_id) ledgerFail(400, 'SERVICE_MISMATCH', 'Session usage must match the canonical Service performed in this Visit.');
  const expectedServiceVersion = ledgerVersion(prospectiveVisit.serviceCatalogueVersion);
  // Retained historical Service snapshots do not automatically authorize a new
  // redemption. Validate their version and current availability in this clinic.
  const currentService = await appointmentServiceSnapshot(tx, { serviceId: prospectiveVisit.serviceId, expectedVersion: expectedServiceVersion }, prospectiveVisit.branchId);
  if (currentService.serviceNameSnapshot !== prospectiveVisit.serviceNameSnapshot
    || currentService.serviceDurationMinutesSnapshot !== prospectiveVisit.serviceDurationMinutesSnapshot) ledgerFail(409, 'SERVICE_SNAPSHOT_CHANGED', 'Reload and review the performed Service before recording session usage.');
  treatmentBalance(selectedLine.purchasedSessions, selectedLine.adjustmentSessions, selectedLine.usedSessions + usage.sessions);
  const snapshot = await visitSnapshot(tx, prospectiveVisit);
  const eventId = await addEvent(tx, actor, { commandId: usage.commandId, requestHash, type: 'usage', purchaseId: selectedLine.purchase_id,
    lineId: usage.lineId, visitId, branchId: prospectiveVisit.branchId, usedDelta: usage.sessions, treatmentDate: prospectiveVisit.visitDate, visitSnapshot: snapshot });
  await tx.sql('UPDATE treatment_ledger_lines SET version=version+1 WHERE id=$1', [usage.lineId]);
  await tx.sql('INSERT INTO treatment_ledger_visit_usage(visit_id,event_id,line_id,sessions,visit_snapshot) VALUES($1,$2,$3,$4,$5::jsonb)', [visitId, eventId, usage.lineId, usage.sessions, JSON.stringify(snapshot)]);
  return { visitId, eventId, lineId: usage.lineId, sessions: usage.sessions, version: 1, visitSnapshot: snapshot };
}
export async function assertVisitUsageCompatible(tx: RecordTransaction, visitId: string, prospectiveVisit: Record<string, any>) {
  const active = await activeUsage(tx, visitId);
  if (active) assertTreatmentUsageCompatible(active.visitSnapshot, prospectiveVisit);
}

async function readLedger(tx: RecordTransaction, actor: Actor, patientId: string): Promise<TreatmentLedgerResponse> {
  assertRead(actor);
  const patientRecord = await patient(tx, patientId);
  const purchases = (await tx.sql('SELECT p.*,pos_purchase_usable(p.id) AS usable,p.purchase_date::text AS purchase_date FROM treatment_ledger_purchases p WHERE patient_id=$1 ORDER BY p.purchase_date DESC,p.recorded_at DESC,p.id', [patientId])).rows;
  const ids = purchases.map(row => row.id);
  const lines = ids.length ? (await tx.sql(`SELECT l.*,COALESCE(sum(e.sessions_delta),0)::integer AS adjustment,COALESCE(sum(e.used_delta),0)::integer AS used
    FROM treatment_ledger_lines l LEFT JOIN treatment_ledger_events e ON e.line_id=l.id WHERE l.purchase_id=ANY($1::uuid[]) GROUP BY l.id ORDER BY l.id`, [ids])).rows : [];
  const events = ids.length ? (await tx.sql('SELECT e.*,p.branch_id AS purchase_branch_id FROM treatment_ledger_events e JOIN treatment_ledger_purchases p ON p.id=e.purchase_id WHERE e.purchase_id=ANY($1::uuid[]) ORDER BY e.recorded_at DESC,e.id', [ids])).rows : [];
  const usages = ids.length ? (await tx.sql('SELECT u.* FROM treatment_ledger_visit_usage u JOIN treatment_ledger_lines l ON l.id=u.line_id WHERE l.purchase_id=ANY($1::uuid[]) ORDER BY u.visit_id', [ids])).rows : [];
  const global = hasGlobalBranchScope(actor.profile), assigned = Array.isArray(actor.profile.assignedBranches) ? actor.profile.assignedBranches.filter((id: unknown) => typeof id === 'string') : [];
  const branches = (await tx.sql("SELECT id,data->>'branchName' AS name,data->>'status' AS status FROM app_records WHERE collection_path='branches' AND ($1::boolean OR id=ANY($2::text[])) ORDER BY lower(data->>'branchName'),id", [global, assigned])).rows;
  return {
    patientId, patientName: typeof patientRecord.name === 'string' ? patientRecord.name : '',
    purchases: purchases.map(row => {
      const scoped = hasBranchScope(actor.profile, row.branch_id);
      return { usable: row.usable, id: row.id, patientId: row.patient_id, packageName: row.package_name, purchaseDate: purchaseDate(row.purchase_date), branchId: row.branch_id,
        catalogue: row.catalogue_package_id ? { packageId: row.catalogue_package_id, version: row.catalogue_package_version } : null,
        branchNameSnapshot: row.branch_name_snapshot, timezoneSnapshot: row.timezone_snapshot, notes: scoped ? row.notes : '', orNumber: scoped ? row.or_number : null,
        version: row.version, recordedAt: dateText(row.recorded_at), actor: row.actor, metadataRedacted: !scoped,
        capabilities: { canEditNotes: scoped && hasCapability(actor.profile, 'treatment_ledger.purchase'), canAdjust: row.usable && scoped && hasCapability(actor.profile, 'treatment_ledger.adjust'), canEditOrNumber: canEditTreatmentOrNumber(actor.profile, row.branch_id) },
        lines: lines.filter(item => item.purchase_id === row.id).map(item => ({ id: item.id, serviceId: item.service_id, serviceNameSnapshot: item.service_name_snapshot,
          serviceCatalogueVersion: item.service_catalogue_version, ...treatmentBalance(item.purchased_sessions, item.adjustment, item.used), version: item.version })),
      };
    }),
    events: events.map(row => {
      const scoped = hasBranchScope(actor.profile, row.branch_id);
      return { id: row.id, type: row.type, purchaseId: row.purchase_id, lineId: row.line_id, visitId: row.visit_id, purchaseBranchId: row.purchase_branch_id, branchId: row.branch_id,
        sessionsDelta: row.sessions_delta, usedDelta: row.used_delta, recordedAt: dateText(row.recorded_at), treatmentDate: row.treatment_date, actor: row.actor,
        reason: scoped ? row.reason : null, visitSnapshot: row.visit_snapshot, reversesEventId: row.reverses_event_id, metadata: scoped ? row.metadata : null, balanceAfter: row.balance_after };
    }),
    activeVisitUsages: usages.map(row => ({ visitId: row.visit_id, eventId: row.event_id, lineId: row.line_id, sessions: row.sessions, version: row.version, visitSnapshot: row.visit_snapshot })),
    branches: branches.map(row => ({ id: row.id, name: row.name || '', status: row.status || '' })),
    capabilities: { canPurchase: hasCapability(actor.profile, 'treatment_ledger.purchase'), canAdjust: hasCapability(actor.profile, 'treatment_ledger.adjust'), canEditOrNumber: canEditTreatmentOrNumber(actor.profile) },
    redemptionPolicy: 'authorized_branches',
  };
}

export function mountTreatmentLedger(app: express.Express) {
  const base = '/api/records/patients/:patientId/treatment-ledger';
  const route = (method: 'get' | 'post' | 'patch', suffix: string, handler: (req: express.Request, tx: RecordTransaction, actor: Actor, patientId: string) => Promise<any>) => {
    app[method](base + suffix, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const result = await db.runTransaction(async tx => {
          const actor = await currentActor(req, tx);
          assertRead(actor);
          const patientId = ledgerRecordId(req.params.patientId);
          await patient(tx, patientId, method !== 'get');
          return handler(req, tx, actor, patientId);
        });
        res.status(result.status ?? 200).json(result.body ?? result);
      } catch (error: any) {
        if (error instanceof TreatmentLedgerError || typeof error.status === 'number') return res.status(error.status).json({ error: error.message, code: error.code || 'FORBIDDEN' });
        if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Please sign in again.', code: 'UNAUTHORIZED' });
        if (error.message === 'Invalid request origin or CSRF token') return res.status(403).json({ error: 'Invalid origin or CSRF token.', code: 'CSRF' });
        if (['23505', '23503', '23514'].includes(error.code)) return res.status(409).json({ error: 'The treatment ledger changed or this command violates its saved history. Reload and review.', code: 'LEDGER_CONFLICT' });
        if (['ECONNREFUSED', 'ETIMEDOUT', '57P01', '53300', '08006', '42P01'].includes(error.code)) return res.status(503).json({ error: 'Treatment ledger is temporarily unavailable.', code: 'UNAVAILABLE' });
        console.error('Treatment ledger request failed', error.code || error.name);
        res.status(500).json({ error: 'Treatment ledger could not be loaded or saved.', code: 'SERVER_ERROR' });
      }
    });
  };
  const result = async (tx: RecordTransaction, actor: Actor, patientId: string, commandId: string, eventId: string, replayed: boolean) => ({ ...(await readLedger(tx, actor, patientId)), command: { id: commandId, eventId, replayed } });
  route('get', '', async (_req, tx, actor, patientId) => readLedger(tx, actor, patientId));
  route('post', '/purchases', async (req, tx, actor, patientId) => {
    const catalogueInput = Object.hasOwn(req.body ?? {}, 'catalogueSelection') ? parseCataloguePurchase(req.body) : null;
    const input = catalogueInput ?? parseTreatmentPurchase(req.body);
    assertCapability(actor.profile, 'treatment_ledger.purchase', { branchId: input.branchId });
    assertBranch(actor, input.branchId);
    if (Object.hasOwn(input, 'orNumber')) assertReference(actor, input.branchId);
    // Replay the original submitted intent before resolving today's catalogue.
    // A lost successful response must not create a second purchase after an edit.
    const requestHash = commandHash('purchase', patientId, input), prior = await replay(tx, actor, input.commandId, requestHash);
    if (prior) return { status: 200, body: await result(tx, actor, patientId, input.commandId, prior.id, true) };
    const resolved = catalogueInput ? await resolveCataloguePurchase(tx, actor, input.branchId, catalogueInput.catalogueSelection) : null;
    const p = resolved ? { ...input, packageName: resolved.packageName, lines: resolved.lines } : input as TreatmentPurchaseInput;
    const clinic = await branch(tx, p.branchId);
    if (clinic.status !== 'Active') ledgerFail(409, 'BRANCH_INACTIVE', 'Select an active clinic for a package purchase.');
    const snapshots = [];
    for (const selected of p.lines) snapshots.push(await appointmentServiceSnapshot(tx, { serviceId: selected.serviceId, expectedVersion: selected.expectedServiceVersion }, p.branchId));
    const purchaseId = randomUUID();
    await tx.sql(`INSERT INTO treatment_ledger_purchases(id,command_id,patient_id,branch_id,package_name,purchase_date,branch_name_snapshot,timezone_snapshot,notes,or_number,actor,catalogue_package_id,catalogue_package_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`, [purchaseId, p.commandId, patientId, p.branchId, p.packageName, p.purchaseDate, String(clinic.branchName || ''), await timezone(tx), p.notes, p.orNumber ?? null, JSON.stringify(actorSnapshot(actor)), resolved?.catalogue.packageId ?? null, resolved?.catalogue.version ?? null]);
    const initialLines = p.lines.map((selected, i) => ({ id: randomUUID(), serviceId: selected.serviceId, serviceNameSnapshot: snapshots[i].serviceNameSnapshot,
      serviceCatalogueVersion: snapshots[i].serviceCatalogueVersion, purchasedSessions: selected.purchasedSessions }));
    for (const selected of initialLines) await tx.sql('INSERT INTO treatment_ledger_lines(id,purchase_id,service_id,service_name_snapshot,service_catalogue_version,purchased_sessions) VALUES($1,$2,$3,$4,$5,$6)', [selected.id, purchaseId, selected.serviceId, selected.serviceNameSnapshot, selected.serviceCatalogueVersion, selected.purchasedSessions]);
    const eventId = await addEvent(tx, actor, { commandId: p.commandId, requestHash, type: 'purchase', purchaseId, branchId: p.branchId,
      metadata: { packageName: p.packageName, purchaseDate: p.purchaseDate, notes: p.notes, orNumber: p.orNumber ?? null, lines: initialLines,
        ...(resolved ? { catalogue: resolved.catalogue } : {}) } });
    return { status: 201, body: await result(tx, actor, patientId, p.commandId, eventId, false) };
  });
  route('patch', '/purchases/:purchaseId', async (req, tx, actor, patientId) => {
    const p = ledgerObject(req.body, ['commandId', 'expectedVersion', 'notes', 'orNumber']);
    const commandId = ledgerUuid(p.commandId), expectedVersion = ledgerVersion(p.expectedVersion), purchaseId = ledgerUuid(req.params.purchaseId);
    if (!Object.hasOwn(p, 'notes') && !Object.hasOwn(p, 'orNumber')) ledgerFail(400, 'EMPTY_UPDATE', 'Provide package notes or an OR number to update.');
    const normalized = { commandId, expectedVersion, ...(Object.hasOwn(p, 'notes') ? { notes: ledgerText(p.notes, 3000, 'Package notes') } : {}),
      ...(Object.hasOwn(p, 'orNumber') ? { orNumber: p.orNumber === null ? null : ledgerText(p.orNumber, 120, 'OR number') || null } : {}) };
    const row = (await tx.sql('SELECT * FROM treatment_ledger_purchases WHERE id=$1 AND patient_id=$2 FOR UPDATE', [purchaseId, patientId])).rows[0];
    if (!row) ledgerFail(404, 'NOT_FOUND', 'Treatment package not found.');
    assertBranch(actor, row.branch_id);
    if (Object.hasOwn(normalized, 'notes')) assertCapability(actor.profile, 'treatment_ledger.purchase', { branchId: row.branch_id });
    if (Object.hasOwn(normalized, 'orNumber')) assertReference(actor, row.branch_id);
    const requestHash = commandHash('metadata', purchaseId, normalized), prior = await replay(tx, actor, commandId, requestHash);
    if (prior) return result(tx, actor, patientId, commandId, prior.id, true);
    assertVersion(row.version, expectedVersion);
    const nextNotes = Object.hasOwn(normalized, 'notes') ? normalized.notes : row.notes, nextOr = Object.hasOwn(normalized, 'orNumber') ? normalized.orNumber : row.or_number;
    const changes = Object.fromEntries([...(row.notes !== nextNotes ? [['notes', { before: row.notes, after: nextNotes }]] : []), ...(row.or_number !== nextOr ? [['orNumber', { before: row.or_number, after: nextOr }]] : [])]);
    await tx.sql('UPDATE treatment_ledger_purchases SET notes=$2,or_number=$3,version=version+1 WHERE id=$1', [purchaseId, nextNotes, nextOr]);
    const eventId = await addEvent(tx, actor, { commandId, requestHash, type: 'metadata', purchaseId, branchId: row.branch_id, metadata: { changes, beforeVersion: row.version, afterVersion: row.version + 1 } });
    return result(tx, actor, patientId, commandId, eventId, false);
  });
  route('post', '/lines/:lineId/adjustments', async (req, tx, actor, patientId) => {
    const raw = ledgerObject(req.body, ['commandId', 'expectedLineVersion', 'delta', 'reason']);
    const p = { commandId: ledgerUuid(raw.commandId), expectedLineVersion: ledgerVersion(raw.expectedLineVersion), delta: ledgerSessions(raw.delta, true), reason: ledgerText(raw.reason, 1000, 'Adjustment reason', true) };
    const lineId = ledgerUuid(req.params.lineId), row = await line(tx, lineId, patientId);
    if (!row.usable) ledgerFail(409, 'PACKAGE_UNPAID', 'Pay the invoice before adjusting these sessions.');
    assertCapability(actor.profile, 'treatment_ledger.adjust', { branchId: row.branch_id });
    assertBranch(actor, row.branch_id);
    const requestHash = commandHash('adjustment', lineId, p), prior = await replay(tx, actor, p.commandId, requestHash);
    if (prior) return result(tx, actor, patientId, p.commandId, prior.id, true);
    assertVersion(row.version, p.expectedLineVersion, 'LINE_VERSION_CONFLICT');
    treatmentBalance(row.purchasedSessions, row.adjustmentSessions + p.delta, row.usedSessions);
    const eventId = await addEvent(tx, actor, { commandId: p.commandId, requestHash, type: 'adjustment', purchaseId: row.purchase_id, lineId, branchId: row.branch_id, sessionsDelta: p.delta, reason: p.reason });
    await tx.sql('UPDATE treatment_ledger_lines SET version=version+1 WHERE id=$1', [lineId]);
    return result(tx, actor, patientId, p.commandId, eventId, false);
  });
  route('post', '/usage/:eventId/reversal', async (req, tx, actor, patientId) => {
    const raw = ledgerObject(req.body, ['commandId', 'expectedLineVersion', 'expectedUsageVersion', 'reason']);
    const p = { commandId: ledgerUuid(raw.commandId), expectedLineVersion: ledgerVersion(raw.expectedLineVersion), expectedUsageVersion: ledgerVersion(raw.expectedUsageVersion), reason: ledgerText(raw.reason, 1000, 'Reversal reason', true) };
    const eventId = ledgerUuid(req.params.eventId), event = (await tx.sql('SELECT * FROM treatment_ledger_events WHERE id=$1 AND type=\'usage\'', [eventId])).rows[0];
    if (!event) ledgerFail(404, 'NOT_FOUND', 'Recorded session usage not found.');
    const row = await line(tx, event.line_id, patientId);
    assertCapability(actor.profile, 'treatment_ledger.adjust', { branchId: row.branch_id });
    assertBranch(actor, row.branch_id); assertBranch(actor, event.branch_id);
    const requestHash = commandHash('reversal', eventId, p), prior = await replay(tx, actor, p.commandId, requestHash);
    if (prior) return result(tx, actor, patientId, p.commandId, prior.id, true);
    const active = await activeUsage(tx, event.visit_id);
    if (!active || active.eventId !== event.id) ledgerFail(409, 'USAGE_ALREADY_REVERSED', 'This session usage is no longer active.');
    assertVersion(row.version, p.expectedLineVersion, 'LINE_VERSION_CONFLICT');
    assertVersion(active.version, p.expectedUsageVersion, 'USAGE_VERSION_CONFLICT');
    treatmentBalance(row.purchasedSessions, row.adjustmentSessions, row.usedSessions - event.used_delta);
    const reversalId = await addEvent(tx, actor, { commandId: p.commandId, requestHash, type: 'reversal', purchaseId: row.purchase_id, lineId: row.id,
      visitId: event.visit_id, branchId: event.branch_id, usedDelta: -event.used_delta, reason: p.reason, reversesEventId: event.id, treatmentDate: event.treatment_date, visitSnapshot: event.visit_snapshot });
    await tx.sql('DELETE FROM treatment_ledger_visit_usage WHERE visit_id=$1 AND event_id=$2', [event.visit_id, eventId]);
    await tx.sql('UPDATE treatment_ledger_lines SET version=version+1 WHERE id=$1', [row.id]);
    return result(tx, actor, patientId, p.commandId, reversalId, false);
  });
}

// Called only after authoritative POS catalogue resolution in the same transaction.
// The link inserted by POS gates usage; no legacy purchases or balances are changed.
export async function createPosLedgerPurchase(tx: RecordTransaction, actor: Actor, input: {
 patientId: string; branchId: string; notes: string; terms: any;
}) {
 const { patientId, branchId, notes, terms } = input;
 assertRead(actor); assertCapability(actor.profile, 'treatment_ledger.purchase', { branchId }); assertBranch(actor, branchId);
 const clinic = await branch(tx, branchId), zone = await timezone(tx), purchaseId = randomUUID(), commandId = randomUUID();
 const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
 await tx.sql(`INSERT INTO treatment_ledger_purchases(id,command_id,patient_id,branch_id,package_name,purchase_date,branch_name_snapshot,timezone_snapshot,notes,actor,catalogue_package_id,catalogue_package_version)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`, [purchaseId,commandId,patientId,branchId,terms.packageName,day,String(clinic.branchName||''),zone,notes,JSON.stringify(actorSnapshot(actor)),terms.catalogue.packageId,terms.catalogue.version]);
 const lines = [];
 for (const l of terms.lines) {
  const id = randomUUID();
  await tx.sql('INSERT INTO treatment_ledger_lines(id,purchase_id,service_id,service_name_snapshot,service_catalogue_version,purchased_sessions) VALUES($1,$2,$3,$4,$5,$6)', [id,purchaseId,l.serviceId,l.serviceNameSnapshot,l.serviceCatalogueVersion,l.purchasedSessions]);
  lines.push({id,serviceId:l.serviceId,serviceNameSnapshot:l.serviceNameSnapshot,serviceCatalogueVersion:l.serviceCatalogueVersion,purchasedSessions:l.purchasedSessions});
 }
 await addEvent(tx,actor,{commandId,requestHash:commandHash('pos-purchase',patientId,input),type:'purchase',purchaseId,branchId,metadata:{packageName:terms.packageName,purchaseDate:day,notes,lines,catalogue:terms.catalogue,source:'pos'}});
 return purchaseId;
}
