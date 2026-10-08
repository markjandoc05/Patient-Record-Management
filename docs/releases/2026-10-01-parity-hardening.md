# Phase 1 production/development parity hardening — October 1, 2026

Status: validated locally; no commit, push, deployment or production changes.
Node **22.23.3 is the authoritative release-validation runtime**. Node 24.15.0
also passes the same candidate. This does not close appointment browser acceptance.

## Scope and evidence

The preceding read-only audit verified committed revision
`97444c49d7e5f19dddea20dfd474290b551deae0`, production checkout parity,
matching PostgreSQL schema and migrations 001/002, and the same 36 API routes.
This pass validates the newer, uncommitted candidate rather than reverting fixes
to the production baseline. It does not synchronize databases or patient files.

Evidence retained locally outside Git:

- `/private/tmp/Vine-Production-Development-Parity-Audit-2026-10-01.txt`:
  preceding audit, including production source/runtime evidence.
- `/private/tmp/vine-parity-snapshot.json`: original 26 modified and 24 untracked
  files, revision and file hashes.
- `/private/tmp/vine-parity-runtime-results.json`: tested source hashes and every
  Node 22/24 step, exit status and output.
- `/private/tmp/vine-parity-runtimes.py`: temporary two-runtime validation runner.

These paths are session evidence, not durable project dependencies. This release
note preserves the findings; retain sanitized run evidence with the eventual
release review. Do not commit session exports indiscriminately.

## Node 22 and Node 24 validation

Both Linux runtimes installed from the existing `package-lock.json` in fresh
source snapshots. `npm ci --include=dev --no-audit --no-fund` installed 432
packages under each runtime. No local `.env`, production secrets, data directory
or existing `node_modules` were copied into either snapshot.

| Validation | Node 22.23.3 | Node 24.15.0 |
| --- | --- | --- |
| Lockfile install | PASS | PASS |
| TypeScript (`npm run lint`) | PASS | PASS |
| Frontend/backend production build (`npm run build`) | PASS | PASS |
| Compiled backend start, health 200, anonymous session 401 | PASS | PASS |
| Appointment loading, 16 scenarios | PASS | PASS |
| New shared helper/profile regression, 32 checks | PASS | PASS |
| RBAC, audit, login-activity and developer-tool policies | PASS | PASS |
| Support API/file access, 122 checks | PASS | PASS |
| Support UI, 13 panel renders | PASS | PASS |
| Protected cache/scope changes, 6 scenarios | PASS | PASS |
| Development activation, 28 checks | PASS | PASS |
| Appointment read/file authorization, 236 assertions | PASS | PASS |
| Existing PostgreSQL integration, 54 checks | PASS | PASS |
| New clinical/upload/audit integration, 142 checks | PASS | PASS |

PostgreSQL suites used disposable local PostgreSQL 17 databases named
`vine_test`, `vine_appointment_auth_test` and `vine_parity_test`. Existing migrations
initialized only those disposable test schemas. Neither the shared development
schema nor production was migrated. Test containers, databases, uploads and
installed snapshot dependencies were removed afterward.

No tested functional or dependency-resolution difference was found. Both builds
produced the same frontend asset names and reported sizes. npm itself differed:
10.9.9 under Node 22 and 11.12.1 under Node 24. Existing package deprecation and
large-bundle warnings remained. Support tests intentionally logged rejected
production use of the development-only role (403); those are expected negative
checks, not unexpected failures. Backend startup used synthetic OAuth placeholders
and is not evidence of interactive Google sign-in under either container runtime.

The package-lock SHA-256 remains
`863eac2dad1027b4c31e8c8904f691bf94abe27bd902d1511b436a08bf7be2ca`.
Keep production on Node 22; validate each eventual isolated commit on Node 22.

## Upload policy: ACCIDENTAL DRIFT, corrected in development only

The same media normalizer and attachment signature checks exist in committed
production and development source. The difference was persisted configuration:
production had `settings/media`; development did not and used source defaults.

| Rule | Production effective policy | Development before | Development after |
| --- | --- | --- | --- |
| Record extensions | `.png`, `.jpg`, `.pdf` | `.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf` | `.png`, `.jpg`, `.pdf` |
| General file ceiling | 1 MiB / 1,048,576 bytes | Same | Same |
| Stored image ceiling | 500 KiB / 512,000 bytes | Same | Same |
| Per-record attachment count | 5 | Same default | Same explicit setting |
| Case handling | Lowercase extension; settings trim, add dot, deduplicate | Same | Same |

