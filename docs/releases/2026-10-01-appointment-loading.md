# Reliable appointment loading — local release candidate

Status: implemented locally; not committed, pushed or deployed.

## Root cause and scope

AppointmentsDashboard used Promise.all on unsubscribe functions, so loading ended
immediately after subscription setup. It did not provide error callbacks. Staff
branch queries could emit partial merged data before all query chunks completed.

The dashboard now waits for appointments, visits, patients, users and branches.
Initial failures show an alert with retry instead of the empty schedule. Transient
refresh failures preserve previously loaded data with a warning. Authorization
failures invalidate readiness and hide cached schedule content. HTTP error status
is retained by the data client for that distinction.

Each subscription generation ignores callbacks after disposal. The dashboard keys
its load state to active branch, profile identity, role and assigned branches;
previous-scope data is hidden immediately and subscriptions are replaced. Existing
client-side filters and branch authorization queries remain in place.

Appointment/visit subscriptions opt into all-chunk readiness. Other callers keep
their existing partial-emission behavior. Polling remains five seconds. No database
migration, booking rule, editing/archive handler or layout redesign is included.

## Validation

- 16 controlled-response scenarios passed: delayed initial results, successful
  empty data, initial failure, reconnect, retained results, retry, authorization
  failure, late callback/error after disposal, multi-chunk readiness/failure/
  recovery, and actual A-slow/B-fast subscription ordering.
- Existing 54-check PostgreSQL suite passed in a fresh disposable local database
  with synthetic data; includes appointment registration, double-booking rejection,
  linked visits, access checks and visit archive/restore. Container removed after
  tests. This suite does not prove every appointment editing/archive UI path.
- TypeScript and production build passed. Existing large frontend chunk warning
  remains (~1.25 MB uncompressed).
- Browser development smoke check: signed in, opened appointments, observed the
  loading skeleton followed by a successful empty schedule with existing controls.
- Browser acceptance results and remaining limitations are recorded below.

## Browser acceptance — 2026-10-01

Environment: localhost:3000 against isolated vine_development, existing development
administrator. Only synthetic patients/appointments. Added synthetic provider
`acceptance-doctor` (no login identity) and branch `acceptance-branch-b` to enable
the workflow. Created one appointment for Demo Patient One in demo-branch through
the UI; edited from 19:00 Scheduled / Initial Consultation to 18:30 Confirmed /
Follow-up on 2026-10-01. Fixtures remain available for follow-up acceptance.

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| Initial loading / empty | PASS | With 2-second network latency, loading skeleton remained visible; successful completion showed No appointments found. Initial requests returned 200; no normal-loading console errors. |
| Existing appointments / filters | PASS | One saved row persisted across polls; search and status excluded/matched it correctly. Calendar showed it in October, not November; Today returned to October. |
| Create | PASS | Existing form saved patient, clinic, doctor, time, concern and notes; row appeared on polling without full-page refresh. |
| Edit | PASS | Time, status and visit type updated; only one appointment row remained, including after navigation/recovery. |
| Archive | FAIL in embedded browser | Existing window.prompt throws `prompt() is not supported`; no archive request completed. Archived visibility and subsequent polling cannot be signed off. Handler unchanged by this release. Retest in a normal browser with native prompt support. |
| Branch switching | PASS (administrator) | Held all five initial A requests, switched to B, released B first (empty schedule), then A; B stayed empty. Rapid A/B/A ended with only the A appointment. |
| Error / recovery | PASS | Offline initial request showed error, not empty. Offline refresh retained row with warning; Retry loading recovered. Automatic polling also recovered. |
| Authorization invalidation | PASS after fix | Injected appointment 403 hid cached schedule. 503 followed by 403 initially failed; after fix the same browser sequence hides the schedule and recovers on successful polling. This is client failure-handling coverage, not an independent proof of server RBAC. |
| Regression navigation / association | PASS except archive | Overview → Appointments reloads the same single appointment and correct synthetic patient/branch. Restricted-staff sign-in/branch restrictions were not browser-tested in this admin session. |

