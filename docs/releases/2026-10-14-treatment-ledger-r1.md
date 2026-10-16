# Patient Profile Treatment Ledger R1 — local implementation

Completed October 14, 2026 on HEAD `bb3504078fdc20fcb16132847df2dffb5981007f`.
Local and uncommitted. Specification: [treatment-ledger-r1.md](../planning/treatment-ledger-r1.md).

## Result and usage

Open Patients → patient profile → Treatment Ledger. Authorized Staff/Manager/administrative users record a package name, purchase date, branch, optional notes and distinct Service/session lines. Admin and existing guarded development Support can set text OR# references; these are accounting references, not posted invoices or payment confirmations. Per-Service cards show purchased, adjusted, used and remaining sessions.

During Visit creation/editing, explicitly choose Use package sessions, select the owned Service line and enter sessions. Usage records the Visit treatment time, captured timezone, actual performer/team, branch and server recorder/time. Any authorized Visit branch may redeem the package if the matching Service is currently eligible there; purchase-origin notes/OR/edit permissions stay independently scoped. Historical names/allowances and all mutations remain attributed. Repeated saves, archive/restore and printing do not silently deduct or restore sessions. Authorized corrections use reasoned immutable adjustments/reversals.

Print / Save PDF and Export saved ledger fetch the current server-authorized saved snapshot; new/unsaved drafts and Visit diagnoses/narratives are excluded. JSON retains the captured local-clock timezone and assisting staff. Chart signing and Visit completion remain separate. Existing Visits without session usage and all legacy patient/treatment fields are retained.

## Validation

TypeScript and full production frontend/server/migration build PASS. Existing large-bundle warning remains; no new compile error. Whitespace PASS.

| Focused suite | Passed |
|---|---:|
| Ledger policy/strict commands | 136 |
| Real HTTP/auth/SQL/concurrency API | 223 |
| Fresh schema and 004→005 upgrade/checksums | 34 |
| Actual controlled components | 40 |
| Protected transport / delayed permissions | 20 |
| Captured local-clock presentation | 6 |
| Saved statement structure | 19 |

478 focused checks pass. Integration uses a nonce-labelled owned local PostgreSQL 17-alpine container, distinct guarded loopback test databases, `.invalid` synthetic identities/origins and temporary private file storage. Container, transient credentials and test storage removed. No production records copied and no normal-development fixtures seeded.

Relevant HTTP/SQL regressions pass: Visit Services152, Appointment Services92, Nurse/Medical Staff/Doctor performers240, charts271, permissions/branch/live revocation210, catalogue133, patient/shared clinical parity142, repaired medical history131 and Services forward migration143. Nineteen relevant deterministic/native regressions also pass, including current policy/redaction223, permission scope227, invalidation14, Service UI76, Visit UI174, appointment UI92, performer components63, chart policy33/UI71/transport18, medical history helpers94/UI35, RBAC/audit/Developer/login policies, and native chart-print35 with both real print stylesheets.

Independent source reviewers found and repairs/tests cover: current-authority checks on lost Visit-create retries; uncertain adjustment exports accidentally refreshing its version into a second command; editing bound Visit context while its ledger lookup is pending; and device-timezone shifts of treatment wall-clock times. A superseded original create retry now conflicts without overwriting or re-deducting. UI reversal controls also require purchase and treatment branch authority; Module Access explains/enforces the nondelegable OR reference role.

Older integration harnesses now verify the full checksummed migration chain and reset explicit dependent tables only in guarded disposable test databases. The focused Services003→004 rewind test uses temporary copies of its four source migrations so later feature FKs do not interfere. Prior workflow assertions remain intact.

## Native/local browser evidence and limits

Vine restarted on its existing localhost3000 using unchanged ignored development configuration. Local DB health and app shell return200. Retained Support session survived refresh. Patient profile exposes the Treatment Ledger, authoritative empty-state GET and unsaved purchase form. Desktop and actual390×844 CSS mobile checks show no document/control horizontal overflow; mobile form visually inspected and discarded unsaved. Main local ledger remains empty.

The actual saved React statement and real ledger CSS were inspected using the supported Browser's native print media. Direct body portal shows both tables and saved facts, excludes clipped synthetic workspace/controls, and has nonzero layout. Native Chromium export produced a nonblank one-page A4 PDF (80,428 bytes); its rendered page was visually inspected, with no clipping/overlap. Browser generated synthetic fixture output, not patient database records. Existing chart print regression also passes35 native checks over direct/Visit-detail/profile-drawer/no-chart cases with both stylesheets.

No fresh Google login, restricted-role native browser matrix, live browser package purchase/redemption or native macOS Save-dialog/physical-printer acceptance is claimed. Those remain bounded follow-up acceptance; deterministic components and real synthetic HTTP cover role/scope/command correctness. No complete browser or production release sign-off.