Production's saved fields were `allowedExtensions: [".png", ".jpg", ".pdf"]`,
`maxFileSizeMB: 1`, `maxFilesPerRecord: 5`, plus legacy `allowedTypes: "pdf, jpg, png"`,
`maxFilesPerAppointment: 5` and `maxSizeMB: 3`. The runtime reads canonical fields;
the old `allowedTypes` and `maxSizeMB` do not override them. The normalizer can
fall back to `maxFilesPerAppointment` if the canonical count is absent.

The server recognizes signatures for JPEG (`.jpg`/`.jpeg`), PNG, WebP, ICO and PDF.
Record uploads must satisfy both the configured extension set and a matching
signature. The client-declared MIME does not grant access: a valid allowed JPEG
declared as `text/plain` still has its signature-derived type, while a PDF renamed
to PNG is rejected. Under the saved production policy, effective record types are
JPEG via `.jpg`, PNG and PDF. Branding uploads follow a separate image policy;
this correction does not change it. Client source image input permits up to 20 MiB before
optimization; existing image optimization targets 0.45 MiB and 1600 pixels.

No environment variable overrides this extension/count policy. Database and
storage environment differences remain intentional isolation boundaries.

Correction: `scripts/configure-development-media.ts` creates only the missing
development document with canonical fields. It requires the existing isolated
localhost/development-database guard and never connects to production or overwrites
a changed policy. It was executed and `--verify` passed. Browser settings now show
`.png,.jpg,.pdf`, size 1 and count 5. Source defaults were not changed and no patient
file contents were inspected or copied. This is a one-time synthetic configuration
fixture, not ongoing production configuration synchronization.

New real HTTP/PostgreSQL checks verify allowed signature-based uploads and reads,
case handling, `.jpeg`/`.webp` rejection, mismatched signature rejection, file/image
size limits, the fifth/sixth file boundary and legacy-field normalization.

## Support logging: LEGACY BEHAVIOR; alias consistency requires a policy decision

The two roles differ in login activity, not in a blanket mutation-audit exemption:

| Action/path | Legacy `support_developer` | Development `SUPPORT_DEVELOPER` |
| --- | --- | --- |
| `/api/login-activity/record` | Returns `recorded: false` | Recorded when otherwise eligible; normal 10-second throttle applies |
| `/api/login-activity` listing | Legacy rows filtered out | New alias rows not excluded |
| Durable CREATE/UPDATE/DELETE audit policy | Recorded | Recorded |
| Ordinary clinical VIEW audit policy | Excluded, as for other roles | Same |
| `developer_*` VIEW diagnostics | Recorded | Recorded |
| AUTH audit policy | Recorded only for resource User | Same |

`src/loginActivityPolicy.ts` explicitly compares the lowercase literal.
`server.ts` also filters only that literal from login history. Both are unchanged
from committed production. Adding the uppercase development identifier elsewhere
did not normalize this policy. The uppercase role is rejected outside isolated
development; it is not a production account migration.

`src/auditPolicy.ts` has no actor-role exclusion for durable changes. Trusted
clinical, archive/restore, attachment, configuration/private-note and managed-user
paths stage audit records. The new integration suite confirms persisted legacy
support archive/restore, upload/delete, settings, user-assignment and private-note
events, and verifies durable audit policy for both aliases. Existing support tests
exercise the uppercase role's HTTP actions. These are examined-path findings, not
a claim that every SQL administrator action or every data read has an audit log.

No sensitive API mutation in the examined paths was found exempt merely because
the actor is support. Routine patient/appointment/file reads are not comprehensive
access-audit events under the current policy. That is existing read-log coverage,
not a new alias defect; assess it separately if access-level logging is required.
Do not apply the login-history exemption to durable clinical/security mutations.

Recommendation: leave durable mutation logging intact. Decide separately whether
both support identifiers should retain the legacy sign-in exemption or both should
be logged. Then change the login recorder, retrieval filter, documentation and
tests together in a dedicated release. No logging policy was changed here.

## Shared helper and clinical regression

