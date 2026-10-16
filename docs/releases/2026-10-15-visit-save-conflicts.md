# Visit save-conflict protection — local implementation

Base: `09046924b7c1d3aaa311bf01f39a67e1e3e28977`. Local work only; no staging,
commit, push, deployment, production change or account migration.

## Behavior

Visit edits now submit the version that was loaded when the editor opened. The
server compares `expectedVisitVersion` with the saved `visitVersion` inside the
existing PostgreSQL transaction, after checking current authorization, Doctor
ownership and source/destination branch access. A successful edit increments the
version. New Visits start at 1. Existing Visits with missing/null metadata load as
version 0; reads do not backfill or rewrite them. Invalid stored metadata fails
closed on writes and remains readable.

A competing edit receives HTTP 409 / `VISIT_VERSION_CHANGED`. Missing or malformed
expected versions receive `VISIT_VERSION_REQUIRED`; invalid saved metadata receives
`VISIT_VERSION_INVALID`. Caller-supplied `visitVersion` is rejected. Conflict
responses contain no latest clinical record. Conflicts leave notes, patient
summaries, appointment links, package balances, usage events and audits unchanged.
Archive and restore also advance the version, preventing an old draft from saving
through an archive/restore cycle. Attachment, chart and ledger commands retain
their existing independent concurrency controls and partial updates.

The editor keeps all unsaved fields and blocks blind retries after a Visit
conflict. **Review saved Visit** displays saved notes through the existing
authorized record-query endpoint without changing the draft or its opened version.
**Reload saved Visit** asks for confirmation; **Keep my draft** leaves everything
intact. **Discard draft and reload** fetches fresh data again and replaces the
draft only after that fetch succeeds in the same authorized scope. A failed or
stale fetch cannot replace the draft. A refreshed archived/sealed Visit is
read-only under the existing rules. Ordinary live-record polling never rebases
an open draft. A successful save receipt advances the opened version if a newer
Service choice keeps the form open; incomplete receipts preserve the saved ID
and require review rather than creating another Visit.

Account, branch and permission changes continue to discard stale transports and
clear protected data. Current 401/403 responses still invalidate normally. The
new conflict behavior does not grant any Visit, chart, branch or clinical access.
It does not provide automatic merging, draft persistence after closing the form,
or a new Visit signing/amendment workflow.

### October 17 — chart draft lifetime repair

The independent review reproduced a chart draft loss while a confirmed Visit
reload was pending. **Open chart** now remains disabled during that replacement
read, and its handler also refuses to open a chart while saving or reloading.
The replacement therefore cannot discard a chart opened after the Visit discard
confirmation. Successful and failed reads restore normal chart access; failed
reads keep the unsaved Visit notes and diagnosis. Read-only **Review saved Visit**
still allows charting and preserves an already open chart's unsaved notes.
The normal chart discard confirmation, permissions and branch rules are unchanged.

Seven real-component regression cases were added to
`scripts/test-clinical-charts-ui.ts`: success/failure for Doctor, Nurse and Medical
Staff, plus a read-only review control. On the pre-fix Visit code, six new cases
fail (72/78 overall); the repaired code passes 78/78. Tests also force the opening
handler to verify its guard, and confirm that declining a dirty chart's normal
close prompt retains the chart and its notes after either reload outcome.

The repaired HEAD-based reconstruction passes TypeScript, complete `npm run build`
(frontend, server and migration bundles), 233 Visit scenarios, 63 performer
scenarios, 227 permission-scope checks, 14 protected-invalidation scenarios and
RBAC assertions. The backend/API results below remain evidence from the prior
implementation/review; this UI-only repair changes no backend or authority code
and does not rerun those database suites. Local health, app shell and the served
Visit module were checked successfully on port 3000 without restarting the server.
These are automated checks, not new interactive browser evidence.

This repair adds no schema change or migration. The committed/local 001–005
baseline was directly verified during the preceding review; this UI-only repair
does not contact either database. Production state remains UNVERIFIED and
unchanged. Existing records need no conversion; no new production catch-up step
is introduced. Schema upgrade validation is N/A for this repair; the full schema,
compatibility and recovery report below still applies. The existing pending
release gap must not trigger an automatic production update.

Repair evidence and updated scoped patch/manifest:
`/private/tmp/vine-visit-chart-reload-fix-wff_93_p/`. The previous reviewed patch and
its blocker report remain historical artifacts; review the repaired candidate
before staging or committing. No staging, commit, push, deployment or production
action is authorized or performed by this repair.

