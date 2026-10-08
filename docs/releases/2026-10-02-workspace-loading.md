# Repeated workspace loading audit and incremental fix

Date: October 2, 2026 (Asia/Manila). Local development only. No commit, push,
deployment, schema change or production mutation.

## 1. Exact renderer and readiness chain

The reported message is `Loading {workspaceName} workspace...` in
`src/components/BranchDashboard.tsx`. Before this change it waited for patient,
appointment and visit subscription callbacks, with three component-local
`loaded` flags. This was Overview page data readiness, not session bootstrap.

The separate App bootstrap originally displayed an unlabelled full-screen spinner
while `loading || !brandingLoaded`. Authentication waits for `/api/auth/session`,
requires a Google provider, reads the current user profile, and validates active
status and a known RBAC role. Branding's first result or fallback completes the
other flag. Footer, timezone, branches and clinical collections are independent
subscriptions; they do not all need to block the application shell.

App now also refuses to render protected pages with an unresolved profile/role.
The initial spinner is labelled `Loading workspace...`. Identity transitions
clear the previous profile, invalidate protected subscriptions and establish the
new identity before showing pages. An in-flight old-identity bootstrap cannot
publish its profile after the session identity changes. Failed profile bootstrap
shows a retry state instead of an apparently authorized shell.

## 2. Confirmed root cause

Module navigation conditionally mounts each page under App. Leaving Overview
unmounted BranchDashboard, discarded its three datasets/readiness flags and
stopped all three subscriptions. Returning mounted it afresh, issued all three
queries and showed the message until their responses arrived. Changing the
selected branch also changed the protected page container's key, remounting it.

A second confirmed code cause was object-identity dependencies: App's branch
subscription and PatientDashboard's five-source effect depended on the whole
profile object. A changed profile document, including a display-name-only edit,
therefore restarted them; PatientDashboard cleared all five datasets and reset
its page loading flags. Unchanged poll payloads are already deduplicated by
onSnapshot and did not cause callbacks or this reset.

## 3. Mounts and route architecture

App, session module, branding/footer/timezone subscriptions and TimezoneProvider
are above the page switch and persist. Browser Fiber identity instrumentation
observed one App and one TimezoneProvider throughout each navigation sequence.
BranchDashboard remounted on return; this remains safe now because it consumes
persistent overview data rather than owning its subscriptions. The existing
protected-container key still remounts page state on user/access/branch changes.

There is no React Router in this app: modules use `activeView` state and button
handlers calling `navigateTo`. There are no duplicated route workspace providers.
No new routing framework, retained-page cache or state-management library was
introduced.

## 4. Loading transitions

Before: App loading started true and became false after session/profile bootstrap;
brandingLoaded started false and became true on the first branding result or
fallback. Neither flag reset on module navigation. BranchDashboard's three flags
started false on every mount and became true on collection results. Patient page
flags reset in its profile-object-dependent subscription effect.

After: session identity establishment is the only new `setLoading(true)` trigger.
The App auth listener does not fire for same-user session polling or module clicks.
Overview readiness lives in App's useWorkspaceOverview hook, keyed by user ID,
role, active/archive status and normalized assigned branch IDs. Names, profile
object identity, module selection and the selected branch do not change that
access scope. A material scope change synchronously hides old overview rows even
before the new subscription effect runs. Disposed callbacks cannot publish.

## 5. Request/subscription classification

| Request | Classification and observation |
| --- | --- |
| GET /api/auth/session | Established workspace/session state; initial request and existing 30-second poll; zero route-triggered calls before or after |
| POST /api/data/query, users/current-user | Workspace state; bootstrap read plus persistent five-second profile poll; initial duplicate read remains, no route-triggered restart |
| settings/branding, settings/footer, settings/timezone | SHOULD BE WORKSPACE-CACHED in existing live state; already persistent five-second subscriptions; no route-triggered restart |
| branches from App | SHOULD BE WORKSPACE-CACHED in existing live state; persistent five-second subscription; now ignores descriptive profile changes |
| patients/appointments/visits from Overview | Persistent live workspace data after fix; previously three fresh subscriptions on every Overview return |
| Appointment/Patient/Visit page datasets | PAGE-SPECIFIC mount-time queries; five sources per page; archive constraints/scoped reads may differ, so no speculative consolidation |
| Identical branches/users/shared collection reads from multiple mounted consumers | DUPLICATE data work remains; potential separate performance improvement |
| Strict Mode mount-effect requests | DUPLICATE in development: effects run setup/cleanup/setup; canceled requests are still visible in network tracing; Strict Mode was preserved |
| Dedicated workspace bootstrap endpoint | None exists |

Polling is unchanged at approximately five seconds after each response. Identical
payloads do not publish again. Valid background overview, branch and settings
state now stays available after transient failures, with warnings. Authorization
401/403 failures clear protected data rather than retaining it.

## 6. Navigation/document evidence

Executed the requested Overview → Appointments → Patients → Overview → Visits →
Appointments sequence in a separate localhost:3001 preview serving the actual
React/Vite source and synthetic read-only HTTP responses. No real identity,
cookie, database or clinic records were created. The preview supplies a simulated
Google session; this is UI evidence, not interactive OAuth acceptance.

Document performance.timeOrigin and URL remained unchanged through both measured
sequences. Module navigation uses buttons, not document links/window.location.
OAuth entry and the explicit bootstrap Retry action intentionally navigate/reload.

The clinic tab at localhost:3000 was signed out and was left intact. Early polling
observations interrupted by unrelated development hot reloads were discarded;
final polling/failure checks used an isolated preview with file watching disabled.

## 7. Exact fix and files

- src/hooks/useWorkspaceOverview.ts: App-owned live patient/appointment/visit
  subscriptions, stable access scope and synchronous removal of mismatched data.
