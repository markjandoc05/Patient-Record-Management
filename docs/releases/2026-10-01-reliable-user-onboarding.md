# Release 1 — reliable user onboarding

Status: local implementation; automated validation and browser evidence recorded
below. No commit, push, production deployment, schema change or invitation feature.

## Audit findings and resulting behavior

- Working: Google callback creates a disabled pending Staff profile, preserves the
  verified subject mapping on repeat sign-in, and requires administrator activation.
  Pending clinic access is denied. Existing role, self-account and developer
  protections, account lifecycle controls and durable mutation audits are present.
- Broken guidance: live profile polling used the generic inactive notice for pending
  accounts, potentially replacing the correct initial pending message. Both paths
  now use shared guidance; pending login is an informational approval notice.
- Incomplete approval UI: the existing Pending activation tab lacked a readiness
  explanation; approval hid specific server errors, and the confirmation could
  reject without a handled retry state. Add inline requirements, preserve specific
  errors, keep failed confirmations open and prevent duplicate confirmation clicks.
- Subscription failures previously threw from callbacks and could leave an empty
  pending list without an actionable explanation. User-access reads now distinguish
  loading, error and empty results; retry does not recreate fixtures. Safe cached
  lists remain during transient failures; authorization failures clear them.
- Incomplete validation: activation did not check default membership or malformed
  assignments consistently. The shared requirement helpers enforce existing
  assignment/default rules in server approval and assignment writes. Pending drafts
  can remain incomplete. Global roles retain their no-assignment/active-branch
  exceptions; a default is optional, and IDs/defaults must be valid when supplied.
- Concurrency defect: lifecycle validation read target/branch state before the write
  transaction. Two approvals could validate the same pending snapshot and produce
  duplicate success audits. Actor, target, lifecycle and branch state now use the
  existing transaction/advisory-lock boundary. A concurrent duplicate returns 409
  with one successful transition and activation audit.
- Session race: deactivation/archive changed profiles and removed sessions in
  separate operations; callback session creation used a profile read outside its
  session insert. Session removal is atomic with lifecycle state, and callback
  issuance rechecks the profile within the same mutation lock. A queued sign-in
  cannot recreate sessions after deactivation.

These gaps predate this release. Existing appointment workstreams are neither
closed nor deployed by this onboarding change. No new clinical access policy,
role, authentication provider or database structure was introduced.

## Acceptance criteria

New verified registrations remain pending with clear next steps. Repeated and
concurrent callbacks keep one identity/profile. Only authorized actors can assign
roles/clinics and approve valid accounts; defaults must be assigned. Restricted
roles need active assigned clinics; global roles keep their existing exceptions.
Approval is validated against current transactional state, retries remain safe,
deactivation revokes sessions, archive/restore retain IDs, and audits describe
successful changes only. Interactive browser checks remain a separate gate.

## Files in this release

- `backend/auth.ts`: serialized session issuance after current-state validation.
- `backend/dataApi.ts`: assignment/default validation on profile updates.
- `server.ts`: transactional lifecycle validation, current actor checks and atomic
  session removal, retaining existing lifecycle endpoints and response conventions.
- `src/utils/userActivation.ts`: shared assignment/activation requirements and notices.
- `src/components/UserActivationReadiness.tsx`: existing-row readiness guidance.
- `src/App.tsx`, `src/components/Login.tsx`: consistent pending approval notices.
- `src/components/AdminSettings.tsx`: pending instructions/readiness, specific errors,
  user-access loading/retry and guarded confirmations using current list state.
- `src/components/ConfirmationModal.tsx`: optional saving/error states; existing
  consumers retain their defaults.
- `scripts/test-user-onboarding.ts`, `scripts/test-user-onboarding-ui.ts`: focused
  integration/concurrency and guidance/component coverage.
- `scripts/test-development-account-activation.ts`, `scripts/test-support-access.ts`:
  update existing mocks for transactional identity/session queries and revocation.
- `package.json`: two focused test commands; dependencies/lockfile unchanged.
- `ROADMAP.md`, `CHANGELOG.md`, `DEVELOPMENT.md`, `docs/user-onboarding.md`, this note:
  release evidence, operating instructions, scope and acceptance status.

The worktree already contains other unreleased work. Review this release against
its pre-task source snapshot; do not commit every modified file as onboarding.

## Validation evidence

Final source snapshot: Node **22.23.3**, PostgreSQL **17**, lockfile `npm ci` and
production-mode middleware in disposable test databases. All 15 suites passed:

