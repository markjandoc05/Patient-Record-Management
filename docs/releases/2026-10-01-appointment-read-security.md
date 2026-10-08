# Phase 1 security: appointment read authorization

Status: implemented locally; automated validation passed; ready for browser
acceptance. Not committed, pushed or deployed. The separate reliable-loading
release remains incomplete pending its remaining acceptance tests.

Latest acceptance attempt: the existing Google-linked development staff profile
has been assigned only Demo Clinic and activated through the existing admin UI.
Its Google passkey verification, the genuine administrator sign-in and normal
browser connection remain pending. Standalone read/file security passes Node 22
validation; actual browser acceptance remains incomplete. See the
[final acceptance record](2026-10-01-final-browser-acceptance.md).

## Acceptance follow-up — October 1, 2026

Browser acceptance is **blocked, not passed**. A fresh localhost tab reaches the
real Google account chooser. Neither the required administrator nor restricted
staff Google sign-in is currently available in that browser session. The user
has been asked to complete authentication; no credentials or sessions were forged.

Development identity inspection, limited to the isolated `vine_development`
database, found:

- Existing Google-linked development `staff` profile, inactive, with
  no assigned branches. Not created by this acceptance run. Intended test scope:
  only `demo-branch` (Demo Clinic — Development), after existing administrator
  activation and assignment. Those changes have **not** been performed yet.
- Prepared development `admin`, pending
  its first verified Google sign-in. This run did not activate it or change roles.
- Existing support identity: now has the separate development `SUPPORT_DEVELOPER`
  role assigned to `demo-branch`; it is not a restricted-staff substitute.

Consequently, staff branch visibility/list/filter/polling acceptance, browser
direct-read denial, live assignment-change invalidation, appointment-file access,
staff actions and administrator regression remain **NOT RUN / BLOCKED**. Previous
automated server proofs below do not count as real-identity browser evidence.
Authenticated console/network inspection and visible polling degradation also
remain unverified. The embedded native-prompt archive limitation is still recorded
in the separate loading release; no prompt code was changed.

### Supplemental performance evidence

An isolated local development HTTP server with Docker PostgreSQL 17 exercised
the actual API, authentication middleware and authorization fix with **100 synthetic
appointments in two branches**, 50 per branch. Ten sequential measured requests
per case followed one warm-up. Synthetic sessions existed only in the disposable
test database; these are server measurements, not Google/browser acceptance.

| Read case | Rows / status | Median ms | Range ms | SQL statements/request |
| --- | --- | --- | --- | --- |
| Administrator, all branches | 100 / 200 | 4.23 | 3.98–5.62 | 7 |
| Restricted staff, explicit A | 50 / 200 | 3.83 | 3.42–4.30 | 7 |
| Administrator, explicit A | 50 / 200 | 4.13 | 3.22–4.82 | 7 |
| Restricted staff, unfiltered | 50 / 200 | 5.11 | 4.71–6.00 | 7 |
| Restricted staff, authorized direct | 1 / 200 | 4.49 | 3.87–5.05 | 7 |
| Restricted staff, denied direct | 0 / 403 | 4.83 | 4.05–6.04 | 7 |

Five unfiltered staff reads, separated by approximately five seconds, returned
50 rows consistently in 5.21, 14.42, 22.72, 16.56 and 12.84 ms, with seven SQL
statements each. This short sample found no accumulating server delay or per-row
N+1 query growth. The seven statements are session lookup, initial profile lookup,
BEGIN, advisory lock, current-profile lookup, one appointment SELECT, then
COMMIT (ROLLBACK for denied direct reads). The initial profile lookup remains
duplicated by the required in-transaction scope recheck; it is constant work,
not one lookup per appointment. No optimization was made.

Limits: these are localhost HTTP timings, **not VPS/tunnel/browser timings** and
not a production capacity or multi-user load test. No pre-fix timing baseline or
database execution-time instrumentation was available; no measured before/after
speed claim is made. The runner used the installed Node 24.15.0, rather than the
deployment's Node 22. VPS-backed browser latency and visible polling behavior must
still be measured after sign-in. The compatibility advisory lock continues to
serialize appointment reads with writes. This evidence does not close acceptance.

