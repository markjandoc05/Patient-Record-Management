# Services 1B-A — Appointment Service Selection

Local implementation candidate, October 2, 2026. No staging, commit or deployment.
Committed baseline: `82b8113b7c2de9d3f898ff0b8c8fffc365ab16bd` (Services 1A plus local development tooling).

## Audited integration

The committed appointment form writes through `src/utils/recordApi.ts` to dedicated
POST/PATCH `/api/records/appointments` routes. Appointments are JSONB records in
`app_records`. These transactions already validate roles, patient/branch/provider
context, clinic time slots, existing conflicts and edit seals; they also write trusted
audit activity. Generic data writes cannot mutate appointments. Archive, restore,
attachments and linked-visit completion update only their existing fields.

The smallest integration adds optional selection to these two routes and the existing
form. It reuses the scoped, paginated Services API and its guarded request adapter.
No catalogue detail lookup is needed to display a recorded appointment snapshot.
No duration-based scheduling or price storage is introduced.

## Write contract and compatibility

- Omitted `serviceSelection`: create without canonical Service, or retain every
  existing snapshot field exactly on edit. Historical inactive, unavailable,
  unpriced and missing-reference Services remain readable/editable.
- `serviceSelection: null`: explicit removal; all four snapshot fields become null.
- `serviceSelection: { serviceId, expectedVersion }`: explicit new selection or
  re-selection. Validate the UUID and positive integer version. The server copies
  `serviceId`, `serviceNameSnapshot`, `serviceDurationMinutesSnapshot` and
  `serviceCatalogueVersion` from the catalogue; direct snapshot writes are rejected.
- New selection must match the current catalogue version, be active, available in
  the active selected branch, and have a configured effective price (including
  explicit Free). A branch price overrides the standard price; inheritance follows
  Services 1A. No charged price or selection command is stored on appointments.
- Reads and appointment/audit writes share the existing transaction lock with
  catalogue mutations. Re-read the current appointment writer's role/access inside
  that lock. Existing role/provider/conflict/visitType/booking/edit/archive rules stay.
- Service intent is explicitly `unchanged`, `selected` or `removed`. Branch navigation
  preserves intent for a persisted canonical snapshot: A→B→A with no Service action
  omits the command and preserves history. Remaining at B requires an eligible explicit
  choice or removal. Only a draft without persisted canonical history resets to
  `unchanged` on branch change. Backend also denies an unresolved old-branch snapshot.
  Legacy appointments without Services continue to change branch normally.
- Branch/access-keyed form and picker lifetimes, layout generation checks and
  abort/current guards reject obsolete list/save success, conflict and denial.
  Explicit protected-data invalidation clears the form. Current denial blocks the
  form until it is reopened or access scope recovers, avoiding automatic denial loops.
- Catalogue loading/search/pagination failures have retry; Service is optional, so
  catalogue availability does not block an otherwise valid legacy booking.

Existing JSONB is sufficient. No backfill, table/index changes, foreign-key migration,
Visit/performed-Service copying, billing, packages, inventory consumption, treatment
completion or advanced scheduling is included.

Older clients can still create/edit appointments without Service selection and edit
other fields of Service-linked appointments within the same branch. A branch move
of a Service-linked appointment needs the new explicit choice contract. An older
backend does not enforce this new contract: do not mix old/new appointment writers
once canonical selection is enabled; rollback must suspend Service-selection writes.

## Files in this feature

- `backend/appointmentServices.ts`: strict selection parser and transactional snapshot.
- `server.ts`: appointment wiring and current transactional writer authorization.
- `src/components/AppointmentServicePicker.tsx`: optional scoped selector and history.
- `src/components/AppointmentForm.tsx`: selection, branch/access boundary and guarded save.
- `src/utils/recordApi.ts`: optional appointment request lifetime guard.
- `src/dataClient.ts`: subscribe to the existing protected-data invalidation boundary.
- `scripts/test-appointment-services-api.ts`: disposable PostgreSQL/HTTP acceptance.
- `scripts/test-appointment-services-ui.ts`: deterministic component/transport races.
- `package.json`: only two test commands in this feature.
- This release note.

Mixed files already contain unrelated work. A HEAD-plus-feature-only reconstruction
and corrected review patch are preserved under `/private/tmp/vine-services-1ba-repair`; they exclude
existing patient, onboarding, appointment-loading, OAuth and development-tool changes.
The real Git index remains empty. This is a review aid, not approval to commit it.

## Automated acceptance and regressions

Working tree and isolated committed-baseline candidate (Node 24.15.0):

- TypeScript and production build pass (existing large frontend chunk warning).
- Appointment Services API: 92 checks pass using a disposable synthetic database.
  Covers authoritative snapshots, Priced/Free/inheritance, unpriced/inactive/unavailable
  denial, version conflict and concurrent catalogue revision, forged fields, missing
  references, legacy/history compatibility, branch change/clear, restricted branches,
  transactional access loss, provider/time conflict, archive/restore/seals, trusted
  audit and complete rollback after synthetic audit failure.
- Appointment Services component/scope: 92 scenarios pass. Covers optional selection,
  history, exact command payload, explicit intent/branch roundtrip, scoped prices,
  targeted review/confirmation, filtered/bounded loading/retry,
  late responses after branch/role/session/access/invalidation/unmount changes,
  token-acquisition races, current conflicts and current-denial invalidation without
  a request loop. Controlled transport intentionally completes aborted requests.
- Existing Services policy 74, Services component 76, Services migration 143,
  Services API 133, appointment read authorization 236, PostgreSQL 54,
  parity/shared clinical/upload/audit 142, protected invalidation 14, Support access
  124, Developer panels 13, Support role selector 14, RBAC and audit checks pass.
  Support subscriptions pass in the corrected committed-baseline reconstruction (5);
  the unrelated sixth subscription scenario in the working tree is excluded.
