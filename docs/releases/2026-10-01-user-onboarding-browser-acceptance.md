# Reliable User Onboarding — browser acceptance

Status: **partially accepted locally; employee-session browser checks pending**.
No schema, authorization rule, invitation feature, production change, commit, push
or deployment. This records the acceptance pass after the initial implementation.

## Environment and evidence boundaries

The development app at `http://localhost:3000` uses isolated Dokploy PostgreSQL
through the existing SSH tunnel. A fresh in-app browser tab recovered inspection
after the earlier tab's control timeouts. Mark's genuine Google account was used
for Support / Developer actions; it was never downgraded, disabled or archived.

The request explicitly permits a separate test Google identity. Its email was
requested but not supplied during this pass. One disposable profile named
**Release 1 Browser Acceptance (synthetic)**, email
`browser-onboarding-20261001@acceptance.invalid`, was therefore created through a
guarded fixture tool solely to test administrator controls. It had **no Google
identity and no authentication session**. No fabricated cookie, provider identity
or employee browser session was used. Admin UI results cannot prove employee
first-sign-in, effective restricted access, session revocation or initial branch
selection in a real browser.

## Acceptance results

PASS/FAIL applies to completed checks. BLOCKED means a required browser scenario
could not be executed; an automated pass does not convert it to browser acceptance.

| Requested check | Browser result | Evidence and remaining gap |
| --- | --- | --- |
| 1. Existing Support / Developer sign-in | **PASS** | Two genuine Google sign-ins, logout and full reload. Support / Developer, both configured clinics, Settings, all developer navigation options, System overview and Database status remain available. Database comparison confirms role, activation, assignments and default configuration unchanged. |
| 2. Pending-account experience | **BLOCKED** | Admin Pending activation tab and actionable readiness tested. Actual employee first-sign-in, pending notice, refresh/re-login and protected-data denial need the separate Google identity. |
| 3. Approval workflow | **PASS for admin controls; BLOCKED for employee access** | Assigned BGC, then ROCKWELL, selected ROCKWELL default; real approval endpoint returned 200. The profile left Pending activation and appeared active with the same ID and configuration. Employee post-approval sign-in/access is unverified. |
| 4. Approval error/retry | **PASS for exercised cases** | Missing clinic blocks approval with a specific requirement. An intentionally invalid default on the disposable pending fixture produces specific guidance. A browser-intercepted 503 leaves the account pending with no activation audit; visible Retry action succeeds against the real development server after clearing interception. Missing/invalid roles and other malformed defaults are covered by automation, not claimed as browser checks. |
| 5. Repeated confirmation protection | **PASS** | Hold one activation Fetch request: Saving and Cancel are disabled, and one intercepted request exists. After the induced failure, one deliberate retry returns 200 and creates one activation transition/audit. Later reactivations were separately requested recovery tests, not duplicates. |
| 6. Pending → approved session transition | **BLOCKED** | The unlinked fixture cannot sign in. Simulated-provider PostgreSQL/HTTP concurrency checks pass; genuine employee session transition remains unverified. |
| 7. Disable session invalidation | **BLOCKED for browser session** | Disable/re-enable admin UI and real endpoints pass after fixing hidden inactive accounts. The fixture had no session to revoke. Real signed-in employee denial and cached-data clearance remain unverified; automated session checks pass. |
| 8. Archive session invalidation | **BLOCKED for browser session** | Archive/restore admin UI and endpoints pass. Same profile ID, assignments and prior lifecycle audits survive archive. The fixture had no session; employee revocation/denial/cached-data behavior remains unverified. |
| 9. Default-clinic validation | **PASS for configuration; BLOCKED for employee initial selection** | One/two assignments, explicit valid default, invalid/unassigned default guidance and successful reactivation with null optional default verified. Persisted state matches admin controls. Actual newly approved employee's initial branch selection is unverified. |
| 10. Responsive inspection | **PASS for exercised admin screens; BLOCKED for employee pending screen** | Readiness, assignment controls and confirmation/error/retry inspected at desktop, tablet and mobile widths. Final checks include 1440 and 390 CSS pixels and a tablet panel at 853 CSS pixels; earlier error modal checks used 1440/768/390. No page-wide overflow; action controls remain reachable and clinic names readable after the tablet fix. Actual signed-in pending employee screen still needs its identity. |

The registered pending notice is:

> Your Google account is registered and awaiting administrator approval. Ask your clinic administrator to assign your role and clinic access, then activate your account. Sign in again with the same Google account after approval.

That text is verified by source/component checks. **It was not observed after a
real first employee sign-in in this pass.** The administrator screen displays:

> Employees sign in with Google first. Open Pending activation, assign their role and clinics, then approve their access.

The failed confirmation visibly displays:

> Synthetic temporary approval outage. Please retry. Retry the action, or cancel to review the account settings.

## Browser-discovered defects and exact fixes

1. **Disabled users disappear from every account tab.** The pre-release filter
   includes active, pending and archived users only. After successful disable, the
   existing Activate action becomes unreachable. Add an Inactive users filter for
   existing non-archived, non-pending inactive profiles, including legacy disabled
   profiles without accountStatus. Preserve all existing lifecycle endpoints,
   permissions, self/developer safeguards and other tab semantics. Browser retest
   locates the same disabled profile and successfully reactivates it.
2. **Account/clinic controls crowd narrow tablet panels.** The pre-release row
   enables fixed minimum desktop columns at `sm`, despite the sidebar reducing
   available panel width. Account text crosses into action space and branch/default
   controls truncate. Enable the existing desktop row at `xl`, stack expanded
   role/clinic controls below `lg`, and use fewer clinic columns until `xl`. Wrap
   account-status tabs and their adjacent action. Final screenshots and DOM bounds
   show full clinic names, reachable action buttons and rows without overflow.

Both defects existed before this onboarding implementation. No backend policy or
database structure was changed in this acceptance pass.

## Console and network findings

Browser warn/error reads returned no uncaught application errors. Sampled normal
API responses and observed lifecycle requests succeeded. The 503 was deliberately
fulfilled by the browser test interceptor; it did not reach the server or partially
activate the profile. Interception was restricted to that fixture's activation Fetch
request and then cleared. Viewport emulation was also cleared at the end.

The browser network event buffer evicted older events during long polling, so this
is **not an exhaustive request trace**. Immediate hold/retry observations and the
stored lifecycle audit counts substantiate the tested repeated-confirmation case.
No broader assertion about every historical request or revoked employee payload is
made. Expected negative authorization responses in automated suites are separate
from these browser observations.

## Final automated validation

After both fixes, the full source snapshot passed on **Node 22.23.3/PostgreSQL 17**:

| Suite/check | Result |
| --- | --- |
| Onboarding PostgreSQL/HTTP | 82 passed; simulated Google provider, real HTTP, transactions, sessions and audits |
| Onboarding guidance/components/visibility | 48 passed; pure/static rendering, including eight account-discovery regressions |
| Development activation | 28 passed; simulated provider/in-memory |
| Support / Developer access | 122 passed; HTTP/in-memory |
| Support subscriptions/cache | 6 scenarios passed |
| Support tool panels | All 13 render |
| Shared data/profile/cache | 32 passed |
| Appointment loading | 16 scenarios passed |
| Existing PostgreSQL integration | 54 passed |
| Appointment read authorization | 236 passed |
| Parity/shared clinical/upload/audit | 142 passed |
| RBAC, audit policy, login activity, Developer policy | All four suites passed |
| TypeScript and production build | Passed |
| Whitespace/diff review | Passed; existing unrelated changes preserved |

All 15 suites passed. The existing bundle-size warning and unchanged lockfile's
eight moderate dependency audit findings remain outside scope. The first disposable
database setup attempt failed before tests; its readiness probe was corrected to
wait for the final TCP listener rather than PostgreSQL's initialization socket.
The private test harness change is not an application change. Its container was
removed, and subsequent complete runs passed. Final sanitized command results are
in `/private/tmp/vine-release1-onboarding-results.json`.

## Fixture retention and cleanup

Archive retained the same synthetic ID, role, two assignments, explicit default,
and prior successful activation/deactivation audits. Restore retained that ID.
A later optional-default recovery check completed with two assignments and null
default. Final intentional lifecycle counts: three activations, two deactivations,
one archive and one restore. The fixture never had a login session or identity.

After verification, removed exactly this task's profile and its 13 generated
test-only audit entries. Evidence snapshots remain private under `/private/tmp`.
Final development baseline: **one user/one identity (Mark), two clinics, three
settings documents, nine existing audit entries**, no synthetic profile, no patients
or appointments. Legitimate Support sign-in activity remains. Mark's access fields
were compared with the pre-fixture snapshot and are unchanged. App and PostgreSQL
health endpoints return 200. All disposable automated databases/uploads were removed.

## Files changed in this acceptance pass

- `src/components/AdminSettings.tsx`: inactive tab/count/empty state and narrow
  account/assignment/tab layout corrections.
- `src/utils/userActivation.ts`: typed account-view matching, preserving existing
  view semantics and exposing disabled-account recovery.
- `scripts/test-user-onboarding-ui.ts`: eight lifecycle-discovery regression checks.
- `ROADMAP.md`, `CHANGELOG.md`, `DEVELOPMENT.md`, `docs/user-onboarding.md`:
  updated local acceptance status and inactive-account recovery/test instructions.
