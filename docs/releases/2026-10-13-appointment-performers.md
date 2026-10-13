# Unassigned appointments and Visit attribution — local implementation

October 13, 2026. Based on committed `ed1b1a4258861b2adb78e7f23af1a1c7de5c910a`.
Local implementation only. No staging, commit, push, production connection or deployment.

## Behavior

Appointments retain their existing types, statuses, branch access, provider assignment,
fixed clinic time slots, editing, archive and restore flows. New appointments default
to **Unassigned — assign later**. `doctorId: null` means no individual doctor is
reserved. Selecting a doctor later checks the doctor's current eligibility and existing
appointment/Visit conflicts inside the serialized server transaction. An omitted doctor
on an update retains the stored assignment; an explicit null removes it. A historical
inactive/deleted doctor remains visibly recorded in the form.

Visits record a required **Performed by** selection for new form submissions and an
optional **Assisting staff** text field (500 characters). Eligible new performers are
active, approved, nonarchived branch-assigned Doctors, or Staff designated **Nurse**
or **Medical Staff**. **Reception/Admin Staff** and undesignated Staff are ineligible.
Designation is metadata, not a new access role, capability grant or qualification check.
Existing clinic policy still determines who should perform a treatment.

The server creates `performedByUserId`, `performedByNameSnapshot`,
`performedByRoleSnapshot` and `performedByDesignationSnapshot`. Client-supplied
snapshot fields are rejected. Assisting names are descriptive text, never account
assignments, reservations or access grants. Performer names remain the recorded
snapshot after a rename, designation change or account removal.

The booked doctor association remains separate from the actual performer. Assigned
appointment links retain their doctor, patient, branch, time and one-Visit constraints.
For an unassigned linked appointment, a doctor-led Visit derives its doctor association
from the actual doctor; a nurse-led Visit has no doctor association. Neither silently
assigns a doctor to the booking. Doctor conflicts cover the associated and actual lead
doctor, including restoration. Nurse/assistant scheduling and clinic capacity are not
introduced. Optional follow-up booking uses the retained/derived doctor or stays
unassigned for nurse-led care.

Existing Doctor ownership and clinical write permissions remain authoritative. A
Doctor with no retained own association is offered only their own performer identity.
On their own assigned booking, a Doctor can still record a nurse as actual performer.
Staff designation alone cannot authorize Visit creation or clinical editing.

Designation is managed in Settings → Access → expanded Staff account → User details.
Writes require `users.manage`; existing role, branch, override and lifecycle protections
remain intact. No user designation is automatically assigned or backfilled.

Historical Visits without performer fields keep their original doctor attribution on
unrelated edits. Unchanged historical snapshots and imported assisting text remain
unchanged. Old doctor-only create clients can still submit a real doctor, which the
server resolves as the performer; explicit empty performer selections are rejected.
History, details and media use recorded performer names and distinguish the record
author (`createdBy`/`createdByUid`) from the treatment team. Operational projections
retain performer attribution; assisting text stays behind clinical access, including
query predicates and sorting.

## Scope

Runtime changes: `server.ts`, `backend/dataApi.ts`, `backend/clinicalRedaction.ts`,
`src/utils/visitPerformerPolicy.ts`; AppointmentForm, VisitForm, UserOperationalDetails,
AppointmentsDashboard, PatientAppointments, CalendarView, PatientTimeline,
VisitHistoryDashboard and PatientMediaTab. No capability defaults, role registry,
canonical Service eligibility/snapshots, OAuth or environment configuration changed.

Focused tests: `scripts/test-appointment-performers.ts`,
`scripts/test-appointment-performers-component.tsx`, and reusable controlled form
harness. Existing Visit Services API update helper excludes the new server-only
snapshot fields. Two package test aliases and this release/roadmap entry complete
the local scope. Existing private evidence files remain unrelated and unstaged.

## Validation

- Focused API/PostgreSQL suite: 180 checks, disposable `vine_performers_test` only.
- Focused actual-component suite: **43/43** scenarios pass, including historical
  inactive/deleted doctor display, actual history/directory attribution and designation.
