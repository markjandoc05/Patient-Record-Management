# Hybrid access-control foundation — October 3, 2026 local evidence

Implemented locally. Nothing staged, committed, pushed or deployed. Production,
production OAuth/migrations and DARF were not accessed or modified. Main local
credentials remain byte-identical to the pre-task copy. Committed base remains
`7407cc16188b41e9822da6437901e43a0a0e14f7`.


## Corrected candidate — independent-review repairs

The earlier 54-path / 190-hunk candidate and its commit-readiness assumptions are
superseded. No staging, commit, push, deployment or Clinical R1 work is authorized.

- Audit queries by a clinically denied user reject narrative/change/unknown fields
  before database matching or sorting. Safe metadata predicates and pagination remain;
  authorized clinical audit searches remain functional. Search in React uses projected
  payloads. No audit facets/count/text-search API bypass was found.
- Generic profile writes reject centrally declared access-policy/lifecycle fields.
  Role/branch/default/override writes use only the revisioned access API; lifecycle
  actions remain on their existing guarded transactions. Cleanup uses revisioned
  individual commands and reports prior saved updates if a later conflict stops it.
- Legacy string comparisons use surrounding-whitespace canonicalization only.
  Unauthorized matching fields are omitted from writes: stored clinical bytes remain
  unchanged. Real clinical edits remain denied, and authorized edits still work.
- Permanent regressions cover hidden audit equality/inequality/sort/limit terms,
  allowed metadata/authorized searches, stale generic/dedicated mixed policies,
  branch/override races, access-manager revocation, atomic rollback and whitespace.
- The existing 487-check coverage is retained with the generic-write expectation
  intentionally changed to rejection. Expanded suites now pass 123 policy + 207 API
  + 218 scope + 37 repair checks = **585 assertions**. All35 corrected-candidate
  suites pass. Prerequisite-only reconstruction passes33 suites. The loading harness
  now explicitly separates empty invalidation snapshots from successful deliveries.
- All three isolated negative controls fail on the rejected candidate and pass on
  the corrected candidate. TypeScript/build pass in both reconstructions; whitespace
  patch checks pass. No browser or Google-login evidence is claimed; Node22 untested.
- Proposed prerequisite baseline: **43 paths / 138 hunks**, with patient/workspace,
  account activation and inherited appointment loading mapped explicitly in the
  dependency graph. It contains no access foundation. Corrected foundation: **59 paths
  / 198 hunks** relative to that baseline (final artifacts are authoritative if counts
  change). Earlier unrelated docs, production configuration, tunnel, environment,
  database-tooling changes and all other working changes remain excluded.
- The unused legacy clinical-access import is removed from corrected PatientProfile.
  Its helper is legitimately used by the earlier patient prerequisite; no new role
  permission implementation is introduced for this access foundation.

Review packet: `/private/tmp/vine-access-repair/` contains prerequisite.patch,
prerequisite-manifest.json, foundation.patch, foundation-manifest.json,
dependency-graph.json, report.md, test ledgers and negative controls. Independently
validated candidates are ready for independent scoped review, not automatic commit
approval. Proposed order: reviewed prerequisite workflow baseline first, corrected
access foundation second. Clinical R1 remains blocked until that baseline is reviewed
and explicitly committed.

Schema unchanged: immutable001–004; local observed004/checksums match; production
reported002 and uninspected. Fresh and upgrade tests pass; no migration/backfill.
Pending production catch-up remains003→004. Older application rollback would not
honor override denials; preserve map-aware authorization or use a forward correction.

## Original implementation report (historical; superseded candidate)

1. **Resolution:** one shared registry/resolver checks active/approved account,
   role defaults, explicit JSONB overrides, then independent scope. DENY wins;
   malformed stored overrides fail closed. Server authority uses the current
   transaction/session/profile, never frontend claims.
2. **Namespace:** 39 capabilities for Dashboard, Patients, Appointments, Visits,
   Services, Clinical, Users, Access, Branches, Settings, Audit, Reports, existing
   Inventory and Developer. The [complete stable namespace and exact role matrix](../architecture/hybrid-access-control.md)
   is generated from the implemented registry. No POS/package/new inventory feature.
