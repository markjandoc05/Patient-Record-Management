# Changelog


Hybrid access foundation repair: audit query inference blocked before predicates; all access-policy writes use the revisioned API; unchanged legacy clinical whitespace preserves stored text. Three defect regressions and prerequisite-only reconstruction are part of the new review evidence. No commit/deployment or Clinical R1 start.
## Unreleased — Hybrid access-control foundation, October 3 local

Add role-default capabilities with per-user JSONB Allow/Deny overrides and independent branch/resource scope. Separate operational `users.manage` from Administrator/Support-only `access.manage`; add compact Module Access controls, revision conflicts and atomic access audits. Explicit clinical viewing denial projects operational patient/appointment/Visit records server-side and protects hidden values during edits. Preserve Staff/Manager clinical-read defaults, Support guards and Services snapshots/race protections. No SQL migration or Clinical R1 workflow implementation. See [release evidence](docs/releases/2026-10-03-hybrid-access-control.md). Local and uncommitted; browser verification remains blocked by missing desktop runtime.


## Unreleased — Services 1B-B Visit / performed Services

Add optional canonical performed Service selection to Visit create/edit, separate from the booked appointment snapshot. Preserve untouched legacy treatment text and historical labels; mirror newly selected authoritative names for existing readers. Reuse Priced/Free eligibility, version review and protected-scope guards. Bind Visit save conflict/error/success to submitted Service intent and retain a successful create ID for later draft saves. Current conflicts and protected-scope denials remain authoritative; 126 component scenarios include negative-control evidence. Explicit clinical seal markers are read-only; existing Completed edits remain audited. No migration, billing, stock deduction, package redemption, production deployment or commit. See [release evidence](docs/releases/2026-10-02-services-1bb.md) and [compatibility](docs/architecture/visit-service-compatibility.md).

## Unreleased — Services 1A correctness repairs

Correct category UUID retry identity and order-independent branch-setting retries; add forward migration `004_services_name_identity.sql` for consistent whitespace/case name uniqueness and blank-name checks. Migration 003 remains unchanged. Preserve the P1 delayed-detail scope-generation repair; fix the later P2 old-scope service/category save denial using the same generation plus component/request lifetime and adapter-boundary checks. Current denials still invalidate once; stale success/error/conflict cannot alter new-scope state. Expanded 76-scenario component/module suite passes; saved pre-P2 candidate fails 33 while retaining the original 31 passing scenarios. Isolated foundation `f2d150c` plus Services-only validation passes 426 Services and 597 foundation checks. Earlier readiness reports superseded; ready again for final scoped staging review, not staged or committed. Production unchanged. Historical Support browser evidence only; fresh Google login has `redirect_uri_mismatch`, restricted-role verification pending, no full browser sign-off. Services 1B remains blocked until Services 1A is committed. See [release evidence](docs/releases/2026-10-02-services-1a.md).

## Unreleased — Simpler allergies and medications entry

Follow-up: also remove Medical conditions status. All three fields are simple
textareas with the same historical-state preservation; focused checks now total 48.

- Remove Allergies status and Current medications status selectors from the patient
  form; retain labelled free-text fields and the existing medical-conditions selector.
- Preserve untouched historical states; changed free text is unconfirmed/Unknown,
  never automatically None Known or Present. No schema or server-rule change.
- TypeScript, build and 42 clinical-finding checks pass; browser fields verified.

Local-only. [Evidence](docs/releases/2026-10-02-simple-clinical-text.md).

## Unreleased — Preserve emergency contacts on older edit requests

- Fix a reproduced full-edit overwrite: omitted structured emergency-contact
  fields remain unchanged; explicitly empty values still clear them.
- Add real PostgreSQL/HTTP regression coverage for omission and deliberate clearing.

Local-only; [evidence](docs/releases/2026-10-02-registration-contact-preservation.md).

## Unreleased — Simple age and structured emergency contact

- Simplify registration to Birthday and automatically calculated read-only Age.
- Add emergency contact name, relationship and number with server validation and
  profile display; retain existing free-text contact data.
- Verify real browser registration/age and 29 Node 22 validation commands.

Local-only. [Evidence](docs/releases/2026-10-02-simple-age-emergency-contact.md).

## Unreleased — Explicit clinical findings (Release 3A)

- Add Unknown/None Known/Present states for allergies, medications and conditions;
  validate details consistently in form/server and label legacy text unconfirmed.
- Default new skin type to Not assessed; preserve stored historical information.
- Keep current role/edit permissions; do not imply encoding is clinician review.
- Add 30 helper and 32 PostgreSQL/API checks; verify real browser save/profile.

Local-only. See [scope and gaps](docs/releases/2026-10-02-explicit-clinical-findings.md).

## Unreleased — Registration duplicate warnings and entry protection

- Show advisory same-name/complete-phone/email/name-plus-exact-DOB matches with
  distinct IDs and archive/inactive labels; preserve exact server safeguards.
- Open the existing profile or continue registration without a new blocking rule.
- Confirm before discarding manual entries; retain failed-save values and install
  dirty-form beforeunload protection. Label unavailable lookup refreshes.
- Add 24 matching checks; validate browser warning/open/continue/discard and
  injected save-failure/retry behavior. Remove both synthetic fixtures afterward.

Local-only. See [acceptance and gaps](docs/releases/2026-10-02-patient-registration-warnings.md).

## Unreleased — Patient registration foundation

- Make initial email/residential address optional; validate supplied email.
- Preserve exact, estimated-age/as-of, estimated-year and unknown DOB sources;
  never fabricate a birthday. Label nonexact information in directory/profiles.
