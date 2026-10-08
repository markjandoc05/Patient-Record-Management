# Services 1B-B — Visit / Performed Service Integration

Local implementation candidate, October 2, 2026. Baseline
`19d5fcb142aaee4ea2e74bb9cb6d6858c7b63327` includes committed Services 1A and 1B-A.
No staging, commit, push, deployment or production migration is authorized here.

## Audit and integration

Committed VisitForm uses dedicated create/edit record routes and carried patient,
branch, clinician, time, visit type and notes from an appointment. `treatmentService`
had three hard-coded choices. History read that text; the timeline also used old
`servicePerformed`. Visits are JSONB; updates merge retained unknown fields. Creating
a linked Visit atomically links/completes the appointment, updates patient summaries
and writes trusted audit activity. Generic record writes reject Visits. Existing
clinical/provider/branch and link consistency restrictions remain.

The smallest safe integration adds the four optional performed snapshots to the
Visit routes and selector; the appointment's booked snapshot remains a separate fact.
See [write, history and older-version compatibility](../architecture/visit-service-compatibility.md).

A proposed booked Service needs explicit review/confirmation of current eligibility.
A different performed Service never rewrites booking identity/name/duration/version.
No-Service and legacy linked Visits remain possible. New canonical selections mirror
the authoritative name to legacy text; untouched free text remains exact. Existing
history labels prefer recorded snapshots, then text/servicePerformed and old fallbacks.

The server shares existing Services selection/version/eligibility validation and
transaction locking. Priced or explicit Free is required operationally; no financial
charge is captured. The writer's clinical permission and branch scope are current
inside the transaction. Structured version 409 blocks save until explicit review,
confirmation and resubmission. Persisted history cannot be erased by branch navigation,
retry, failure or stale async state. Old token/list/detail/save/follow-up responses and
401/403 cannot change the current protected workspace; current denials invalidate.

No existing signature/amendment workflow was found. Completed Visits remain editable.
Explicit seal markers are read-only; no new clinical amendment policy is introduced.
The audited pre-existing unlinked-Visit null-ID conflict exemption is documented in
compatibility notes; booking conflict and linked consistency rules are retained.

## Feature files

- `backend/visitServices.ts`: performed snapshot and legacy mirror retention.
- `server.ts`: Visit-only validation/wiring and transactional clinical authorization.
- `src/utils/visitServicePolicy.ts`: historical label and explicit seal rules.
- `src/components/VisitForm.tsx`: booked/performed display, intent/review and scope guards.
- `src/components/AppointmentServicePicker.tsx`: optional field label/ID for reuse.
- `src/utils/recordApi.ts`: optional lifetime guards for Visit create/edit.
- `src/components/VisitHistoryDashboard.tsx`, `src/components/PatientTimeline.tsx`:
  recorded labels and sealed edit affordance.
- `scripts/test-visit-services-api.ts`, `scripts/test-visit-services-ui.ts`:
  disposable PostgreSQL/HTTP and deterministic actual-component acceptance.
- `package.json`: two focused test commands only.
- ROADMAP, CHANGELOG, this note and the compatibility document.

Mixed files contain unrelated pre-existing work. A HEAD-plus-feature-only candidate,
review patch and manifest under `/private/tmp/vine-services-1bb` exclude those changes.
The real index remains empty. These artifacts are review aids, not commit approval.

## P2 save-intent repair

The independently rejected candidate guarded save responses by branch, protected
scope and request lifetime only. Its delayed version conflict could flag a different
performed Service, or a confirmed newer version of the same Service, as needing
review. Delayed success could also close the newer draft.

Each performed-Service transition now advances an immutable intent revision holding
its kind (unchanged/selected/removed), ID, version, branch and review state. A save
captures that exact intent plus the existing request/abort generation. Only a still
current intent may apply conflict/error UI, follow-up feedback or successful close.
Service A→B→A is a newer intent too. Current version conflicts still require explicit
review/confirmation and manual save. Current validation/network/5xx errors remain
visible and retryable. Authorization invalidation stays bound to protected scope:
a current-scope 401/403 still invalidates even after a Service choice changes;
a denial from a removed scope remains discarded by the existing adapter guard.

A stale successful create retains the authoritative returned Visit ID while leaving
the newer draft open, with a saved/unsaved status notice. The next save PATCHes that
same record, including after its linked booking or Visit list refreshes. This avoids
a duplicate create without rewriting snapshots or changing backend scheduling logic.
Stale initial success does not prompt/create a follow-up; a pending follow-up response
cannot alert or close over a newer Service draft. Unmount still aborts the request.

