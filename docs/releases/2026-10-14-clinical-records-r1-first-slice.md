# Clinical Records R1 — patient medical background

Implemented locally October 14, 2026 on `bb35040`. The preceding stabilization
commit is `bb3504078fdc20fcb16132847df2dffb5981007f` (`fix(visits): stabilize
service carryover and chart presentation`): nine reviewed files, 27 hunks,
315 insertions/33 deletions. Each staged/committed blob matched the private review
manifest. All ten excluded dirty paths and the ignored environment were preserved.
That local commit has not been pushed or deployed.

Specification: [first-slice contract](../planning/clinical-records-r1-first-slice.md).
This clinical slice is **unstaged and uncommitted**, ready for independent scoped
review. It does not complete the entire Clinical Records roadmap.

## Result

The existing Patient form now has optional **Medical history** and **Ongoing health
concerns** fields in Clinical intake. The Patient profile's Medical overview shows
them, plus the server-owned encoder and time of their last meaningful change.
Blank/missing text says Not recorded; it never establishes confirmed none.
Allergies, medications, conditions, main concern and their historical semantics
remain unchanged. No duplicate encounter module or additional role is introduced.

Supplied new values must be strings within the shared limits (5,000/2,000).
Omitted data remains unchanged. Unchanged imported strings retain their original
bytes/length; non-text historical content remains visible/read-only and is omitted
from unrelated form writes. An explicit authorized clear is a versioned change.

The existing patient JSONB record stores `clinicalHistoryVersion` (missing means
0), `clinicalHistoryUpdatedAt`, `clinicalHistoryUpdatedByUid`, and
`clinicalHistoryUpdatedByName`. Creation/meaningful edits derive metadata from the
authenticated transaction actor. Client metadata is rejected. Changed history
updates require the current `expectedClinicalHistoryVersion`; stale/missing/invalid
versions return 409 `PATIENT_HISTORY_VERSION_CHANGED`. Unchanged retries are safe
no-ops for the history revision. The existing whole-patient timestamp check remains.

The form captures both conflict tokens when opened, rather than adopting a newer
polling response while retaining an older unsaved draft. Account/access changes
discard the old workspace, abort pending requests and prevent stale success,
401/403 or conflict responses from closing/invalidation of a new scope. Current
denials still invalidate protected data. The current own-profile snapshot wins
over a stale shared user row and works without a document ID. The submitted form
draft is disabled while saving; success closes that submitted draft, while a
current failure preserves it and re-enables editing/retry.

Independent review reproduced two P2 defects in the first candidate: denied-reader
private-value guessing and loss of edits entered during an earlier pending save.
Both are repaired locally. History input now requires the transaction's current
actor and denies every nonblank/nonstring submission before inspecting private
stored history. Omitted/blank string defaults preserve protected data and permit
existing operational updates. Creation uses this boundary after its authorization
refresh; visible read-only users retain unchanged legacy values. The native form
fieldset locks all draft controls during save without changing per-control access.

## Permissions and preserved workflows

Existing registration/intake rules and branch checks apply to creation. Existing
full patient-edit masks plus `patients.edit`, `clinical.view` and
`clinical.edit_draft` govern edits; current authority is reloaded inside the write
transaction. Staff/Manager masks remain limited. Nurse/Medical Staff can retain
their current patient registration and demographic edits, appointment completion,
Visit documentation and eligible chart work; this does not grant full background
history editing. Operational patient reads remain shared; denied clinical readers
receive neither new content nor its attribution and cannot query those fields.

Doctor Visit ownership, Visit/chart branch restrictions, archived/finalized record
guards, Service eligibility and charts are unchanged. No signing permission,
prescription workflow, dental maps, inventory, package or billing behavior added.
Metadata identifies who entered the background text, not a clinical reviewer.
Existing transactional audits record changed fields/actor/time without adding new
clinical narrative to general audit logs.

## Validation

- TypeScript and production build pass; existing large-bundle warning remains.
- New helper/version/redaction tests: **94** checks pass.
- New controlled real-form/adapter race suite: **35** scenarios pass.
- New HTTP/PostgreSQL suite: **131** checks pass, including concurrent edits,
  explicit clear, lost-response retry, metadata spoofing, old client omission,
  legacy strings/structured data, restricted masks, branch-limited registration,
  clinical redaction/query denial and permission loss before transaction commit.
  Repair regressions cover correct/incorrect/trim-equivalent/over-limit/structured
  guesses for both fields, identical denial outcomes, blank-default operational
  saves, unchanged read-only legacy saves and queued intake losing clinical view.
  The new helper and HTTP denial regressions fail against the pre-repair backend;
  the six new pending-save component regressions fail against the editable form.
  Delayed 200/409/500 tests now verify locking, recovery/retry and successful close.
