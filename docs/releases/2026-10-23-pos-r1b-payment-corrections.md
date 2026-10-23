# POS R1B — Admin payment corrections

Implemented locally after separately committing the exact reviewed POS R1A
candidate as `a0128575e9dfcbf2d33286ff2137de11b087d22a`.
The correction work is not staged or committed. Nothing was pushed or deployed.

## Scope and workflow

Main POS → open a posted invoice → Payment acknowledgments → Correct payment.
An authorized Admin or guarded Support user reviews the original amount, enters
a required reason and explicitly confirms the full-entry reversal. Cancel performs
no write. This corrects a recorded entry; it does not refund money. If needed,
staff records the replacement payment using the existing collection workflow.
Partial reversals, refunds, paid-invoice voids and changes to posted prices remain
outside this release. Daily Collections, receipts/export, retail sales and cashier
closing are not included.

Original payment amount, tender, change, method, reference, operator and timestamp
remain unchanged. A separate immutable reversal stores its identity, original
payment, command, reason, operator and recorded time. The original acknowledgment
shows Reversed and its correction attribution. Patient Billing can read the same
history and collect later payments; correction controls remain in main POS.

Net paid excludes reversed allocations. Invoice detail, statuses, Outstanding,
patient totals, replacement collection limits and package funding share the same
SQL calculation. Existing payment references remain searchable. An invoice with
any historical payment remains ineligible for void even when its net paid is zero.
Saved quotes, Special Price, Services and posted terms are not recalculated.

Clinic Sales shows received payments, reversed entries and collected net.
Original receipts retain their recorded date; corrections subtract on the
correction's recorded date in Asia/Manila. A correction-only period can therefore
have negative net collections. Invoiced sales do not change. Outstanding remains
the current balance across all dates.

## Packages, authorization and concurrency

An unused linked package becomes unavailable when its invoice loses full funding,
without changing purchased or remaining sessions. A replacement payment restores
the same purchase's funding. Any usage or adjustment history on any linked package
blocks correction conservatively, including previously reversed usage. Existing
manual purchases remain usable and unlinked; no backfill is performed.

Existing `pos.adjust` authority is reused: Admin/guarded Support only. Staff,
Manager and Doctor cannot obtain this authority through an explicit allow map.
Account, patient-view, POS-view and branch requirements remain in effect. The
capability caption now describes corrections; defaults and scopes are unchanged.

Current authority is checked before replay. Invoice locking, expected version,
command hash/actor checks and unique payment/command constraints prevent duplicate
corrections and stale writes. Correction, invoice revision, POS event and general
audit commit together. The general audit does not duplicate the private reason.

The database funding trigger locks the same invoice before rechecking funding.
A correction scans immutable usage/adjustment history without acquiring ledger
line locks. Two-connection tests exercise both lock acquisition orders, separately
for usage and adjustment. Obsolete UI success/401/403 responses cannot restore or
invalidate a replacement permission/branch scope. Conflicts preserve the entered
reason; reload obtains the new invoice version. An uncertain retry uses the same
command and exact payload.

## Validation

All integration checks used guarded, disposable, loopback PostgreSQL17 databases,
synthetic identities/records and temporary storage. No production data was used.

- Correction API:122 checks, including immutable original rows, net balances,
  quote preservation, authorization, current-denial-before-replay, duplicate/stale
  corrections, replacement-payment races, package funding, cross-date Sales,
  audit failure rollback and four direct-SQL usage/adjustment races.
- Correction migration:57 checks; fresh001–009 and retained008→009 schema equality,
  original rows/checksums, inert repeat, tamper rejection, constraints and direct
  SQL correction/redemption races.
- Focused POS008 migration:15 checks; isolated001–008 despite later migrations.
- Existing POS API:288; Treatment Ledger API:234; permissions API:210.
- POS UI:32 scenarios; Patient Billing Profile:9; protected invalidation:14;
  permission scope:227; POS money/policy suite passed.
- TypeScript, production build and whitespace checks passed. Independent backend
  and UI cross-reviews reported no actionable introduced issue.
- Local001–008→001–009 migration preserved every existing table's record hashes;
  checksums match source and local schema equals the disposable fresh target.
  No synthetic live correction/payment was inserted. Vine was restarted on
  localhost3000; API PostgreSQL health and app shell returned200.

Evidence is outside Git at `/private/tmp/vine-pos-r1a-review/` in correction logs
and `local-corrections-result.json`. Controlled component tests are not browser
acceptance. No new browser or mobile acceptance is claimed.

## Required schema report

1. Schema change required: YES, append-only payment reversal relation and updated
   net-payment/funding guards.