| Area | Evidence | Result and limits |
| --- | --- | --- |
| Patients | Actual shared helper plus real HTTP/PG reads for staff, manager, doctor, admin and legacy support; browser list/profile | PASS: shared A/B list/direct reads unchanged; synthetic profile and associated appointment render |
| Visits | Actual helper archive filters and real HTTP/PG visit creation/read | PASS: patient/appointment/`visitHistoryId` relationships and patient totals correct; existing shared reads unchanged |
| Cache | Controlled 503, recovery, 403 and stale generation responses for patients, visits, branches and users | PASS: transient data retained; denial clears; earlier-scope response cannot republish |
| Branches/users | Real HTTP/PG directory reads for five existing roles; shared helper choices; browser settings directories | PASS: no new collection-read branch restriction; staff choices limited by existing assignments; admin global choices unchanged |
| Archive/restore | Real HTTP/PG staff denial, legacy support clinical archive/restore, existing appointment suite; controlled active/archived polling | PASS server/helper: existing permissions, counts and no-duplicate restoration preserved |

Browser checks used the existing real Google-linked development Support / Developer
identity, not a fabricated staff session. Four synthetic patients loaded; Demo
Patient One's profile, medical overview and one correct linked appointment opened.
Visits loaded a successful empty list/history; populated visit relationships were
validated in disposable PostgreSQL, not claimed as browser coverage. Clinic and
user settings directories loaded; settings visibly reflected the corrected upload
policy. Returning to Patients and its subsequent polls yielded successful 200
query responses with no captured network failure or warning/error console entries
in the inspected interval. Normal polls are expected repeated reads, not duplicate
record creation. This is limited browser evidence, not full appointment acceptance.

No new server branch restriction was imposed on patients, visits, branches or users.
Do not treat global support browser results as proof of restricted staff UI access.
Normal-browser native-prompt archive/restore and genuine restricted-staff/browser
scope-change acceptance remain pending from the earlier appointment workstream.
Final navigation back to Appointments showed the initial loading state followed
by the two expected synthetic Demo Clinic appointments, with no captured console
warnings/errors. This does not replace archive, staff or administrator acceptance.

## Working tree classification — original 50 files

Groups: **A** appointment loading/recovery; **B** appointment read/file security;
**C** tests supporting A/B; **D** A/B documentation; **E** development/support/shared
cache work; **F** parity/audit/history documentation; **G** unrelated or unfinished
work to hold outside the appointment commits. Multiple groups require hunk-level
review, not committing the entire file into every release.

### Original 26 modified tracked files

| File | Group | Reason / boundary |
| --- | --- | --- |
| `DEPLOYMENT.md` | F/G | Historical infrastructure/import completion; independent of appointment code |
| `backend/auth.ts` | E | Development-only role authentication guard |
| `backend/dataApi.ts` | B/E | Appointment read scope/transaction checks mixed with support role/profile guards |
| `backend/database.ts` | B/E | Strict `string-in` appointment scope; separate `withIds` helper for support work |
| `backend/inventory.ts` | E | Support administrative role expansion/guard |
| `backend/maintenance.ts` | E | Support role guard and administrative role handling |
| `deployment.production.json` | F/G | Historical DNS/import status metadata; not a deployment action |
| `package.json` | A/C/E/F | Loading/security, support, dev and parity script entries; no dependency/lock change |
| `scripts/bootstrap-admin.ts` | E | Support-aware bootstrap behavior; not appointment stabilization |
| `scripts/test-rbac.ts` | E | Uppercase support-role assertions; existing permissions preserved |
| `server.ts` | B/E | Appointment file-read checks mixed with support refresh/activation/role changes |
| `src/App.tsx` | E | Support navigation/profile labels and global scope/cache invalidation |
| `src/components/AdminSettings.tsx` | E | Support administrative checks and activation handling |
| `src/components/AppointmentForm.tsx` | E | Support-aware existing form permission checks |
| `src/components/AppointmentsDashboard.tsx` | A/E | Loading/retry integration mixed with support role access checks |
| `src/components/AuditTrailDashboard.tsx` | E | Support role access helper |
| `src/components/BranchDashboard.tsx` | E | Support role visibility and protected-state handling |
| `src/components/NotesTab.tsx` | E | Support clinical permission helper |
| `src/components/PatientDashboard.tsx` | E | Protected-data reset/error clearing and clinical read helper |
| `src/components/PatientProfile.tsx` | E | Support/shared clinical visibility helper; not new appointment features |
| `src/components/UserSettings.tsx` | E | Support role-aware existing settings behavior |
| `src/components/VisitForm.tsx` | E | Support permission helper |
| `src/dataClient.ts` | A/E | Error status/class transitions needed for loading; shared protected generation/invalidation and write failures |
| `src/rbac.ts` | E; B dependency | Support alias and shared role arrays imported by appointment security helper |
| `src/utils/branchAccess.ts` | A/E | All-query-batches ready/cleanup plus authorization clearing and support global-role helper |
| `src/utils/recordApi.ts` | E | Shared mutation error status and protected cache invalidation |

