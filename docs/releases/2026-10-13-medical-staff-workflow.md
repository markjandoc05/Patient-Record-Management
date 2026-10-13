# Nurse and Medical Staff appointment, Visit and chart workflow

Implemented locally on October 13, 2026. No staging, commit, push, deployment,
production connection or DARF action. No SQL migration or main-local clinical
record/account/permission update was performed.

## P2 permission-save display repair — October 13 local

The independent review reproduced an old permission-save Allow reply replacing a
newer target access revision and Deny on screen. The database denial remained
authoritative. The permission editor now rejects older target revisions before
calling its parent, including changed/archived targets. The shared Settings access
result merge also compares against current queued state, preserving newer
designation, branch and permission changes. Current and same-revision successful
saves remain accepted. No access defaults, server rules or branch policy changed.

The new component regression failed before repair (58/59), then passed with the
additional current-save/changed-target scenarios (63/63). Permission-scope checks
now include eight merge-ordering assertions (226 total). TypeScript, build and
the scoped workflow regressions are recorded with the final repair evidence in
`/private/tmp/vine-permission-response-repair`. The previous review artifacts remain
unchanged; this updated candidate requires a new independent scoped review.
No migration, staging, commit, push, deployment, production or DARF action.
Interactive browser and print acceptance remain pending.

## User-approved behavior

Active Staff designated **Nurse** or **Medical Staff** inherit the Doctor's
existing Visit creation, Visit editing, clinical draft/chart editing and Visit
file management actions. They retain the Staff role and assigned branch scope.
Reception and undesignated Staff retain their existing defaults. Existing explicit
DENY overrides remain authoritative; the update does not remove or overwrite them.

In Appointments, use the existing **Arrived → Create visit** flow. Select the
actual performer and optional assisting names; save the Visit. Saving a linked
Visit marks the appointment Completed and updates the patient counters in the
same transaction. Duplicate completion is rejected. Walk-in Visits and editing
completed Visits use the existing forms. Booked Doctor assignment, appointment
Service snapshots, conflict checks and performer history are retained.

Open the saved Visit's chart from Visit details or Patient Profile → Clinical
Charts. Face/front/back maps support markers, undo, notes, saving and later
amendments. No assigned Doctor is needed for an eligible recorded medical
performer. Doctor ownership on Doctor-assigned Visits is unchanged. Chart signing
still requires the separate explicit `clinical.finalize` grant, just as for
Doctors; completion of an appointment does not sign or finalize a chart.
Private notes, prescriptions, full patient-edit rules, archive and administrative
access are not expanded. This update does not add a new role.

## Configure staff

An authorized access administrator opens Settings → Users → expand the Staff
account → **Module Access → Staff designation** and selects Nurse or Medical Staff.
The designation is saved immediately through the revisioned access API. The
inherited Visit/clinical defaults display as Allowed; explicit overrides remain
visible. Another access administrator must change one's own designation.

Designation now affects permission inheritance, so it is protected access policy,
not an operational user detail. Generic/own-profile/operational writes cannot
change it. The access endpoint validates values and target role, requires current
access revision, and persists designation, revision and audit in one transaction.
User details shows the current designation and keeps name/contact editing separate.
A late designation response cannot overwrite a newer target access revision.

The signed-in profile subscription observes designation/access-revision changes
and clears protected data. Request scopes include designation, so old Visit/chart
responses are discarded. The server reloads live actor authority under its write
transaction: pending/inactive/archived accounts, designation loss, branch loss and
explicit denial cannot complete Visits or write charts with stale permission.
Historical performer snapshots and existing chart history are retained.

## Source scope

New files:

- `src/staffDesignation.ts`: shared validated designation values/predicate.
- `docs/releases/2026-10-13-medical-staff-workflow.md`: this report.

Permission/access sources:

- `src/permissions.ts`, `src/permissionState.ts`, `src/accessPolicyFields.ts`.
- `backend/accessApi.ts`, `backend/permissions.ts`, `backend/dataApi.ts`.
- `src/utils/accessApi.ts`, `src/utils/visitPerformerPolicy.ts`.

Workflow/admin UI:

- `src/components/AppointmentsDashboard.tsx`, `src/components/VisitHistoryDashboard.tsx`,
  `src/components/VisitForm.tsx`: effective actor profile for action checks.
- `src/components/UserPermissionEditor.tsx`: designation under Module Access and
  correct inherited-default display.
- `src/components/UserOperationalDetails.tsx`: access-bearing designation removed
  from operational writes; current value shown.

Tests/documentation:

- `scripts/test-permission-policy.ts`, `scripts/test-permission-api.ts`,
  `scripts/test-permission-scope.ts`.
- `scripts/test-appointment-performers.ts`,
  `scripts/test-appointment-performers-component.tsx`.
- `scripts/test-clinical-charts-api.ts`, `scripts/test-clinical-charts-ui.ts`.
- `backend/clinicalCharts.ts`: comment updated to describe common inherited policy;
  no additional chart runtime change.
- `docs/architecture/hybrid-access-control.md`, `ROADMAP.md`: superseding policy.

