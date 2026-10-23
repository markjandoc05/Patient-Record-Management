import type { RecordTransaction } from './database';
import { assertCapability, type currentActor } from './permissions';
import { hasGlobalBranchScope } from '../src/permissions';
import { ledgerFail, ledgerRecordId, ledgerText } from '../src/treatmentLedgerPolicy';
import { readVisitPriceQuote } from '../src/utils/visitPricingPolicy';
import type { VisitBillingSummary } from '../src/utils/visitBilling';
import type { VisitBillingWorklistFilter, VisitBillingWorklistResponse, VisitBillingWorklistStatus } from '../src/utils/visitBillingWorklist';
import { readVisitBilling } from './visitBilling';

type Actor = Awaited<ReturnType<typeof currentActor>>;
const recordIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const filters: VisitBillingWorklistFilter[] = ['attention', 'unbilled', 'draft', 'missing_price', 'package', 'billed', 'all'];

// Match readVisitPriceQuote's canonical amount strings. An absent, malformed or
// identity-mismatched historical quote must never become a zero-priced Visit.
const amountChecks = ['servicePrice', 'specialPrice', 'total'].map(key => `(
  v.quote->'${key}'='null'::jsonb OR
  (jsonb_typeof(v.quote->'${key}')='string' AND v.quote->>'${key}' ~ '^(0|[1-9][0-9]{0,9})[.][0-9]{2}$')
)`).join(' AND ');
const validQuote = `jsonb_typeof(v.quote)='object'
  AND v.quote->'version'='1'::jsonb AND v.quote->>'currency'='PHP'
  AND v.quote->'branchId'=v.quote_record->'branchId'
  AND jsonb_typeof(v.quote->'serviceId') NOT IN ('object','array')
  AND jsonb_typeof(v.quote->'serviceCatalogueVersion') NOT IN ('object','array')
  AND v.quote->'serviceId'=v.quote_record->'serviceId'
  AND v.quote->'serviceCatalogueVersion'=v.quote_record->'serviceCatalogueVersion'
  AND ${amountChecks}
  AND v.quote->'total'=CASE WHEN v.quote->'specialPrice'<>'null'::jsonb THEN v.quote->'specialPrice' ELSE v.quote->'servicePrice' END
  AND v.quote->>'source'=CASE WHEN v.quote->'specialPrice'<>'null'::jsonb THEN 'special'
    WHEN v.quote->'servicePrice'<>'null'::jsonb THEN 'service' ELSE 'unset' END`;