### Original 24 untracked files

| File | Group | Reason / boundary |
| --- | --- | --- |
| `CHANGELOG.md` | D/F | Separate release entries, split by subject |
| `DEVELOPMENT.md` | D/E/F | Development setup and security/parity validation procedures |
| `ROADMAP.md` | D/F | Appointment status, independent roadmap and parity follow-up |
| `backend/appointmentReadAccess.ts` | B | Server appointment list/direct-read scope helper |
| `backend/developmentAccess.ts` | E | Isolated development account/role guard |
| `backend/developmentAccountActivation.ts` | E | Development account activation binding |
| `deployment.development.json` | E | Nonsecret isolated infrastructure metadata |
| `docs/planning/Vine-System-Development-Plan.txt` | F/G | General capability roadmap, independent documentation |
| `docs/releases/2026-10-01-appointment-loading.md` | D | Loading release evidence and incomplete acceptance status |
| `docs/releases/2026-10-01-appointment-read-security.md` | D | Independent read/file security release note |
| `docs/support-developer-access.md` | E | Development/support operating instructions |
| `scripts/configure-development-accounts.ts` | E | Real development account preparation; identity configuration review required |
| `scripts/dev-tunnel.mjs` | E | Development SSH tunnel |
| `scripts/prepare-support-development.ts` | E | Development support fixtures |
| `scripts/seed-development.ts` | E | Synthetic seed guarded against production |
| `scripts/test-appointment-loading.ts` | C/A | Focused loading/race/recovery tests |
| `scripts/test-appointment-read-auth.ts` | C/B | Disposable PostgreSQL read/file/write authorization tests |
| `scripts/test-development-account-activation.ts` | E | Development account binding/activation checks |
| `scripts/test-support-access.ts` | E; C overlap | Independent support HTTP/file tests also exercise shared authorization |
| `scripts/test-support-subscriptions.ts` | E; C overlap | Protected cache/scope tests also exercise appointment helpers |
| `scripts/test-support-ui.ts` | E | Support panel render checks |
| `scripts/verify-support-development.ts` | E | Development metadata/access verification |
| `src/utils/appointmentSubscriptions.ts` | A | Appointment initial-ready/error/generation orchestration |
| `src/vite-env.d.ts` | E | Development/build typing required by import-meta usage |

No original file is unclassified. G identifies known independent work, not an
unknown defect. E is a separate support/development workstream and must not be
silently bundled with either appointment release. Global protected-cache behavior
is a shared dependency requiring its own explicit review and regression evidence.

### Added in this parity-hardening pass

| File | Group | Change |
| --- | --- | --- |
| `scripts/configure-development-media.ts` | E/F | Minimal guarded missing-setting correction/verification |
| `scripts/test-shared-data-regression.ts` | C/E/F | Synthetic helper/profile/cache regressions |
| `scripts/test-parity-regression.ts` | C/E/F | Disposable PostgreSQL clinical/upload/audit regression |
| `docs/releases/2026-10-01-parity-hardening.md` | F | This report and complete grouping |

Also updated in this pass: script entries in `package.json`; parity/runtime
instructions in `DEVELOPMENT.md`; separate `CHANGELOG.md` and `ROADMAP.md` status
entries. Other uncommitted application changes predate this pass and were retained.

## Proposed clean commit grouping — not staged or committed

1. **Appointment loading/recovery**: A logic, focused loading tests and D loading
   notes/script entry. Include required error-status, error-transition,
   all-batch-ready and cleanup hunks. Do not absorb support UI/role changes merely
   because they share a file.
2. **Appointment read/private-file security**: B logic, strict `string-in` helper,
   security tests/script entry and D security note. Preserve all established write
   rules and the other shared clinical read rules.
3. **Shared protected-cache and development/support access**: E global invalidation,
   support/account safeguards, supporting UI/server/tests, seed/tunnel/type files
   and relevant operating instructions. Prefer separate cache and support commits
   if their dependency edges can be resolved cleanly.
4. **Parity validation and development media fixture**: the three new scripts,
   package entries and F parity note/runtime procedures. This is independent
   configuration/test hardening, not a production upload-policy change.
5. **Historical infrastructure and general planning documentation**: reviewed F/G
   deployment metadata and planning text; exclude from application fixes.

