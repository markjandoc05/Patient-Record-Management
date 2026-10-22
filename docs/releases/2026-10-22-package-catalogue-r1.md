# Package Catalogue R1 — local implementation

October 22, 2026. Base HEAD `da4655733f1b6c546bba684a70d7670999233905`.
Local implementation only; no staging, commit, push, deployment, production or
DARF access. This report does not supersede a subsequent independent scoped review.

## Behavior

- Services → Packages: search/filter, create/edit, activate/deactivate, immutable
  version history and read-only details for users without management permission.
- Definitions contain a name, optional description and 1–20 distinct canonical
  Services with 1–10,000 whole sessions each. Changes create the next version.
- Patient Profile → Treatment Ledger → Record purchase retains Manual package as
  the default and adds Catalogue package. Purchase clinic/date, notes and Admin
  OR# keep their existing workflow and authority.
- Catalogue terms are read-only. Requests contain package/version and reviewed
  Service versions; the server supplies the package name and allowances. Active,
  available, priced or explicitly Free Services are required at purchase clinic.
- Historical purchase terms and references stay frozen after package edits or
  deactivation. Visit redemptions still use existing balance/eligibility rules at
  any authorized branch. No session events, usage arithmetic or Visit binding
  behavior is replaced.
- Existing manual purchases remain unlinked and readable. Manual creation keeps
  its previous request contract and permissions. JSON ledger export adds a
  catalogue reference only for linked purchases. Ledger printing stays removed;
  chart printing is unchanged.
- Captured permission generation and request lifetimes discard old detail/save
  success, denial and conflict responses. Current-scope denials still invalidate.
  Version conflicts preserve drafts and require explicit review. Uncertain saves
  retain their command ID for an idempotent retry.

No package price/payments, expiry, reservation, package-specific branch policy,
multi-Service Visit redemption, new role or accounting workflow is introduced.
See [approved scope](../planning/package-catalogue-r1.md).

## Implementation files

New domain files: `backend/packageCatalogue.ts`, `src/packageCataloguePolicy.ts`,
`src/utils/packageCatalogueApi.ts`, `src/components/PackageCatalogueDashboard.tsx`,
`src/components/PackagePurchasePicker.tsx`, and migration 006.

Scoped integration: `server.ts`, `backend/treatmentLedger.ts`,
`src/treatmentLedgerPolicy.ts`, `src/permissions.ts`,
`src/components/ServicesDashboard.tsx` and `src/components/TreatmentLedgerTab.tsx`.
Four new test scripts/commands are added. Existing harness/regressions are updated
to expose the test-only permission mirror, retain the real protected-data
subscription, validate the complete migration chain in Ledger API tests, and pin
the historical 004→005 migration suite to that immutable boundary.

## Validation

| Check | Result |
| --- | --- |
| Package policy | 48 passed |
| Package real HTTP/PostgreSQL API | 114 passed |
| Package fresh/retained migration | 30 passed |
| Package controlled component/scope | 34 passed |
| Existing Ledger API / UI | 225 / 44 passed |
| Existing Ledger 004→005 migration | 34 passed |
| Existing Ledger policy / transport / presentation | 136 / 20 / 6 passed |
| Existing Services API / UI | 133 / 76 passed |
| Existing Appointment Services UI | 92 passed |
| Existing Visit Services API / UI | 152 / 233 passed |
| Existing chart UI | 78 passed |
| Permission policy / repair / scope | 223 / 37 / 227 passed |
| Real permission API / RBAC | 210 passed / passed |
| TypeScript | Passed |
| Production build | Passed; existing large-chunk warning remains |
| Whitespace | Passed |

API coverage includes actual authentication/CSRF, explicit grants/denials, queued
revocation, branch denial, inactive/unavailable/unpriced Services, stale versions,
forged name/count rejection, immutable SQL history, repeated command replay after
catalogue changes, manual compatibility, OR#/notes, cross-branch usage and
concurrent overspend. Migration coverage retains synthetic old purchases, events,
balances, Visit bindings, auth identities and checksummed applied history.
Controlled UI tests cover old-scope responses and the pre-render permission-mirror
race, review-required drafts, retry identity, source switching and metadata retention.

Browser checks use the supported desktop integration and the real built UI/API
against a disposable synthetic PostgreSQL fixture on loopback port 3108. They do
not bypass a real account's Google login, seed the normal local database, or use
production data. Observed: create version 1, edit to version 2, both allowances in
history, catalogue selection and fixed terms, Admin OR#/notes, successful linked
purchase and correct initial balances. Synthetic Nurse sees branch A only,
read-only catalogue details/history and no OR# input. Browser console reported no
warnings/errors for these interactions. Direct mutation/branch denials and races
are API/component evidence, not a claim of a full interactive role/race matrix.

Desktop and narrow layouts are captured in `.impeccable/review/`. The browser
clamped the requested 390px viewport to observed 443 CSS pixels; document width
equaled viewport width. Narrow catalogue, details and purchase preview remained
usable. All current captures were opened and inspected. UI detector: zero findings.
Fresh, independently delegated UI finish review: **ship**, ordinary-extension
visual/UX scope, no material fixes. All seven captures were accepted. The generic
agent spawn lacked a preset selector, so the reviewer retrieved only its
five-section format from the degraded reference; the review itself stayed
independently delegated. This is not an independent security/commit-readiness
review or new live-browser testing by that reviewer. Documentation handoff is
complete: `.impeccable/review/documentation.md` records the incumbent-system
comparison and preserved global design files.

