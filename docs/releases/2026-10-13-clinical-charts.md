# Face and front/back body charts — local implementation

User-authorized scope: face and body charts linked to saved Visits for the assigned
doctor, or an eligible recorded performer when no Doctor is assigned. No dental maps. Preserve Visit booking/edit/archive/link/Services/performer
workflows and existing roles, capabilities and branch permissions. Local development
only; no staging, commit, push, production access, DARF changes or deployment.
Baseline HEAD: `ed1b1a4258861b2adb78e7f23af1a1c7de5c910a`.

## Nurse-led follow-up

The user approved charts on nurse-led Visits without a Doctor assignment. The
Doctor-required review artifacts describe the previous candidate and no longer
authorize staging the updated code. The new eligibility, recorded performer
context, delayed-response protection and validation are documented in
[the nurse-led release report](2026-10-13-nurse-led-charts.md). Existing permissions
and signing grants are preserved; a Nurse designation does not grant chart editing.

## Workflow

- Patient profile → Clinical Charts lists saved Visits; Visit details and existing
  Visit edit forms offer Open chart. New unsaved Visits cannot create charts.
- Face, body front and body back share one Visit chart. Normalized marker positions,
  labels and notes are editable in drafts with removal and undo. Schematics explicitly
  identify patient left/right and provide numbered keyboard-selectable markers and
  coordinate inputs. Small screens stack the editor; larger screens show two columns.
- Save draft persists chart content separately from the Visit. No billed price,
  scheduling, appointment status or treatment completion is written.
- Signing requires the existing explicit `clinical.finalize` capability in addition
  to existing Visit/clinical write authority. No role defaults or per-user grants are
  changed. Every existing default still denies clinical finalization.
- Signed versions are immutable. A correction begins an amendment draft with a
  required reason; original signed versions and author/signer attribution remain.
- Print / Save PDF and JSON export use the selected saved draft or signed revision,
  including its frozen context and attribution. Unsaved draft content cannot export.

## Integrity and access

Dedicated chart routes read/write `clinical_charts` in existing `app_records` JSONB,
keyed by Visit ID. Generic query/write endpoints deny this collection. Charts do not
travel in routine patient/Visit subscriptions or operational clinical-denied projections.

Reads retain shared longitudinal clinical history and require `visits.view` and
`clinical.view`. Every write refreshes session, account and permissions under the
same transaction lock as existing access/record writes. Writes require `visits.edit`,
`clinical.edit_draft`, Visit branch access and existing Doctor ownership. The assigned
Doctor, when assigned, must be active and eligible in that branch. Without an assigned
Doctor, an active branch-eligible recorded Doctor/Nurse/Medical Staff performer is
required. Archived patients/Visits, inactive
branches and imported clinically sealed Visits retain read-only history.

Server validation accepts only face/body-front/body-back, unique bounded marker IDs,
finite coordinates in [0,1], up to 100 markers, label 100/marker-note 1000/chart-note 3000
character limits and amendment reasons up to 500 characters. All attribution and
signed-history fields are server owned; forged and unknown fields are rejected.
At most 50 signed revisions are supported; older versions are never discarded.

Optimistic chart versions prevent concurrent overwrite and duplicate signing or
amendment. Uncertain/failed mutations require authoritative reload before retry.
Server-generated Visit context hashes detect changed patient/branch/Doctor/date/type/
Service snapshots. Signing requires a draft saved against the current Visit context.
Each signed version freezes that context; ordinary later Visit edits remain supported
and never rewrite prior signatures. Signing does not clinically seal the Visit.

Frontend requests capture protected-data generation, identity and exact modal/request
lifetime. Late successes, denials and conflicts cannot restore chart data or invalidate
a newer session. Permission loss clears the workspace. Audits contain event metadata
and versions, without marker contents or clinical notes.

## Initial implementation validation

These initial results are superseded for commit readiness by the repair validation
below. Independent review subsequently reproduced the patient-list archive race and
identified chart-only commit prerequisites.

- Clinical chart API: 178 checks pass in a fresh guarded disposable loopback PostgreSQL
  database. Includes strict inputs, forged fields, Doctor ownership, origin/CSRF,
  stale versions/context, current permission revocation, concurrent saves, immutable
  signatures/amendments, archive/restore, migration checksums and record retention.
- Clinical chart policy: 33 checks pass. Real protected transport: 18 checks pass.
- Clinical chart UI: **37/37** actual-component scenarios pass, including normalized
  markers on all maps, undo, explicit signing permission, amendment history, saved
  print/export capture, conflicts, stale replies, current denials and patient/Visit
  entry points. These are controlled components, not browser evidence.
- Existing **20 relevant regression suites pass**, including performer API180 and
  UI43, Visit Services API152/UI174, appointment Services API92/UI92, permission API207,
  appointment authorization236, permission scope218, Services UI76, shared-data32,
  protected invalidation14, parity142 and forward migration143 checks. The shared
  SSR regression initially hit a CSS module import; moving the import to the app
  stylesheet corrected it and its32 checks passed. The harness extension was followed
  by passing performer43 and Visit Services174 reruns.
- Initial TypeScript, production build and whitespace checks **PASS**. Existing large
  bundle warning remains. Initial checks did not cover the patient-list archive race
  or establish an independent chart-only commit on HEAD.
- Vine restarted on existing **localhost:3000**. Three consecutive health and shell
  requests returned200; chart requests without a session returned401. PostgreSQL
  remained healthy; no synthetic chart or clinical records added to the main database.
- Existing regression checks cover appointments, Visit Services, performer attribution,
  branch/clinical permissions, shared history/cache, Support, RBAC/audits and migration
  upgrade behavior. No new interactive browser, fresh Google-login or visual PDF
  acceptance evidence is claimed. The supported desktop browser runtime limitation
  from earlier work is not repaired or bypassed by this task.