This is a proposed boundary, not five already-independent patches. Current B
imports E's centralized administrative role array; security tests include the
uppercase support behavior. A also shares cache helpers with E. Resolve those
dependencies explicitly: either place unchanged legacy role constants in the
standalone B patch and apply the alias in E, or review the minimal shared helper
as a named prerequisite. Do not cherry-pick whole mixed files blindly. Validate
each assembled commit on Node 22; passing the combined worktree does not prove
every isolated patch builds or retains the same coverage.

## Files, credentials and fixture handling

Exclude `.env`, credentials/tokens, SSH private keys, raw OAuth/session/cookie
captures, database dumps, patient exports, actual development database rows,
`data/`, local uploads, logs, `node_modules/`, `dist/`, coverage and temporary
validation snapshots. Existing ignore rules cover `.env`, `data/`, dependencies
and build output. No generated test upload or database export was added to the
candidate file set. Public Firebase browser configuration already tracked in the
baseline is not an OAuth client secret or a server credential; do not confuse it
with migration credentials.

A targeted candidate-text scan found no new plaintext private key, OAuth client
secret or credential-bearing PostgreSQL URL. Documentation test URL credentials
are explicit placeholders. This is a limited scan, not a credential-leak guarantee.
Review staged diffs again when commits are actually prepared.

Test source using `example.invalid`, generated disposable cookies and signature-only
synthetic files is intentional source coverage. Real Google-linked development
identities in account configuration scripts are personal configuration, not
synthetic patient data: review separately in E and consider configurable/anonymized
defaults before sharing broadly. Those scripts do not belong in appointment-only
commits. Environment service IDs and public hostnames are not passwords, but also
belong in their own reviewed infrastructure/documentation change.

## Final parity assessment and remaining acceptance gates

1. **Node 22:** PASS, production-matching 22.23.3 is now authoritative.
2. **Node 22 vs 24:** no functional/dependency difference in tested scope; npm and
   diagnostic stack frames differ; existing warnings remain.
3. **Uploads:** ACCIDENTAL DRIFT from missing development saved media settings;
   safely corrected only in development and verified against the effective policy.
4. **Support logging:** LEGACY BEHAVIOR in sign-in activity; POLICY DECISION
   REQUIRED for alias consistency. Durable mutation audit policy is not exempt.
5. **Patients:** PASS helper/server and support browser checks; existing reads intact.
6. **Visits/clinical:** PASS helper/server relationships and cache; browser successful
   empty list/history only, not populated encounter browser acceptance.
7. **Branches/users:** PASS helper/server and support browser directory loading;
   genuine restricted staff selector/profile-change browser testing still pending.
8. **Archive/restore:** PASS server/helper; native-prompt browser acceptance pending.
9. **Working tree:** all original 50 files classified above, including mixed hunks.
10. **Exclude from commits:** credentials, patient exports/files, database contents,
    generated dependencies/builds/logs and session evidence; E/F/G outside A/B.
11. **Secrets/data risk:** no new secret found by targeted scan; real development
    account identifiers need separate review; synthetic source fixtures are allowed.
12. **Loading browser readiness:** technically ready for final acceptance, not yet
    accepted or complete; real restricted-role and supported native prompt tests remain.
13. **Read/file security browser readiness:** technically ready; server negatives and
    admin/legacy regressions pass; actual staff/admin browser sign-off still required.
14. **Before clean release commits:** finish role/browser acceptance, resolve mixed
    hunk/helper dependencies, review identity/configuration files and validate each
    proposed patch under Node 22. Logging alias policy is a separate decision, not
    a reason to undo the appointment fixes or block unrelated safe work.
15. **Production-like development:** sufficiently representative for runtime,
    schema, API and effective upload-policy release validation when Node 22 and
    existing production roles are exercised; not identical production data or a
    substitute for staging, real-role browser acceptance or verified recovery.

Recovery: the only shared development settings mutation was creation of the
previously absent `settings/media` document. To return to the former development
defaults, a deliberate removal of only that development fixture would be required
after verifying the database target; no removal was performed. No production recovery action is
needed. Retain the source candidate for further acceptance; no app schema change
was made. Backup restore testing, private-file backup scheduling, representative
production-scale performance and staging remain independent outstanding work.

Final diff checks: `git diff --check` passed, all untracked source/documentation
files passed trailing-whitespace checks, and the index remained empty. Only
documentation changed after the successful two-runtime validation; tested code,
package commands and lockfile remained at their validated hashes. Pre-existing
whitespace elsewhere in unchanged portions of tracked files was left alone.