- Preserve existing role/branch rules and exact identity hashes; add 26 validator
  checks and 39 real disposable PostgreSQL/HTTP checks.
- Local browser Unknown create and Estimated Birth Year edit pass; additional
  date-input/responsive acceptance remains. Synthetic fixture removed, audits kept.

See [evidence and recovery](docs/releases/2026-10-02-patient-registration-foundation.md).

## Unreleased — Reliable Patient Lookup

- Share name/email/patient-ID/phone matching across directory and existing selectors;
  tolerate whitespace and Philippine mobile formats without rewriting records.
- Distinguish directory request failures from empty results; add retry, retain safe
  cached rows during outages and hide protected data after authorization denial.
- Add 50 matching/component checks and 20 disposable PostgreSQL/HTTP checks.
- Verify browser lookup, profile/appointment selection, failures and recovery;
  remove all nine task fixtures afterward. Preserve shared-patient read policy.

Local-only, ready for scoped commit review; no commit, push or deployment.
See [release evidence](docs/releases/2026-10-02-reliable-patient-lookup.md).

## Unreleased — Release 1 reliable user onboarding

- Explain pending Google registration consistently and show activation requirements
  in existing user rows. Add specific approval errors, retry and saving controls.
- Validate current role/clinic/default assignments and actor permissions within
  lifecycle transactions; repeated approvals create one successful transition/audit.
- Remove sessions atomically on disable/archive and recheck account state during
  Google session issuance to close the overlapping-sign-in race.
- Add disposable onboarding and guidance tests; keep ordinary development data clean.
- Browser acceptance: make disabled accounts discoverable in Inactive users so
  existing reactivation remains reachable. Keep account tabs and role/clinic/action
  controls usable at tablet/mobile widths without changing lifecycle or access rules.
- Verify genuine Support / Developer Google sign-in and synthetic admin approval,
  failure/retry, disable/re-enable and archive/restore. Employee-session browser
  acceptance still requires the separately authorized test Google identity.

Local-only; browser acceptance pending. No invitations, schema changes, commit,
push or deployment. See [release evidence](docs/releases/2026-10-01-reliable-user-onboarding.md)
and [onboarding instructions](docs/user-onboarding.md).
Detailed [browser evidence](docs/releases/2026-10-01-user-onboarding-browser-acceptance.md)
distinguishes tested administrator controls from unverified employee sessions.

## Local development data cleanup — October 1, 2026

- Remove the inspected synthetic patients, appointments, demo branches and five
  testing profiles, including their associated test audit entries and linked
  development identity. Preserve Mark's Support / Developer account, session,
  account history and existing application settings.
- Verify a private recovery snapshot by restoring it into temporary PostgreSQL
  tables before the atomic cleanup. Clear the retained account's deleted demo
  branch references; global access and authorization rules are unchanged.
- Make fixture seeding opt-in in startup instructions so normal restarts preserve
  the clean development baseline. No application code, schema or production change.

## Unreleased — final acceptance attempt

- Prepare the existing genuine development staff profile through the current
  admin UI with only Demo Clinic access; Google passkey verification is pending.
- Validate loading and read/file security source patches independently on the
  committed baseline under Node 22.23.3. Shared cache/support passes with its
  documented prerequisites and appointment-role helper dependency.
- Review candidate sensitive data and remove personal identifiers from security
  acceptance notes. No application code fix was required.

Normal-browser extension connection and genuine staff/admin browser tests remain
blocked. Neither appointment workstream is closed; nothing staged or committed.
See [acceptance record](docs/releases/2026-10-01-final-browser-acceptance.md).

## Unreleased — Phase 1 parity hardening

- Validate the combined local candidate under production-matching Node 22.23.3
  and local Node 24.15.0; both pass. Node 22 is authoritative for release checks.
- Correct missing development media configuration to the verified effective
  production policy without changing production or source defaults.
- Add 32 shared-helper/profile/cache checks and 142 disposable PostgreSQL
  clinical/upload/audit checks; preserve existing non-appointment read rules.
- Document the legacy sign-in logging exemption, unchanged durable mutation
  logging and complete worktree release boundaries.

No commit, push or deployment. Actual restricted-role and native-prompt browser
acceptance remains pending. See [parity report](docs/releases/2026-10-01-parity-hardening.md).

## Unreleased — Phase 1 appointment read security

- Enforce authenticated branch scope for appointment collection and direct reads.
- Apply the same read policy to private appointment-file downloads.
- Keep global administrator/legacy support access and existing write permissions.
- Add disposable PostgreSQL authorization regression coverage.

Local automated validation passed; browser acceptance pending. Separate from
appointment loading; see [security release](docs/releases/2026-10-01-appointment-read-security.md).

## Unreleased — reliable appointment loading

- Wait for required initial data and all appointment branch-query batches.
- Show loading failures and a retry action separately from an empty schedule.
- Retain safe cached results during temporary refresh failures with a warning.
- Ignore callbacks from disposed or superseded appointment subscriptions.
- Report authorization failures even when preceded by a temporary polling error,
  so cached appointment data is hidden when access is denied.
- Preserve booking, editing, archive actions, filters and branch permissions.

Validated locally; not deployed. See
[release checks](docs/releases/2026-10-01-appointment-loading.md).
Remaining browser sign-off needs an external browser connection and a restricted
development login. A separate server branch-read authorization task is recorded
in the roadmap; its existing policy was not changed in this release.
