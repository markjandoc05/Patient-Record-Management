# POS R1A — Invoice Lookup and Patient Billing

Implemented locally on October 23, 2026 over POS R1 commit 35a23555f452201838e45a3b0568279dafa85aa2. Uncommitted, pending independent scoped commit-readiness review. No production access or deployment.

## Audit and scope

POS R1 already stores invoice identity, patient/clinic snapshots, immutable posted terms, allocation history and timestamps. No schema change is needed. R1A extends the existing read endpoints and reuses the established invoice detail and payment collection flow; it does not introduce another financial ledger or copy quoted prices.

POS now searches invoices by patient name/ID, invoice number or recorded payment reference, with literal case-insensitive matching. Clinic, creation-date, Draft/Unpaid/Partially paid/Paid/Void and Outstanding filters operate on the complete server-side result set with 30-record pages. Creation dates use Asia/Manila; sales/collections retain their existing separate date policies. Payment-reference search uses EXISTS, so multiple matching payments never duplicate an invoice or inflate counts. Free posted invoices are Paid, and drafts/voids are excluded from Outstanding.

Patient Profile adds Billing for users with both pos.view and patients.view, independently of clinical.view. The tab opens all authorized clinics by default and can narrow to one clinic. It displays Invoiced, Paid and Outstanding totals for that patient and clinic scope, across all dates. These totals include posted invoices only, remain independent of list filters and are explicitly labelled. General POS lookup does not expose clinic sales summary totals to Staff.

Billing shows existing invoice details and payment acknowledgments. Later collections target that same invoice through the existing current-version/idempotent payment endpoint; no duplicate invoice is created. Billing does not offer new invoices, catalogue editing, draft changes, voids, OR editing or clinic sales controls; those remain in the main POS workflow under their existing permissions. Archived patient billing remains readable and existing posted invoices remain collectible.

## Permissions and compatibility

All list, summary and detail queries enforce current POS/patient authority and authorized branches. Exact patient detail requests also verify the invoice patient binding. Summary/list clinic scope is identical; other-clinic invoices and totals are excluded. Patient changes, permission changes and branch changes unmount old protected state. Delayed reads or denials cannot repopulate or invalidate the replacement scope.

Invoice financial write handlers, quote/source resolution, posting, payments, package funding, voids, Admin references and clinic sales handlers are byte-identical to POS R1. Existing quote versions, purchases, balances and payment rows are retained. No permission defaults, roles, migration files, environment or OAuth settings changed.

The existing unrelated AppointmentForm patient-prefill patch remains byte-identical. PatientProfile retains its pre-existing defaultPatientId={patient.id} line; that line belongs to the earlier unrelated change and must be excluded from a later R1A-only staging patch. Existing untracked design/evidence files remain untouched.

## Validation

Passed:
- POS HTTP/PostgreSQL API: 288 checks, including >30-record lookup pagination, all payment states, Free, literal searches, multiple matching references, Manila midnight boundaries, authorized-only patient totals, invalid inputs, archived patients and later collections. Source quotes and financial/ledger tables matched before/after read snapshots.
- POS controlled UI: 17 scenarios covering lookup/query construction, default/one-sided date handling, filter resets, All-clinic sales compatibility, patient detail/collection, same-invoice reuse, stale filters, existing quote paging/retry protections and read-only access.
- Patient Billing Profile: 9 actual-component integration scenarios, including finance access without clinical access, capability/account denial, live revocation, patient replacement and branch changes.
- Treatment Ledger API 234, Permissions API 210, Clinical chart UI 78, protected invalidation 14, POS policy and permission-scope suite.
- TypeScript, production build and whitespace checks.

A focused independent code/finish review caught empty date query values and All-clinic sales mapping; both were repaired and covered. Subsequent review and desktop visual inspection found no further material issue. The mechanical UI detector reported only two unchanged PatientDashboard gray-on-amber warnings; no unrelated style cleanup was made.

Read-only localhost desktop smoke used existing synthetic QA Clinical Ledger UNX 1410 and invoice #1. Default lookup loaded, Outstanding excluded the paid invoice, Patient Billing showed PHP 1.25 invoiced/PHP 1.25 paid/PHP 0 outstanding, Branch B showed zero/no invoices, and reopening All clinics/detail retained the existing two-payment history. No browser mutation or new synthetic live record. Captured console errors: none. Local Vine was restarted against guarded 127.0.0.1:55439/vine_development; PostgreSQL health returned 200.

Evidence: /private/tmp/vine-pos-r1a/ including invoice-lookup-desktop.png, patient-billing-desktop.png, API logs and unit results. Full mobile and ordinary-role browser acceptance remain unverified; API/controlled tests cover the roles and branch denials. This is not a production release sign-off.

## Mandatory schema report

1. Schema change required: NO.
2. Committed chain: 001–008 unchanged.
3. Local applied chain: 001–008 previously observed; migration metadata not freshly queried in this task. Local database target and health were guarded/verified.
4. Production applied chain/parity: UNVERIFIED and untouched.
5. New migrations:none. No applied migration edited.
6. Fresh-database validation:full001–008 initialization and repeat passed within the disposable POS API suite on PostgreSQL17.
7. Upgrade path:N/A for this additive UI/read-query feature; target schema is the current committed008 schema. The prior POS R1 upgrade evidence remains historical, not a new upgrade run.
8. Existing-record compatibility:read snapshots preserve quotes, invoice/payment rows, package purchases and usage; retained and archived-patient scenarios pass. No backfill or historical rewrite.
9. Production catch-up:R1A needs no additional migration. Deployment still requires the POS R1 schema through 008; inspect actual production state and apply only missing committed migrations during a separately authorized release.
10. Recovery/rollback:no R1A schema or independent balance store to roll back. Preserve POS R1 financial history and existing pending-release recovery rules. Reverting R1A UI/read queries must retain unrelated local changes.
11. Divergence:no migration/source-chain change. Actual live local/production schema comparison UNVERIFIED in this task; do not infer parity from build success.

## Files and next step

Feature files:backend/pos.ts, src/components/PosDashboard.tsx, src/components/PatientProfile.tsx, src/components/PatientDashboard.tsx, scripts/test-pos-api.ts, scripts/test-pos-ui.ts, new scripts/test-patient-billing-profile.ts, package.json, ROADMAP.md and this release note.

Next:independent scoped commit-readiness review. No staging, commit, push, deployment, production migration or production access was performed. Disposable regression infrastructure and credential files were removed after checks; local Vine remains running.