Prior uncommitted appointment/performer/chart features remain present. All35
unrelated pre-existing changed/untracked paths retain their starting bytes. Twelve
existing working paths changed intentionally for this task; eleven previously
clean paths changed and two new files were added. The earlier descriptive-only
generic designation writer was removed, so that file can now match committed HEAD.
The old chart review artifacts remain unchanged but do not review this permission
follow-up; a new scoped review is required before any eventual staging/commit.

HEAD is unchanged and there are no staged changes. All index paths, modes and
blob IDs still match HEAD, and the cached diff is unchanged. The physical index
hash changed during the task; its content was checked independently, and no
index restoration was performed. Ignored `.env` is byte-identical.

## Validation

A frozen copy of the current combined local workspace passed TypeScript and the
production frontend/server/migration build. Existing large-bundle warning only.
Final edits after this run were documentation and a backend comment, with no
runtime change. Working and cached whitespace PASS.

All **24 relevant suites PASS**:

| Suite | Result |
| --- | --- |
| Appointment/Visit performer API, including medical Staff full workflow | 240 |
| Appointment/Visit/admin controlled components | 58/58 |
| Chart HTTP/PostgreSQL API | 270 |
| Chart controlled components | 68/68 |
| Chart policy | 33/33 |
| Chart protected transport | 18/18 |
| Permission policy | 223 |
| Permission API | 210 |
| Permission scopes and Module Access | 218 |
| Protected invalidation | 14 |
| RBAC and audit policy | PASS each |
| Support API and UI | 124 checks / 13 panels |
| Services UI | 76 |
| Appointment Services API/UI | 92 / 92 |
| Visit Services API/UI | 152 / 174 |
| Shared data/clinical findings | 32 / 48 |
| Appointment authorization | 236 |
| Parity/shared clinical/upload/audit | 142 |
| Services migration | 143 |

The full workflow checks cover both Nurse and Medical Staff, no manual edit grants,
Unassigned booking → linked completed Visit → all three chart maps → reload,
appointment linkage/patient aggregates, duplicate completion, edit, separate
signing denial, unchanged archive authority, branch denial, designation removal,
history preservation, explicit denial and queued authority revocation. Chart tests
retain signing with explicit grants, amendments, archived/sealed records, Doctor
ownership, version conflicts, audit atomicity and stale-response protection.

Admin UI checks cover designation endpoint/revision payload, inherited defaults,
self/delegated/archived restrictions,403/409 failures and a delayed response after
a newer target revision. Workflow entry controls are tested for Nurse/Medical Staff
versus Reception. Tests use real application handlers/components; controlled UI
results are not interactive browser evidence.

Integration databases were fresh named guarded disposable databases on Vine's
loopback PostgreSQL port55439, with synthetic data and temporary storage; all were
cleaned up. Existing databases are refused. Main-local health/ledger queries were
read-only. No real Google login, browser acceptance or visual print/PDF evidence
is claimed. Expected denial/fault logs are confined to synthetic tests.

Vine was reloaded on **http://localhost:3000** after checking the listener's PID,
command and repository directory, and confirming the unchanged development-only
configuration. Three consecutive checks: PostgreSQL/API health200, app shell200,
anonymous protected chart401. No startup migration or fixture command was run.

Evidence remains outside Git in `/private/tmp/vine-staff-workflow`:
`checks/results.json`, `validation.log`, `typecheck-final.log`, `build.log`,
`local-health.log`, `local-smoke.json`, `source-verification.json`, `integrity.json`.

## Mandatory database report

1. **Schema change required: NO.** Existing user/Visit/chart JSONB is adequate.
2. **Committed migration chain: 001–004**, unchanged immutable files.
3. **Local applied migration: OBSERVED 001–004**, read-only loopback ledger;
   all checksums match committed source.
4. **Production applied migration: UNVERIFIED.** Production was not inspected.
5. **New migrations: none.** No DDL, backfill, account seed or schema synchronization.
6. **Fresh database validation: PASS**, complete001–004 in disposable integration tests.
7. **Upgrade path: N/A for new schema**; existing003→004 retained-record forward
   migration regression PASS.
8. **Existing-record compatibility: PASS**, legacy/unassigned appointments, historical
   performers, canonical/legacy Services, chart revisions and archive/restore retained.
   No account or clinical record backfill is needed.
9. **Production catch-up:** none added by this update; actual missing committed
   migrations require future authorized inspection and ordered compatible release.
10. **Recovery/rollback:** no SQL reversal. Prior enforcing permission code restores
    medical Staff read-only defaults; keep JSONB data and explicit overrides intact.
    Roll back the permission policy and its designation protection together;
    do not restore a generic designation writer while retaining medical defaults.
11. **Unexplained divergence:** no local migration/checksum mismatch observed;
    full local/production structural parity remains **UNVERIFIED**.

## Next

New scoped review of the combined appointment/performer/chart permission follow-up,
then interactive Nurse/Medical Staff walkthrough and print/PDF acceptance. Staging,
commit, push or production deployment requires a separate user instruction.