- `docs/releases/2026-10-01-reliable-user-onboarding.md`: updated candidate evidence.
- This new acceptance record.

This is nine repository files. The wider worktree includes prior onboarding,
appointment/security/support changes; they must not be committed indiscriminately.
No backend file was changed in this pass. Recovery reverses these narrow UI/helper/
test changes while preserving prior work. No schema rollback is required.

## Commit, closure and next release

**Ready to commit as a fully accepted Release 1: no. Release closed: no.** The
remaining gate is a genuine separate employee Google identity covering pending
registration, approval/session transition, effective restricted access, initial
clinic selection and disable/archive cache/session behavior. Pending guidance also
needs responsive browser inspection under that identity. No invitation work began;
keep its separate proposal queued until this acceptance gate is complete.

A separate audit review may clarify whether paired `configuration_or_note_changed`
and `record_activity` entries for one assignment write are intentional. This existing
behavior was observed but not changed; lifecycle transitions each retained their
single expected audit. Dependency remediation and bundle work also remain separate.

## October 2 follow-up: authorized Google employee identity

The user authorized `vineaesthetics.marketing@gmail.com` specifically for restricted
development employee acceptance. A guarded read-only query confirmed that this
identity already has exactly one linked Google identity and an existing pending
Staff profile (`active: false`, `accountStatus: pending_activation`, no assigned
clinics, null default). This is an existing-account sign-in test; creation of its
first profile was not observed in this follow-up. No provisioning tool, role
promotion, identity replacement or profile mutation was performed. Mark's existing
active `SUPPORT_DEVELOPER` role and clinic/default configuration remain unchanged.

Opened a fresh development browser tab and followed the normal Google OAuth flow:
Sign In with Google → Use another account → supplied employee email. Google asks
to complete sign-in using a passkey. The browser was handed to the user at that
challenge. Until the user authenticates, pending guidance/protected-data checks,
employee approval/session transition/default clinic, signed-in disable/reactivate,
archive/restore and employee responsive/console/network checks remain **BLOCKED**.
No Google authentication challenge was bypassed, and no session was fabricated.

The connected in-app browser advertises visibility and viewport capabilities,
but no separate profile/context capability. Separate ordinary-browser administrator
sign-in was requested so that approval and revocation can be tested while the
employee session is active. Tabs in the same browser are not treated as isolated
identities. No production tabs, records or services were modified.

The complete isolated Node 22.23.3/PostgreSQL 17 validation was rerun: **all 15
suites passed**, including 82 onboarding PostgreSQL/HTTP checks, 48 onboarding
guidance/component checks, 236 appointment read-authorization assertions and
the existing RBAC/audit/session regressions. TypeScript, production build and
`git diff --check` passed. All 19 harness commands exited successfully, and its
disposable PostgreSQL container/databases/fixtures were removed. These use
synthetic identities and a simulated Google provider, not real employee browser
authentication. Existing bundle/dependency warnings remain outside this release.

No application code or database/schema changes were made during this follow-up;
only this acceptance record was updated. The existing pending development employee
profile was retained unchanged. Release 1 is **not yet ready to commit or close**:
the remaining real employee browser checks require authentication and the separate
administrator session. No commit, push or deployment was performed.

### Employee sign-in after user-confirmed approval

The user subsequently confirmed approval from the developer account and confirmed
that Mark remains signed in through a separate ordinary browser. A guarded
development read found the same employee profile ID now active as Staff, assigned
only to BGC, with BGC as its default. Mark's Support / Developer access fields
remain unchanged. The approval click and earlier pending guidance were not observed
by the browser controller; they must not be counted as controller-verified evidence.

Clicking the normal Sign In with Google button in the employee browser now returns
to the authenticated workspace as **Marketing Vine Aesthetics / staff**. The
Overview defaults to BGC, and the clinic selector contains BGC only. Appointments
loads successfully with its empty development schedule and only BGC as a named
clinic filter. Restricted mobile navigation contains the existing employee modules
and no developer tools.

Inspected employee Appointments at 1440×900, 768×1024 and 390×844 CSS pixels.
Document scroll width equals viewport width at each size. Tablet/mobile screenshots
show readable clinic/filter/action controls; mobile navigation opens successfully.
These verify approved employee screens, not the unobserved pending screen. Viewport
override was reset after testing. Console warn/error reads returned no entries.
The sampled appointment API responses were all 200, with no failed network events
or event-buffer truncation in that observation interval; this is not an exhaustive
session trace.

Asked the user to disable only the employee through Mark's separate browser while
leaving the observed employee session open. That action is pending. Disable/session
invalidation, reactivation, archive/session invalidation and restore remain
unverified in the employee browser. No application code or account state was changed
by the controller. Release acceptance remains incomplete until those checks and
the pending-account evidence gap are resolved.