- src/utils/workspaceOverview.ts: initial/refresh/denial state transitions,
  generation disposal and normalized access identity.
- src/components/BranchDashboard.tsx: consume the live state, retain genuine
  initial loading, and distinguish initial errors from background warnings.
- src/App.tsx: own overview state, stabilize branch effect dependencies, preserve
  branches/settings during transient refresh failures, label bootstrap and gate
  unresolved identity/profile state.
- src/components/PatientDashboard.tsx: use stable access dependencies rather than
  the entire descriptive profile object.
- scripts/test-workspace-overview.ts and package.json: 28 targeted state/security
  regressions and a test command.
- scripts/preview-workspace-audit.ts: explicitly opt-in synthetic UI preview and
  request/loading/Fiber instrumentation, with no real backend imports.
- This report and accompanying synthetic browser evidence JSON/screenshot.

Other dirty workspace files predated this task or belong to separate development
work and were preserved.

## 8. Before/after navigation observations

| Observation | Before | After |
| --- | --- | --- |
| Return to Overview: fresh clinical queries | 6 in Strict Mode (3 logical sources) | 0 |
| Return to Overview: workspace-loading transition | Present | Absent |
| Return to Overview: loader dwell | About 191 ms | 0 ms |
| Return to Overview: automation click-to-ready observation | 375 ms | 272 ms (final pass) |
| Route-triggered auth/profile/settings bootstrap | 0 | 0 |
| App / TimezoneProvider mount identities | 1 / 1 | 1 / 1 |
| Document navigation on module clicks | None | None |

Timings include browser automation overhead and a controlled 180 ms response delay;
they are representative synthetic observations, not production benchmarks.

Other module click-to-ready observations were Appointments 517/481 ms, Patients
688/485 ms, Visits 339/273 ms, and the final Appointments transition 505/588 ms
(before/after). Their own loading is permitted and no general speedup is claimed.
An overlapping background poll occurred during the baseline Patients observation;
its raw request total must not be presented as route-only work. Development page
mounts still issue ten requests for their five sources under Strict Mode.

## 9. Background, branch and access acceptance

A stable 25.8-second observation covered five polling groups without any workspace
loading transition or document change. Temporary synthetic 503 failures retained
Overview data, branch choices, branding and timezone/footer state and showed
non-blocking warnings; successful polls remove those warnings.

Changing the selected branch filters the established authorized overview data;
no new authentication bootstrap is required. Material role/assigned-branch changes
remove old page/dialog state through the existing container key and invalidate
protected subscriptions. Browser testing of Support → Staff with only branch B
removed Developer controls and the All branches option, revalidated Overview,
and displayed only branch B. This authorized-context change appropriately showed
a brief Overview data-loading transition (about 198 ms).

A synthetic protected collection 403 removed all overview records and showed an
access/retry state. Current-profile 401 handling was also checked for protected
shell removal and return to sign-in.

Initial launch and deliberate hard refresh still bootstrap the workspace. Real
OAuth/session restoration in the clinic tab remains a manual acceptance step.

## 10. Authentication/authorization regressions

All requested checks ran against synthetic data and isolated disposable local
PostgreSQL databases, never shared development or production:

- 28 workspace overview initial/refresh/denial/scope/disposal checks.
- 16 appointment loading scenarios.
- 236 appointment read-authorization assertions.
- 32 shared patient/visit/directory/cache/profile checks.
- 142 clinical/shared-data/upload/audit parity checks.
- 54 PostgreSQL/session/authorization/inventory checks.
- 82 user onboarding PostgreSQL/HTTP checks, plus 48 UI guidance checks.
- 122 Support access route checks, 6 protected-cache/scope checks, all 13 Developer
  panels, 28 development activation checks, RBAC/audit/login/Developer policies.

## 11. Node 22 and final validation

Authoritative runtime: Node v22.23.3 from node:22-bookworm-slim, fresh npm ci using
the existing lockfile, isolated source snapshot, disposable PostgreSQL 17.
TypeScript and production build passed. A final Node 22 snapshot rechecked
TypeScript/build and the workspace/shared-data/cache suites after the background
settings and session-transition adjustments. Containers, databases, fixtures and
snapshot dependency directories were removed. Whitespace/diff checks passed.

## 12. Remaining performance concerns

Full clinical collection polling is still performed for the overview and active
page. Moving Overview ownership above navigation deliberately keeps its three
pollers alive while other modules are open; overlapping page queries remain.
Pagination, query deduplication and incremental refresh deserve separate measured
work rather than extending this fix. The approximately 1.26 MB minified frontend
bundle still triggers Vite's existing chunk-size warning. Production latency was
not measured.

## 13. Browser acceptance readiness

Ready for authenticated acceptance on localhost:3000: sign in normally, repeat
the sequence, select branches, wait through polling and hard refresh. Synthetic
browser evidence and real server/DB authorization regressions are complete;
interactive Google authentication was not performed. No production release was
made or authorized.

## 14. Separate issues kept outside this release

Browser Back returned the synthetic test tab to about:blank; Forward loaded the
preview and performed its normal initial bootstrap. Module selection does not
create history entries or persist the selected module
in the URL. Back/Forward therefore cannot traverse modules; it traverses document
history, and a hard refresh returns to the existing default Overview. This was
present before the fix and is not the loading root cause. Adding history/deep
links needs its own small routing task and acceptance criteria.

VisitHistoryDashboard currently calls Promise.all on unsubscribe functions rather
than waiting for collection callbacks, so its skeleton can disappear before data
arrives. That independent page-readiness issue was reported, not changed here.

The isolated lockfile install reported eight moderate dependency vulnerabilities;
no dependency updates or automatic audit fix were included in this UX release.
