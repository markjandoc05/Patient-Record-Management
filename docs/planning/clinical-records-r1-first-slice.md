# Clinical Records R1 — first local slice

Prepared October 14, 2026 against stabilization commit
`bb3504078fdc20fcb16132847df2dffb5981007f`. This specification implements the
smallest incremental slice of the user's instruction to proceed with the sequence.
Clinical changes remain local and uncommitted; production deployment is separate.

## Current clinical audit

The existing Patient form/profile already stores and displays allergies,
medications, medical conditions, skin type and main concern. These are reported
entries, not clinician review. Three historical finding states are retained;
free-text edits return a changed finding to Unknown and never infer None Known.
Patient mutations already use server authors/timestamps and an optional
`expectedLastUpdatedAt` conflict check. Staff and Manager edits use restricted
field masks, even when clinical viewing is allowed.

Visits already contain diagnosis, treatment plan, notes, follow-up, actual
performer snapshots and descriptive assisting names. Creation stores server
authors/timestamps, links a booked appointment or records a walk-in, and marks the
Visit Completed. Completed remains editable subject to current capabilities,
branch scope and Doctor ownership. There is no implemented Visit draft/signing
command or Visit amendment workflow. Imported signed/finalized flags block edits;
archive/restore retains existing authority. Visit-wide optimistic concurrency is
a remaining gap; Service version guards do not version all clinical notes.

Face/front/back charts are separate versioned Visit records with drafts,
immutable signed revisions, attributed amendments and saved print/JSON export.
Chart signing does not sign the Visit. Nurse/Medical Staff Visits need no assigned
Doctor when their performer is eligible. `clinical.finalize` is explicitly granted;
it is not inherited by any role. No dental charts.

Patient timelines, longitudinal Visit history, private notes and attachments/media
already exist. Authenticated clinical reads retain the current shared continuity
policy; clinical denial uses server redaction. Branch restrictions on appointment
operations, Visit/chart writes and Services prices remain independent. This slice
does not invent a new clinical read/write scope. Prescription permission names are
reserved; a clinician-authored prescription workflow is not implemented.

Evidence: `server.ts`, `src/components/PatientForm.tsx`, `PatientProfile.tsx`,
`VisitForm.tsx`, `VisitHistoryDashboard.tsx`, `PatientTimeline.tsx`,
`backend/clinicalCharts.ts`, `backend/clinicalRedaction.ts`, and the hybrid
access-control architecture/release notes. Current local PostgreSQL health and
001–004 ledger observed; current production state was not inspected.

## Scope and placement

Add two optional plain-text fields inside the existing Patient form's medical
section, and display them in the Patient profile's Medical overview:

| Field | Purpose | New/changed input limit |
| --- | --- | --- |
| `medicalHistory` | Reported past medical history | 5,000 characters |
| `healthConcerns` | Ongoing health concerns | 2,000 characters |

Keep existing allergies, medications, conditions and Visit-specific main concern
as they are. Empty/missing new values mean Not recorded, never confirmed none.
These are editable background notes, not a signed review or complete historical
snapshot ledger. Do not duplicate encounters or create a new navigation module.

## Exact write, attribution and concurrency contract

- Store optional fields in the existing patient JSONB. Omitted fields remain
  byte-for-byte unchanged, including when an older client edits demographics.
- Parse supplied values as strings only. Retain an unchanged legacy string exactly,
  including whitespace/over-limit text; validate and trim genuinely new inputs.
  An explicit authorized empty value clears that field. No backfill/conversion.
  Imported non-text content is shown read-only, omitted from form writes and
  retained on unrelated edits; it is not silently converted to a text field.
- Legacy/missing `clinicalHistoryVersion` means 0. On a meaningful history/concern
  change, increment it and set server-owned `clinicalHistoryUpdatedAt`,
  `clinicalHistoryUpdatedByUid`, and `clinicalHistoryUpdatedByName`. Do not stamp
  unchanged values or unrelated demographic edits. A new blank entry has no
  attributed history change.
- For an existing patient's changed history/concerns, require integer
  `expectedClinicalHistoryVersion` equal to the version read inside the existing
  serialized transaction. Reject a stale or missing version with 409 and a stable
  error code. Ignore/reject attempts to supply author/time/version metadata.
- Keep the existing whole-patient `expectedLastUpdatedAt` check. The history
  version also catches concurrent history edits without relying on clock precision.
  No new conflict policy is imposed on unrelated legacy edit commands.
- If a response is lost, refresh/reopen the patient to see the authoritative
  record; retrying an old changed-history request cannot overwrite a newer version.