Temporary evidence: `/private/tmp/vine-treatment-ledger-bhy75t88/` (logs, native print report, synthetic PDF/PNG and private preservation baselines); transient test secrets/storage were removed. No temporary evidence, screenshots, logs, fixtures or dumps are included in repository source. Only main Vine remains running; owned fixture tabs/servers closed, viewport restored, public treatments tab preserved. DARF untouched.

## Mandatory schema report

1. **Schema change required: YES.** Four new relational ledger tables and supporting constraints/indexes/triggers; existing JSONB is adequate for legacy records but not this immutable session workflow.
2. **Committed chain:**001–004 unchanged. New005 exists locally and is deliberately uncommitted until scoped review/authorization.
3. **Local applied migration:** directly observed004 with matching source checksums, then applied005. Now001–005; existing Patient/Visit/Service record/timestamp fingerprint before/after exactly matches; zero ledger data seeded.
4. **Production applied migration:** current **UNVERIFIED**; no production connection. Historical002 is not current evidence.
5. **New migration:**`005_treatment_ledger.sql`; local-only additive forward migration, no applied source edits/manual DDL/alternate environment schema.
6. **Fresh database:**PASS complete001–005 in disposable PostgreSQL17; no automatically seeded data, repeat checksums/definitions stable.
7. **Upgrade path:**PASS004→005 with retained synthetic Patient/Appointment/Visit/Service JSONB and timestamps. Fresh/upgrade columns, constraints, indexes, functions and triggers match; changed source copies reject by checksum. Existing002→current catch-up also exercised by appointment/Visit Services regressions.
8. **Existing records:**PASS no backfill/name matching/automatic historical package or Visit conversion. Missing ledger records produce an empty view; legacy clinical text remains intact.
9. **Production catch-up:**separate release must inspect actual production version and apply only missing reviewed/committed migrations in order, including005 after authorized commit. If production is still002, required path is003→004→005. No production migration executed.
10. **Recovery/rollback:**retain all ledger tables/events. An older application cannot enforce active session bindings or handle ledger commands; pause relevant Visit/package writes before a code rollback or mixed-writer deployment. No destructive down migration provided. Backup/recovery and production compatibility remain separate release checks.
11. **Divergence:**local pre-upgrade migration checksums match source and005 was absent, then applied through the same runner; no divergence introduced by this feature. Full current production structural parity **UNVERIFIED**. Local005 ahead of committed/deployed release is an expected pending release gap, not a reason to modify production.

## Preservation and next step

HEAD and Git index remain byte-for-byte unchanged, all changes unstaged. Three ignored environment files and ten unrelated dirty roadmap/evidence/image paths remain unchanged. Existing Clinical Records R1 source/docs preserved; its API harness only gained the necessary guarded migration-aware cleanup. Shared files contain separate feature hunks and must not be blanket-staged later.

Next: independent scoped commit-readiness review of this ledger on its explicit Clinical R1 dependency/base, followed by any authorized bounded role/browser acceptance. No staging, commit, push, tag, deployment, production configuration/OAuth/migration or DARF action performed.

## Files changed by this task

- `backend/dataApi.ts`
- `backend/treatmentLedger.ts`
- `docs/planning/treatment-ledger-r1.md`
- `docs/releases/2026-10-14-treatment-ledger-r1.md`
- `migrations/005_treatment_ledger.sql`
- `package.json`
- `scripts/platform-test-support.ts`
- `scripts/test-appointment-performers.ts`
- `scripts/test-appointment-read-auth.ts`
- `scripts/test-appointment-services-api.ts`
- `scripts/test-clinical-charts-api.ts`
- `scripts/test-clinical-findings-api.ts`
- `scripts/test-migration-import.ts`
- `scripts/test-parity-regression.ts`
- `scripts/test-patient-lookup-api.ts`
- `scripts/test-patient-medical-history-api.ts`
- `scripts/test-patient-registration-api.ts`
- `scripts/test-permission-api.ts`
- `scripts/test-permission-scope.ts`
- `scripts/test-postgres.ts`
- `scripts/test-services-api.ts`
- `scripts/test-services-migration.ts`
- `scripts/test-simple-registration-api.ts`
- `scripts/test-treatment-ledger-api.ts`
- `scripts/test-treatment-ledger-migration.ts`
- `scripts/test-treatment-ledger-policy.ts`
- `scripts/test-treatment-ledger-presentation.ts`
- `scripts/test-treatment-ledger-print.ts`
- `scripts/test-treatment-ledger-transport.ts`
- `scripts/test-treatment-ledger-ui.ts`
- `scripts/test-user-onboarding.ts`
- `scripts/test-visit-services-api.ts`
- `scripts/test-visit-services-ui.ts`
- `server.ts`
- `src/components/PatientProfile.tsx`
- `src/components/TreatmentLedgerTab.tsx`
- `src/components/UserPermissionEditor.tsx`
- `src/components/VisitForm.tsx`
- `src/components/VisitSessionUsagePicker.tsx`
- `src/components/treatmentLedger.css`
- `src/index.css`
- `src/permissions.ts`
- `src/treatmentLedgerPolicy.ts`
- `src/utils/treatmentLedgerApi.ts`
- `src/utils/treatmentLedgerPresentation.ts`