3. **Defaults:** all known active roles retain existing patient/appointment reads,
   intake/limited edits, shared Visit/clinical reads, catalogue reads and directories.
   Administrator/Support retain administrative defaults. Doctor retains clinical
   documentation/private-note defaults. Staff/Manager clinical viewing remains
   initially allowed. Finalize/prescription defaults are Deny for all roles; no new
   clinical workflow exists.
4. **JSONB:** `permissionOverrides: { "clinical.view": "deny" }`, with only explicit
   `allow`/`deny`. Command `inherit` removes a key. `accessRevision` detects concurrent
   policy writes and enters the protected scope. No SQL migration or backfill.
5. **Delegation:** `users.manage` permits operational employee details.
   `access.manage` separately requires effective authority plus Administrator or
   guarded Support role. Ordinary-role ALLOW cannot grant security administration
   or Developer access. Self role/override elevation and Admin→Support grants are
   blocked. Existing lifecycle/self-target safeguards remain.
6. **Redaction:** central server projections remove clinical narratives, findings,
   prescriptions, protected media and unknown/nested content; operational identity,
   demographics, branch/date/status/provider and booked/performed Service snapshots
   remain readable. Direct/collection/patient-directory responses use the projection;
   clinical inference queries and media are denied. Empty redacted edit defaults
   preserve stored protected content, while unauthorized clinical changes fail.
7. **Scope:** capability ALLOW does not broaden branch access. Existing shared
   longitudinal reads remain shared; appointment reads, writes, providers and price
   rows retain their resource/branch rules. Separate pricing denial still permits
   description edits without a price change.
8. **UI:** compact native expandable Module Access groups show role inheritance
   and explicit Inherited/Allow/Deny. Separate operational details remain available
   to delegated managers; security controls/self overrides/Support targets are
   guarded. Existing visual language preserved. Static rendering/controlled handler
   tests pass; desktop/mobile browser captures are UNVERIFIED.
9. **Audit:** target, server actor/time, old/new role/branch/default/override changes
   and revision are written atomically. Forced audit failure rolls back the policy
   change. Existing generic branch security changes emit the same audit. No clinical
   narrative in access events; legacy clinical audit bodies are projected safely.
10. **Session/cache:** current authorization is checked under the write lock; queued
    old saves fail after revocation. Existing five-second own-profile polling detects
    changes, then invalidates protected state and remounts scope-dependent UI.
    Identity/generation guards cover token, transport, body and media preview stages.
    Old success/401/403 cannot restore data or clear a new scope. Current denials and
    logout still invalidate; own-profile recovery remains identity bound.
11. **Compatibility:** current role defaults, legacy records, appointment booking,
    performed/booked Service snapshots, limited patient edits, Support guards and
    existing patient/Visit/upload behavior pass their regression suites. Existing
    clinical finalization markers remain sealed. Clinical R1 workflows were not added.
12. **Security:** 123 policy/redaction/backend-hook assertions, 146 real HTTP/local
    PostgreSQL access-management/redaction/audit/revocation assertions, and 218
    controlled adapter race/invalidation/static Module Access checks pass: **487**.
    The required eighteen security scenarios are covered across these suites.
13. **Regression:** all 31 existing suites below pass, plus TypeScript, production
    build and whitespace checks. Final Services branch validation preserves missing
    branch 400 behavior while unauthorized branch writes remain 403. Test harness
    edits expose the actual new guarded client adapters and transaction session
    lookup; existing assertions were retained.
14. **Changed files:** the task-specific file list is appended below. Pre-existing
    patient/onboarding/loading/environment work is preserved in place. Review
    artifacts under `/private/tmp/vine-access-foundation/` include the frozen before
    tree, task-only patch, before/candidate SHA-256 manifest and validation ledger.
    The patch is relative to the pre-task working state, not a staged HEAD candidate.