Twenty-six permanent scenarios cover both P2 reproductions, current conflict,
success, 5xx/network/validation errors, explicit removal, unchanged intent, intent ABA,
current-scope denials, linked/walk-in create identity and follow-up lifetime. The
corrected component suite passes **126/126**. Running it against the rejected isolated
candidate passes the original 100 and six controls but fails **20 new scenarios**,
including both reported old-409 races. Negative-control logs and the rejected patch/
manifest/report are preserved in `/private/tmp/vine-services-1bb-p2-repair`.

The original 15-path/41-hunk artifacts are superseded. Corrected patch, manifest and
hashes are regenerated in `/private/tmp/vine-services-1bb`; independent review is
required before staging. The repair changes only VisitForm, its component tests,
this release evidence, compatibility notes and current ROADMAP/CHANGELOG entries.
No backend, API adapter, migration or other source changes are part of this repair.

## Validation

The isolated baseline + Services 1B-B candidate passes all 18 required suites on
Node 24.15.0. Focused acceptance: **152 API checks and 126 component scenarios**.
Coverage includes same/different booked/performed identity, explicit proposal review,
legacy exact text, all eligibility states, authoritative/forged snapshots, branch intent,
version 409, orphan history, clinical seals, current transactional role/access loss,
generic-write denial, atomic audit rollback and delayed list/detail/save/token/follow-up
responses after branch/scope/ABA/logout/invalidation/unmount. Actual timeline/history
components verify recorded labels and sealed edit affordances.

Regression results:

| Suite | Result |
| --- | --- |
| Appointment Services API / UI | 92 / 92 passed |
| Services policy / UI | 74 / 76 passed |
| Services migration / API | 143 / 133 passed |
| Appointment read authorization | 236 passed |
| PostgreSQL / authorization / sessions | 54 passed |
| Clinical/shared parity / uploads / audit | 142 passed |
| Protected invalidation | 14 passed |
| Support access / panels / subscriptions / role selector | 124 / 13 / 5 / 14 passed |
| RBAC / audit policy | Both passed |

TypeScript and production build pass on Node 24.15.0 and **Node 22.23.3**. Node 22
also passes Visit API152/UI126 and Appointment UI92. The existing bundle-size warning
remains; no dependency or build-configuration changes are included. Expected invalid
CSRF and injected audit-failure logs are synthetic negative-test evidence.

Local Vine was restarted to load the routes: `/api/health` 200 with PostgreSQL OK;
app shell 200. No development catalogue/patient records were seeded for these tests.
All test databases were disposable and removed. The migration ledger was read from
local development, with the four committed checksums matching.

Whitespace and feature-only cached apply checks pass; HEAD stays at the baseline,
index empty. The corrected candidate retains **15 paths**; exact hunk count and SHA256 hashes
are recorded in the regenerated staging manifest. Hashes verify 194 files outside
this task are unchanged; pre-existing mixed-file work is excluded from the patch.
The exact tested source hashes and staging manifest are review artifacts in
`/private/tmp/vine-services-1bb`. Ready again for independent scoped commit review; not
staged/committed and no claim of completed browser release acceptance.
Controlled component execution is automated acceptance, not fresh browser evidence.
Manual browser smoke remains pending; desktop browser automation did not block work.
No Google login, Services release acceptance sign-off or production verification claimed.

## Mandatory schema report

1. Schema change required: **NO**; optional Visit JSONB is sufficient.
2. Committed chain: **001 → 002 → 003 → 004**, unchanged checksummed files.
3. Local applied: **004 OBSERVED**, checksums match committed migration files.
4. Production applied: **002 REPORTED / UNVERIFIED during this task**.
5. New migrations: **NONE**; no 005, DDL, backfill or fixtures in migrations.
6. Fresh database: guarded synthetic complete-chain initialization in migration/API regression.
7. Upgrade: synthetic 002→004 retains legacy Visit JSONB; existing 003→004 migration
   regression; application upgrade at unchanged 004 preserves legacy/canonical JSONB.
8. Existing records: legacy text/servicePerformed/unknown JSONB and canonical
   orphan/inactive/unavailable/unpriced histories retained; no automatic conversion.
9. Future production catch-up: same committed **003 then 004**, separately authorized.
10. Recovery: no schema rollback; suspend canonical performance writes before older
    writer rollback and assess snapshot/alias protection. No deployment performed.
11. Unexplained divergence: none introduced; actual cross-environment schema parity
    **UNVERIFIED here**. Local004 versus reportedproduction002 is an expected pending release gap.

## Scope and next step

No billing/payment, stock deduction, package redemption, completion orchestration,
advanced scheduling, signing/amendment workflow or historic backfill. Production,
OAuth/environment configuration and DARF unchanged. Next: independent scoped
commit-readiness review of the corrected candidate, then user-authorized staging/commit.
Clinical Records remains blocked until Services 1B-B is reviewed and committed.