## Scope

Runtime: `server.ts`, `src/components/VisitForm.tsx`, `src/utils/recordApi.ts`,
new `src/utils/visitVersionPolicy.ts`.

Tests: new `scripts/test-visit-save-conflicts-api.ts`; conflict/review/reload races
in `scripts/test-visit-services-ui.ts`; versioned receipts/current opened versions
in the existing performer component, performer API, Visit Services API, chart API
and Treatment Ledger API fixtures. The Treatment Ledger suite also verifies that
a stale Visit edit cannot deduct sessions or create usage/event history.
The chart component suite now also covers the pending Visit reload interaction.

All pre-existing unrelated edits, including Ledger print removal and Visit filter
layout, remain preserved separately and unstaged. Ignored environment files are
unchanged.

## Validation

The isolated candidate is committed HEAD plus only this feature's files, excluding
unrelated working changes. Tests use fresh disposable PostgreSQL 17 databases,
synthetic identities/records, production-mode test middleware, `.invalid` origins
and temporary storage. Owned test containers are removed afterward.

- TypeScript and production build: PASS on the isolated candidate.
- Visit conflict HTTP/PostgreSQL tests: 67 checks passed, including simultaneous
  editors, legacy version 0, required/forged/malformed versions, branch denial,
  Doctor ownership, Nurse/Medical Staff writes, archive/restore and audit rollback.
- Visit component/transport tests: 233/233 scenarios passed, including 54 new
  version/conflict/review/reload checks. Draft notes survive conflicts, failed
  confirmed reloads and invalid receipts; stale reads/denials cannot affect a new
  account/permission scope. HEAD control fails the new version and review cases.
- Visit Services API: 152; performer API: 240; performer component: 63;
  chart API: 271; chart component: 71; Ledger API: 225; permission API: 210;
  permission-scope component/transport: 227; parity/clinical/upload API: 142;
  protected invalidation: 14 checks/scenarios passed. RBAC assertions passed.
- Local Vine restarted on port 3000; three health checks and the app shell
  returned 200. No migrations or development-data writes during restart.
- Whitespace check passed. HEAD, index, unrelated edits and ignored environment
  hashes match the task baseline. No staging or commit occurred.

Controlled component tests and HTTP checks are not new browser acceptance evidence.
The existing Vite large-chunk advisory remains; the build succeeds.

## Required schema and release report

1. **Schema change required: NO.** Version metadata fits existing Visit JSONB;
   no SQL schema change, account migration or read backfill.
2. **Committed migration chain:** 001_platform.sql, 002_session_integrity.sql,
   003_services.sql, 004_services_name_identity.sql, 005_treatment_ledger.sql.
3. **Local applied:** directly observed 001–005 in a read-only transaction;
   all applied names/checksums match the committed files.
4. **Production applied:** UNVERIFIED in this task. Production was not contacted.
5. **New migrations:** none. No applied migration was edited.
6. **Fresh-database validation:** complete 001–005 chain passes in fresh disposable
   conflict/workflow databases, including repeat-safe migration invocation.
7. **Upgrade-path validation:** no new DDL/backfill to upgrade (N/A for this
   feature). Visit Services regression also retains synthetic 002-era JSONB while
   applying the current complete migration chain. Missing-version historical
   Visits are exercised directly by the conflict suite.
8. **Existing-record compatibility:** untouched legacy text, unknown JSONB,
   historical snapshots, authors, linking and counters survive. Missing/null
   version is 0. Old unversioned edit clients receive 409 and must refresh the
   updated app; this deliberately prevents unprotected overwrites. Release must
   pair the updated server and UI. Missing new-server receipts leave the draft
   open for review; old-server behavior cannot provide the new concurrency guarantee.
9. **Production catch-up:** no new migration for this feature. During a separately
   authorized release, inspect production and apply only missing committed
   migrations in order; do not infer its current version from older reports.
10. **Recovery/rollback:** no data conversion or destructive operation. Preserve
    existing JSONB/version metadata. Rolling back code loses the new save-conflict
    guarantee, so server/client compatibility must be reviewed together.
11. **Unexplained divergence:** none in the observed local migration checksums;
    production version/checksums and actual structural parity are UNVERIFIED.
    Expected pending releases must not trigger an automatic production update.

Local evidence and scoped candidate artifacts:
`/private/tmp/vine-visit-conflict-psnb_ozo/`. These are temporary review artifacts
and must not be staged with the feature.