15. **Schema:** no change; mandatory report is below. Main development records are
    not seeded or reset. Test records exist only in guarded disposable databases,
    which are dropped after each suite. No production inspection in this task.
16. **Documentation:** add the access architecture/namespace/default matrix and
    this evidence; update DEVELOPMENT, ROADMAP and CHANGELOG narrowly. Existing
    historical entries remain preserved; the current base includes committed
    Services 1A/1B-A/1B-B.
17. **Isolation:** production/DARF untouched; no OAuth values exposed or modified;
    no tunnel changes, migration changes, stage/commit/push/deploy. Git staged entries
    and HEAD match the pre-task state. Existing production-config diffs predate this
    task and are preserved, not included in the task patch.
18. **Review readiness:** ready for independent scoped code/commit-readiness review
    of the local foundation. This is not staging/commit approval or browser sign-off.
    The working baseline contains previously uncommitted patient/onboarding utilities
    and UI; an exact HEAD-only candidate must resolve its prerequisite dependencies
    and mixed-file hunks rather than staging whole working files. No isolated staged
    candidate was constructed or claimed by this implementation task.
19. **Clinical R1:** permission hooks are available. Proceed with its separately
    approved workstream after independent foundation review and authorized commit;
    define its finalizer/prescriber/resource policy before implementing those features.
20. **Remaining blockers:** no unresolved approved foundation policy decision.
    Browser capture remains blocked by missing desktop runtime `26.930.21537`.
    Clinical R1 authority decisions remain a separate policy/specification gate.

## Validation ledger

Host: Node 24.15.0, PostgreSQL 17.11. Production Node 22 runtime was not separately
executed in this task. Database suites use real HTTP, synthetic sessions/records,
loopback temporary PostgreSQL databases and temporary storage; they do not establish
fresh Google-login/browser acceptance. Main local migration ledger was inspected
read-only and all four checksums match the immutable files.

| Suite | Result |
|---|---|
| Permission policy/redaction/hooks | 123 pass |
| Access-management API/redaction/audit/revocation | 146 pass |
| Permission scope/adapter races/UI static rendering | 218 pass |
| Services 1A policy | 74 pass |
| Services 1A API/database | 133 pass |
| Services 1A UI/scope | 76/76 pass |
| Services forward migration | 143 pass |
| Appointment Services API | 92 pass |
| Appointment Services UI | 92/92 pass |
| Visit Services API | 152 pass |
| Visit Services UI | 126/126 pass |
| Appointment read authorization | 236 pass |
| PostgreSQL/auth/session/inventory | 54 pass |
| Parity/shared clinical/upload/audit | 142 pass |
| Protected invalidation | 14/14 pass |
| Support authorization | 124 pass |
| Support UI | 13 panels pass |
| Support subscriptions | 6 pass |
| Support selector | 14 pass |
| RBAC | pass |
| Audit policy | pass |
| Shared data | 32 pass |
| Workspace overview | 28 pass |
| Patient lookup | 50 pass |
| Patient lookup API | 20 pass |
| Patient birth | 26 pass |
| Patient registration API | 39 pass |
| Patient duplicate warnings | 24 pass |
| Clinical findings | 48 pass |
| Clinical findings API | 32 pass |
| Simple registration | 13 pass |
| Simple registration API | 28 pass |
| User onboarding API | 82 pass |
| User onboarding UI | 48 pass |
| TypeScript (`npm run lint`) | pass |
| Production build (`npm run build`) | pass; existing large-chunk warning |
| Whitespace (`git diff --check`, task patch check) | pass |
| Local Vine `/api/health` | 200, PostgreSQL healthy |
| Local Vine app shell | 200 |

The local server was started on port 3000 to load the implemented backend. No
Google-login or Services acceptance matrix was performed.

## Mandatory schema report

