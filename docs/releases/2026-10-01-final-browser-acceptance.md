# Phase 1 final browser acceptance — October 1, 2026

Status: **incomplete — authentication and normal-browser connection required**.
No application defect was confirmed in this run. No application code, schema,
production configuration, logging policy or broader clinical visibility rule was
changed. Nothing was staged, committed, pushed or deployed.

## Development preparation actually completed

- The development app and SSH database tunnel had stopped. Restarted the existing
  guarded tunnel and `npm run dev`; localhost health returned 200 with PostgreSQL
  healthy. No migration command was run on the application databases.
- The existing Google-linked development staff profile was assigned only
  `demo-branch` through Settings → Access. Its role stayed `staff`; the other
  synthetic branch remained unchecked.
- Activated that profile with the existing Approve & activate UI. Normal polling
  confirmed the pending profile moved to active. These are authorized development
  user/account changes, not new authorization rules or production account changes.
- Signed out of the real Support / Developer session and started ordinary Google
  sign-in for the staff identity. Google reached **Complete sign-in using your
  passkey**. The user must finish verification personally; no password, passkey,
  verification code, cookie or session was fabricated or collected.
- At the final check, that Google sign-in tab was no longer present. The surviving
  localhost tab still showed Support / Developer, so staff sign-in was not verified.
- The prepared development administrator still needs its own genuine Google
  sign-in. Support / Developer access is not counted as administrator acceptance.

Role details recorded without personal identifiers: ordinary `staff`, active,
one synthetic assigned branch; prepared `admin`, awaiting verified sign-in;
development `SUPPORT_DEVELOPER` used only for account preparation. Neither the
staff email nor Google subject/user ID is part of this release report.

## Normal-browser connection

The supported extension browser selector failed twice with
`Browser is not available: extension`. Read-only plugin diagnostics found Chrome
running and its native host manifest valid, but the required browser extension
not installed/enabled. The user was asked to connect it through Codex Settings →
Computer use and open localhost in Chrome.

The embedded browser remains usable for sign-in but its previously established
native-prompt limitation cannot satisfy archive acceptance. No replacement prompt,
alternate automation transport or manual API archive is counted as a normal-browser
archive/restore pass. The browser-control instructions require extension recovery
through the supported UI; the native host was not installed or repaired manually.

## Required browser results

BLOCKED / NOT RUN below means the required browser identity or capability was
unavailable. It is neither a passing test nor evidence of a tested application
failure. Earlier automated proofs are not substituted for these browser checks.

| Requested acceptance | Result | Exact gate |
| --- | --- | --- |
| 1. Restricted staff sign-in | BLOCKED / NOT RUN | Google passkey verification pending; account preparation succeeded |
| 2. Restricted branch visibility | BLOCKED / NOT RUN | Requires authenticated staff session |
| 3. Restricted appointment list/direct read/filter/date/polling | BLOCKED / NOT RUN | Requires authenticated staff session and actual browser requests |
| 4. Restricted assigned/unassigned create/edit rules | BLOCKED / NOT RUN | Requires authenticated staff session |
| 5. Assignment invalidation after administrator change | BLOCKED / NOT RUN | Requires genuine staff plus administrator sessions; no assignment removal was attempted |
| 6. Authorized/unauthorized appointment files and admin access | BLOCKED / NOT RUN | Requires genuine sessions and synthetic appointment file fixtures |
| 7. Native-prompt appointment archive | BLOCKED / NOT RUN | Normal browser not connected; administrator sign-in pending |
| 8. Restore, no duplicate and stable polling | BLOCKED / NOT RUN | Depends on actual normal-browser archive and administrator session |
| 9. Administrator regression | BLOCKED / NOT RUN | Prepared administrator Google sign-in pending |

No new clinical appointments, patient rows or uploaded files were created in the
shared development database for this blocked browser attempt. Disposable automated
fixtures below remained isolated. Staff assignment/activation remain in development
so genuine-role acceptance can resume. There was no need to restore a removed
assignment because the invalidation test never started.

