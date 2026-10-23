import type { RecordTransaction } from './database';
import { assertCapability, type currentActor } from './permissions';
import { hasCapability } from '../src/permissions';
import { ledgerFail, ledgerRecordId } from '../src/treatmentLedgerPolicy';
import type { VisitBillingInvoice, VisitBillingSummary } from '../src/utils/visitBilling';
import { readVisitPriceQuote } from '../src/utils/visitPricingPolicy';

type Actor = Awaited<ReturnType<typeof currentActor>>;
const snapshotRelation = `(item.snapshot->'source'->>'collection'='visits' AND item.snapshot->'source'->>'id'=v.visit_id)
          OR (v.appointment_id IS NOT NULL AND
            ((item.snapshot->'source'->>'collection'='appointments' AND item.snapshot->'source'->>'id'=v.appointment_id)
              OR (item.snapshot->'source'->>'collection'='visits' AND item.snapshot->'source'->>'appointmentId'=v.appointment_id)))`;
const claimRelation = `(c.collection_path='visits' AND c.record_id=v.visit_id)
          OR (c.collection_path='appointments' AND c.record_id=v.appointment_id)`;

export async function assertInvoiceVisitRelationship(tx: RecordTransaction, actor: Actor, visitId: string, invoiceId: string) {
    assertCapability(actor.profile, 'visits.view');
    const visit = (await tx.sql("SELECT data FROM app_records WHERE collection_path='visits' AND id=$1", [visitId])).rows[0]?.data;
    if (!visit) ledgerFail(404, 'NOT_FOUND', 'Visit not found.');
    assertCapability(actor.profile, 'visits.view', { branchId: ledgerRecordId(visit.branchId) });
    const linked = (await tx.sql(`WITH v AS (SELECT $1::text AS visit_id,$2::text AS appointment_id)
        SELECT 1 FROM pos_invoices i CROSS JOIN v WHERE i.id=$3 AND i.patient_id=$4 AND i.branch_id=$5 AND
          (EXISTS(SELECT 1 FROM pos_source_claims c WHERE c.invoice_id=i.id AND (${claimRelation}))
            OR EXISTS(SELECT 1 FROM pos_invoice_items item WHERE item.invoice_id=i.id AND (${snapshotRelation})))`,
        [visitId, typeof visit.appointmentId === 'string' ? visit.appointmentId : null, invoiceId, visit.patientId, visit.branchId])).rowCount;
    if (!linked) ledgerFail(403, 'VISIT_INVOICE_SCOPE', 'This invoice is not linked to this Visit.');
}