- Existing real HTTP/PostgreSQL regressions pass: registration **39**, explicit
  findings **32**, access-control/security/branch/audit/live revocation **210**,
  shared clinical/parity **142**. All writes use new disposable loopback PostgreSQL
  17 databases, synthetic identities and temporary storage. Owned containers and
  storage removed; no normal development records were written.
- Existing controlled/policy regressions pass: findings **48**, birth **26**,
  duplicates **24**, simple registration **13**, permission policy **223**,
  permission scope **226**, Visit Services **174**, appointment Services **92**,
  performers **63**, charts **71**, chart transport **18**, invalidation **14**.
- The repair rerun also passes permission repairs **37**, chart policy **33**,
  Support HTTP/in-memory **124**, all **13** Developer panels, existing
  RBAC/audit/Developer/login policies and performer HTTP/PostgreSQL **240**.
  The initial broad runner hit an overlong `tsx` CLI IPC path, sandboxed localhost
  binding and a correctly guarded missing test database. Equivalent Node-loader
  runs, isolated localhost access and the disposable performer database pass;
  no test guard or application permission was weakened.
- A fresh read-only reviewer found no concrete surviving bypass or compatibility
  regression in the repair. This does not replace the next full scoped
  commit-readiness review of the current HEAD-based clinical candidate.
- Whitespace check passes; environment, migration files, empty index, committed
  stabilization and all ten unrelated dirty paths remain intact.
- Supported Browser smoke on localhost: retained Support session loads after the
  Vine-only restart, fields accept synthetic unsaved input, desktop and requested
  390×844 layout pass (actual CSS viewport 433×938 at current browser scale), no
  horizontal overflow. Screenshots inspected; synthetic drafts discarded through
  the existing confirmation. No browser record-save or restricted-role matrix was
  run. An immediate post-restart click preceded auth initialization; repeating it
  after inspecting the ready DOM succeeded. No product defect reproduced.
- Main Vine `/api/health` and app shell return 200 over three consecutive cycles.
  Server remains on localhost:3000. No DARF, production or OAuth settings changed.
  After the repair, only the verified Vine server was restarted to load the new
  backend; three additional health/SELECT 1 and app-shell cycles return 200.
  No browser acceptance or normal-development patient writes ran in this repair.

Evidence/logs outside Git:
`/private/tmp/vine-stabilization-review/` and
`/private/tmp/vine-clinical-r1-first-slice/`.
Prior native PDF/JSON/chart overlay evidence is retained separately; macOS native
Save-dialog completion/physical printing and full fresh/restricted browser
acceptance remain unverified. Do not reinterpret this smoke as full release sign-off.

Local clinical patch paths (12; all unstaged): `package.json`, `server.ts`,
`src/components/PatientForm.tsx`, `src/components/PatientProfile.tsx`,
`src/utils/recordApi.ts`, `src/utils/patientMedicalHistory.ts`,
`backend/patientMedicalHistory.ts`, `scripts/test-patient-medical-history.ts`,
`scripts/test-patient-medical-history-api.ts`,
`scripts/test-patient-medical-history-ui.ts`, this release note and
`docs/planning/clinical-records-r1-first-slice.md`.

## Mandatory schema report

1. Schema change required: **NO**. Additive JSONB fields and existing transactions.
2. Committed immutable chain: **001–004**, unchanged.
3. Local: **observed 001–004 on October 14**, SELECT 1 and ledger checksums pass.
4. Production: **current UNVERIFIED**, no connection; historical 001–002 does not
   establish today's applied version.
5. New migrations: **NONE**.
6. Fresh DB: complete 001–004 initialization passes in disposable integration tests.
7. Upgrade: **N/A**, no SQL/schema transition. Compatibility with retained legacy
   JSONB and omitted new fields is tested explicitly.
8. Existing records remain readable; no bulk backfill/conversion or synthetic seed
   on startup. Current source omits/read-only protects non-text legacy content.
9. Production catch-up: no new migration; any existing 003/004 pending gap requires
   separate current inspection and authorized compatible release.
10. Recovery: reverse only this feature's source hunks; retain values/version/author
    metadata. Old clients omitting fields remain compatible, but older server code
    must not perform new history edits without this version check.
11. No structural divergence introduced; full current structural parity UNVERIFIED.

## Next

Repeat independent scoped commit-readiness review of the repaired first slice; do not
stage its source as part of the preceding stabilization commit. Review the exact
HEAD-based candidate before any separate commit authorization. Then decide the
Visit-wide stale-note-save guard. Visit signing/amendments and prescribing remain
separate approved design/implementation work.