| Check | Result |
| --- | --- |
| Onboarding PostgreSQL/HTTP | 82 checks passed, including registration/approval races, revoked actor scope and concurrent sign-in/deactivation |
| Onboarding guidance/components | 48 checks passed; static rendering only |
| Existing development activation | 28 simulated-provider/in-memory checks passed |
| Existing Support / Developer access | 122 HTTP/in-memory checks passed |
| Support subscription/cache | 6 scenarios passed |
| Support tools UI | All 13 panels render |
| Shared data/profile/cache | 32 checks passed |
| Appointment loading | 16 scenarios passed |
| Existing PostgreSQL integration | 54 checks passed |
| Appointment read authorization | 236 assertions passed |
| Parity/shared clinical/uploads/audit | 142 checks passed |
| RBAC, audit, login activity, Developer policies | All four suites passed |
| TypeScript and production build | Passed on Node 22.23.3; also passed locally on Node 24.15.0 |
| Whitespace and release diff review | Passed; prior worktree changes preserved |

The first support-suite run exposed a test-double mismatch after identity checks
moved into transactions. Its mock now handles transactional identity checks and
session deletion; the corrected full candidate passes. No production policy was
relaxed to accommodate tests.

The existing large-bundle warning remains. The unchanged dependency lockfile's
installation reports eight moderate audit findings; dependency remediation belongs
to a separate reviewed task. No dependency version, lockfile or warning suppression
was changed here. Expected 403 rejection logs appear in negative authorization tests;
they are not unexpected application failures or browser-console evidence.

Detailed sanitized command results are saved locally at
`/private/tmp/vine-release1-onboarding-results.json`. All test databases, temporary
uploads and identities were removed with the task's disposable container.

The localhost backend was restarted with the updated source. Both `localhost:3000`
and `127.0.0.1:3000` return HTTP 200 for the app and PostgreSQL health endpoint.
Read-only development checks retain the active Mark Support / Developer profile,
the user's two configured branches and application settings. Previously removed
demo fixtures remain absent. No shared development account or clinic data was
changed by this release's tests.

Browser attempts on the existing localhost tab timed out on a browser-control
command, using both accessibility and the documented DOM alternative. No real
Google registration, administrator approval, responsive screenshot inspection,
console/network review or interactive retry result is claimed by those attempts.
The initial 40 component checks used static rendering, not an interactive browser.

A subsequent acceptance pass recovered browser inspection in a fresh tab, verified
genuine Mark sign-in/re-login and synthetic administrator controls, and exposed two
pre-existing UI defects: disabled accounts were hidden from all tabs, and fixed
account/assignment columns crowded tablet controls. Inactive users now expose the
existing Activate action; account tabs wrap and narrow account/clinic controls
stack. Eight visibility regression assertions bring the component/guidance total
to 48. The final Node 22/PostgreSQL 17 full candidate passes all 15 suites. Employee
Google/session browser checks remain pending; see the
[browser acceptance record](2026-10-01-user-onboarding-browser-acceptance.md).

## Recovery and environment

No schema/migration changes are needed. The browser pass temporarily added one
unlinked synthetic profile to isolated development; its profile and 13 test-only
audits were removed after retention verification. Mark, the two configured clinics
and all settings remain intact. Synthetic automated test
identities, branches, sessions and audits use a newly created disposable PostgreSQL
17 container and guarded test databases, then the whole container is removed.
The clean development dataset and Mark's real identity are not used as test fixtures.

Recover code by reversing this release's reviewed changes while preserving prior
uncommitted appointment/security/support work. A private pre-task source snapshot
of the main application files is at `/private/tmp/vine-release1-onboarding-baseline`. No database rollback is
required. Revoked sessions are intentionally not restored; users sign in again.
Do not restore the earlier removed demo data as part of code recovery.

Before any eventual production release: complete browser acceptance, review the
mixed worktree boundaries, validate staging and obtain deployment authorization.
Existing backup/recovery work can continue independently of this release.

## Next release

Browser acceptance is partially complete; not signed off as ready to commit or
production-ready while employee Google/pending-to-approved/revocation/default-clinic
session behavior remains unverified. Support Google sign-in and synthetic admin
controls/retry/responsive checks passed. The user authorized a separate test Google
identity, whose email is still needed. Do not relabel Support access as employee
evidence or downgrade Mark for testing.

After Release 1 acceptance, prepare a separate invitation proposal covering
verified-email/subject linking, duplicate prevention, cancellation/expiry, access
approval and audit behavior. Invitations and email delivery are not implemented.
