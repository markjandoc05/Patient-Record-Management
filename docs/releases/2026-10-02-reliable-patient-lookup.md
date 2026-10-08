# Reliable Patient Lookup — local evidence

October 2, 2026, Asia/Manila. Local-only; no commit, push, deployment, production
write, schema change, registration-field change, stored-phone rewrite or merge.

## Audit, defects and exact changes

PatientDashboard loads patients, users, branches, appointments and permitted visits
using existing subscriptions. Search/pagination filter loaded records client-side;
typing does not send server searches. AppointmentForm and VisitForm also filter
loaded patients, exclude archives and cap suggestions at eight. They currently
allow nonarchived Inactive patients; this release preserves that policy.

The directory previously searched name, contactNumber, email and internal id but
missed patientID. Selector matching was inconsistent. Repeated spaces and Philippine
phone-prefix/format differences could hide existing patients. Failed directory
requests could look like empty results.

One shared matcher now searches name, email, patientID, internal id and contactNumber
using case-insensitive substring matching and trimmed/collapsed spaces. Phone-shaped
queries additionally strip punctuation and equate Philippine mobile forms 09...,
+639..., 00639... and 9..., including partial prefixes with at least three normalized
digits. Missing legacy contact fields remain searchable by name/ID. Stored values
and registration rules are unchanged; no fuzzy-name or automatic identity matching.

Directory initial failures show an error and Retry loading rather than an empty
result. Existing required initial-subscription loading barriers remain. Temporary
refresh errors retain loaded records with an out-of-date warning. Retry reloads
subscriptions while preserving search/filter controls. Authorization denial hides
cached rows/profile/edit views; retry can recover after authorized responses resume.
Existing cancellation/generation guards prevent disposed callbacks updating state.
Synchronous search always uses the current query, including after polling refreshes.

## Server authorization

Audited backend/dataApi.ts POST /api/data/query and direct reads, server.ts patient
routes, RBAC and shared subscriptions. Patient visibility is intentionally shared
organization-wide among active approved roles, including registration at unassigned
branches. Registration-clinic filters narrow results; they do not grant patient
access. Archived/Inactive records remain server-readable under existing policy;
normal directory mode excludes archives and the archived view includes them.
Appointment reads retain their separate branch restrictions. No server policy changed.

Real disposable PostgreSQL/HTTP checks verify Staff assigned A and Administrator
list/direct reads across A/B, narrowing filters, archive/inactive visibility,
inactive/anonymous account denial, hostile limits/fields/operators and malformed
direct paths. Error/denied responses contain no synthetic patient payload.

## Duplicate risks and next registration proposal

Existing registration returns 409 for exact identity duplicates. Transactional keys
combine normalized name, digits-only phone, lowercase email and birthday; a legacy
email-query scan compares name/contact/birthday. These are exact safeguards, not
probable-duplicate warnings. Keys do not equate local and country phone prefixes.

HTTP tests prove exact-repeat rejection while same name/different DOB, shared phone,
shared email, similar names, same name/DOB with different contacts, and local/+63
phone variants can be created separately. These can be legitimate people or duplicate
records. No record is merged or automatically classified by this release.

Propose a nonblocking Possible existing patient warning with matching reasons,
distinct IDs and Open/use existing versus Continue registration actions. Keep the
existing exact-duplicate safeguard; never block on one weak/shared contact/name.
Before implementing, agree signal combinations, unknown DOB handling, shared family
contacts, archived restoration, inactive booking, and any override role/reason.
Minimum registration fields and name/contact structure remain separate clinic decisions.

## Browser acceptance

Interactive identity: existing markjandoc@gmail.com Support / Developer, unchanged.
Nine isolated synthetic patients included duplicate names/contacts, missing fields,
phone formats, an archive and an Inactive record.

