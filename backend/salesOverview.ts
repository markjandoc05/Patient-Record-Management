import type express from 'express';
import type { RecordTransaction } from './database';
import { assertCapability, type currentActor } from './permissions';
import { hasBranchScope, hasCapability, hasGlobalBranchScope } from '../src/permissions';
import { ledgerFail, ledgerRecordId } from '../src/treatmentLedgerPolicy';
import { salesSourceKinds, type SalesBranch, type SalesMetrics, type SalesOverviewData, type SalesPeriodMetrics, type SalesRecordKind, type SalesRecordsData, type SalesSourceKind, type SalesSourceTotal, type SalesRecordSource } from '../src/utils/salesOverview';

type Actor = Awaited<ReturnType<typeof currentActor>>;
const DAY = 86400000;
const METHODS = ['cash', 'card', 'gcash', 'bank'] as const;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const PAGE_SIZE = 25;
// Categorize each frozen invoice line once. A later Visit does not rewrite an
// earlier appointment sale, and package session usage never creates sales.
const sourceKindSql = `CASE
    WHEN item.kind='visit' AND item.snapshot->'source'->>'collection'='visits' AND NULLIF(item.snapshot->'source'->>'id','') IS NOT NULL THEN 'visit'
    WHEN item.kind='appointment' AND item.snapshot->'source'->>'collection'='appointments' AND NULLIF(item.snapshot->'source'->>'id','') IS NOT NULL THEN 'appointment'
    WHEN item.kind='service' THEN 'service'
    WHEN item.kind='package' THEN 'package'
    ELSE 'unclassified' END`;
function sourceTotals(rows: Record<string, unknown>[]): SalesSourceTotal[] {
    const byKind = new Map(rows.map(row => [row.kind, row]));
    return salesSourceKinds.map(kind => ({ kind, sales: safe(integer(byKind.get(kind)?.sales ?? '0')),
        lineCount: safe(integer(byKind.get(kind)?.lineCount ?? '0')) }));
}
function reconciles(sources: SalesSourceTotal[], total: number) {
    if (sources.reduce((sum, source) => sum + BigInt(source.sales), 0n) !== BigInt(total))
        ledgerFail(503, 'SALES_RECONCILIATION', 'Invoice items do not reconcile to this report. Contact an Admin before using these totals.');
}


function date(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31')
        ledgerFail(400, 'DATE_RANGE', 'Choose a valid start and end date.');
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
        ledgerFail(400, 'DATE_RANGE', 'Choose a valid start and end date.');
    return value;
}

function scope(query: express.Request['query'], actor: Actor) {
    assertCapability(actor.profile, 'pos.sales');
    const from = date(query.from), to = date(query.to);
    const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
    const days = (end - start) / DAY + 1;
    if (days < 1 || days > 366)
        ledgerFail(400, 'DATE_RANGE', 'Choose a date range of up to 366 days.');
    const previousFrom = new Date(start - days * DAY).toISOString().slice(0, 10);
    const previousTo = new Date(start - DAY).toISOString().slice(0, 10);
    const branchId = query.branchId === undefined || query.branchId === '' ? null : ledgerRecordId(query.branchId);
    if (branchId && !hasBranchScope(actor.profile, branchId))
        ledgerFail(403, 'BRANCH_FORBIDDEN', 'This clinic is outside your authorized branches.');
    return { from, to, previousFrom, previousTo, branchId,
        values: [hasGlobalBranchScope(actor.profile), actor.profile.assignedBranches || [], branchId, from, to, previousFrom] };
}

// Never let PostgreSQL numeric/JSON conversion round a financial aggregate before
// checking it. SQL emits integer strings; arithmetic and averages stay exact here.
function integer(value: unknown): bigint {
    if (typeof value !== 'string' || !/^-?\d+$/.test(value))
        ledgerFail(503, 'SALES_UNAVAILABLE', 'Sales totals are temporarily unavailable.');
    return BigInt(value);
}
function safe(value: bigint): number {
    if (value > MAX_SAFE || value < -MAX_SAFE)
        ledgerFail(503, 'SALES_LIMIT', 'This total is too large to display accurately. Choose a smaller clinic or date range.');
    return Number(value);
}
function period(row: Record<string, unknown>): SalesPeriodMetrics {
    const sales = integer(row.sales), received = integer(row.received), reversed = integer(row.reversed), count = integer(row.invoiceCount);
    return { sales: safe(sales), received: safe(received), reversed: safe(reversed), collected: safe(received - reversed),
        invoiceCount: safe(count), averageInvoiceCents: safe(count ? (sales + count / 2n) / count : 0n) };
}
function metrics(row: Record<string, unknown>): SalesMetrics {
    return { ...period(row), outstanding: safe(integer(row.outstanding)) };
}