/** Read-only completed-Visit queue. Status/search filtering precedes pagination. */
export async function readVisitBillingWorklist(
  tx: RecordTransaction, actor: Actor, query: Record<string, unknown>,
): Promise<VisitBillingWorklistResponse> {
  assertCapability(actor.profile, 'pos.view');
  assertCapability(actor.profile, 'patients.view');
  assertCapability(actor.profile, 'visits.view');
  const branchId = query.branchId === undefined || query.branchId === 'all' || query.branchId === 'All'
    ? null : ledgerRecordId(query.branchId);
  if (branchId) assertCapability(actor.profile, 'visits.view', { branchId });
  const q = ledgerText(query.q ?? '', 100, 'Visit search');
  const status = query.status ?? 'attention';
  if (typeof status !== 'string' || !filters.includes(status as VisitBillingWorklistFilter))
    ledgerFail(400, 'INVALID_VISIT_BILLING_FILTER', 'Choose a valid Visit billing status.');
  const page = query.page === undefined ? 1 : typeof query.page === 'string' ? Number(query.page) : NaN;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    ledgerFail(400, 'INVALID_PAGE', 'Enter a valid Visit billing page.');

  // Only source IDs explicitly frozen on invoice lines/claims establish a link.
  // Matching patient, Service name or price must never imply a Visit was billed.
  // The projected quote_record deliberately excludes clinical notes and findings.
  const result = (await tx.sql(`WITH scoped AS MATERIALIZED (
    SELECT r.id AS visit_id,r.data->>'patientId' AS patient_id,r.data->>'branchId' AS branch_id,
      CASE WHEN jsonb_typeof(r.data->'appointmentId')='string' AND r.data->>'appointmentId' ~ '^[A-Za-z0-9_-]{1,128}$'
        THEN r.data->>'appointmentId' ELSE NULL END AS appointment_id,
      COALESCE(p.data->>'name',r.data->>'patientName','Unnamed patient') AS patient_name,
      COALESCE(p.data->>'patientID','') AS patient_number,
      COALESCE(b.data->>'branchName','Clinic unavailable') AS branch_name,
      COALESCE(r.data->>'visitDate','') AS visit_date,
      COALESCE(CASE WHEN NULLIF(r.data->>'serviceId','') IS NOT NULL THEN NULLIF(r.data->>'serviceNameSnapshot','') END,
        NULLIF(r.data->>'treatmentService',''),NULLIF(r.data->>'servicePerformed',''),r.data->>'visitType','Clinic visit') AS service_name,
      jsonb_build_object('branchId',r.data->'branchId','serviceId',r.data->'serviceId',
        'serviceCatalogueVersion',r.data->'serviceCatalogueVersion','visitQuote',r.data->'visitQuote') AS quote_record,
      r.data->'visitQuote' AS quote,
      COALESCE(r.id ~ '^[A-Za-z0-9_-]{1,128}$' AND jsonb_typeof(r.data->'patientId')='string'
        AND r.data->>'patientId' ~ '^[A-Za-z0-9_-]{1,128}$',false) AS valid_record_ids,
      p.id IS NOT NULL AND COALESCE(p.data->>'isArchived','false')<>'true'
        AND b.data->>'status'='Active' AS active_context
    FROM app_records r
    LEFT JOIN app_records p ON p.collection_path='patients' AND p.id=r.data->>'patientId'
    LEFT JOIN app_records b ON b.collection_path='branches' AND b.id=r.data->>'branchId'
    WHERE r.collection_path='visits' AND r.data->>'status'='Completed'
      AND COALESCE(r.data->>'isArchived','false')<>'true'
      AND jsonb_typeof(r.data->'branchId')='string' AND r.data->>'branchId' ~ '^[A-Za-z0-9_-]{1,128}$'
      AND ($1::boolean OR r.data->>'branchId'=ANY($2::text[]))
      AND ($3::text IS NULL OR r.data->>'branchId'=$3)
      AND position(lower($4) in lower(concat_ws(' ',r.id,p.data->>'name',r.data->>'patientName',
        p.data->>'patientID',r.data->>'serviceNameSnapshot',r.data->>'treatmentService',r.data->>'servicePerformed',r.data->>'visitType')))>0
  ), snapshot_links AS (
    SELECT DISTINCT v.visit_id,item.invoice_id
    FROM scoped v JOIN pos_invoice_items item ON
      (item.snapshot->'source'->>'collection'='visits' AND item.snapshot->'source'->>'id'=v.visit_id)
      OR (v.appointment_id IS NOT NULL AND
        ((item.snapshot->'source'->>'collection'='appointments' AND item.snapshot->'source'->>'id'=v.appointment_id)
          OR (item.snapshot->'source'->>'collection'='visits' AND item.snapshot->'source'->>'appointmentId'=v.appointment_id)))
  ), claim_links AS (
    SELECT DISTINCT v.visit_id,c.invoice_id FROM scoped v JOIN pos_source_claims c ON
      (c.collection_path='visits' AND c.record_id=v.visit_id)
      OR (c.collection_path='appointments' AND c.record_id=v.appointment_id)
  ), links AS (
    SELECT visit_id,invoice_id FROM snapshot_links UNION SELECT visit_id,invoice_id FROM claim_links
  ), billing_flags AS (
    SELECT l.visit_id,
      bool_or(i.patient_id IS DISTINCT FROM v.patient_id OR i.branch_id IS DISTINCT FROM v.branch_id) AS unavailable,
      bool_or(i.state='posted') AS posted,bool_or(i.state='draft') AS draft,
      bool_or(c.invoice_id IS NOT NULL) AS claimed
    FROM links l JOIN scoped v ON v.visit_id=l.visit_id JOIN pos_invoices i ON i.id=l.invoice_id
    LEFT JOIN claim_links c ON c.visit_id=l.visit_id AND c.invoice_id=l.invoice_id GROUP BY l.visit_id
  ), usage_flags AS (
    SELECT v.visit_id,
      p.patient_id IS DISTINCT FROM v.patient_id OR u.visit_snapshot->>'patientId' IS DISTINCT FROM v.patient_id
        OR u.visit_snapshot->>'branchId' IS DISTINCT FROM v.branch_id AS unavailable
    FROM scoped v JOIN treatment_ledger_visit_usage u ON u.visit_id=v.visit_id
    JOIN treatment_ledger_lines l ON l.id=u.line_id JOIN treatment_ledger_purchases p ON p.id=l.purchase_id
  ), classified AS (
    SELECT v.*,CASE
      WHEN NOT v.valid_record_ids OR COALESCE(f.unavailable,false) OR COALESCE(u.unavailable,false) THEN 'review'
      WHEN u.visit_id IS NOT NULL THEN 'package'
      WHEN COALESCE(f.posted,false) THEN 'billed'
      WHEN COALESCE(f.draft,false) THEN 'draft'
      WHEN COALESCE(f.claimed,false) OR NOT COALESCE(v.active_context,false) THEN 'review'
      WHEN NOT COALESCE((${validQuote}) AND v.quote->'total'<>'null'::jsonb,false) THEN 'missing_price'
      ELSE 'unbilled' END AS status
    FROM scoped v LEFT JOIN billing_flags f ON f.visit_id=v.visit_id LEFT JOIN usage_flags u ON u.visit_id=v.visit_id
  ), matched AS (
    SELECT * FROM classified WHERE $5::text='all' OR status=$5
      OR ($5='attention' AND status IN ('unbilled','draft','missing_price','review'))
  ), page_rows AS (
    SELECT * FROM matched ORDER BY visit_date DESC,visit_id DESC LIMIT 25 OFFSET $6
  )
  SELECT (SELECT count(*) FROM matched)::text AS total,
    COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.visit_date DESC,p.visit_id DESC) FROM page_rows p),'[]'::jsonb) AS visits`,
  [hasGlobalBranchScope(actor.profile), Array.isArray(actor.profile.assignedBranches) ? actor.profile.assignedBranches : [],
    branchId, q, status, (page - 1) * 25])).rows[0];

  const rows: Record<string, any>[] = result.visits;
  const readableIds = rows.filter(row => row.valid_record_ids && recordIdPattern.test(row.visit_id)).map(row => row.visit_id);
  const current = readableIds.length ? (await readVisitBilling(tx, actor, readableIds.join(','))).visits : [];
  const summaries = new Map(current.map(summary => [summary.visitId, summary]));
  return {
    page, pageSize: 25, total: Number(result.total),
    visits: rows.map(row => {
      const quoteTotal = readVisitPriceQuote(row.quote_record)?.total ?? null;
      const summary: VisitBillingSummary = summaries.get(row.visit_id) ?? {
        visitId: row.visit_id, invoices: [], packageSessionUsed: false, hasMoreInvoices: false,
        billingUnavailable: true, canCreateInvoice: false,
      };
      const responseStatus: VisitBillingWorklistStatus = summary.billingUnavailable ? 'review' : row.status;
      return {
        id: row.visit_id, patientId: row.patient_id ?? '', patientName: row.patient_name,
        patientNumber: row.patient_number, branchId: row.branch_id, branchName: row.branch_name,
        visitDate: row.visit_date, serviceName: row.service_name, quoteTotal, status: responseStatus,
        summary: { ...summary, canCreateInvoice: summary.canCreateInvoice && quoteTotal !== null && responseStatus === 'unbilled' },
      };
    }),
  };
}
