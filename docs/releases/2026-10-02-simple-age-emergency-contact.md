# Simple birthday/age and emergency contact

User-directed scope, October 2, 2026. This supersedes the four-mode DOB registration
UI: show Birthday and read-only Age calculated from the selected actual date.
No unrelated clinical/review features added. Local-only; no commit/push/deployment.

Age uses the shared date validator and clinic date, handles birthday boundaries and
age zero, and is independently derived by the server. Invalid/future birthdays are
rejected. No selected date means no calculated age. Prior estimated DOB information
is retained when editing without a replacement birthday; an actual selected birthday
becomes Exact. Historical source metadata is not bulk removed or converted into dates.

Emergency contact has optional name, relationship and contact number fields, stored
as emergencyContactName, emergencyContactRelationship, emergencyContactNumber in
existing JSONB. Supplied phone must contain 7–15 digits; length/type checks apply
server-side too. Restricted demographic editing accepts these demographic fields.
Legacy emergencyContact text remains visible and stored separately; no automatic
splitting/guessing or historical data loss. Profiles display all three fields.

All 29 validation commands pass on Node 22.23.3/disposable PostgreSQL 17: TypeScript,
production build and 25 suites. New simple-helper checks: 13; simple registration
HTTP/PostgreSQL checks: 24, including create/edit, age derivation ignoring client age,
invalid birthday/phone rejection, optional email/address, legacy contact preservation
and branch authorization. Existing registration, clinical, duplicate, lookup,
appointment, RBAC/audit/account/shared-data regressions pass. Whitespace check passes.
Existing bundle/dependency warnings remain outside scope.

Real browser using unchanged Mark Support / Developer account:
- Birthday 1990-10-03 gives age 35 on 2026-10-02; 1990-10-02 gives 36.
- Age remains 36 after editing other fields.
- Registration saves with optional email/address blank and three emergency fields.
- Profile displays saved age 36, contact name, Mother relationship and phone correctly.

The single synthetic browser patient and identity key were removed after checking
for clinical links. Audits and issued ID counter retained. Development returns to
zero patients/appointments/visits with two existing users unchanged. Disposable
validation containers/source snapshots removed; production untouched.

Changed PatientForm.tsx, PatientProfile.tsx, server.ts, package.json; new
src/utils/emergencyContact.ts, scripts/test-simple-registration.ts and
scripts/test-simple-registration-api.ts; roadmap/changelog/development docs and this
note. Review release hunks independently of earlier dirty files. No schema migration.
Recovery must preserve stored structured contacts and historical DOB source metadata;
do not replace records with an older database snapshot. Responsive/native-navigation
checks from earlier releases are not relabelled as complete by this targeted pass.

Additional [acceptance pass](2026-10-02-simple-registration-acceptance.md) verifies
desktop/tablet/mobile geometry, mobile create/retry/edit/profile, invalid emergency
phone handling and Escape/Keep editing. Native reload confirmation remains unverified;
no new code defect or implementation changes. Viewport and fixtures cleaned up.