## Console/network findings and defects

The initial localhost navigation produced ERR_CONNECTION_REFUSED while the app
was stopped; this was a development-process availability issue, resolved by restart.
The old tab also produced a browser-controller focus timeout; a fresh tab recovered.
These are not appointment-loading defects. The support account's preparation UI
completed with normal polling and no captured warning/error console entries in
the inspected interval. Required staff/admin network and payload-leak inspection
has not run because authentication is incomplete. Do not interpret absence of a
captured error in preparation as successful restricted-role acceptance.

No application fix was made. The first temporary shared/support patch assembly
omitted its appointment-role helper dependency, causing the support access test
to fail. Adding the **existing** helper to that temporary assembly resolved it.
This identified a patch-boundary dependency, not a defect in repository code.

## Per-patch Node 22 validation

Performed while browser authentication was pending. These are provisional source
patch validations, not post-browser release sign-off. All snapshots started from
`97444c49d7e5f19dddea20dfd474290b551deae0`, used Node **22.23.3**, installed the existing
lockfile in fresh Linux containers and used explicitly disposable PostgreSQL 17
databases/files. No Git worktree/index manipulation, staging or repository source
rewrites were used to assemble patches.

| Source patch assembly | Result | Validation |
| --- | --- | --- |
| A: loading alone on committed baseline | PASS | 16 loading scenarios; baseline RBAC/audit; 54 PostgreSQL checks; TypeScript; production frontend/backend build |
| B: read/file security alone on committed baseline | PASS | 236 read/file authorization assertions; baseline RBAC/audit; 54 PostgreSQL checks; TypeScript; production frontend/backend build |
| E: shared cache/support with A+B prerequisites | PASS after correcting temporary dependency manifest | 32 patient/visit/directory/cache/profile checks; 6 protected cache checks; 122 support API/file checks; 13 support panel renders; 28 activation checks; RBAC/audit/login policy; 16 loading; 236 authorization; 54 PostgreSQL; TypeScript/build |

A consists of selected loading/error-transition/ready-batch hunks in
`AppointmentsDashboard.tsx`, `dataClient.ts`, `branchAccess.ts`, plus
`appointmentSubscriptions.ts` and the focused loading test. It excludes global
support cache invalidation and the new role alias. The temporary assembly preserves
the baseline legacy role constants and original visit-read behavior.

B consists of appointment list/direct-read transaction/scope hunks in
`backend/dataApi.ts`, strict `string-in` in `backend/database.ts`, the appointment
file-read check in `server.ts`, the policy helper and focused security tests. Its
temporary helper retains the existing admin/lowercase-support global roles, so B
does not depend on development account activation or alias changes.

E overlays the current shared/cache/support runtime and tests on A+B. It must
also overlay `backend/appointmentReadAccess.ts` with its current central role
import; otherwise the uppercase support role incorrectly retains B's standalone
legacy scope. That dependency is now recorded and tested. The source assemblies
exercise code/test boundaries; documentation and npm convenience script entries
still need review when the final patches are actually prepared.

Local reproducibility evidence, outside Git:

- `/private/tmp/vine-final-patch-validation.py`: assembly and test runner.
- `/private/tmp/vine-final-patch-validation-results.json`: final passing steps,
  exact per-group source hashes, baseline and declared prerequisites.
- `/private/tmp/vine-final-patch-initial-results.json`: initial diagnostic failure.
- `/private/tmp/vine-final-acceptance-source-snapshot.json`: repository candidate
  hashes before this acceptance run.

Test suites initialized only disposable test schemas using the existing migration
files; no shared development or production schema was migrated. Temporary
assemblies, dependencies, test databases/containers and uploads were removed.
The existing large-bundle and package-deprecation warnings were left unchanged.
No Google browser acceptance is implied by synthetic server sessions in tests.

## Sensitive-data review