## Archive repair and standalone commit prerequisites

- Clinical Charts and Patient Timeline retain only the selected Visit ID and resolve
  it against the current non-archived patient Visit list. Removal or archival unmounts
  the editor, aborts pending detail/save requests and clears its selection. Restoring
  the Visit requires explicit reopening and a new request. Ordinary list refreshes
  retain current unsaved chart edits. Server archive denial remains unchanged.
- The backend uses committed `activeAccount` plus the same Doctor-role and branch
  assignment checks directly. It no longer imports the uncommitted performer policy;
  account, ownership, branch and signing authority are unchanged.
- Historical unassigned Visit coverage is seeded directly into the guarded disposable
  test database, instead of creating an Unassigned Visit through an unreleased API.
  Normal test reassignment supplies optional performer attribution for compatibility
  with the existing working-tree workflow; committed HEAD ignores that field. Both
  versions pass. No main-development record is seeded or rewritten.
- The complete controlled-form harness is explicitly included as a new chart-testing
  prerequisite. It does not require the performer feature or its test scripts.
- A **21-path / 35-hunk** standalone candidate is reconstructed from committed HEAD
  plus chart changes only. It excludes earlier Unassigned/performer/designation,
  booked-Service carryover, legacy-field hiding and unrelated evidence changes.
  Temporary patch application, hashes and whitespace are verified without staging.

### Repair validation

- Chart policy33, transport18, UI**51/51**, and API**193** pass: **295 focused checks**.
  Fourteen UI additions cover both patient entry points, pending detail and save
  replies, archival, explicit restoration/reopening and unrelated-list negative
  controls. Against the old reviewed components,12 archive scenarios fail while
  the original37 and two unaffected-list controls pass (**39/51**).
- Assigned-Doctor API checks cover archived/pending accounts, missing branch access,
  malformed branch assignments and Nurse designation without a Doctor role.
- The standalone HEAD-plus-charts candidate passes TypeScript, production build and
  **22 suites**: four chart suites plus18 existing relevant regressions. It contains
  neither the uncommitted performer policy nor performer workflows/test scripts.
- The current combined workspace passes TypeScript/build and **24 suites**, including
  performer API180/UI43 and Visit Services UI174. One reassignment fixture initially
  omitted the existing performer branch requirement; its correction was followed
  by passing chart API reruns on both candidates. No application workflow changed.
- Existing build-size warning remains. Controlled UI checks are not interactive
  browser or visual print/PDF acceptance. No staging, commit or deployment occurred.

## Mandatory database report

1. Schema change required: **NO**. Existing generic JSONB storage is adequate.
2. Committed migration chain: immutable/checksummed **001–004**; files unchanged.
3. Local applied migration: **observed 001–004** through a guarded read-only query;
   applied checksums match committed files. No main-development migration executed.
4. Production applied migration: **UNVERIFIED in this task**. No production access;
   historical documents do not establish the current deployed version.
5. New migrations: **none**. No DDL, backfill or schema synchronization.
6. Fresh database: **PASS**, complete 001–004 chain in guarded disposable tests.
7. Upgrade path: feature migration **N/A**. Existing forward migration regression
   validates003→004 with retained synthetic records; repeat migrations preserve chart
   and legacy JSONB exactly.
8. Existing-record compatibility: **PASS**. Visits with no chart remain unchanged;
   Services snapshots, legacy treatment text, appointment links, performer/assistant
   fields and old Visit edit/archive/restore behavior are preserved. No backfill.
9. Production catch-up: **no new migration introduced by charts**. Any future release
   must independently inspect deployed state and apply missing committed files in order.
10. Recovery/rollback: no destructive SQL operation. Earlier code ignores this separate
    collection and retains stored chart history, but cannot display/edit charts. A
    rollback must retain chart records; restoring support later requires this feature.
11. Unexplained divergence: no new migration/checksum mismatch found locally. Full
    structural local/production parity is **UNVERIFIED**; production remains untouched.

## Files changed for chart implementation

- Backend route: `backend/clinicalCharts.ts`; mounting in the existing mixed `server.ts`.
- Shared contract/validation and guarded adapter: `src/clinicalChartPolicy.ts` and
  `src/utils/clinicalChartsApi.ts`.
- UI: `ClinicalChartMap.tsx`, `ClinicalChartModal.tsx`, `ClinicalChartsTab.tsx`;
  patient profile, patient timeline, Visit History and saved Visit form integrations.
- Print stylesheet: `src/components/clinicalCharts.css`, loaded by `src/index.css`.
- Four focused test scripts: clinical-charts-api, clinical-charts-policy,
  clinical-charts-transport and clinical-charts-ui. Narrow additions to the existing
  controlled-form harness. Package aliases, roadmap and this release note.

**21 chart-related paths** form the standalone candidate. Six files use selected
chart integrations over committed HEAD; the shared controlled-form harness is a
whole new supporting test file. Mixed working files must not be staged whole.
Earlier working changes remain preserved; the chart candidate does not bundle
them. HEAD and the empty Git index remain unchanged.

## Scope and next gate

Prior unstaged appointment/performer, booked-Service carryover and legacy-field work
are retained. Unrelated review evidence and images are retained. Existing local OAuth,
environment settings and production configuration are unchanged. Generated build/test
artifacts and disposable databases are not staged. No main-development fixture added.

Next: independent scoped commit-readiness review of the repaired **HEAD plus charts
only** candidate. Earlier unstaged features remain a separate review/commit scope.
Interactive browser and print walkthrough remain pending; automated component
checks do not substitute for that. This repair does not authorize staging or commit.