| Check | Result/evidence |
| --- | --- |
| Initial loading | PASS: loading precedes eight nonarchived records. |
| Full/partial names, case and spaces | PASS: expected distinct records, including intentional substring matches. |
| Phone formats | PASS: 09171234567, +63 917 123 4567 and 9171234567 each return three records; partial 0917, +63 917 and 0063917 also return three. |
| Email, patientID, legacy name | PASS: expected two, one and one records. |
| Clear/nonexistent | PASS: eight after clear; true successful empty result for nonexistent query. |
| Rapid searches | PASS: final ID query shows only the expected record. |
| Open patient | PASS: correct ID, DOB, phone, email and clinic. |
| Existing-patient appointment | PASS: lookup/select preserves ID/phone; cancelled without saving. |
| Navigation | PASS: profile close preserves search; navigation away/back resets it according to existing design. |
| Inactive/archive filters | PASS: corresponding fixtures visible in existing views. |
| Initial 503/retry | PASS: explicit error, not empty; recovery restores eight records. |
| Polling 503/retry | PASS: eight cached rows retained with warning; recovery succeeds. |
| Authorization denial/recovery | PASS: injected 403 hides cached protected rows; cleared interception and retry/navigation recover. |

Injected failures prove UI response, not real account authorization. Server policy
is separately tested over HTTP. Interceptors were cleared and paused requests resumed.
Normal loading console inspection returned no warnings/errors. Injected denial caused
an expected existing Failed to load clinic branches log, not a normal-load error.

No saved appointment/clinical visit, patient archive/restore, or restricted-staff
interactive browser evidence is claimed. Visit selector matching has shared-helper
and static-wiring checks. Existing profile New appointment requires selecting its
patient in the form; this behavior remains. Profile live-refresh is a separate task.

## Performance

Observed window across polling, profile and appointment handoff: 98 request events,
93 paired responses, zero failed requests, paired durations 114–2784 ms; five were
in flight/unpaired. This is not an exhaustive trace or per-keystroke benchmark.
Search adds no HTTP requests. Existing multiple subscriptions and workspace polls
remain; each schedules the next poll five seconds after its request finishes.
Nine fixtures establish functional behavior, not large-directory scalability.
No evidence required new search infrastructure or broad polling changes.

## Automated validation

Fresh source copy excluding private data/credentials; Node 22.23.3 and disposable
PostgreSQL 17. All 22 harness commands passed: install, runtime version, TypeScript,
production build and 18 suites. Patient lookup: 50 pure/static checks; patient API:
20 real HTTP/PostgreSQL checks; shared data/cache/profile: 32; appointment loading:
16; PostgreSQL: 54; appointment read authorization: 236; parity/API/clinical/audit:
142; workspace: 28; onboarding UI: 48; development activation: 28; onboarding API:
82; support access: 122; support subscriptions: 6; all 13 support panels rendered.
RBAC, audit, login activity and developer-tool suites passed. Simulated OAuth tests
are not genuine Google sign-in evidence.

Existing build bundle warning and eight moderate dependency findings remain outside
scope. Final git diff --check passed after documentation changes.

## Files, cleanup, readiness and recovery

Changed feature files: src/utils/patientLookup.ts (new), PatientDashboard.tsx,
AppointmentForm.tsx and VisitForm.tsx. New tests: scripts/test-patient-lookup.ts and
scripts/test-patient-lookup-api.ts; package.json adds two commands. Documentation:
this note, ROADMAP.md, CHANGELOG.md and DEVELOPMENT.md. Prior worktree changes are
outside this release; review individual hunks before any future commit.

Removed all nine marked development fixtures after verifying no appointment/visit
references. Final development counts: zero patients/appointments/visits; two existing
users preserved. Disposable test databases/containers/files removed. Test-only
helpers/manifests remain in ignored private data, not application seeding. No ordinary
demo dataset recreated and no development/production schema migration applied.

Ready for a scoped commit review on the evidence above; no commit authorized here.
This does not close earlier appointment/onboarding workstreams or authorize deployment.
Recovery is code-only: revert this release's matcher, call sites, directory error
handling and tests/docs, preserving earlier unrelated hunks. No data rollback needed.
Next smallest release: agree and implement lightweight registration duplicate warnings.
