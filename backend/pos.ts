import type express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { db, type RecordTransaction } from './database';
import { currentActor, assertCapability } from './permissions';
import { hasBranchScope, hasGlobalBranchScope, hasCapability } from '../src/permissions';
import { ledgerFail, ledgerDate, ledgerObject, ledgerRecordId, ledgerText, ledgerUuid, ledgerVersion, canViewTreatmentLedger } from '../src/treatmentLedgerPolicy';
import { parsePosDraft, parsePosPayment, invoiceTotal, moneyCents, type PosLineInput } from '../src/posPolicy';
import { appointmentServiceSnapshot } from './appointmentServices';
import { resolveCataloguePurchase } from './packageCatalogue';
import { readAppointmentBookingQuote } from '../src/utils/appointmentBookingQuote';
import { readVisitPriceQuote } from '../src/utils/visitPricingPolicy';
import { appointmentPricingRevision } from '../src/utils/appointmentSpecialPrice';
import { createPosLedgerPurchase } from './treatmentLedger';
import { readVisitBilling, assertInvoiceVisitRelationship } from './visitBilling';
import { readVisitBillingWorklist } from './visitBillingWorklist';
import { readSalesOverview, readSalesRecords } from './salesOverview';
type Actor = Awaited<ReturnType<typeof currentActor>>;
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const who = (a: Actor) => ({ uid: a.identity.uid, name: String(a.profile.fullName || 'Recorded user'), role: a.profile.role });
const scoped = (a: Actor, id: string) => { if (!hasBranchScope(a.profile, id))
    ledgerFail(403, 'BRANCH_FORBIDDEN', 'This clinic is outside your authorized branches.'); };
const version = (actual: number, expected: number) => { if (actual !== expected)
    ledgerFail(409, 'VERSION_CONFLICT', 'This record changed. Reload and review; your unsaved entries have not been applied.'); };
