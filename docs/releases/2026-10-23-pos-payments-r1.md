# POS & Payments R1 — local implementation, October 23, 2026

Status: implemented locally; uncommitted and pending independent scoped commit-readiness review. No push, deployment or production access.

## Workflow

POS supports draft invoices, reviewed posting, full/partial/later manual collections, cash tender/change, payment references and on-screen acknowledgments. Saved booking/Visit quotes retain their amounts and Special Price; catalogue changes do not silently reprice those quotes. Standalone Services use eligible branch pricing. Posting revalidates versions and prevents duplicate billing of linked appointments/Visits. Unsaved drafts survive conflicts; ambiguous requests retry the same command rather than create duplicate records.

Packages freeze catalogue terms and the explicitly entered selling price. Posting creates a single linked Treatment Ledger purchase. Sessions unlock only after the entire invoice is paid. Existing manual purchases and balances remain usable unchanged. Void unpaid invoices retain history and lock linked sessions; paid refunds are deferred. Already billed Visits cannot also consume package sessions.

Approved defaults: Admin, Manager and Staff can create/post invoices and collect payments; Admin/Manager can view clinic sales; Admin can override draft prices with a reason and void unpaid invoices. Existing Admin OR# capability and guarded Support access remain. Every endpoint enforces current branch access. All-clinic totals include authorized clinics only.

Sales use invoice posting date; collections use payment date, in Asia/Manila. Outstanding shows current balances across all dates. Quotes, drafts, voids and session redemptions are not counted as sales. Invoice OR# is separate from existing ledger purchase references and does not rewrite them.

No online charging, refunds of paid invoices, retail stock deductions, tax invoice certification or advanced accounting in R1.

## Validation

- TypeScript and production build passed; whitespace check passed.
- POS API: 195 checks; migration: 13 checks; controlled UI: 12 scenarios; money/parser/permission policy suite passed.
- Controlled UI covers unsaved notes after conflict, identical ambiguous retry, stale save denial, stale branch denial, Staff sales restriction, loading/failure/retry versus successful empty state, saved-quote paging/search for Visits and appointments, exact Visit launch and retry, and obsolete source-response denials.
- Existing regression checks passed: Treatment Ledger API 234, Package Catalogue API 114, Permissions API 210, Appointment Services API 322, Visit Services API 302, Inventory API 187, Inventory migration 33, Inventory categories API 90, Inventory import API 161.
- Seventeen focused unit/UI/policy suites passed, including protected invalidation, RBAC, package, ledger, appointment/Visit and Inventory Excel regressions.
- Real localhost desktop smoke: synthetic invoice #1 for QA Clinical Ledger UNX 1410, total PHP1.25, collected in PHP0.50 and PHP0.75 payments. Cash change PHP0.50, acknowledgments, zero outstanding, branch and overall sales were verified. No captured browser errors. This clearly labelled synthetic invoice remains in local immutable history; no real payment was taken.
- Desktop finish review found misleading empty-state messaging during loading; repaired with explicit loading/error/ready states and regression coverage. Payment status labels and narrow-grid wrapping were also improved.
- Focused independent UI recheck passed after the loading fix; recheck was source-only, with the earlier desktop screenshot as visual evidence. This does not substitute for a complete independent commit-readiness review.
- Restricted-role behavior was tested through API/policy suites. Full ordinary-role browser acceptance and mobile viewport acceptance remain unverified. No claim of complete browser release sign-off.

Local evidence is under `/private/tmp/vine-pos-r1/`, including logs, unit-results.json, local-migration-report.json, schema-comparison.json and pos-paid-desktop.png.

## Mandatory schema report

