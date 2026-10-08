# Patient Registration Improvements — Release 2

Local implementation October 2, 2026. No commit, push, deployment, server-policy
change, schema migration or clinical-review implementation.

## Analysis of Release 1

Optional email/address and explicit DOB source modes passed all 24 Node 22 validation
commands, including 39 real registration API checks and 26 birth-validator checks.
Browser Unknown create and Estimated Birth Year edit/display passed. Exact-calendar,
estimated-age/as-of browser saves and mobile/tablet acceptance remain open; progressing
this independent release does not relabel those gaps as complete.

## Scope and behavior

Registration previously exposed only exact-duplicate rejection at submission and
closed manual entries through Cancel/Close/Escape without warning. This release adds
advisory matching over the already authorized, loaded patient collection, with no
new endpoint, per-keystroke requests or changes to registration authorization.

Signals: same normalized full name, same complete phone (7–15 digits, Philippine
local/country prefixes equivalent), same valid email, and same name plus exact DOB.
Blank values never match. Unknown/estimated dates are not exact-DOB signals. Partial
phone and fuzzy name matching are intentionally omitted to avoid noisy suggestions.
These signals are reasons for staff review, never proof that two records are one person.

The form shows distinct IDs, source-aware birth information, phone, clinic and
archive/inactive status for up to five matches. Additional matches are counted and
can be reviewed in the directory. Continue registration dismisses the advisory for
the current input/matched IDs; changed identity input or different matching IDs
rechecks it. There is no required override reason, new permission or server block.
Existing exact identity rejection remains authoritative. Archived matches can be
opened for review but are not automatically restored or reactivated.

Opening a matched record uses its existing object/id; no patient copy, merge, new
booking or clinical link is created. Manual changes require explicit discard before
opening the profile. Close/Cancel/Escape protect dirty create and edit forms; Keep
editing retains values. Browser beforeunload protection is installed for dirty forms.
This is a conservative manual-change flag, not draft persistence: reverting a field
can still prompt; browser crashes cannot be recovered. Auto-generated age/default
clinic do not themselves mark the form dirty. Existing failed-save value retention
and saving-action guards remain. An unavailable directory refresh is labelled so
no matches is not represented as proof that a patient is new.

## Validation

All 25 Node 22.23.3 harness commands passed: TypeScript, production build and 21
suites on fresh source/disposable PostgreSQL 17. New matching suite: 24 checks.
Registration API: 39; birth validator: 26; patient lookup: 50/20; PostgreSQL: 54;
appointment read authorization: 236; parity: 142; shared/cache/profile: 32;
appointment loading: 16. RBAC, audit, user lifecycle and support regressions pass.
Existing bundle warning and eight moderate dependency findings remain outside scope.
Final whitespace/diff check passes.

Browser with existing Mark Support / Developer identity, two isolated synthetic
patients (active/archive), results:

- PASS: name/normalized phone match reasons, separate IDs and archived label.
- PASS: Unknown DOB does not produce exact-date matching reasons.
- PASS: Cancel shows discard confirmation; Keep editing retains the name.
- PASS: explicit discard/open selects correct existing patient ID/profile.
- PASS: Continue registration dismisses advisory; changing identity brings it back.
- PASS: Close followed by explicit discard closes the form.
- PASS: a shared-phone warning does not block a valid registration request.
- PASS: intercepted 503 shows a save error and retains name/concern entries; retry
  sends a second request. Both requests were intercepted, so no new patient saved.

Interception was restricted to the registration Fetch endpoint and cleared afterward.
Expected injected errors are not normal-operation error evidence. Successful post-error
browser save, native beforeunload/Escape behavior, full console/network inspection and
responsive visual checks remain unverified. Pure/helper checks are not browser evidence.
Server exact-duplicate/weak-match and authorization behavior is covered by existing
real API suites, not inferred from Support / Developer browser access.

## Files, cleanup and readiness

New src/utils/patientDuplicates.ts and scripts/test-patient-duplicates.ts.
Changed PatientForm.tsx, PatientDashboard.tsx, package.json, ROADMAP.md,
CHANGELOG.md, DEVELOPMENT.md and this note. No Release 2 server or schema changes.
Prior worktree changes remain separate; review individual hunks before committing.

Both marked fixtures removed after verifying no linked appointments/visits; no
accounts or production records changed. No ordinary demo dataset seeded. Private
test helper remains ignored. Keep existing audit history and issued counters.

Local candidate ready for remaining acceptance; no blanket commit/deployment sign-off.
Recovery: remove only advisory helper/call sites and dirty/discard handlers; preserve
Release 1 source-aware DOB fields, server validation and prior security improvements.
Next: finish outstanding registration browser checks, then audit clinical intake
sources, explicit findings, versioned clinician review and treatment enforcement as
Release 3. That clinical audit must identify existing authorized roles and applicable
service/treatment entry points before introducing a clinical gate.