Reviewed tracked modifications and untracked source/docs by path, with targeted
email and credential-pattern checks. Findings were reviewed in context:

- No new captured token, cookie, session, SSH private key, OAuth client secret,
  credential-bearing database URL, patient export or actual uploaded file was
  found in the candidate source file set by the targeted checks.
- Matches in tests were deliberate in-memory synthetic sessions, passwordless
  loopback test-target strings and generated disposable credentials; test URLs
  in operating instructions used explicit placeholders. Those are not real
  authentication material and must not be replaced by real captured values.
- `scripts/configure-development-accounts.ts`,
  `scripts/verify-support-development.ts` and `docs/support-developer-access.md`
  already intentionally name the previously user-authorized development accounts.
  Keep these in their separate development workstream and review before sharing.
- Removed personal account identifiers from the earlier security release's
  identity inspection bullets. The new acceptance report uses role/scope details
  only. Existing examples/placeholders elsewhere are not real test identities.
- `.env`, `data/`, `dist/` and `node_modules/` remain ignored. No generated upload,
  screenshot, browser capture or database dump was added to source control.

The scan is limited evidence, not a guarantee. Review the exact proposed staged
diff again when staging is later authorized. No staging was performed here.

Files that must remain out of commits: `.env`, actual keys/credentials, private
SSH materials, OAuth/session/cookie captures, database/export files, all uploaded
patient/test files, browser captures, generated builds/dependencies/logs, temporary
patch snapshots and unsanitized session artifacts. Synthetic identifiers in test
source are intentional only when clearly non-sensitive. Do not bundle development
account provisioning or infrastructure history into appointment-only commits.

## Closure and next actions

10. Console/network: preparation evidence only; authenticated staff/admin review
    remains pending. Expected simulated authorization denials in automated suites
    are distinguished from unexpected browser failures.
11. Defect/fix: no confirmed application defect; temporary patch dependency corrected
    without repository code changes.
12. Per-patch Node 22: PASS for the declared source assemblies; repeat affected
    checks if acceptance exposes a fix or final assembled patch content changes.
13. Sensitive review: no new secret found by targeted checks; identity-bearing
    development tools require separate review; release-note identifiers sanitized.
14. Uncommitted/private artifacts: exclusions listed above; all work remains unstaged.
15. Appointment loading ready to close: **NO**, native-prompt and genuine-role
    browser acceptance remain incomplete.
16. Appointment read/file security ready to close: **NO**, genuine staff/admin
    browser direct/read/file/scope-change checks remain incomplete.
17. Clean release commits can now be created: **NO final sign-off**; boundaries
    have provisional Node 22 evidence, but acceptance and final diff review are
    required. No commit is authorized by this report.
18. Separate Phase 1 work: support sign-in logging alias policy, backup restoration,
    private-file backup scheduling, staging and representative performance remain
    independent tasks. Existing bundle/JSX warnings and global settings subscriptions
    were not changed or folded into appointment acceptance.

Resume by signing in as the prepared staff and completing Google verification, connecting the
normal browser extension and signing in with the prepared development administrator.
Then run the nine browser checks above, restore the staff synthetic assignment
after invalidation, inspect console/network and record actual PASS/FAIL evidence.
Do not close either workstream based on the passing automated checks alone.

## Subsequent user direction — interactive Support account only

The user has directed all interactive development and browser testing to use the
existing Support / Developer account. This supersedes the request to continue
interactive staff/admin authentication unless the user later explicitly requests
another identity. Do not continue the staff passkey flow under this preference.
No role, account activation, branch assignment or production setting was changed
by recording this direction. The already prepared staff profile remains in its
development state.

Run ordinary-role authorization checks through the existing disposable synthetic
suites. Actual staff/admin browser coverage stays unverified/deferred; Support
workflow results cannot substitute for it. Normal-browser archive/restore still
requires a connected browser with native prompt support. Prior acceptance results
above remain historical evidence and are not converted to PASS by this change.