| Required item | Result |
|---|---|
| 1. Schema change required | NO |
| 2. Committed migration chain | 001–004 |
| 3. Local applied | Observed 004; four checksums match, PostgreSQL 17.11 |
| 4. Production applied | Reported 002 from earlier baseline; not accessed here |
| 5. New migrations | NONE |
| 6. Fresh database | Pass: complete four-file chain and idempotent replay in disposable databases |
| 7. Upgrade path | Pass: existing retained-record 002→003→004 and forward 003→004 regression; no new foundation migration, so 004→new N/A |
| 8. Existing records | Missing overrides inherit old defaults; legacy JSONB/snapshots retained; redacted edits preserve hidden fields |
| 9. Production catch-up | Still separately approved 003→004; expected pending release gap |
| 10. Recovery/rollback | No SQL reversal/backfill. Older code ignores overrides; retain enforcement or review/revoke affected access before authorized rollback |
| 11. Unexplained divergence | No migration change introduced; local ledger/checksums verified. Full structural production parity not re-inspected |

## UI finish evidence and limits

Impeccable context loading failed because its engine is unavailable. The first
fresh finish-review agent failed on a usage limit; one fresh retry returned
**disposition: recapture**, requiring valid desktop/mobile Module Access captures.
The supported browser connection failed exactly:

```text
Cannot find module '/Users/markjandoc/.codex-vscode-api/plugins/cache/openai-bundled/browser/26.930.21537/scripts/browser-service.mjs'
```

Installed browser package inspected: `26.928.31416`. No unsupported raw CDP or
Playwright workaround, version symlink, copied runtime or plugin patch was used.
Documenter source comparison confirmed incumbent conformity and required no design
system edits. It did not verify rendered contrast/focus/responsive geometry. No new
PRODUCT.md/DESIGN.md/sidecar/raster was created. Captures and a full UI finish verdict
remain pending; neither automated static renders nor earlier evidence is promoted
to full browser acceptance.

## Task-specific files

- `CHANGELOG.md`
- `DEVELOPMENT.md`
- `ROADMAP.md`
- `backend/accessApi.ts`
- `backend/auth.ts`
- `backend/clinicalRedaction.ts`
- `backend/dataApi.ts`
- `backend/inventory.ts`
- `backend/permissions.ts`
- `backend/services.ts`
- `docs/architecture/hybrid-access-control.md`
- `docs/releases/2026-10-03-hybrid-access-control.md`
- `package.json`
- `scripts/test-appointment-services-ui.ts`
- `scripts/test-permission-api.ts`
- `scripts/test-permission-policy.ts`
- `scripts/test-permission-scope.ts`
- `scripts/test-services-ui.ts`
- `scripts/test-support-access.ts`
- `scripts/test-visit-services-ui.ts`
- `server.ts`
- `src/App.tsx`
- `src/components/AdminSettings.tsx`
- `src/components/AppointmentForm.tsx`
- `src/components/AppointmentServicePicker.tsx`
- `src/components/AppointmentsDashboard.tsx`
- `src/components/AuditTrailDashboard.tsx`
- `src/components/BranchDashboard.tsx`
- `src/components/FileAttachmentSection.tsx`
- `src/components/InventoryDashboard.tsx`
- `src/components/NotesTab.tsx`
- `src/components/PatientDashboard.tsx`
- `src/components/PatientForm.tsx`
- `src/components/PatientMediaTab.tsx`
- `src/components/PatientProfile.tsx`
- `src/components/PrivateNotesList.tsx`
- `src/components/ServicesDashboard.tsx`
- `src/components/UserOperationalDetails.tsx`
- `src/components/UserPermissionEditor.tsx`
- `src/components/VisitForm.tsx`
- `src/components/VisitHistoryDashboard.tsx`
- `src/dataClient.ts`
- `src/hooks/useWorkspaceOverview.ts`
- `src/permissionState.ts`
- `src/permissions.ts`
- `src/utils/accessApi.ts`
- `src/utils/attachmentApi.ts`
- `src/utils/developerToolsApi.ts`
- `src/utils/inventoryApi.ts`
- `src/utils/loginActivityApi.ts`
- `src/utils/recordApi.ts`
- `src/utils/servicesApi.ts`
- `src/utils/userAccountApi.ts`
- `src/utils/workspaceOverview.ts`