- Production runtime Node 22.23.3: isolated candidate TypeScript/build, all 92
  component/scope scenarios and 92 PostgreSQL/HTTP checks also pass. Validation used
  an ephemeral container and the unchanged local dependency lock, with matching
  dependency declarations. Container and disposable database were removed.
- Whitespace checks pass. Main development records are not used for destructive tests;
  every integration test database is created fresh, guarded, then removed.

These are automated API/component checks, not new authenticated browser evidence.
Interactive booking/edit/history and responsive browser acceptance remain pending.
Earlier Services 1A browser limitations are not reclassified by this implementation.

## Repairs following independent review

The rejected candidate conflated a branch reset with explicit removal (`null`). It
also retained a selected v1 command while Reload updated only the separately loaded
v2 options. Priced options omitted the API's resolved branch price.

The corrected form keeps one confirmed selection containing ID, branch, version,
name, duration and a display-only reference price. Historical retention and explicit
removal have separate intent states. A version conflict has the stable server error
code `SERVICE_VERSION_CHANGED`; ordinary appointment conflicts do not trigger this
transition. Reload marks the selection unresolved, requests the specific Service
through the existing branch-scoped detail API and presents an unconfirmed candidate.
`Use reviewed Service` copies the full candidate into the confirmed selection. No
save occurs automatically. Inactive, unavailable or unpriced revisions cannot be
confirmed; another eligible Service or explicit removal is required.

Options and confirmed selections show name, estimated duration, version and the
API's effective selected-branch price, including explicit Free. The shared Services
price formatter is reused. No override calculation occurs in the appointment UI;
no other branch price is rendered and no price enters the appointment payload.
Historical snapshots are never refreshed by list or review requests.

| Action | Outgoing behavior |
| --- | --- |
| Service untouched; unrelated appointment edit | Omit command; preserve existing snapshot exactly. |
| New selection or explicit replacement | Send only ID/version; server validates and captures all four snapshots. |
| Explicit Remove Service / No Service | Send null; clear four canonical fields. Removal notice is visible for recorded history. |
| Historical branch A→B without resolution | Block save with an actionable choice/removal warning. |
| Historical branch A→B→A, no Service action | Omit command; preserve original history. |
| Unsaved/new noncanonical draft changes branch | Reset to unchanged; omit command, never imply historical removal. |
| Catalogue temporarily unavailable or retry | Preserve intent/history; failure does not generate removal. |
| Selected Service becomes inactive/unavailable/unpriced | Server denies new selection; reviewed revision cannot be confirmed. Choose another or remove explicitly. |
| Version 409 followed by Reload | Block save while latest revision is unconfirmed; retain old context as needing review. |
| Confirm eligible reviewed revision | Name/duration/reference context and submitted version change together; next deliberate save uses latest version. |
| Access/session loss | Clear protected form and discard old responses; no removal write is generated. |

The focused suite adds 43 component/race scenarios beyond the original 49, covering
historical roundtrips and delayed responses, explicit removal, blocked unresolved
moves, eligible replacements, new-record POST omission, unrelated edits, v1→v2
rename/duration/price/Free changes, ineligible revisions, failed review/retry, and
late detail success/denials after branch ABA, scope, logout, invalidation, selection,
superseding review and unmount. Current review denials still invalidate protected
state. One backend assertion verifies the version-conflict code.

Negative control: the saved rejected candidate independently fails the historical
A→B→A preservation, unresolved permanent move, latest-version review and scoped
reference-price scenarios. The new targeted-review tests also fail on that candidate
because it lacks this transition; these failures are expected, not new regressions.

Corrected artifacts are `services-1ba.patch`, `staging-manifest.json`,
`candidate-hashes.json`, validation logs and the 22-item `report.txt` under
`/private/tmp/vine-services-1ba-repair`. They supersede the rejected patch and hashes
under `/private/tmp/vine-services-1ba-review`; older artifacts are preserved solely
as evidence/negative controls. Scope remains 10 paths, 28 diff hunks over committed
HEAD. Mixed-file unrelated hunks remain excluded. The real index remains empty.

## Mandatory schema report

| Item | Result |
| --- | --- |
| Schema change required | **NO**: four optional appointment JSONB fields. |
| Committed migration chain | 001_platform, 002_session_integrity, 003_services, 004_services_name_identity. |
| Local applied | Observed 001–004 on local PostgreSQL 17; checksums match committed files. |
| Production applied | **UNVERIFIED this task**; user baseline and previous October 2 audit report 001–002. No production connection. |
| New migrations | None; next number remains 005 for a future required schema change. |
| Fresh database | Existing 001–004 full-chain initialization/checksummed rerun passes in fresh disposable test databases. |
| Upgrade path | Existing immediately previous 003→004 migration suite passes with retained synthetic records; focused appointment suite also validates ordered 002→004 with byte/timestamp-preserved legacy JSONB. No feature migration is needed. |
| Existing records | No backfill or rewrite. Legacy no-Service and historical snapshots retained; appointment regression suites pass. |
| Production catch-up | Apply the same committed 003 then 004 during a separately authorized compatible Services release. Nothing was applied to production. |
| Recovery/rollback | No schema downgrade needed. Retain JSONB snapshots; suspend new selection writes before reverting to an older backend. Normal operational backup/recovery policy remains. |
| Unexplained divergence | None introduced. Local migration checksums match; actual schema divergence and production were not re-audited in this task. The previous audit found no unexplained drift. Reported 001–002 vs 001–004 is an expected pending release gap. |

Ready for independent scoped commit review after validation. Not committed, pushed,
deployed or signed off as a full browser release. Production and DARF are untouched.
