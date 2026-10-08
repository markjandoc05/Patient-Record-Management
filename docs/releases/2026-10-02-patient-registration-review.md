# Patient registration — release review

October 2, 2026. Local candidate only. This review makes no application, database,
permission, commit, push or deployment change.

## Resulting workflow

- Register using the existing clinic, name, phone, gender and concern requirements.
  Email and residential address are optional; supplied email is validated.
- Select an actual birthday; Age is calculated and read-only. A blank birthday
  produces no calculated age. Server validation independently derives age.
- Enter optional emergency contact name, relationship and number. Existing free-text
  contact information remains visible and stored. Omitted structured contact fields
  in older full-edit requests preserve saved values; explicit empty values clear them.
- Existing duplicate warnings, save failure/retry, dirty-form confirmation and
  explicit clinical finding states remain. Blank clinical information is not a
  negative finding. No new clinical review gate or invitation functionality.

Historical estimated birth information remains internally supported without
fabricating a date; the current form does not present the earlier four-mode UI.

## Files and dependencies to review before staging

Registration implementation: patient-related hunks in `server.ts`,
`src/components/PatientForm.tsx`, `src/components/PatientProfile.tsx`,
`src/components/PatientDashboard.tsx`, and test scripts in `package.json`.
Shared registration helpers: `src/utils/patientBirth.ts`, `emergencyContact.ts`,
`patientDuplicates.ts`, and `clinicalFindings.ts`.
Tests: `scripts/test-simple-registration.ts`, `test-simple-registration-api.ts`,
`test-patient-birth.ts`, `test-patient-registration-api.ts`,
`test-patient-duplicates.ts`, `test-clinical-findings.ts`,
`test-clinical-findings-api.ts`.
Documentation: associated registration release notes, ROADMAP.md, CHANGELOG.md,
DEVELOPMENT.md.

This is a dependency inventory, not permission to stage entire files. The current
files also contain earlier Support / Developer, onboarding, lookup, appointment
and authorization work. The form imports current RBAC and record API helpers.
An isolated patch must retain or explicitly declare those dependencies and pass
validation itself. Existing combined-tree validation does not prove a standalone
registration patch can run on the original baseline. Do not use `git add .`.

## Evidence already recorded

The latest combined candidate passed all 29 Node 22.23.3 validation commands,
including TypeScript, production build and 25 suites against disposable PostgreSQL
17 where needed. Simple helper: 13 checks; simple registration API: 28 checks.
The contact omission defect was reproduced before its fix and passed afterward.
This documentation review does not claim a new run of those suites.

Browser evidence covers actual birthday/age, registration with blank email/address,
saved emergency contacts, edit/profile, invalid phone rejection, failure/retry,
Escape/Keep editing, and desktop/tablet/mobile geometry. Synthetic fixtures were
removed after checking linked records. Production was not used or modified.

See [browser evidence](2026-10-02-simple-registration-acceptance.md) and
[contact compatibility evidence](2026-10-02-registration-contact-preservation.md).

## Remaining acceptance

Native reload confirmation remains UNVERIFIED: browser automation paused navigation
but exposed no inspectable native dialog. In a normal browser, enter unsaved form
data, reload, choose to stay, and verify the entries remain; then discard using the
existing form confirmation. This check requires no saved test patient.
Comprehensive console/network and pixel-perfect visual acceptance remain unverified.
Interactive checks used Support / Developer; ordinary-role server tests are separate
evidence, not ordinary-role browser acceptance.

## Recovery and release decision

No schema migration or data backfill is needed. Preserve JSONB contact fields,
legacy contact text, birth-source metadata, IDs, identities and audit history.
Do not restore an older database snapshot to roll back UI code. Removing the
contact compatibility fix restores a confirmed data-clearing defect.

Ready for user acceptance and patch preparation, with the limits above. Not yet
an independently validated, isolated commit or authorized production release.
Before committing: review/select the coherent patch and its declared dependencies,
validate that exact candidate on Node 22, and obtain an explicit commit instruction.
No additional patient feature is authorized by this review.
