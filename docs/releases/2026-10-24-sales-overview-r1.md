# Sales Overview R1 — local implementation

Sales Overview replaces the Clinic sales table in POS & Payments. It uses the
existing invoice/payment history and existing `pos.sales` capability to show a
single authorized clinic or all authorized clinics. No financial write workflow,
permission default, quote, purchase or session balance is changed.

## Reporting and navigation

- Today, Yesterday, This week (Monday), This month and custom inclusive dates in
  Asia/Manila; custom periods are limited to 366 days.
- Invoiced sales, net collections, outstanding now, posted invoice count and
  average invoice value. Flow metrics compare with the preceding equal-duration
  period; current outstanding has no historical comparison.
- Branch comparison includes zero-activity clinics, overall totals, sorting by
  sales/collections/outstanding/name and source-record drill-down.
- Daily sales/net-collection chart with exact daily figures, payment-method
  breakdown and source pages of 25 records. Source records can open an authorized
  invoice through the existing invoice view. Returning retains report filters.
- Excel export contains Overview, Branches, Daily trend and Payment methods.
  Export uses the complete report scope, not the invoice/source-record page or its
  additional filters. Source patient records are not included in the workbook.

Invoiced sales use posted invoice values by posting date. Quotes, drafts and voided
invoices do not count. Payments and reversed entries use their own recorded dates;
net collections can be negative. Outstanding is the current unpaid balance across
all dates, using existing `pos_paid_cents`. Attribution follows the invoice clinic.
Package purchases count once through their invoice; session redemption is usage,
not a new sale. Prices stay frozen on their existing invoice records. Correction
entries are reversals of recorded payments, not refunds.

## Implementation and access

Additive GET `/api/pos/sales-overview` and `/api/pos/sales-records` use the existing
POS authenticated wrapper (`pos.view`, `patients.view`) plus `pos.sales` and branch
scope. Totals, previous-period metrics, zero-filled daily trends and payment
methods share one PostgreSQL statement snapshot. Record page/count also share
one statement snapshot. Money sums are checked as exact integers before conversion
to client numbers; unsupported aggregate sizes fail instead of rounding silently.
Average invoice rounds to the nearest cent. Dates are real calendar dates, methods
are allowlisted and record pages are bounded. Explicit unauthorized branches fail.

Client reads use the existing Services protected transport and reject obsolete
responses. A separate visibility generation retires pending invoice-opening and
export actions when navigation hides the report, while retaining report filters. Report data is keyed by account, permissions, clinic and period. Export
reauthorizes with a fresh complete report, then rechecks the live account,
permission generation and filter scope after workbook generation before download.
Excel amounts are numeric PHP cells; text remains literal, with no formulas or
links. No reporting result is derived from the first page of invoices.

The existing `/sales` API remains available and unchanged. Sales Overview extends
the established Vine presentation without changing shared design tokens or unrelated
forms. Daily closing/cash counting, refunds, profit, tax and commission reporting
remain later workstreams.

## Validation and limitations

Per the user's instruction, no regression tests, browser acceptance, synthetic
fixtures, database test suites or export round-trip tests were added/run. Only
static implementation review, TypeScript compilation, build and whitespace checks
were performed. TypeScript and build passed; the build retains bundle-size
warnings. Runtime report SQL, ordinary-role acceptance, workbook opening and
responsive browser acceptance are **UNVERIFIED** in this task, not reported as
passed. No production data or credentials were accessed. Vine was restarted locally on
port 3000 to load the new GET routes; its startup announcement and listener were
observed. No endpoint/browser acceptance was run.

Static review tightened post-generation export checks and preserved report state
across invoice drill-down. All prior dirty work remains intact. No staging,
commit, push or deployment was performed. Current review artifacts from older
workstreams do not cover this expanded candidate.

Changed source: `backend/pos.ts`, `src/components/PosDashboard.tsx`.
New source: `backend/salesOverview.ts`, `src/components/SalesOverview.tsx`,
`src/utils/salesOverview.ts`, `src/utils/salesOverviewExcel.ts`.
Documentation: this report and `ROADMAP.md`.

## Mandatory schema report

1. Schema change required: **NO**.
2. Committed migration chain: **001–008**, observed in HEAD `a012857`.
3. Local applied migrations: **UNVERIFIED this task**; previously observed 001–009.
4. Production applied migrations: **UNVERIFIED**; not accessed.
5. New migrations: **none**. Existing pending 009 remains unchanged and is required
   by the existing payment-correction/net-payment reporting functions.
6. Fresh-database validation: **not run**, per user instruction; no schema change.
7. Upgrade-path validation: **not run**, per user instruction; no schema change.
8. Existing-record compatibility: read-only projection of saved invoices/payments;
   no backfill, rewriting, account migration or financial mutation.
9. Production catch-up migrations: actual missing versions are **UNVERIFIED**.
   Pending 009 must be separately reviewed/committed with its correction feature;
   any later authorized release must apply every missing committed migration in
   order. This task does not authorize a production update.
10. Recovery/rollback: revert this read-only reporting patch; no data rollback or
    migration is introduced. Preserve existing pending work and recorded history.
11. Unexplained schema divergence: **UNVERIFIED**; no schema inspection/change was
    performed. A development release gap is not by itself evidence of divergence.