### Repeated validation and changes

Passed again: 236 focused appointment authorization assertions; 54 PostgreSQL
integration checks; 16 appointment-loading scenarios; RBAC and audit suites;
71 support-access checks; six support subscription/cache scenarios; 28 development
activation checks; TypeScript; production build; full-workspace `git diff --check`.
Support/activation tests initially hit sandbox localhost-listen restrictions and
passed when rerun with authorized local-network access. The temporary performance
harness initially encountered container readiness and temporary-file module-format
errors; both were corrected outside the repository before successful measurement.
Every disposable database/container/file directory was removed. No development or
production data was populated by these server tests.

No application defect was exposed and **no application code was changed in this
acceptance run**. Only this security release note was updated. Concurrent account
and support-role edits already in the workspace are not attributed to this run.
No commit, push or deployment occurred. Security sign-off and closure of both
appointment workstreams remain pending actual browser acceptance.

## Confirmed root cause

The deployed PostgreSQL compatibility API's `POST /api/data/query` authenticates
the session and approves the account/module, but originally classified appointments
alongside shared patient/visit continuity records. It did not enforce branch scope.
Collection reads applied only client-supplied constraints; direct document reads
loaded the ID and returned its payload without a branch check. The database adapter
is privileged server infrastructure and does not independently enforce user access.

Frontend `subscribeToBranchScopedCollection` scopes restricted appointment queries
to assigned branches and exposes only accessible branch choices. Server mutation
handlers also check assigned branches. Neither protects a read request that omits,
changes or bypasses the frontend filter. This inconsistency was reproduced with
a synthetic staff session assigned A receiving an appointment in B through both
unfiltered and direct requests.

This defect predates the appointment-loading release: the committed data API already
contained the shared-continuity exception and unconditional document return. Loading
work changed lifecycle/error handling, not server authorization. Historical Firebase
rules also allowed shared appointment reads; they are retained migration reference,
not this PostgreSQL runtime's enforcement boundary.

## Rule and smallest shared fix

Appointment reads now follow the operating-branch policy used by the dashboard and
server mutation handlers. `admin` and legacy `support_developer` retain global
appointment reads. Other approved roles use only their authenticated profile's
current `assignedBranches`, including multiple assigned branches. Empty or malformed
assignments grant no branch access. Pending/unknown/inactive account rejection remains
in the existing account middleware.

`backend/appointmentReadAccess.ts` supplies one appointment policy for list scope,
direct record checks and appointment-file downloads. The API adds a server-owned
constraint ANDed with client conditions, before database ordering and LIMIT. Client
role/branch/assignment claims never supply the authorization scope. Existing support
role gates, projections and stricter query rejection remain in place; no role or
grant was introduced by this release.

The database adapter adds strict string membership, so missing/null/array/object/
numeric stored branch IDs cannot satisfy branch authorization. Existing generic IN
semantics remain unchanged for other queries. No schema migration is required.

Appointment list/direct reads re-read the profile under the existing transaction
advisory lock used by account assignment writes. No new polling mechanism or query
endpoint was introduced. This uses the current compatibility lock and serializes
appointment reads with writes; representative staging/browser performance remains
part of acceptance, rather than changing lock architecture in this fix.

Direct unauthorized records return 403 with only `{"error":"Branch access denied"}`.
List filters naming an unassigned/unknown branch return no protected rows. Mixed
filters may return their authorized intersection. Malformed query requests either
return a safe empty intersection or generic 400 without a record payload. Nonexistent
direct IDs retain the existing successful null convention for legacy roles.

## Affected read paths

- `POST /api/data/query`, collection `appointments`: all lists, polling, getDocs,
  summary and patient-profile appointment reads, including callers using the shared
  frontend subscription helper.
- Same endpoint, document `appointments/:id`: getDoc/direct reads.
- `GET /api/attachments/content`, registered appointment files: the existing
  attachment resource helper applies the same branch rule before content access.
  Knowing a file path cannot bypass appointment scope. Unauthorized file requests
  retain the generic 403 `Attachment access denied` convention.