const branchScope = `branches AS (
    SELECT id,COALESCE(NULLIF(data->>'branchName',''),id) AS name
    FROM app_records WHERE collection_path='branches'
      AND ($1::boolean OR id=ANY($2::text[])) AND ($3::text IS NULL OR id=$3)
)`;

// All report projections share one PostgreSQL statement snapshot. Scope is
// applied before financial aggregation; every authorized branch remains visible
// even when it has no activity. Only posted invoices create sales: package
// session redemptions, quotes and drafts never enter this projection.
export async function readSalesOverview(tx: RecordTransaction, actor: Actor, query: express.Request['query']): Promise<SalesOverviewData> {
    const selected = scope(query, actor);
    const row = (await tx.sql(`WITH ${branchScope}, events AS (
        SELECT i.branch_id,(i.posted_at AT TIME ZONE 'Asia/Manila')::date AS day,
          'sales'::text AS kind,NULL::text AS method,i.total_cents AS amount
        FROM pos_invoices i JOIN branches b ON b.id=i.branch_id
        WHERE i.state='posted' AND i.posted_at >= ($6::date::timestamp AT TIME ZONE 'Asia/Manila')
          AND i.posted_at < (($5::date+1)::timestamp AT TIME ZONE 'Asia/Manila')
        UNION ALL
        SELECT i.branch_id,(p.recorded_at AT TIME ZONE 'Asia/Manila')::date,'payments',p.method,p.amount_cents
        FROM pos_payments p JOIN pos_invoices i ON i.id=p.invoice_id JOIN branches b ON b.id=i.branch_id
        WHERE p.recorded_at >= ($6::date::timestamp AT TIME ZONE 'Asia/Manila')
          AND p.recorded_at < (($5::date+1)::timestamp AT TIME ZONE 'Asia/Manila')
        UNION ALL
        SELECT i.branch_id,(r.recorded_at AT TIME ZONE 'Asia/Manila')::date,'corrections',p.method,p.amount_cents
        FROM pos_payment_reversals r JOIN pos_payments p ON p.id=r.payment_id
        JOIN pos_invoices i ON i.id=p.invoice_id JOIN branches b ON b.id=i.branch_id
        WHERE r.recorded_at >= ($6::date::timestamp AT TIME ZONE 'Asia/Manila')
          AND r.recorded_at < (($5::date+1)::timestamp AT TIME ZONE 'Asia/Manila')
      ), source_metrics AS (
        SELECT i.branch_id,${sourceKindSql} AS kind,sum(item.amount_cents) AS sales,count(*) AS line_count
        FROM pos_invoice_items item JOIN pos_invoices i ON i.id=item.invoice_id JOIN branches b ON b.id=i.branch_id
        WHERE i.state='posted' AND i.posted_at >= ($4::date::timestamp AT TIME ZONE 'Asia/Manila')
          AND i.posted_at < (($5::date+1)::timestamp AT TIME ZONE 'Asia/Manila')
        GROUP BY i.branch_id,${sourceKindSql}
      ), source_totals AS (
        SELECT kind,sum(sales) AS sales,sum(line_count) AS line_count FROM source_metrics GROUP BY kind
      ), branch_period AS (
        SELECT branch_id,COALESCE(sum(amount) FILTER(WHERE kind='sales'),0) AS sales,
          COALESCE(sum(amount) FILTER(WHERE kind='payments'),0) AS received,
          COALESCE(sum(amount) FILTER(WHERE kind='corrections'),0) AS reversed,
          count(*) FILTER(WHERE kind='sales') AS invoice_count
        FROM events WHERE day >= $4::date GROUP BY branch_id
      ), outstanding AS (
        SELECT i.branch_id,sum(i.total_cents-pos_paid_cents(i.id)) AS amount
        FROM pos_invoices i JOIN branches b ON b.id=i.branch_id
        WHERE i.state='posted' GROUP BY i.branch_id
      ), branch_metrics AS (
        SELECT b.id,b.name,COALESCE(p.sales,0) AS sales,COALESCE(p.received,0) AS received,
          COALESCE(p.reversed,0) AS reversed,COALESCE(p.invoice_count,0) AS invoice_count,
          COALESCE(o.amount,0) AS outstanding
        FROM branches b LEFT JOIN branch_period p ON p.branch_id=b.id LEFT JOIN outstanding o ON o.branch_id=b.id
      ), previous AS (
        SELECT COALESCE(sum(amount) FILTER(WHERE kind='sales'),0) AS sales,
          COALESCE(sum(amount) FILTER(WHERE kind='payments'),0) AS received,
          COALESCE(sum(amount) FILTER(WHERE kind='corrections'),0) AS reversed,
          count(*) FILTER(WHERE kind='sales') AS invoice_count
        FROM events WHERE day < $4::date
      ), daily AS (
        SELECT day,COALESCE(sum(amount) FILTER(WHERE kind='sales'),0) AS sales,
          COALESCE(sum(amount) FILTER(WHERE kind='payments'),0) AS received,
          COALESCE(sum(amount) FILTER(WHERE kind='corrections'),0) AS reversed,
          count(*) FILTER(WHERE kind='sales') AS invoice_count
        FROM events WHERE day >= $4::date GROUP BY day
      ), days AS (
        SELECT ($4::date+n)::text AS date FROM generate_series(0,$5::date-$4::date) n
      ), methods AS (
        SELECT method,COALESCE(sum(amount) FILTER(WHERE kind='payments'),0) AS received,
          COALESCE(sum(amount) FILTER(WHERE kind='corrections'),0) AS reversed
        FROM events WHERE day >= $4::date AND method IS NOT NULL GROUP BY method
      )
      SELECT statement_timestamp() AS generated_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'sales',sales::text,
          'received',received::text,'reversed',reversed::text,'invoiceCount',invoice_count::text,
          'outstanding',outstanding::text,'sources',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'kind',s.kind,'sales',s.sales::text,'lineCount',s.line_count::text)) FROM source_metrics s WHERE s.branch_id=branch_metrics.id),'[]'::jsonb)) ORDER BY lower(name),id) FROM branch_metrics),'[]'::jsonb) AS branches,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',kind,'sales',sales::text,'lineCount',line_count::text))
          FROM source_totals),'[]'::jsonb) AS sources,
        (SELECT jsonb_build_object('sales',sales::text,'received',received::text,'reversed',reversed::text,
          'invoiceCount',invoice_count::text) FROM previous) AS previous,
        (SELECT jsonb_build_object('sales',COALESCE(sum(sales),0)::text,'received',COALESCE(sum(received),0)::text,
          'reversed',COALESCE(sum(reversed),0)::text,'invoiceCount',COALESCE(sum(invoice_count),0)::text,
          'outstanding',COALESCE(sum(outstanding),0)::text) FROM branch_metrics) AS totals,
        (SELECT jsonb_agg(jsonb_build_object('date',d.date,'sales',COALESCE(v.sales,0)::text,
          'received',COALESCE(v.received,0)::text,'reversed',COALESCE(v.reversed,0)::text,
          'invoiceCount',COALESCE(v.invoice_count,0)::text) ORDER BY d.date)
          FROM days d LEFT JOIN daily v ON v.day=d.date::date) AS trend,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('method',method,'received',received::text,'reversed',reversed::text))
          FROM methods),'[]'::jsonb) AS methods`, selected.values)).rows[0];
    if (selected.branchId && !row.branches.length)
        ledgerFail(404, 'BRANCH_NOT_FOUND', 'Clinic not found.');
    const branches: SalesBranch[] = row.branches.map((branch: Record<string, any>) => {
        const result = { id: String(branch.id), name: String(branch.name), ...metrics(branch), sources: sourceTotals(branch.sources) };
        reconciles(result.sources, result.sales);
        return result;
    });
    const salesSources = sourceTotals(row.sources), totals = metrics(row.totals);
    reconciles(salesSources, totals.sales);
    const methods = new Map<string, Record<string, unknown>>(row.methods.map((entry: Record<string, unknown>) => [entry.method, entry]));
    return { from: selected.from, to: selected.to, timezone: 'Asia/Manila', generatedAt: new Date(row.generated_at).toISOString(),
        previousFrom: selected.previousFrom, previousTo: selected.previousTo, branches, totals, salesSources, previous: period(row.previous),
        trend: row.trend.map((entry: Record<string, unknown>) => {
            const { averageInvoiceCents: _average, ...values } = period(entry);
            return { date: String(entry.date), ...values };
        }),
        paymentMethods: METHODS.map(method => {
            const entry = methods.get(method), received = integer(entry?.received ?? '0'), reversed = integer(entry?.reversed ?? '0');
            return { method, received: safe(received), reversed: safe(reversed), collected: safe(received - reversed) };
        }) };
}

