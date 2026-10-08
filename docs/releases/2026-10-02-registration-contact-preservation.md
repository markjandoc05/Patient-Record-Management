# Registration compatibility: preserve omitted emergency contacts

Local-only October 2, 2026. Narrow server compatibility fix; no new UI fields,
clinical rules, schema migration, production change, commit/push/deployment.

## Confirmed defect

PATCH /api/records/patients/:patientId parses full edits before reading the existing
patient. parseEmergencyContact defaults absent structured fields to empty strings.
An older full-edit client that does not send emergencyContactName, Relationship or
Number could therefore erase an existing structured contact while changing other
patient information. Restricted staff/manager edits already merge with the current
record, so this finding concerns the full-edit path.

A real disposable PostgreSQL/HTTP regression reproduced the overwrite before the
fix: the assertion that omitted emergency fields retain the saved values failed.
No ordinary development or production patient was used for reproduction.

## Fix and acceptance

Inside the existing patient transaction, copy full parsed updates and remove the
three structured contact fields from the update if the original request omits them.
The existing record is then left unchanged for those fields. Explicit empty values
still clear fields deliberately and explicit supplied values retain their existing
validation. Create behavior and edit/branch/clinical permissions are unchanged.

The regression covers an older administrator full edit with all three fields omitted,
preservation of the saved contact, and subsequent explicit clearing. Existing tests
cover current-client registration and staff edits. No browser UI behavior was changed;
previous browser create/edit/failure/retry evidence remains separately documented.
Native reload confirmation and comprehensive visual/console acceptance remain open.

## Validation and recovery

All 29 commands pass on Node 22.23.3 and disposable PostgreSQL 17: TypeScript,
production build and 25 suites. The expanded simple registration API suite passes
28 checks, including the formerly failing preservation assertion and explicit
clearing. Existing patient, clinical, appointment, RBAC/audit and account regressions
pass. Whitespace/diff check passes. Existing bundle/dependency warnings are unchanged.
The localhost backend was restarted to load the tested fix.
No fixture is created in the shared development database; disposable test containers,
source snapshots and all synthetic database records are removed by the harness.
Recovery is source-only; do not roll back patient data. Reverting this fix restores
the confirmed overwrite behavior, so keep compatibility protection for older clients.

Files: server.ts, scripts/test-simple-registration-api.ts, roadmap/changelog and
this note. Earlier dirty worktree releases remain separate; review individual hunks.