Direct defect fixed: onSnapshot formerly suppressed every error after the first
failure. A 403 following a temporary 503 therefore failed to notify the appointment
coordinator. dataClient.ts now deduplicates by transient versus authorization
failure class, preserving the polling interval and recovery callbacks. Added three
controlled scenarios covering escalation, repeated denial suppression and recovery
with unchanged data. TypeScript, production build and diff whitespace check pass.

Console/network: expected failed fetches during offline simulation and injected
503/403 responses; the existing global settings subscriptions log failures and
temporarily revert branding/branch options. One pre-existing outdated JSX transform
warning appeared with the calendar. Archive produced the unsupported prompt error.
No duplicate appointment state or wrong-branch replacement observed. Fresh post-fix
tab console was clean during normal loading/recovery. Network overrides and fetch
interception were cleared after testing; no application permission was changed.

Acceptance sign-off remains incomplete: retest archive in a native-prompt-capable
browser and verify restricted staff access. Do not mark Phase 1 complete or the
release fully ready to commit on the strength of this partial browser coverage.

## Remaining acceptance follow-up — 2026-10-01

Normal-browser connection was attempted through the supported extension surface;
it returned `Browser is not available: extension`. Only the embedded browser was
connected. Read-only diagnostics confirmed Google Chrome is installed, its native
host manifest is valid, and the required extension is not installed/enabled.
User was asked to connect the normal browser through Settings → Computer use and
sign in at localhost. No alternate automation or prompt replacement was used.

Development fixture inspection confirmed one active administrator with a real
sign-in identity, the synthetic provider with no sign-in identity, and the single
unarchived Demo Patient One appointment. No restricted development sign-in account
exists. The current admin functionality manages Google-sign-in-created profiles;
it does not create a synthetic Google login. A second verified development login
is needed before its role/branch assignments can be configured through the existing
admin workflow. No development account role or permission was changed.

Repeated automated checks passed: 16 loading scenarios; RBAC, audit,
developer-tools and login-activity policy suites; 54 PostgreSQL integration checks;
TypeScript; production build; whitespace check. Integration ran in a fresh local
PostgreSQL 17 container with synthetic data and separate private-file storage.
Container and temporary storage were removed. The normal large-chunk build warning
was left unchanged. Temporary probe setup errors (module extension, then conflicting
synthetic doctor times) were corrected in temporary files, without app changes.

A separate disposable server probe with staff assigned only b1 produced:

| Server operation | Actual result |
| --- | --- |
| Appointment query constrained to b1 | 200; only b1 records |
| Unfiltered appointment query | 200; also returned synthetic b2 appointment |
| Direct read of synthetic b2 appointment | 200 |
| Create appointment in b1 | 201 |
| Edit appointment in b1 | 200 |
| Create appointment in b2 | 403 |
| Edit appointment in b2 | 403 |
| Archive appointment as staff | 403 |
| Restore appointment as staff | 403 |

Thus the requested server-enforced restricted-branch read criterion FAILS. The
existing data API deliberately permits shared clinical continuity reads and trusts
frontend query constraints for this dashboard's appointment branch filtering.
This policy predates the loading release. No business rule or permission was changed
to satisfy the test. A separate Phase 1 task must reconcile shared clinical-history
reads with restricted operational appointment reads and enforce the agreed policy
server-side. The passing write probes are server tests, not restricted-staff browser
acceptance, and do not demonstrate frontend selectors or profile-change behavior.

Archive/restore in a normal browser, restricted-staff browser checks and the final
post-acceptance UI regression remain BLOCKED awaiting the external-browser connection
and development staff sign-in. No new browser console/network evidence was obtained
in this follow-up. Archive/restore must not be reported as passed merely because
other backend integration checks pass. Release acceptance remains unsigned; this
workstream cannot yet be closed. No application source changes were made in this
follow-up; only roadmap/changelog/release documentation was updated.

## Acceptance checklist

Use synthetic development data. Check list/calendar, search/status/branch filters,
new booking, editing, archive/restore, and rapid branch changes. Verify the warning
and retry with a temporary connection failure, then recovery. Confirm the original
layout and permissions remain intact.

## Recovery

No data rollback is needed. Revert the release's source changes and rebuild if
rejected. Do not revert unrelated local setup/documentation work. Production is
unchanged. Stage and obtain deployment authorization before release.