// A record page is a read-only explanation of the corresponding metric. Each
// query returns its page and complete count from the same statement snapshot.
export async function readSalesRecords(tx: RecordTransaction, actor: Actor, query: express.Request['query']): Promise<SalesRecordsData> {
    const selected = scope(query, actor);
    const kind = query.kind;
    if (typeof kind !== 'string' || !['sales', 'payments', 'corrections', 'outstanding'].includes(kind))
        ledgerFail(400, 'SALES_RECORD_KIND', 'Choose sales, payments, corrections or outstanding balances.');
    const method = query.method === undefined || query.method === '' ? null : query.method;
    if (method !== null && (typeof method !== 'string' || !(METHODS as readonly string[]).includes(method) || !['payments', 'corrections'].includes(kind)))
        ledgerFail(400, 'PAYMENT_METHOD', 'Choose a valid payment method for payment or correction records.');
    const sourceKind = query.source === undefined || query.source === '' ? null : query.source;
    if (sourceKind !== null && (typeof sourceKind !== 'string' || !(salesSourceKinds as readonly string[]).includes(sourceKind) || kind !== 'sales'))
        ledgerFail(400, 'SALES_SOURCE', 'Choose a valid invoice sales source.');
    const rawPage = query.page ?? '1';
    if (typeof rawPage !== 'string' || !/^[1-9]\d{0,5}$/.test(rawPage))
        ledgerFail(400, 'PAGE', 'Choose a valid record page.');
    const page = Number(rawPage);
    const base = `SELECT i.id AS invoice_id,i.number::text AS invoice_number,i.branch_id,b.name AS branch_name,i.patient_name,i.patient_id,i.total_cents AS invoice_total,`;
    const range = (column: string) => `${column} >= ($4::date::timestamp AT TIME ZONE 'Asia/Manila') AND ${column} < (($5::date+1)::timestamp AT TIME ZONE 'Asia/Manila')`;
    const entries = kind === 'sales'
        ? `${base} i.id,i.posted_at AS at,NULL::text AS method,
           CASE WHEN $8::text IS NULL THEN i.total_cents ELSE
             (SELECT sum(item.amount_cents) FROM pos_invoice_items item WHERE item.invoice_id=i.id AND (${sourceKindSql})=$8) END AS amount
           FROM pos_invoices i JOIN branches b ON b.id=i.branch_id WHERE i.state='posted' AND ${range('i.posted_at')}
             AND ($8::text IS NULL OR EXISTS(SELECT 1 FROM pos_invoice_items item WHERE item.invoice_id=i.id AND (${sourceKindSql})=$8))`
        : kind === 'payments'
            ? `${base} p.id,p.recorded_at AS at,p.method,p.amount_cents AS amount
               FROM pos_payments p JOIN pos_invoices i ON i.id=p.invoice_id JOIN branches b ON b.id=i.branch_id
               WHERE ${range('p.recorded_at')} AND ($6::text IS NULL OR p.method=$6)`
            : kind === 'corrections'
                ? `${base} r.id,r.recorded_at AS at,p.method,p.amount_cents AS amount
                   FROM pos_payment_reversals r JOIN pos_payments p ON p.id=r.payment_id
                   JOIN pos_invoices i ON i.id=p.invoice_id JOIN branches b ON b.id=i.branch_id
                   WHERE ${range('r.recorded_at')} AND ($6::text IS NULL OR p.method=$6)`
                : `${base} i.id,i.posted_at AS at,NULL::text AS method,i.total_cents-pos_paid_cents(i.id) AS amount
                   FROM pos_invoices i JOIN branches b ON b.id=i.branch_id
                   WHERE i.state='posted' AND i.total_cents>pos_paid_cents(i.id)`;
    // All parameter slots have explicit types, including the range/method slots
    // deliberately unused by current all-date outstanding records.
    const row = (await tx.sql(`WITH ${branchScope}, request AS (
          SELECT $4::date AS from_date,$5::date AS to_date,$6::text AS method,$8::text AS source
        ), entries AS (${entries}), page AS (
          SELECT * FROM entries ORDER BY at DESC,id DESC LIMIT ${PAGE_SIZE} OFFSET $7::integer
        )
        SELECT (SELECT count(*)::text FROM branches) AS branch_count,
          (SELECT count(*)::text FROM entries) AS total,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'invoiceId',invoice_id,'invoiceNumber',invoice_number,
            'branchId',branch_id,'branchName',branch_name,'patientName',patient_name,'at',at,'method',method,
            'amountCents',amount::text,'invoiceTotalCents',invoice_total::text,'sources',COALESCE((
              SELECT jsonb_agg(jsonb_build_object('kind',${sourceKindSql},'name',item.name,'amountCents',item.amount_cents::text,
                'sourceId',CASE WHEN source.data->>'patientId'=page.patient_id AND source.data->>'branchId'=page.branch_id THEN source.id END,
                'linkedVisitIds',CASE WHEN item.kind='appointment' AND item.snapshot->'source'->>'collection'='appointments' THEN
                  COALESCE((SELECT jsonb_agg(v.id ORDER BY v.id) FROM (
                    SELECT id FROM app_records WHERE collection_path='visits'
                      AND data->>'appointmentId'=item.snapshot->'source'->>'id'
                      AND data->>'patientId'=page.patient_id AND data->>'branchId'=page.branch_id
                    ORDER BY id LIMIT 21) v),'[]'::jsonb) ELSE '[]'::jsonb END) ORDER BY item.position,item.id)
              FROM pos_invoice_items item LEFT JOIN app_records source
                ON source.collection_path=item.snapshot->'source'->>'collection' AND source.id=item.snapshot->'source'->>'id'
              WHERE item.invoice_id=page.invoice_id),'[]'::jsonb)) ORDER BY at DESC,id DESC) FROM page),'[]'::jsonb) AS records`,
        [...selected.values.slice(0, 5), method, (page - 1) * PAGE_SIZE, sourceKind])).rows[0];
    if (selected.branchId && row.branch_count === '0')
        ledgerFail(404, 'BRANCH_NOT_FOUND', 'Clinic not found.');
    return { records: row.records.map((entry: Record<string, any>) => {
        const canVisit = hasCapability(actor.profile, 'visits.view', { branchId: entry.branchId });
        const canAppointment = hasCapability(actor.profile, 'appointments.view', { branchId: entry.branchId });
        const sources: SalesRecordSource[] = entry.sources.map((item: Record<string, any>) => ({
            kind: item.kind as SalesSourceKind, name: String(item.name), amountCents: safe(integer(item.amountCents)),
            ...((item.kind === 'visit' && canVisit || item.kind === 'appointment' && canAppointment) && typeof item.sourceId === 'string' ? { sourceId: item.sourceId } : {}),
            ...(item.kind === 'appointment' && canVisit ? { linkedVisitIds: item.linkedVisitIds.slice(0, 20), hasMoreLinkedVisits: item.linkedVisitIds.length > 20 } : {})
        }));
        return { ...entry, sources, kind: kind as SalesRecordKind, amountCents: safe(integer(entry.amountCents)), invoiceTotalCents: safe(integer(entry.invoiceTotalCents)) };
    }),
        total: safe(integer(row.total)), page, pageSize: PAGE_SIZE };
}