- Recheck current actor/capabilities in the transaction. Protected request scope
  and the form lifetime reject responses from a previous account/access scope,
  including late 401/403 responses. Preserve unsaved form input on current errors.

## Permissions and workflow preservation

Creation follows existing reported-intake rules: patient-create permission,
clinical viewing and the current branch checks. Editing requires the existing
patient-edit authority and full patient-edit mask, plus `clinical.view` and
`clinical.edit_draft`. Nurse/Medical Staff remain on their current Staff patient
edit mask; their appointment/Visit/chart actions are unchanged. Explicit denial,
account lifecycle, Doctor ownership and guarded Support behavior remain in force.

Only authorized clinical readers see the fields and their attribution. The closed
operational redaction must omit them and prohibit queries on them for denied
clinical readers. Before any stored-value parsing/comparison, history input uses
the transaction's current actor. Denied readers' omitted/blank string defaults
preserve history; every supplied nonblank/nonstring value receives the same 403,
whether it matches private stored data or not. Generic data writes cannot bypass dedicated patient mutations.
The existing transactional audit records changed field names and actor/time; do
not add clinical narrative to generic logs. The new author identifies the encoder,
not the treating clinician, signer or reviewer.

## Proposed files

- `src/utils/patientMedicalHistory.ts`: shared limits, optional-value preservation
  and version interpretation.
- `backend/patientMedicalHistory.ts`: changed-field revision and trusted attribution.
- `server.ts`: compose with existing patient-create/update transactions.
- `src/components/PatientForm.tsx`: two existing-style optional inputs, version
  command and scoped save lifetime.
- `src/components/PatientProfile.tsx`: two values and their history-change attribution.
- `src/utils/recordApi.ts`: optional patient request lifetime, consistent with Visit
  adapters; no transport or endpoint bypass.
- Focused helper/API/component regressions and package test commands; this spec
  and a local release report. No permission-default or migration changes.

## Acceptance and failure checks

Create/read/edit with authorized roles; unknown/blank semantics; explicit clear;
unchanged legacy text/over-limit preservation; old client omission; server-only
attribution; unchanged writes do not version/stamp; two concurrent edits (one
succeeds, one 409); missing/stale/malformed version; lost-response retry; archived
patient denial; restricted Staff/Manager and explicit clinical denial; current
actor checked on commit; denied clinical read/query; stale scope success and
401/403 cannot close or invalidate a newer form scope. Retain registration,
allergy/medication semantics, Nurse/Medical Staff Visit/chart and branch regressions.
Lock the submitted form draft while saving; current errors retain and unlock it
for editing/retry. Test both history fields with delayed success, conflict and
server failure, plus matched/unmatched/over-limit/structured denial probes,
operational blank defaults and queued intake after clinical-view revocation.
Run TypeScript, production build and whitespace checks. Use disposable synthetic
PostgreSQL for write tests, never normal development/production records.

## Schema, compatibility and recovery report

1. Schema change required: NO; additive JSONB fields use existing transactions.
2. Committed immutable chain: 001–004, unchanged.
3. Local: directly observed 001–004 on October 14; health/checksums pass.
4. Production: current UNVERIFIED; historical 001–002 is not current evidence.
5. New migrations: NONE.
6. Fresh DB: complete existing chain in guarded disposable integration checks.
7. Upgrade: N/A for no schema transition; retain synthetic legacy JSONB records in
   compatibility tests.
8. Existing records load without new fields; omission preserves data and metadata.
9. Catch-up: no new migration. Any pending 003/004 requires separate current
   production inspection and authorization.
10. Recovery: preserve stored values/version/attribution on code rollback. Old
    clients omitting the new fields can continue their existing workflows; an older
    server must not be used to edit the new history fields without its version guard.
11. No structural divergence introduced; current full structural parity UNVERIFIED.

## Deferred scope and next decisions

Defer Visit-wide concurrent clinical-note edits, Visit draft/sign/amendment state,
clinician intake review/consent, immutable background-history snapshots,
prescription drafts, advanced scheduling, billing, packages and inventory.
Visit finalization requires an agreed signer/resource policy and amendment model;
prescribing requires separately approved clinician authority. No automatic grants.
Do not add dental maps. Native macOS Save-dialog completion/physical printing and
the earlier broad browser acceptance backlog remain unverified.

Sequence: stabilize and locally commit reviewed Visit/chart fixes → implement this
bounded Patient slice → independent scoped review → later decide Visit-wide edit
integrity and only then signing/prescriptions. The full Clinical Records roadmap
is not declared complete by this first slice. Effort is one bounded implementation
and review cycle assuming the existing JSONB/API architecture remains sufficient.