## P2 repair — metadata drafts during print/export

The independent scoped review reproduced a stale notes/OR# overwrite: a metadata
editor opened on version2 retained its draft fields when Print or Export refreshed
saved data to version3, then saved those old fields with expectedVersion3.

The metadata editor now captures its expected version when opened and retains it
across statement refreshes. Print/export still uses the latest authorized saved
snapshot. A concurrent edit therefore produces the existing409 conflict instead of
silently replacing newer notes/OR#. Explicit Reload balances discards the draft;
reopening captures the reviewed current version. Current per-purchase permissions
still determine writable fields; uncertain retries keep their exact command.

Five new controlled component regressions cover both Print and JSON Export for
Admin notes/OR# and notes-only Staff, preservation of saved output versus draft
fields,409 guidance, explicit reload/reopen recovery, and an uncertain metadata
Retry. Before the repair, the four stale-version cases failed with3 rather than2;
afterward, all45 ledger component cases pass. The unchanged40 cases remain intact.

Fresh checks on the isolated current-source candidate pass: ledger UI45,
transport20, saved-print structure19, policy136, time presentation6, permission
policy223/scope227, protected invalidation14 and Visit Services UI174. TypeScript,
full frontend/server/migration build and whitespace pass. The existing bundle-size
warning remains. A separate source reviewer found no remaining issue in this narrow
repair. These are controlled component/transport checks; no new native browser,
macOS print-dialog or physical-printer evidence is claimed.

Only `src/components/TreatmentLedgerTab.tsx`,
`scripts/test-treatment-ledger-ui.ts` and this report changed during the repair.
Existing backend, permissions, branch rules, purchase/session/Visit behavior,
records and migrations are unchanged. HEAD/index and unrelated dirty-file/ignored
environment fingerprints remain unchanged. No database connection, record update,
staging, commit, push, deployment, production or DARF action was performed.

Repair schema report:

1. Schema change required: **NO** — editor version lifetime only.
2. Committed chain:001–004, unchanged.
3. Local applied:001–005 directly observed in the preceding review; not queried
   again during this UI-only repair.
4. Production applied: **UNVERIFIED**, no production access.
5. New migrations: none; existing locally applied005 is unchanged.
6. Fresh-database validation: N/A for this repair; preceding ledger review passed
   complete001–005 initialization, with no migration changes since.
7. Upgrade validation: N/A for this repair; preceding004→005 validation passed,
   with retained synthetic records/timestamps and unchanged migration source.
8. Existing-record compatibility: no backfill/data rewrite; original draft
   versions and the existing server conflict/reload workflow are preserved.
9. Production catch-up: unchanged, separately authorized ordered missing
   migrations after actual-version inspection;003→004→005 if still at002.
10. Recovery: this UI repair requires no schema/data rollback; reverting it would
    reintroduce the stale draft-version defect. Ledger release recovery rules above
    remain applicable.
11. Divergence: no schema changes introduced. Local/production structural parity
    remains **UNVERIFIED** in this repair; expected pending release gap unchanged.

Next: final independent scoped commit-readiness review of the repaired ledger.
Clinical Records R1 remains a separate uncommitted prerequisite; neither its prior
review nor the pre-repair ledger patch is new staging approval.


## Local update — remove Treatment Ledger printing

On October 14, 2026, the user removed Treatment Ledger Print / Save PDF from the
release scope. The ledger print action, saved statement portal, print scheduling
and ledger-only stylesheet are removed. Earlier print evidence above describes
the previous implementation and is retained as history; it does not describe the
current Treatment Ledger surface.

Export saved ledger remains JSON with the same saved, server-authorized session
facts. Admin notes/OR# and Staff notes-only metadata regression paths still retain
the opened version across export, require explicit reload after conflicts, and
keep uncertain commands locked. Purchases, session balances, Visit usage,
permissions, origin-branch redaction and existing records are unchanged. Clinical
chart Print / Save PDF and chart JSON export are unchanged.

The obsolete ledger-print fixture and npm command are removed. The component
regressions now cover the absence of ledger print controls/portals/calls across
loading, editing and JSON export, plus saved JSON refresh, denied export and
preservation of unsaved drafts. Schema change required: NO; committed migrations
001–005 are unchanged, no migration is run, and current production schema parity
remains UNVERIFIED. This update is local and unstaged; no commit, push, deployment
or production action is authorized.

Focused validation for this update: ledger components44/44, protected
transport20/20, policy136/136 and treatment-time presentation6/6 PASS. Tests use
controlled synthetic responses and do not claim native browser/print evidence.
The intentionally interrupted Visit-save case logs its expected simulated
connection error while its retry regression passes.