## Required schema report

1. **Schema required: YES.** Normalized versioned definitions and immutable
   purchase provenance need relational constraints/history. Existing JSONB Visits
   and clinical records are unchanged.
2. **Committed chain:** 001–005. Their bytes/checksums remain unchanged.
3. **Local observed:** 001–006, applied in order. Before upgrading, Vine stopped
   and a private local custom-format backup was saved. Digests/counts of all 11
   existing data tables matched before/after (new nullable purchase fields excluded
   from comparison). Prior applied checksums/timestamps matched; catalogue tables
   stayed empty and every existing purchase reference stayed NULL.
4. **Production current: UNVERIFIED.** Not contacted. Last recorded observation was
   001–005 on October 17; no new parity or health claim is made.
5. **New migration:** `006_package_catalogue.sql`, uncommitted. Adds roots,
   sealed immutable revisions/lines and nullable paired purchase references with
   foreign keys. No fixture data/backfill, historical rewrites or manual DDL.
6. **Fresh database:** complete 001–006 passed on disposable PostgreSQL 17.
7. **Upgrade:** immediately previous 005→006 passed with retained synthetic data;
   fresh/upgrade schemas matched and repeated migrations were safe. Applied-file
   tampering was rejected.
8. **Existing records:** manual purchases, event history, balance totals, Visit
   bindings and auth records preserved. Existing purchases stay unlinked. Package
   terms are frozen for new linked purchases; later definitions cannot rewrite them.
9. **Production catch-up:** if still at verified 005, only reviewed/committed 006
   is required, together with compatible application code in a separately authorized
   release. Inspect the actual production chain first. No production migration here.
10. **Recovery:** keep the additive schema/history/references on application rollback;
    do not delete purchased versions or reverse migration with destructive SQL.
    Previous code can retain extra columns but cannot manage catalogue definitions
    and may omit their provenance display. The private local backup predates 006;
    restoration would discard later changes and needs a separate recovery decision.
11. **Divergence:** no unexplained divergence detected in the tested fresh/upgrade
    paths or local applied migration chain. Local 006 ahead of last observed
    production 005 is the expected pending release gap. Current full production
    schema parity remains UNVERIFIED.

## UI recovery repairs — October 22 local

The subsequent independent review reproduced a P2 current-access-denial reload
loop and a P3 purchase-picker pagination recovery issue. Both are repaired locally.
The earlier reviewed patch/manifest predates these repairs and is not staging
approval for the current candidate. A fresh scoped review is required.

The catalogue now latches protected invalidation against the committed account,
permission and branch scope. It unmounts protected content, shows an access-change
notice and waits for a deliberate retry or a changed scope. A retry permits one
request; another denial blocks again. Capturing the committed scope preserves
App's permission-publication-before-invalidation ordering. Old requests and old
Retry callbacks cannot invalidate or unblock a replacement scope. Effective
permission denials still hide the catalogue and its retry action.

The purchase picker corrects an out-of-range page when eligible results shrink
and fetches the valid page before publishing the invalid result. Pagination
changes do not replace the reviewed package or purchase date, notes and OR#.
Zero eligible results reach the first-page empty state. Stale search/branch
responses remain discarded by the existing transport/lifetime checks.

Repair scope: `PackageCatalogueDashboard.tsx`, `PackagePurchasePicker.tsx`, the
controlled form harness and package UI tests, plus this evidence update. The
harness's opt-in uses production protected invalidation/subscription/generation
code; other suites keep their existing harness behavior. Its invalidation export
exists only in generated test modules, never application code.

Validation after repair:

- Package UI **82/82 passed**, including **48 new regression scenarios**.
- Counterfactual pre-repair source with the new tests: **53/82 passed, 29 failed**
  as expected; all original 34 cases still passed. The failures cover both bugs.
- Services UI 76, Ledger UI 44, permission policy 223/scope 227, Ledger policy
  136/transport 20/presentation 6 all passed.
- TypeScript, production build and whitespace checks passed. Existing build
  chunk-size warning remains. UI detector reported zero findings.
- Fresh read-only review of the repair delta found no further issue in committed
  scope capture, retry latching or pagination/metadata preservation.
- Controlled component evidence only for this repair; no new browser, OAuth or
  full interactive acceptance claim. Earlier screenshots are historical evidence.

Schema report for this repair: **no schema change required**; committed chain
001–005 and the existing uncommitted/local-applied 006 remain byte-identical.
Local 001–006 and schema/checksum equivalence were directly observed read-only
in the immediately preceding review; they were not queried again for this UI-only
repair. Production remains UNVERIFIED and unaccessed, with the last recorded 005
baseline. No new migration, backfill or database writes. Fresh/upgrade reruns are
N/A for this repair; the feature's prior validation and ordered 006 catch-up plan
above remain applicable. Existing-record compatibility and recovery semantics
are unchanged; no new schema divergence is introduced or silently corrected.

## Review and preservation

Ready for independent scoped commit-readiness review. HEAD and the empty index
remain unchanged. Original ignored environment files, migrations 001–005 and nine
unrelated historical evidence files retain their baseline hashes.
Synthetic browser/API records live only in the owned disposable test runtime,
which is removed after checks. Normal local Vine remains on port 3000 using local
PostgreSQL; optional SSH tunneling and other applications are not changed.