2. Committed chain:001–008. POS R1A adds no schema.009 is new local uncommitted work.
3. Local applied chain:001–009 directly observed; shared checksums match source.
4. Production applied chain/parity:UNVERIFIED; no production access or change.
5. New migration:`009_pos_payment_corrections.sql`.001–008 remain byte-identical
   to committed files. No manual DDL or environment-specific schema.
6. Fresh validation:complete001–009 and repeat passed; no fixtures are seeded.
7. Upgrade validation:008→009 retained records and exactly matched fresh schema;
   existing invoices, payments, source claims, quotes, purchases, session events
   and Visit usage bindings survived. Local upgrade independently preserved data.
8. Existing-record compatibility:no stored-balance rewrite or reversal backfill.
   Before correction data exists, old financial results are unchanged. Once
   corrections exist, older applications that sum gross payments are incompatible
   with correct balance reporting. Do not serve mixed old/new financial versions.
9. Production catch-up:inspect actual deployed version during a separately
   authorized release and apply only missing committed migrations in order through
   009 with compatible code.009 is not yet committed or authorized for deployment.
10. Recovery:failed migration/operation rolls back transactionally. Retain all
    reversal history. After a correction exists, recovery requires correction-aware
    code or a reviewed forward fix; reverting to R1A would misreport balances.
    Never remove009 or delete corrections to achieve rollback.
11. Unexplained divergence:none identified between the inspected local target and
    fresh tested target. Live production comparison remains UNVERIFIED. Local009
    ahead of committed/deployed versions is an expected pending feature/release gap.

## Next step

Independent scoped commit-readiness review of this correction patch, followed by
a separately authorized commit. Preserve unrelated AppointmentForm patient-prefill
and PatientProfile defaultPatientId edits. No correction staging, commit, push,
production migration, deployment or DARF operation was performed.

## P2 repair — preserve Admin OR# on correction reload

The independent scoped review reproduced an unsaved OR# being replaced by the
saved reference when Reload invoice for correction called the normal open helper.
The repair adds an explicit correction-refresh option. Before awaiting the read,
it checks whether this invoice's reference differs from its saved baseline. An
edited reference, including an intentional empty value, survives refresh. An
untouched reference adopts the latest server value, and every successful refresh
still updates the invoice version. Normal Open/reopen hydrates the selected
invoice as before. No payment, reversal or reference is written by refresh.

Changed for this repair only:src/components/PosDashboard.tsx,
scripts/test-pos-ui.ts and this release note. UI layout, financial backend,
permission rules, package guards, migrations and unrelated working changes are
byte-identical to their pre-repair state. The previous review patch/manifest
predates this repair and must not be used to stage the repaired candidate.

The new regression failed on the old source with SERVER-OR-5 replacing
UNSAVED-OR-DRAFT, then passed after the repair. POS UI now passes42 scenarios,
including dirty/cleared/untouched references, known409 conflicts, repeated/failed
refreshes, new-version correction commands, unchanged monetary drafts, normal
opening of a different invoice, GET-only refreshes, and obsolete200/401/403 replies
after branch or permission replacement. Five additional independent component
probes passed for a draft becoming equal to the refreshed server baseline,
same-invoice reopening and absent/null/empty clean references.

Patient Billing Profile9, protected invalidation14, permission scope227, POS policy,
TypeScript, production build and whitespace checks passed. Existing build chunk
size warnings remain. The prior API/migration review results above are historical;
no database suite, direct live database inspection/mutation or browser acceptance
was repeated for this UI-only repair. Local API PostgreSQL health returned200.
Evidence:/private/tmp/vine-pos-corrections-or-fix/ and independent probe
/private/tmp/vine-pos-or-review-probe.mts. No server restart was needed.

Repair schema report:
1. Additional schema change required:NO.
2. Committed migration chain:001–008 unchanged.
3. Local applied chain:001–009 previously observed; not queried again here.
4. Production applied chain/parity:UNVERIFIED and untouched.
5. New/modified migrations for this repair:none; pending009 remains unchanged.
6. Fresh validation:not rerun for this UI-only repair; previous001–009 evidence
   remains historical.
7. Upgrade validation:N/A for this repair; no additional schema transition.
8. Existing records:no data writes/backfill or changes to quote/payment/package
   semantics. Financial backend and migration hashes remain unchanged.
9. Production catch-up:unchanged; inspect actual state and apply missing committed
   files only in a separately authorized compatible release.
10. Recovery:the UI repair can be reverted independently; existing correction-aware
    financial recovery requirements above still apply after reversal data exists.
11. No schema change or new unexplained divergence identified. Live parity remains
    UNVERIFIED; local009 remains an expected pending feature/release gap.

Next:final independent scoped commit-readiness review of the repaired candidate.
No staging, commit, push, deployment or production action occurred during repair.