- 24 relevant existing regression suites pass, including appointment/Visit Services,
  catalogue policy/API/UI, Support, protected invalidation, branch authorization,
  hybrid permissions, audit, shared clinical, onboarding and schema migration suites.
  The Visit Services API suite initially exposed branch validation before authorization;
  the server now checks current branch scope first and its 152 checks pass.
- TypeScript, production build and whitespace checks pass. The build retains its
  existing large JavaScript chunk warning.
- Local Vine restarted on port 3000; application shell and PostgreSQL-backed health
  return 200 on three consecutive rounds. No synthetic feature fixtures added to the
  main development database; all destructive integration checks use guarded temporary
  databases and storage, cleaned up afterward.
- Component tests execute actual forms/adapters with controlled responses, including
  late 200/401/403/409 responses, scope changes, logout and unmount. They are not
  fresh Google sign-in or desktop browser acceptance evidence. Interactive visual
  walkthrough remains pending; no browser/runtime workarounds used.

## Database and compatibility report

1. SQL schema change required: **NO**. Existing JSONB is adequate.
2. Committed chain: immutable/checksummed migrations **001–004**.
3. Local observed: PostgreSQL **17.11**, **001–004**, each applied checksum matches
   committed source. Read-only inspection; no main-database migration run.
4. Production applied version: **UNVERIFIED in this task**; no production access.
   Historical baseline statements are not a current production inspection.
5. New migrations: **none**; existing migration files unchanged.
6. Fresh initialization: PASS in guarded disposable databases with complete 001–004.
7. Feature upgrade migration: **N/A**. Existing guarded forward-migration regression
   passes; rerunning the chain retains new and legacy JSONB exactly.
8. Existing records: PASS; assigned doctor records, legacy absent fields, stale/inactive
   attribution, retained assistant text, archive/link summaries and Services snapshots.
   No backfill and no production-data fixtures.
9. Production catch-up required by this feature: **none newly introduced**. Any eventual
   deployment must independently inspect and reconcile the deployed migration chain.
10. Recovery: data is retained; there is no destructive SQL operation. Old code can load
    existing JSONB but does not support writing unassigned appointments or nurse-led
    Visits, and will not display the new attribution correctly. Any future rollback
    therefore needs an explicit workflow compatibility assessment, not just code rollback.
11. Unexplained divergence: no migration changes or checksum mismatch found locally.
    Full local/production structural parity is **UNVERIFIED**; production was untouched.

## Next gate

Ready for scoped commit review after final checks. No commit is authorized by this
implementation task. Production and DARF remain untouched. Clinical Records Release 1,
multi-service staffing, advanced scheduling, billing and stock workflows are separate.

## Booked Service carryover repair — October 13

New linked Visits keep the booked canonical Service selected while checking its
current detail automatically. Matching ID/version and active, branch-available,
Priced/Free eligibility require no second selection. Changed versions, unavailable
Services and failed checks retain explicit review/retry/removal. Pending checks block
saving; manual choices and branch/access changes discard late results and denials.
Historical Visit snapshots and the booked appointment remain unchanged. Backend
validation remains authoritative; no API, schema, migration or permission change.

Visit component/scope checks pass **174/174**, including booked carryover and
pre-passive-cleanup races. Appointment Services **92/92**, performer **43/43**,
Services **76/76**, permission scope **218**, protected invalidation **14/14** and
shared-data **32** checks pass. TypeScript and build pass. Automated component
evidence does not supply a new interactive browser walkthrough. The earlier frozen
20-file review patch represents the pre-repair candidate; a future scoped staging
task must use newly reviewed artifacts including this repair. No commit or deployment.

## New Visit legacy-field cleanup — October 13

The Legacy treatment / service text input is hidden on new booked and walk-in
Visits. Existing Visit edits retain their field and exact saved text; timeline and
Visit history retain legacy treatment labels. The state, payload, server alias
handling and stored records are unchanged. No schema, migration or permission change.

Visit component/scope **174/174**, performer **43/43**, TypeScript and build pass.
Coverage verifies new-form absence through creation and repeat-save, exact existing
text preservation, and actual history rendering of legacy text. No new browser
acceptance, database write, commit, push, production access or deployment.