1. Schema change required: YES — transactionally consistent invoice/payment/source-claim/package links.
2. Committed chain: 001–007, unchanged.
3. Local applied chain: observed 001–008 on local PostgreSQL17 at 127.0.0.1:55439/vine_development.
4. Production applied chain: UNVERIFIED in this task; production untouched.
5. New migration: 008_pos_payments.sql, applied locally and uncommitted. No fixture data in migrations.
6. Fresh initialization: complete 001–008 passed; repeated migration run is inert.
7. Upgrade: 007→008 passed with retained synthetic records and unchanged prior migration metadata.
8. Compatibility: old JSONB records and ledger purchases preserved; local pre/post migration legacy hash matched. Legacy unlinked purchases remain usable. Existing quotes/history are not backfilled or rewritten.
9. Production catch-up: only missing ordered, reviewed and committed migrations through 008 during a separately authorized compatible release. Actual missing versions must first be inspected; no production migrations run here.
10. Recovery: preserve financial history; prefer forward corrections. No destructive down-migration. Older application code cannot manage POS and must not be assumed to enforce the new workflow; coordinate application/database recovery with a backup and release review. New permission keys fail closed in older implementations.
11. Divergence: local schema matched fresh and upgraded candidates across 438 schema entries. No unexplained local divergence observed. Production parity UNVERIFIED; unreleased 008 is an expected pending release gap.

## Scope and next step

Source changes cover POS policy/API/UI, capability defaults and navigation, Visit launch, funded ledger usability, additive migration008, focused regression scripts and migration-aware test setup. AppointmentForm.tsx and PatientProfile.tsx pre-existing patient-prefill changes were preserved separately. Existing untracked evidence/design files were not included or removed.

Next: independent scoped commit-readiness review, then separately authorized staging/commit. No staging or commit performed by this implementation.

## Saved quotes beyond100 — local P2 repair

The initial independent scoped review reproduced a valid saved quote disappearing from POS when its patient had more than100 Visits/appointments. The old options window remains bounded for compatibility, but the POS source picker now uses dedicated search and pagination (50 per page). Search covers Service name, Visit type, date and record ID across the complete authorized history. Opening POS from a Visit fetches that exact Visit directly, independently of the picker page. Its frozen quote and version populate the draft; no current catalogue repricing occurs.

Direct launch blocks editing until its quote loads and provides an explicit retry on failure. Quote search/page changes retain existing invoice items and notes; obsolete responses cannot publish data or invalidate the new scope. Read endpoints enforce current POS, patient and source-view permissions, active patient/clinic, actual source branch/patient binding and archive checks. All invoice/payment/package write paths remain unchanged.

Regression evidence:125 Visits and125 appointments, complete three-page traversal, literal case-insensitive search, exact loading beyond the former window, unauthorized branch/patient/capability denials and archived-record handling. Source rows and financial/ledger tables matched snapshots after all source-discovery reads. The full195-check POS API suite passed, plus12 controlled UI scenarios,13 fresh/upgrade migration checks,234 Treatment Ledger API checks, POS policy and14 protected invalidation scenarios. TypeScript, production build and whitespace checks passed. Focused read-only review found no remaining actionable defect in this repair. No new real-browser acceptance evidence is claimed.

Repair schema report: (1) NO additional schema change; (2) committed001–007 unchanged; (3) local001–008 observed in prior implementation, migration metadata not queried again here; (4) production UNVERIFIED and untouched; (5) no new/modified migration; (6) fresh001–008 passed on disposable PostgreSQL17; (7)007→008 upgrade passed with retained synthetic data; (8) saved quotes, legacy records, package balances and payment history preserved by regression checks; (9) production catch-up remains a separately reviewed release using only missing committed migrations; (10) this repair only adds source reads/UI, existing financial recovery requirements above remain; (11) tested fresh/upgraded schema equality passed, live local/production parity not reverified. No unexplained divergence identified in tested schemas.

Changed for this repair only: backend/pos.ts, src/components/PosDashboard.tsx, scripts/test-pos-api.ts, scripts/test-pos-ui.ts and this report. Evidence: /private/tmp/vine-pos-source-fix/. Local Vine restarted on localhost3000 with guarded local database configuration; PostgreSQL health returned200. No live fixtures inserted. No staging, commit, push, deployment or production access. Next: final independent scoped commit-readiness review of the repaired POS candidate; the prior review patch/manifest predates this repair and must not be used for staging.