async function record(tx: RecordTransaction, collection: string, id: string) {
    const value = (await tx.get(db.collection(collection).doc(id))).data();
    if (!value)
        ledgerFail(404, 'NOT_FOUND', 'Record not found.');
    return value!;
}
async function context(tx: RecordTransaction, a: Actor, patientId: string, branchId: string) {
    scoped(a, branchId);
    assertCapability(a.profile, 'patients.view');
    const patient = await record(tx, 'patients', patientId), branch = await record(tx, 'branches', branchId);
    if (patient.isArchived || branch.status !== 'Active')
        ledgerFail(409, 'INACTIVE_RECORD', 'Use an active patient and clinic for new invoices.');
    return { patient, branch };
}
function sourceKind(value: unknown): 'visit' | 'appointment' {
    if (value !== 'visit' && value !== 'appointment')
        ledgerFail(400, 'INVALID_SOURCE', 'Select a Visit or appointment quote.');
    return value;
}
function sourceSummary(kind: 'visit' | 'appointment', id: string, saved: Record<string, any>) {
    const quote = kind === 'visit' ? readVisitPriceQuote(saved) : readAppointmentBookingQuote(saved);
    return { id, kind, name: saved.serviceNameSnapshot || saved.visitType || 'Saved quote', date: saved.visitDate || saved.appointmentDate,
        version: kind === 'visit' ? saved.visitVersion ?? 0 : appointmentPricingRevision(saved), price: quote?.total ?? null };
}
async function sourceContext(req: express.Request, tx: RecordTransaction, a: Actor, kind: 'visit' | 'appointment') {
    const branchId = ledgerRecordId(req.query.branchId), patientId = ledgerRecordId(req.query.patientId);
    assertCapability(a.profile, kind === 'visit' ? 'visits.view' : 'appointments.view', { branchId });
    await context(tx, a, patientId, branchId);
    return { branchId, patientId, collection: kind === 'visit' ? 'visits' : 'appointments' };
}
async function resolveLine(tx: RecordTransaction, a: Actor, branchId: string, patientId: string, input: PosLineInput) {
    let name = '', amount: number | null = null, source: any = null, packageTerms: any = null;
    if (input.kind === 'service') {
        assertCapability(a.profile, 'services.view');
        const snapshot = await appointmentServiceSnapshot(tx, { serviceId: input.id, expectedVersion: input.expectedVersion }, branchId);
        const row = (await tx.sql('SELECT COALESCE(b.price_override,s.standard_price)::text AS price FROM services s JOIN service_branch_settings b ON b.service_id=s.id AND b.branch_id=$2 WHERE s.id=$1', [input.id, branchId])).rows[0];
        name = snapshot.serviceNameSnapshot;
        amount = moneyCents(row.price);
        source = snapshot;
    }
    else if (input.kind === 'package') {
        assertCapability(a.profile, 'treatment_ledger.purchase', { branchId });
        if (!canViewTreatmentLedger(a.profile))
            ledgerFail(403, 'FORBIDDEN', 'Package sales require Treatment Ledger viewing permission.');
        const versions = (await tx.sql('SELECT l.service_id,s.version FROM package_catalogue_lines l JOIN services s ON s.id=l.service_id WHERE l.package_id=$1 AND l.version=$2 ORDER BY l.service_id', [input.id, input.expectedVersion])).rows;
        const resolved = await resolveCataloguePurchase(tx, a, branchId, { packageId: input.id, expectedVersion: input.expectedVersion, serviceVersions: versions.map(v => ({ serviceId: v.service_id, expectedServiceVersion: v.version })) });
        const lines = [];
        for (const l of resolved.lines)
            lines.push({ ...l, ...(await appointmentServiceSnapshot(tx, { serviceId: l.serviceId, expectedVersion: l.expectedServiceVersion }, branchId)) });
        packageTerms = { ...resolved, lines };
        name = resolved.packageName;
    }
    else {
        const collection = input.kind === 'visit' ? 'visits' : 'appointments';
        assertCapability(a.profile, input.kind === 'visit' ? 'visits.view' : 'appointments.view', { branchId });
        const saved = await record(tx, collection, input.id);
        if (saved.branchId !== branchId || saved.patientId !== patientId)
            ledgerFail(403, 'SOURCE_SCOPE', 'The selected quote belongs to another patient or clinic.');
        if (saved.isArchived)
            ledgerFail(409, 'SOURCE_ARCHIVED', 'Restore the source record before billing.');
        if (input.kind === 'visit' && (await tx.sql('SELECT 1 FROM treatment_ledger_visit_usage WHERE visit_id=$1', [input.id])).rowCount)
            ledgerFail(409, 'PACKAGE_USAGE', 'This Visit used package sessions and cannot be billed again as a Service.');
        if (input.kind === 'appointment' && (await tx.sql("SELECT 1 FROM app_records WHERE collection_path='visits' AND data->>'appointmentId'=$1 LIMIT 1", [input.id])).rowCount)
            ledgerFail(409, 'USE_VISIT', 'A Visit exists for this appointment. Use its confirmed quote.');
        const sourceVersion = input.kind === 'visit' ? saved.visitVersion ?? 0 : appointmentPricingRevision(saved);
        version(sourceVersion, input.expectedVersion);
        const quote = input.kind === 'visit' ? readVisitPriceQuote(saved) : readAppointmentBookingQuote(saved);
        amount = quote?.total == null ? null : moneyCents(quote.total);
        name = saved.serviceNameSnapshot || saved.visitType || 'Saved booking quote';
        source = { collection, id: input.id, version: sourceVersion, appointmentId: input.kind === 'visit' ? saved.appointmentId || null : input.id, quote };
    }
    const originalAmount = amount;
    if (input.amount !== undefined) {
        const custom = moneyCents(input.amount);
        if (input.kind !== 'package' && custom !== amount) {
            assertCapability(a.profile, 'pos.adjust', { branchId });
            if (!input.reason?.trim())
                ledgerFail(400, 'REASON_REQUIRED', 'Explain the price adjustment.');
        }
        amount = custom;
    }
    if (amount === null)
        ledgerFail(400, 'PRICE_REQUIRED', input.kind === 'package' ? 'Confirm the package selling price.' : 'This record has no saved quote. An Admin must enter and explain its price.');
    return { kind: input.kind, name, amount, snapshot: { input, originalAmount, source, packageTerms } };
}
async function invoice(tx: RecordTransaction, a: Actor, id: string) {
    const i = (await tx.sql('SELECT * FROM pos_invoices WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!i)
        ledgerFail(404, 'NOT_FOUND', 'Invoice not found.');
    scoped(a, i.branch_id);
    return i;
}
async function detail(tx: RecordTransaction, a: Actor, id: string) {
    const i = await invoice(tx, a, id);
    const items = (await tx.sql('SELECT * FROM pos_invoice_items WHERE invoice_id=$1 ORDER BY position', [id])).rows;
    const payments = (await tx.sql(`SELECT p.*,CASE WHEN r.id IS NULL THEN NULL ELSE
        jsonb_build_object('id',r.id,'reason',r.reason,'actor',r.actor,'recorded_at',r.recorded_at) END AS reversal
        FROM pos_payments p LEFT JOIN pos_payment_reversals r ON r.payment_id=p.id
        WHERE p.invoice_id=$1 ORDER BY p.recorded_at,p.id`, [id])).rows;
    const events = (await tx.sql('SELECT * FROM pos_events WHERE invoice_id=$1 ORDER BY recorded_at,id', [id])).rows;
    const paid = Number((await tx.sql('SELECT pos_paid_cents($1) AS paid', [id])).rows[0].paid);
    return { ...i, total_cents: Number(i.total_cents), paid_cents: paid, outstanding_cents: i.state === 'void' ? 0 : Number(i.total_cents) - paid, items, payments, events };
}
async function replay(tx: RecordTransaction, a: Actor, commandId: string, requestHash: string) {
    const row = (await tx.sql('SELECT * FROM pos_events WHERE command_id=$1', [commandId])).rows[0];
    if (!row)
        return null;
    if (row.request_hash !== requestHash || row.actor.uid !== a.identity.uid)
        ledgerFail(409, 'COMMAND_CONFLICT', 'This request identifier was already used for different content.');
    return detail(tx, a, row.invoice_id);
}
async function event(tx: RecordTransaction, a: Actor, id: string, commandId: string, requestHash: string, kind: string, value: any = {}) {
    await tx.sql('INSERT INTO pos_events(id,command_id,invoice_id,request_hash,kind,actor,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)', [randomUUID(), commandId, id, requestHash, kind, JSON.stringify(who(a)), JSON.stringify(value)]);
    const i = await invoice(tx, a, id);
    tx.create(db.collection('audit_logs').doc(), { action: 'UPDATE', resource: 'POS', resourceId: id, branchId: i.branch_id, timestamp: new Date().toISOString(), source: 'trusted_server', eventType: 'pos_' + kind, userId: a.identity.uid, userName: who(a).name, userRole: a.profile.role, details: 'POS ' + kind + ' recorded' });
}
export function mountPos(app: express.Express) {
    const route = (method: 'get' | 'post' | 'patch', path: string, handler: (req: express.Request, tx: RecordTransaction, a: Actor) => Promise<any>) => {
        app[method]('/api/pos' + path, async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            try {
                res.json(await db.runTransaction(async (tx) => { const a = await currentActor(req, tx); assertCapability(a.profile, 'pos.view'); assertCapability(a.profile, 'patients.view'); return handler(req, tx, a); }));
            }
            catch (error: any) {
                if (typeof error.status === 'number')
                    return res.status(error.status).json({ error: error.message, code: error.code || 'FORBIDDEN' });
                if (error.message === 'Unauthorized')
                    return res.status(401).json({ error: 'Please sign in again.' });
                if (error.message === 'Invalid request origin or CSRF token')
                    return res.status(403).json({ error: 'Invalid origin or CSRF token.' });
                if (['23505', '23514', '23503'].includes(error.code))
                    return res.status(409).json({ error: 'This operation conflicts with saved financial history. Reload and review.', code: 'POS_CONFLICT' });
                console.error('POS request failed', error.code || error.name);
                res.status(503).json({ error: 'POS is temporarily unavailable. Retry the same request.', code: 'UNAVAILABLE' });
            }
        });
    };
    route('get', '/branches', async (_req, tx, a) => ({ branches: (await tx.sql("SELECT id,data->>'branchName' AS name,data->>'status' AS status FROM app_records WHERE collection_path='branches' AND ($1 OR id=ANY($2::text[])) ORDER BY lower(data->>'branchName'),id", [hasGlobalBranchScope(a.profile), a.profile.assignedBranches || []])).rows }));
    route('get', '/visit-billing', async (req, tx, a) => readVisitBilling(tx, a, req.query.visitIds));
    route('get', '/visit-billing-worklist', async (req, tx, a) => readVisitBillingWorklist(tx, a, req.query));
    route('get', '/sales-overview', async (req, tx, a) => readSalesOverview(tx, a, req.query));
    route('get', '/sales-records', async (req, tx, a) => readSalesRecords(tx, a, req.query));
    route('get', '/options', async (req, tx, a) => {
        const branchId = ledgerRecordId(req.query.branchId);
        scoped(a, branchId);
        assertCapability(a.profile, 'patients.view');
        const q = ledgerText(req.query.q ?? '', 100, 'Search');
        const patientId = req.query.patientId === undefined || req.query.patientId === '' ? null : ledgerRecordId(req.query.patientId);
        const patients = q.length >= 2 ? (await tx.sql("SELECT id,data->>'name' AS name,data->>'patientID' AS \"patientID\" FROM app_records WHERE collection_path='patients' AND COALESCE(data->>'isArchived','false')<>'true' AND position(lower($1) in lower(COALESCE(data->>'name','')||' '||COALESCE(data->>'patientID','')))>0 ORDER BY lower(data->>'name'),id LIMIT 30", [q])).rows : [];
        const selectedPatient = patientId ? (await tx.sql("SELECT id,data->>'name' AS name,data->>'patientID' AS \"patientID\" FROM app_records WHERE collection_path='patients' AND id=$1 AND COALESCE(data->>'isArchived','false')<>'true'", [patientId])).rows[0] ?? null : null;
        const services = hasCapability(a.profile, 'services.view') ? (await tx.sql("SELECT s.id,s.name,s.version,COALESCE(b.price_override,s.standard_price)::text AS price FROM services s JOIN service_branch_settings b ON b.service_id=s.id AND b.branch_id=$1 WHERE s.active AND b.available AND COALESCE(b.price_override,s.standard_price) IS NOT NULL AND position(lower($2) in lower(s.name))>0 ORDER BY lower(s.name),s.id LIMIT 100", [branchId, String(req.query.itemSearch ?? '').slice(0, 100)])).rows : [];
        const packages = hasCapability(a.profile, 'packages.view') && hasCapability(a.profile, 'services.view') ? (await tx.sql('SELECT p.id,p.version,v.name FROM package_catalogue p JOIN package_catalogue_versions v ON v.package_id=p.id AND v.version=p.version WHERE v.active AND NOT EXISTS (SELECT 1 FROM package_catalogue_lines l JOIN services s ON s.id=l.service_id LEFT JOIN service_branch_settings b ON b.service_id=s.id AND b.branch_id=$2 WHERE l.package_id=p.id AND l.version=p.version AND (NOT s.active OR b.available IS DISTINCT FROM true OR COALESCE(b.price_override,s.standard_price) IS NULL)) AND position(lower($1) in lower(v.name))>0 ORDER BY lower(v.name),p.id LIMIT 100', [String(req.query.itemSearch ?? '').slice(0, 100), branchId])).rows : [];
        const sources: any[] = [];
        if (patientId) {
            for (const collection of ['visits', 'appointments']) {
                if (!hasCapability(a.profile, collection === 'visits' ? 'visits.view' : 'appointments.view', { branchId }))
                    continue;
                const rows = (await tx.sql("SELECT id,data FROM app_records WHERE collection_path=$1 AND data->>'patientId'=$2 AND data->>'branchId'=$3 AND COALESCE(data->>'isArchived','false')<>'true' ORDER BY id LIMIT 100", [collection, patientId, branchId])).rows;
                for (const r of rows)
                    sources.push(sourceSummary(collection === 'visits' ? 'visit' : 'appointment', r.id, r.data));
            }
        }
        return { patients, selectedPatient, services, packages, sources };
    });
    route('get', '/sources', async (req, tx, a) => {
        const kind = sourceKind(req.query.kind), { branchId, patientId, collection } = await sourceContext(req, tx, a, kind);
        const q = ledgerText(req.query.q ?? '', 100, 'Search');
        const page = req.query.page === undefined ? 1 : typeof req.query.page === 'string' ? Number(req.query.page) : NaN;
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
            ledgerFail(400, 'INVALID_PAGE', 'Enter a valid source page.');
        const filter = "collection_path=$1 AND data->>'patientId'=$2 AND data->>'branchId'=$3 AND COALESCE(data->>'isArchived','false')<>'true' AND position(lower($4) in lower(id||' '||COALESCE(data->>'serviceNameSnapshot','')||' '||COALESCE(data->>'visitType','')||' '||COALESCE(data->>'visitDate','')||' '||COALESCE(data->>'appointmentDate','')))>0";
        const params = [collection, patientId, branchId, q];
        const total = Number((await tx.sql('SELECT count(*) FROM app_records WHERE ' + filter, params)).rows[0].count);
        const rows = (await tx.sql('SELECT id,data FROM app_records WHERE ' + filter + " ORDER BY COALESCE(data->>'visitDate',data->>'appointmentDate') DESC NULLS LAST,id DESC LIMIT 50 OFFSET $5", [...params, (page - 1) * 50])).rows;
        return { sources: rows.map(r => sourceSummary(kind, r.id, r.data)), page, total };
    });
    route('get', '/sources/:kind/:id', async (req, tx, a) => {
        const kind = sourceKind(req.params.kind), { branchId, patientId, collection } = await sourceContext(req, tx, a, kind);
        const id = ledgerRecordId(req.params.id), saved = await record(tx, collection, id);
        if (saved.branchId !== branchId || saved.patientId !== patientId)
            ledgerFail(403, 'SOURCE_SCOPE', 'The selected quote belongs to another patient or clinic.');
        if (saved.isArchived)
            ledgerFail(409, 'SOURCE_ARCHIVED', 'Restore the source record before billing.');
        return { source: sourceSummary(kind, id, saved) };
    });
    route('get', '/invoices', async (req, tx, a) => {
        const branchId = req.query.branchId === undefined || req.query.branchId === 'all' || req.query.branchId === 'All' ? null : ledgerRecordId(req.query.branchId);
        if (branchId)
            scoped(a, branchId);
        const patientId = req.query.patientId === undefined ? null : ledgerRecordId(req.query.patientId);
        if (patientId)
            await record(tx, 'patients', patientId); // Historical billing remains readable for archived patients.
        const q = ledgerText(req.query.q ?? '', 100, 'Invoice search');
        const state = req.query.status === undefined ? 'all' : req.query.status;
        if (typeof state !== 'string' || !['all', 'draft', 'unpaid', 'partial', 'paid', 'void', 'outstanding'].includes(state))
            ledgerFail(400, 'INVALID_STATUS', 'Select a valid invoice status.');
        const from = req.query.from === undefined ? null : ledgerDate(req.query.from), to = req.query.to === undefined ? null : ledgerDate(req.query.to);
        if (from && to && from > to)
            ledgerFail(400, 'INVALID_DATE_RANGE', 'The end date must be on or after the start date.');
        const page = req.query.page === undefined ? 1 : typeof req.query.page === 'string' && /^[1-9]\d*$/.test(req.query.page) ? Number(req.query.page) : NaN;
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
            ledgerFail(400, 'INVALID_PAGE', 'Enter a valid invoice page.');
        const scope = '($1::boolean OR i.branch_id=ANY($2::text[])) AND ($3::text IS NULL OR i.branch_id=$3) AND ($4::text IS NULL OR i.patient_id=$4)';
        const params: any[] = [hasGlobalBranchScope(a.profile), a.profile.assignedBranches || [], branchId, patientId];
        // Aggregate each invoice's allocations once. EXISTS searches payment references
        // without multiplying invoice rows or pagination totals by payment count.
        const base = `FROM pos_invoices i LEFT JOIN LATERAL (SELECT pos_paid_cents(i.id) AS paid_cents) p ON true WHERE ${scope}`;
        const statusFilter: Record<string, string> = {
            all: 'true', draft: "i.state='draft'", void: "i.state='void'",
            unpaid: "i.state='posted' AND p.paid_cents=0 AND i.total_cents>0",
            partial: "i.state='posted' AND p.paid_cents>0 AND p.paid_cents<i.total_cents",
            paid: "i.state='posted' AND p.paid_cents=i.total_cents",
            outstanding: "i.state='posted' AND p.paid_cents<i.total_cents"
        };
        const filter = ` AND (${statusFilter[state]})
            AND ($5::text='' OR position(lower($5) in lower(i.patient_name||' '||i.patient_id||' '||i.number::text||' '||COALESCE((SELECT r.data->>'patientID' FROM app_records r WHERE r.collection_path='patients' AND r.id=i.patient_id),'')))>0
                OR EXISTS(SELECT 1 FROM pos_payments payment WHERE payment.invoice_id=i.id AND position(lower($5) in lower(payment.reference))>0))
            AND ($6::date IS NULL OR (i.created_at AT TIME ZONE 'Asia/Manila')::date>=$6::date)
            AND ($7::date IS NULL OR (i.created_at AT TIME ZONE 'Asia/Manila')::date<=$7::date)`;
        const filteredParams = [...params, q, from, to];
        const rows = (await tx.sql(`SELECT i.*,p.paid_cents,CASE WHEN i.state='void' THEN 0 ELSE i.total_cents-p.paid_cents END AS outstanding_cents ${base}${filter} ORDER BY i.created_at DESC,i.id DESC LIMIT 30 OFFSET $8`, [...filteredParams, (page - 1) * 30])).rows;
        const total = Number((await tx.sql(`SELECT count(*) ${base}${filter}`, filteredParams)).rows[0].count);
        const result: Record<string, any> = { invoices: rows.map(i => ({ ...i, total_cents: Number(i.total_cents), paid_cents: Number(i.paid_cents), outstanding_cents: Number(i.outstanding_cents) })), page, total };
        if (patientId) {
            const summary = (await tx.sql(`SELECT COALESCE(sum(i.total_cents),0) AS invoiced,COALESCE(sum(p.paid_cents),0) AS paid,COALESCE(sum(i.total_cents-p.paid_cents),0) AS outstanding ${base} AND i.state='posted'`, params)).rows[0];
            result.summary = { invoicedCents: Number(summary.invoiced), paidCents: Number(summary.paid), outstandingCents: Number(summary.outstanding) };
        }
        return result;
    });
    route('get', '/invoices/:id', async (req, tx, a) => {
        const patientId = req.query.patientId === undefined ? null : ledgerRecordId(req.query.patientId);
        const id = ledgerUuid(req.params.id);
        if (req.query.visitId !== undefined)
            await assertInvoiceVisitRelationship(tx, a, ledgerRecordId(req.query.visitId), id);
        const value = await detail(tx, a, id);
        if (patientId && value.patient_id !== patientId)
            ledgerFail(403, 'PATIENT_SCOPE', 'This invoice belongs to another patient.');
        return value;
    });
    const saveDraft = async (req: express.Request, tx: RecordTransaction, a: Actor) => {
        const p = parsePosDraft(req.body);
        assertCapability(a.profile, 'pos.manage', { branchId: p.branchId });
        const id = req.params.id ? ledgerUuid(req.params.id) : null;
        const requestHash = hash(['draft', id, p]);
        const prior = await replay(tx, a, p.commandId, requestHash);
        if (prior)
            return prior;
        if (id) {
            const i = await invoice(tx, a, id);
            version(i.version, p.expectedVersion);
            if (i.state !== 'draft')
                ledgerFail(409, 'NOT_DRAFT', 'Only drafts may be edited.');
        }
        else
            version(0, p.expectedVersion);
        const ctx = await context(tx, a, p.patientId, p.branchId), lines = [];
        for (const input of p.items)
            lines.push(await resolveLine(tx, a, p.branchId, p.patientId, input));
        const total = invoiceTotal(lines), invoiceId = id || randomUUID();
        if (id) {
            await tx.sql('UPDATE pos_invoices SET patient_id=$2,branch_id=$3,patient_name=$4,branch_name=$5,total_cents=$6,notes=$7,version=version+1 WHERE id=$1', [id, p.patientId, p.branchId, ctx.patient.name, ctx.branch.branchName, total, p.notes]);
            await tx.sql('DELETE FROM pos_invoice_items WHERE invoice_id=$1', [id]);
        }
        else
            await tx.sql('INSERT INTO pos_invoices(id,patient_id,branch_id,patient_name,branch_name,total_cents,notes,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [invoiceId, p.patientId, p.branchId, ctx.patient.name, ctx.branch.branchName, total, p.notes, JSON.stringify(who(a))]);
        for (const [index, l] of lines.entries())
            await tx.sql('INSERT INTO pos_invoice_items(id,invoice_id,position,kind,name,amount_cents,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)', [randomUUID(), invoiceId, index, l.kind, l.name, l.amount, JSON.stringify(l.snapshot)]);
        await event(tx, a, invoiceId, p.commandId, requestHash, 'draft', { total });
        return detail(tx, a, invoiceId);
    };
    route('post', '/invoices', saveDraft);
    route('patch', '/invoices/:id', saveDraft);
    route('post', '/invoices/:id/post', async (req, tx, a) => {
        const p = ledgerObject(req.body, ['commandId', 'expectedVersion']), commandId = ledgerUuid(p.commandId), id = ledgerUuid(req.params.id), expected = ledgerVersion(p.expectedVersion);
        const i = await invoice(tx, a, id);
        assertCapability(a.profile, 'pos.manage', { branchId: i.branch_id });
        const h = hash(['post', id, expected]);
        const prior = await replay(tx, a, commandId, h);
        if (prior)
            return prior;
        version(i.version, expected);
        if (i.state !== 'draft')
            ledgerFail(409, 'NOT_DRAFT', 'This invoice is already posted or void.');
        await context(tx, a, i.patient_id, i.branch_id);
        const lines = (await tx.sql('SELECT * FROM pos_invoice_items WHERE invoice_id=$1 ORDER BY position', [id])).rows;
        for (const l of lines) {
            const resolved = await resolveLine(tx, a, i.branch_id, i.patient_id, l.snapshot.input);
            if (hash(resolved.snapshot) !== hash(l.snapshot) || resolved.amount !== Number(l.amount_cents))
                ledgerFail(409, 'TERMS_CHANGED', 'The quote or catalogue changed. Edit and review the draft before posting.');
            const source = l.snapshot.source;
            if (source?.collection) {
                const claims = [[source.collection, source.id], ...(source.collection === 'visits' && source.appointmentId ? [['appointments', source.appointmentId]] : [])];
                for (const [collection, recordId] of claims)
                    await tx.sql('INSERT INTO pos_source_claims(collection_path,record_id,invoice_id) VALUES($1,$2,$3)', [collection, recordId, id]);
            }
            if (l.kind === 'package') {
                const purchaseId = await createPosLedgerPurchase(tx, a, { patientId: i.patient_id, branchId: i.branch_id, notes: i.notes, terms: l.snapshot.packageTerms });
                await tx.sql('INSERT INTO pos_package_purchases(item_id,purchase_id) VALUES($1,$2)', [l.id, purchaseId]);
            }
        }
        await tx.sql("UPDATE pos_invoices SET state='posted',posted_at=now(),version=version+1 WHERE id=$1", [id]);
        await event(tx, a, id, commandId, h, 'post', { total: Number(i.total_cents) });
        return detail(tx, a, id);
    });
    route('post', '/invoices/:id/payments', async (req, tx, a) => {
        const p = parsePosPayment(req.body), id = ledgerUuid(req.params.id), i = await invoice(tx, a, id);
        assertCapability(a.profile, 'pos.collect', { branchId: i.branch_id });
        const h = hash(['payment', id, p]);
        const prior = await replay(tx, a, p.commandId, h);
        if (prior)
            return prior;
        version(i.version, p.expectedVersion);
        if (i.state !== 'posted')
            ledgerFail(409, 'NOT_POSTED', 'Post this invoice before collecting payment.');
        const paid = Number((await tx.sql('SELECT pos_paid_cents($1) AS paid', [id])).rows[0].paid);
        if (p.amount > Number(i.total_cents) - paid)
            ledgerFail(409, 'OVERPAYMENT', 'Payment exceeds the remaining balance. Cash tender may exceed payment; the excess is change.');
        const paymentId = randomUUID();
        await tx.sql('INSERT INTO pos_payments(id,invoice_id,amount_cents,tender_cents,method,reference,actor) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)', [paymentId, id, p.amount, p.tender, p.method, p.reference, JSON.stringify(who(a))]);
        await tx.sql('UPDATE pos_invoices SET version=version+1 WHERE id=$1', [id]);
        await event(tx, a, id, p.commandId, h, 'payment', { paymentId, amount: p.amount, change: p.tender - p.amount });
        return detail(tx, a, id);
    });
    route('post', '/invoices/:id/payments/:paymentId/reversal', async (req, tx, a) => {
        const p = ledgerObject(req.body, ['commandId', 'expectedVersion', 'reason']);
        const commandId = ledgerUuid(p.commandId), expected = ledgerVersion(p.expectedVersion), reason = ledgerText(p.reason, 1000, 'Correction reason', true);
        const id = ledgerUuid(req.params.id), paymentId = ledgerUuid(req.params.paymentId), i = await invoice(tx, a, id);
        assertCapability(a.profile, 'pos.adjust', { branchId: i.branch_id });
        const h = hash(['payment-reversal', id, paymentId, expected, reason]);
        const prior = await replay(tx, a, commandId, h);
        if (prior)
            return prior;
        version(i.version, expected);
        if (i.state !== 'posted')
            ledgerFail(409, 'NOT_POSTED', 'Only payments on a posted invoice may be corrected.');
        const payment = (await tx.sql('SELECT * FROM pos_payments WHERE id=$1 AND invoice_id=$2', [paymentId, id])).rows[0];
        if (!payment)
            ledgerFail(404, 'PAYMENT_NOT_FOUND', 'Payment not found on this invoice.');
        if ((await tx.sql('SELECT 1 FROM pos_payment_reversals WHERE payment_id=$1', [paymentId])).rowCount)
            ledgerFail(409, 'PAYMENT_ALREADY_REVERSED', 'This payment entry has already been reversed.');
        if ((await tx.sql("SELECT 1 FROM pos_package_purchases p JOIN pos_invoice_items i ON i.id=p.item_id JOIN treatment_ledger_events e ON e.purchase_id=p.purchase_id WHERE i.invoice_id=$1 AND e.type IN ('usage','adjustment') LIMIT 1", [id])).rowCount)
            ledgerFail(409, 'PACKAGE_USED', 'Package usage or adjustment history prevents this payment correction. Existing sessions and history must be preserved.');
        const reversalId = randomUUID();
        await tx.sql('INSERT INTO pos_payment_reversals(id,payment_id,command_id,reason,actor) VALUES($1,$2,$3,$4,$5::jsonb)', [reversalId, paymentId, commandId, reason, JSON.stringify(who(a))]);
        await tx.sql('UPDATE pos_invoices SET version=version+1 WHERE id=$1', [id]);
        await event(tx, a, id, commandId, h, 'payment-reversal', { reversalId, paymentId, amount: Number(payment.amount_cents), reason });
        return detail(tx, a, id);
    });
    route('post', '/invoices/:id/void', async (req, tx, a) => {
        const p = ledgerObject(req.body, ['commandId', 'expectedVersion', 'reason']), commandId = ledgerUuid(p.commandId), id = ledgerUuid(req.params.id), expected = ledgerVersion(p.expectedVersion), reason = ledgerText(p.reason, 1000, 'Void reason', true);
        const i = await invoice(tx, a, id);
        assertCapability(a.profile, 'pos.adjust', { branchId: i.branch_id });
        const h = hash(['void', id, expected, reason]);
        const prior = await replay(tx, a, commandId, h);
        if (prior)
            return prior;
        version(i.version, expected);
        if (i.state === 'void' || (await tx.sql('SELECT 1 FROM pos_payments WHERE invoice_id=$1', [id])).rowCount)
            ledgerFail(409, 'CANNOT_VOID', 'Only invoices without recorded payment history may be voided. A payment correction preserves that history.');
        // A free package may already have been redeemed; never strand that history.
        if ((await tx.sql("SELECT 1 FROM pos_package_purchases p JOIN pos_invoice_items i ON i.id=p.item_id JOIN treatment_ledger_events e ON e.purchase_id=p.purchase_id WHERE i.invoice_id=$1 AND e.type IN ('usage','adjustment') LIMIT 1", [id])).rowCount)
            ledgerFail(409, 'PACKAGE_USED', 'Package history prevents voiding this invoice.');
        await tx.sql("UPDATE pos_invoices SET state='void',version=version+1 WHERE id=$1", [id]);
        await tx.sql('DELETE FROM pos_source_claims WHERE invoice_id=$1', [id]);
        await event(tx, a, id, commandId, h, 'void', { reason });
        return detail(tx, a, id);
    });
    route('patch', '/invoices/:id/reference', async (req, tx, a) => {
        const p = ledgerObject(req.body, ['commandId', 'expectedVersion', 'orNumber']), commandId = ledgerUuid(p.commandId), id = ledgerUuid(req.params.id), expected = ledgerVersion(p.expectedVersion), orNumber = ledgerText(p.orNumber ?? '', 120, 'OR number');
        const i = await invoice(tx, a, id);
        assertCapability(a.profile, 'treatment_ledger.reference', { branchId: i.branch_id });
        const h = hash(['reference', id, expected, orNumber]);
        const prior = await replay(tx, a, commandId, h);
        if (prior)
            return prior;
        version(i.version, expected);
        if (i.state === 'void')
            ledgerFail(409, 'VOID_INVOICE', 'Voided invoice references are retained.');
        await tx.sql('UPDATE pos_invoices SET or_number=$2,version=version+1 WHERE id=$1', [id, orNumber || null]);
        await event(tx, a, id, commandId, h, 'reference', { before: i.or_number, after: orNumber || null });
        return detail(tx, a, id);
    });
    route('get', '/sales', async (req, tx, a) => {
        assertCapability(a.profile, 'pos.sales');
        const from = ledgerDate(req.query.from), to = ledgerDate(req.query.to);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || from > to)
            ledgerFail(400, 'DATE_RANGE', 'Choose a valid date range.');
        const branchId = req.query.branchId ? ledgerRecordId(req.query.branchId) : null;
        if (branchId)
            scoped(a, branchId);
        const branches = (await tx.sql("SELECT id,data->>'branchName' AS name FROM app_records WHERE collection_path='branches' AND ($1 OR id=ANY($2::text[])) AND ($3::text IS NULL OR id=$3) ORDER BY id", [hasGlobalBranchScope(a.profile), a.profile.assignedBranches || [], branchId])).rows;
        const rows = [];
        for (const b of branches) {
            const sales = Number((await tx.sql("SELECT COALESCE(sum(total_cents),0) AS total FROM pos_invoices WHERE branch_id=$1 AND state='posted' AND (posted_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $2::date AND $3::date", [b.id, from, to])).rows[0].total);
            const received = Number((await tx.sql("SELECT COALESCE(sum(p.amount_cents),0) AS total FROM pos_payments p JOIN pos_invoices i ON i.id=p.invoice_id WHERE i.branch_id=$1 AND (p.recorded_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $2::date AND $3::date", [b.id, from, to])).rows[0].total);
            const reversed = Number((await tx.sql("SELECT COALESCE(sum(p.amount_cents),0) AS total FROM pos_payment_reversals r JOIN pos_payments p ON p.id=r.payment_id JOIN pos_invoices i ON i.id=p.invoice_id WHERE i.branch_id=$1 AND (r.recorded_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $2::date AND $3::date", [b.id, from, to])).rows[0].total);
            const collected = received - reversed;
            const outstanding = Number((await tx.sql("SELECT COALESCE(sum(i.total_cents-pos_paid_cents(i.id)),0) AS total FROM pos_invoices i WHERE branch_id=$1 AND state='posted'", [b.id])).rows[0].total);
            rows.push({ id: b.id, name: b.name, sales, received, reversed, collected, outstanding });
        }
        return { from, to, timezone: 'Asia/Manila', branches: rows, totals: rows.reduce((s, r) => ({ sales: s.sales + r.sales, received: s.received + r.received, reversed: s.reversed + r.reversed, collected: s.collected + r.collected, outstanding: s.outstanding + r.outstanding }), { sales: 0, received: 0, reversed: 0, collected: 0, outstanding: 0 }) };
    });
}