// A page-sized, read-only projection. Authorize the complete clinical set before
// consulting any invoice, claim or package record; mixed-scope requests fail closed.
export async function readVisitBilling(tx: RecordTransaction, actor: Actor, value: unknown): Promise<{ visits: VisitBillingSummary[] }> {
    if (typeof value !== 'string')
        ledgerFail(400, 'INVALID_VISIT_IDS', 'Select between 1 and 50 unique Visits.');
    const ids = value.split(',');
    if (ids.length > 50 || new Set(ids).size !== ids.length)
        ledgerFail(400, 'INVALID_VISIT_IDS', 'Select between 1 and 50 unique Visits.');
    ids.forEach(ledgerRecordId);
    assertCapability(actor.profile, 'visits.view');
    const saved = (await tx.sql("SELECT id,data FROM app_records WHERE collection_path='visits' AND id=ANY($1::text[])", [ids])).rows;
    const visits = new Map(saved.map(row => [row.id, row.data]));
    for (const id of ids) {
        const visit = visits.get(id);
        if (!visit) ledgerFail(404, 'NOT_FOUND', 'Visit not found.');
        assertCapability(actor.profile, 'visits.view', { branchId: ledgerRecordId(visit.branchId) });
        ledgerRecordId(visit.patientId);
    }
    const requested = ids.map(id => {
        const visit = visits.get(id)!;
        const quote = readVisitPriceQuote(visit);
        return { visit_id: id, patient_id: visit.patientId, branch_id: visit.branchId,
            appointment_id: typeof visit.appointmentId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(visit.appointmentId) ? visit.appointmentId : null,
            visit_version: visit.visitVersion ?? 0, visit_quote: quote?.total != null ? quote : null };
    });
    const scopes = JSON.stringify(requested);
    const usage = (await tx.sql(`SELECT u.visit_id,p.patient_id,u.visit_snapshot->>'patientId' AS snapshot_patient_id,u.visit_snapshot->>'branchId' AS branch_id
        FROM treatment_ledger_visit_usage u JOIN treatment_ledger_lines l ON l.id=u.line_id
        JOIN treatment_ledger_purchases p ON p.id=l.purchase_id WHERE u.visit_id=ANY($1::text[])`, [ids])).rows;
    const usageByVisit = new Map(usage.map(row => [row.visit_id, row]));
    const records = (await tx.sql(`WITH requested AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS v(visit_id text,patient_id text,branch_id text,appointment_id text,visit_version jsonb,visit_quote jsonb)
      ), snapshot_links AS (
        SELECT v.visit_id,item.invoice_id,sum(item.amount_cents) AS visit_line_cents,count(*) AS linked_count,
          count(*) FILTER(WHERE item.snapshot->'source'->>'collection'='visits' AND item.snapshot->'source'->>'id'=v.visit_id) AS direct_count,
          bool_and(item.snapshot->'source'->>'collection'='visits' AND item.snapshot->'source'->>'id'=v.visit_id
            AND v.visit_quote IS NOT NULL AND item.snapshot->'source'->'version'=v.visit_version
            AND item.snapshot->'source'->'quote'=v.visit_quote) AS quote_comparable
        FROM requested v JOIN pos_invoice_items item ON
          ${snapshotRelation}
        GROUP BY v.visit_id,item.invoice_id
      ), claim_links AS (
        SELECT DISTINCT v.visit_id,c.invoice_id FROM requested v JOIN pos_source_claims c ON
          ${claimRelation}
      ), links AS (
        SELECT visit_id,invoice_id FROM snapshot_links UNION SELECT visit_id,invoice_id FROM claim_links
      ), related AS (
        SELECT l.visit_id,i.*,COALESCE(s.visit_line_cents,0) AS visit_line_cents,
          CASE WHEN s.invoice_id IS NULL THEN 'unavailable' WHEN s.direct_count=s.linked_count THEN 'visit'
            WHEN s.direct_count=0 THEN 'linked_booking' ELSE 'mixed' END AS visit_amount_source,
          COALESCE(s.linked_count=1 AND s.quote_comparable,false) AS visit_quote_comparable,
          i.patient_id=v.patient_id AND i.branch_id=v.branch_id AS compatible,c.invoice_id IS NOT NULL AS claimed
        FROM links l JOIN requested v ON v.visit_id=l.visit_id JOIN pos_invoices i ON i.id=l.invoice_id
        LEFT JOIN snapshot_links s ON s.visit_id=l.visit_id AND s.invoice_id=l.invoice_id
        LEFT JOIN claim_links c ON c.visit_id=l.visit_id AND c.invoice_id=l.invoice_id
      ), flags AS (
        SELECT visit_id,bool_or(NOT compatible) AS unavailable,
          bool_or(state IN ('posted','draft') OR claimed) AS active FROM related GROUP BY visit_id
      ), ranked AS (
        SELECT r.*,row_number() OVER(PARTITION BY visit_id ORDER BY CASE state WHEN 'posted' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,created_at DESC,id DESC) AS rank
        FROM related r WHERE compatible
      )
      SELECT v.visit_id,COALESCE(f.unavailable,false) AS unavailable,COALESCE(f.active,false) AS active,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'number',r.number,'state',r.state,
          'totalCents',r.total_cents,'paidCents',pos_paid_cents(r.id),
          'outstandingCents',CASE WHEN r.state='void' THEN 0 ELSE r.total_cents-pos_paid_cents(r.id) END,
          'visitLineCents',r.visit_line_cents,'visitAmountSource',r.visit_amount_source,
          'visitQuoteComparable',r.visit_quote_comparable) ORDER BY r.rank) FROM ranked r WHERE r.visit_id=v.visit_id AND r.rank<=21),'[]'::jsonb) AS invoices
      FROM requested v LEFT JOIN flags f ON f.visit_id=v.visit_id`, [scopes])).rows;
    const byVisit = new Map(records.map(row => [row.visit_id, row]));
    // Missing/archived related records preserve history but cannot start new billing.
    const contexts = (await tx.sql(`SELECT v.visit_id,p.data AS patient,b.data AS branch
        FROM jsonb_to_recordset($1::jsonb) AS v(visit_id text,patient_id text,branch_id text,appointment_id text)
        LEFT JOIN app_records p ON p.collection_path='patients' AND p.id=v.patient_id
        LEFT JOIN app_records b ON b.collection_path='branches' AND b.id=v.branch_id`, [scopes])).rows;
    const contextByVisit = new Map(contexts.map(row => [row.visit_id, row]));
    return { visits: ids.map(visitId => {
        const visit = visits.get(visitId)!, row = byVisit.get(visitId)!, context = contextByVisit.get(visitId)!;
        const used = usageByVisit.get(visitId);
        const billingUnavailable = row.unavailable || !!used && (used.patient_id !== visit.patientId || used.snapshot_patient_id !== visit.patientId || used.branch_id !== visit.branchId);
        const allInvoices: VisitBillingInvoice[] = row.invoices.map((i: Omit<VisitBillingInvoice, 'paymentStatus'>) => ({ ...i,
            paymentStatus: i.state !== 'posted' ? null : i.paidCents === i.totalCents ? 'paid' : i.paidCents > 0 ? 'partial' : 'unpaid' }));
        return { visitId, packageSessionUsed: !!used, invoices: allInvoices.slice(0, 20), hasMoreInvoices: allInvoices.length > 20,
            billingUnavailable, canCreateInvoice: !billingUnavailable && !used && !row.active && !visit.isArchived
                && !!context.patient && !context.patient.isArchived && context.branch?.status === 'Active'
                && hasCapability(actor.profile, 'pos.manage', { branchId: visit.branchId }) };
    }) };
}
