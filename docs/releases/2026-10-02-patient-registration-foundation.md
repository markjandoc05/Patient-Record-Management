# Patient Registration Improvements — Release 1

Local implementation, October 2, 2026. No commit, push, deployment, production
change or database schema migration. Releases 2 (duplicate warnings/form protection)
and 3 (explicit clinical states/intake attribution/review) remain separate work.

## Root cause and behavior

PatientForm and server parsePatientPayload both required email/address and an exact
birthday. Profiles/directories displayed stored age without DOB certainty metadata.
Registration now accepts empty email/address, validates supplied email, and records:

- exact: actual birthday and calculated age;
- estimated_age: estimatedAge plus estimatedAgeAsOf, with empty birthday/null age;
- estimated_year: estimatedBirthYear, with empty birthday/null age;
- unknown: empty birthday/null age and no estimate.

New forms default to Unknown; selecting Exact requires a real valid nonfuture date.
Existing records with birthday and no status are inferred exact; missing dates are
inferred unknown. No historical rows are bulk modified. Switching modes clears
inapplicable fields on save. Approximate values never generate an exact date.
Estimates retain their original values/date, rather than silently advancing to a
current exact age. Profiles and directory rows explicitly label estimates/unknown.

JSONB adds birthDateStatus, estimatedAge, estimatedAgeAsOf, estimatedBirthYear.
The shared validator is used by frontend and backend. Staff demographic edit
allowlists include these source fields; existing role/branch/edit restrictions remain.
Exact patient identity hashes retain their prior input to preserve historical keys.
Nonexact identities incorporate status/source instead of pretending an estimate is
an exact DOB. Unknown DOB is not a probable-match signal; broader duplicate-warning
logic is not introduced. The existing full-identity collision safeguard remains.
Legacy duplicate scans compare complete identity keys to avoid conflating different
estimate sources. Same name/contact/email with differing estimates can remain separate;
this is not evidence of identity and no automatic merges occur.

Clinical fields, main-concern requirement, gender and skin-type defaults remain
unchanged until their separately planned release. Optional initial email/address
does not implement later workflow-specific requirements; those need a concrete
operational rule. Current age bounds (0–130) are preserved for estimates.

## Validation and honest gaps

Node 22.23.3, fresh source snapshot, disposable PostgreSQL 17: all 24 commands
passed, including TypeScript/build and 20 suites. New birth validator: 26 checks;
new patient registration HTTP/PostgreSQL suite: 39 checks covering all four modes,
empty fields, invalid email/source dates/estimates, restricted demographic updates,
branch restrictions, inactive account denial, and shared read-policy regressions.
Existing patient lookup 50/20, PostgreSQL 54, appointment authorization 236, parity
142, shared cache/profile 32, appointment loading 16 and RBAC/audit/onboarding/support
suites pass. Build retains the existing bundle warning; dependency install reports
eight moderate findings outside this release. Whitespace/diff check passes.

Real browser, existing Mark Support / Developer: four mode controls render; Unknown
registration saves with empty email/address; editing to Estimated Birth Year saves;
directory and opened profile show the estimate, not an exact DOB/age. Invalid missing
estimated-age as-of input gives an explicit validation error. Estimated-age save and
exact-date calendar interaction are proven by API/helper tests, not completed browser
saves. Native date fill in automation did not reliably persist into React form state;
manual estimated-age/as-of acceptance remains required. Mobile/tablet visual and
full console/network acceptance have not been completed. Do not label these PASS.

The initial browser request reached an older server and received email-required;
restarting the identified localhost process loaded the updated backend and fixed
the environment mismatch. One process now owns HTTP and Vite hot-reload ports.

## Files and cleanup

server.ts; src/utils/patientBirth.ts (new); PatientForm.tsx, PatientProfile.tsx,
PatientDashboard.tsx; scripts/test-patient-birth.ts and
scripts/test-patient-registration-api.ts (new); package.json test commands;
ROADMAP.md, CHANGELOG.md, DEVELOPMENT.md and this release note.
Prior unrelated dirty hunks remain and need separate review before committing.

One synthetic browser patient was created and edited, then removed after verifying
zero appointment/visit references; its identity key was removed too. Audit history
and the issued patient-ID counter are retained (IDs must not be reused). Final
development patients/appointments/visits: zero; two original users preserved.
All disposable test databases/containers/source files removed. No demo dataset seeded.

Ready for remaining browser acceptance, not a claim of completed production release.
Recovery: revert only this release's source hunks; do not revert the database to an
older snapshot or manufacture birthday values. Older application versions cannot
safely edit new nonexact DOB records; retain this validator/display compatibility
or disable such edits during rollback. No automatic destructive data rollback.