No dedicated GET appointment endpoint exists. Create/edit/archive/restore routes
remain unchanged. The attachment guard applies to read operations only; existing
attachment upload/delete authorization remains intact. Patient/visit file continuity
policies are unchanged. Restricted patient profiles will now receive only authorized
appointment history from the generic query endpoint; patient identity and visit
continuity remain governed by their existing separate policies.

## Evidence

`npm run test:appointment-read-auth` passed 236 assertions against real Express,
session/CSRF middleware and PostgreSQL with disposable synthetic fixtures. Fixtures
include A/B branches, A/B appointments, administrator, restricted staff, manager,
multi-assigned doctor, global legacy support, inactive/unknown roles and malformed/
empty assignments. No production or ordinary development records were used.

| Workflow | Result |
| --- | --- |
| Staff unfiltered / explicit A list | PASS; only A |
| Staff explicit B / unknown branch list | PASS; no protected records |
| Mixed A/B, broad comparisons, omitted filter, injected role/assignments | PASS; only authorized intersection |
| Order/limit with unauthorized row first | PASS; server scope precedes limit |
| Direct A / direct B | PASS; 200 / generic 403 |
| Missing ID / malformed filters and stored branch values | PASS; safe null, empty or generic rejection; no protected error payload |
| Repeated polls and 20 concurrent reads | PASS; remain scoped |
| Same-session assignment A → B → none | PASS; subsequent reads use changed scope and old direct access is rejected |
| Administrator / legacy support all-branch and direct reads | PASS; unchanged |
| Doctor assigned A+B | PASS; both authorized branches |
| Staff assigned A create/edit | PASS; 201 / 200 |
| Staff unassigned B create/edit | PASS; 403 / 403 |
| Staff archive/restore | PASS; 403 / 403 |
| Administrator archive/restore | PASS; 200 / 200 |
| Appointment files A/B as staff | PASS; authorized file readable, unassigned file 403 |
| Appointment files as administrator | PASS; authorized all-branch reads retained |

Also passed: 16 appointment-loading scenarios; 54 existing PostgreSQL integration
checks; RBAC and audit policy suites; 70 existing in-memory support-access checks;
TypeScript; production build; security-file and final full-workspace whitespace
checks. Test containers, databases and temporary files were removed. The existing
frontend chunk warning was not changed. An earlier full-workspace whitespace check
found two trailing spaces in unrelated concurrent UI edits; their final state is
clean, without this security change touching those lines.

## Reproduction and acceptance

The focused suite refuses ordinary development/production database URLs and requires
an explicitly disposable local `/vine_appointment_auth_test` database, production
test mode, `ALLOW_TEST_DATABASE=yes`, and separate temporary `STORAGE_DIR`. It
truncates only that named test database. See DEVELOPMENT.md for the test command.
The PostgreSQL integration suite must run separately against `/vine_test`.

Browser acceptance must verify administrator and restricted-user appointment lists,
refresh, direct denial/error handling, assigned branch changes, existing booking/
edit actions and appointment-file access. Use development identities and synthetic
data. Native-prompt archive acceptance still belongs to the loading release's
pending checklist; this security fix does not replace that prompt.

Other collections (`patients`, `visits`, `branches`, `users`) use the same generic
read endpoint. Legacy patient/visit reads are explicitly shared for clinical
continuity; branch/user directories are also shared. This release does not claim
those policies are defects or silently narrow them. Review their intended scope
and visit/private-media read access in a separate security task if the clinic
requires stronger boundaries. The legacy Firebase rules remain broad reference
rules; any return to Firebase would require separate policy alignment.

Recovery: no schema/data rollback is needed. Keep this security release separate
from loading and concurrent support-role work when preparing review/commits.
Reverting the read guard would reintroduce the confirmed disclosure; preserve the
fix or restrict affected access while repairing a rejected release. No production
deployment or full security audit is implied by this local validation.
