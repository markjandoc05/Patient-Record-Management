# Vine incremental production roadmap


Hybrid access foundation repair: audit query inference blocked before predicates; all access-policy writes use the revisioned API; unchanged legacy clinical whitespace preserves stored text. Three defect regressions and prerequisite-only reconstruction are part of the new review evidence. No commit/deployment or Clinical R1 start.
## Hybrid access-control foundation — October 3 local

Implement the approved role defaults + JSONB explicit overrides + independent scope model on committed Services 1A/1B-A/1B-B baseline `7407cc1`. Operational user management cannot delegate security authority. Clinical denial retains authorized operational records through server projections; Staff/Manager clinical viewing remains initially allowed for compatibility. No SQL migration, production catch-up or Clinical R1 workflow implementation. Next: independent scoped review of this foundation, then approved commit; Clinical R1 may use the tested hooks after that gate, with finalizer/prescriber/resource policy still decided in its own specification. Live Module Access browser acceptance remains pending because desktop runtime 26.930.21537 is missing. See [architecture](docs/architecture/hybrid-access-control.md) and [release evidence](docs/releases/2026-10-03-hybrid-access-control.md). Earlier roadmap statements are historical; Services 1A/1B-A/1B-B are committed in the current baseline.


## Services 1B-B — Visit / Performed Service Integration, October 2 local

Implemented locally on committed Services 1A/1B-A. Appointment booked and Visit performed snapshots are separate facts. Reuse the scoped selector and server-authoritative eligibility/version checks; preserve legacy text/history, current clinical permissions and booking/link behavior. Explicit intent, review and async guards protect history and current scope. No SQL migration, billing, stock deduction, package redemption or production changes. Validation/review status is recorded in [Services 1B-B release evidence](docs/releases/2026-10-02-services-1bb.md). The remaining stale-save P2 is repaired with submitted-intent revisions and safe create identity retention; 126 component scenarios and negative controls cover old conflict/error/success. No staging or commit yet; independent scoped review of the corrected candidate is next. Clinical Records remains blocked until Services 1B-B is reviewed and committed. Older roadmap entries below are historical and do not override this current committed baseline.

## Services 1A — corrected catalogue and branch pricing, October 2 local

Correct category UUID retry identity and order-independent branch-setting retries; add forward migration `004_services_name_identity.sql` for consistent whitespace/case name uniqueness and blank-name checks. Migration 003 remains unchanged. Preserve the P1 delayed-detail scope-generation repair; fix the later P2 old-scope service/category save denial using the same generation plus component/request lifetime and adapter-boundary checks. Current denials still invalidate once; stale success/error/conflict cannot alter new-scope state. Expanded 76-scenario component/module suite passes; saved pre-P2 candidate fails 33 while retaining the original 31 passing scenarios. Isolated foundation `f2d150c` plus Services-only validation passes 426 Services and 597 foundation checks. Earlier readiness reports superseded; ready again for final scoped staging review, not staged or committed. Production unchanged. Historical Support browser evidence only; fresh Google login has `redirect_uri_mismatch`, restricted-role verification pending, no full browser sign-off. Services 1B remains blocked until Services 1A is committed. See [release evidence](docs/releases/2026-10-02-services-1a.md).

## User-directed clinical field simplification — October 2 local

Follow-up user instruction includes Medical conditions: all three clinical status
selectors are removed; retain labelled textareas and unconfirmed edit handling.

Remove allergies/medications status selectors; keep simple text fields and preserve
existing clinical data without inferring negative findings. Medical conditions is
unchanged. See [evidence](docs/releases/2026-10-02-simple-clinical-text.md).

## Registration server compatibility — October 2 local

Confirmed and fixed older full-edit requests clearing omitted structured emergency
contact fields. Explicit clearing remains supported. See
[compatibility evidence](docs/releases/2026-10-02-registration-contact-preservation.md).
No additional UI/business rules or production deployment.

## User-directed simple registration — October 2

Birthday plus automatically calculated read-only Age replaces the multi-mode DOB
registration controls. Add emergency-contact name, relationship and number while
preserving legacy text. All 29 Node 22 commands and targeted real browser create/
profile/age checks pass. Local-only; see [evidence](docs/releases/2026-10-02-simple-age-emergency-contact.md).
This user instruction supersedes the earlier registration UI plan; no extra features.

Additional [registration acceptance](docs/releases/2026-10-02-simple-registration-acceptance.md)
passes responsive geometry, mobile create/retry/edit/profile and Escape protection.
Native reload confirmation remains unverified. No code changes, commit or deployment.

## Clinical findings — Release 3A local

Explicit Unknown/None Known/Present fields, legacy unconfirmed labels and new
unassessed skin type implemented. All 27 Node 22 commands pass; browser validation,
save and profile checks pass. No clinician-review/treatment gate or deployment.
See [3A evidence](docs/releases/2026-10-02-explicit-clinical-findings.md).
Next: source attribution/versioned review/service-policy audit; prior registration
date/native-confirmation/responsive acceptance remains open.

## Registration duplicate warnings/form protection — Release 2 local

Advisory existing-patient reasons, explicit open/continue actions and unsaved-entry
protection implemented locally. Twenty-five Node 22 commands pass; browser warning,
keep/discard, correct profile, nonblocking request and failure/retry checks pass.
Remaining browser/date/responsive gates are recorded separately; no deployment.
See [Release 2 evidence](docs/releases/2026-10-02-patient-registration-warnings.md).
Next: finish registration acceptance, then audit Release 3 clinical intake/review.

## Patient registration foundation — October 2 local

Optional email/address and four DOB source modes implemented locally with shared
server/form validation and labelled profile/directory values. Node 22 validation
passes; browser Unknown create and Estimated Birth Year edit pass. Manual exact/age
date and responsive acceptance remain. No schema migration/commit/deployment.
See [registration evidence](docs/releases/2026-10-02-patient-registration-foundation.md).
Then deliver duplicate warnings/form protection and clinical states/review separately.

## Reliable Patient Lookup — October 2 local candidate

Shared directory/appointment/visit search matching and directory error/retry handling
pass targeted browser acceptance, 50 lookup checks, 20 disposable patient API checks
and existing Node 22 regression suites. Synthetic patients were cleaned up; no schema,
registration-policy or production changes. Ready for scoped commit review, not deployed.
See [lookup evidence](docs/releases/2026-10-02-reliable-patient-lookup.md).
Next: agree a lightweight registration duplicate warning; do not automatically merge
or block on shared contacts. Earlier workstreams retain their own acceptance gates.

Vine is live and used operationally. Improve existing workflows through small,
independently useful releases. Preserve records and established behavior.

## Next work

- Current authorized improvement: Release 1 reliable user onboarding. Preserve
  Google-first registration/approval; improve guidance/readiness/retry and validate
  current lifecycle state transactionally. See [release evidence](docs/releases/2026-10-01-reliable-user-onboarding.md).
  Implemented locally: 82 focused PostgreSQL/HTTP checks and 48 guidance/component
  checks pass, along with existing regressions, TypeScript and build on Node 22.23.3.
  Browser connection recovered in a fresh tab. Genuine Support / Developer Google
  sign-in and synthetic administrator workflow checks pass. Browser acceptance found
  and fixed hidden disabled accounts and crowded tablet account controls. Employee
  Google/session acceptance still needs the separately authorized test identity;
  the release is not closed. See [browser evidence](docs/releases/2026-10-01-user-onboarding-browser-acceptance.md).
- After onboarding browser acceptance, prepare the separate invitation proposal.
  No invitation implementation is included in Release 1.
- Confirm the most useful operational improvement; audit before adding code.
- Candidate: complete a narrowly scoped service/branch-pricing gap.
- In parallel: verify backup recovery, complete file backups and establish staging.
- Separate Phase 1 task: reconcile shared clinical continuity reads with restricted
  appointment branch reads, then enforce the agreed read scope on the server.
  Acceptance probing confirmed unfiltered/direct staff requests currently return
  appointments from unassigned branches. A separate local security fix now enforces
  assigned-branch appointment reads and file access; automated tests pass, browser
  acceptance pending. See [security release](docs/releases/2026-10-01-appointment-read-security.md).
- Keep development isolated; use synthetic data and targeted regression checks.

## Release loop

Problem → inspect existing behavior → small local change → targeted checks →
GitHub milestone → proportionate staging/acceptance → deploy → production smoke
check → brief release note and recovery instructions.

Schema, authentication, clinical, financial and stock changes require stronger
validation than cosmetic fixes. Destructive data changes require verified recovery.
Normalize database structures only when the affected workflow needs it.

## Capability map

Core operations; clinical documentation; packages and treatment stock; billing and
operational finance; reporting and automation. These are workstreams, not a
mandatory sequence. Prioritize clinic impact and actual dependencies.

Detailed scope and reviewer brief:
[Development plan](docs/planning/Vine-System-Development-Plan.txt).

## Status

Infrastructure migration and separate development environment are established.
Recovery testing, recurring file backups and full workflow acceptance remain
outstanding. No feature deployment is implied by this roadmap update.

## Current small release

Reliable appointment loading: implemented locally; focused tests, TypeScript,
production build and synthetic PostgreSQL checks pass. Initial loading/empty-state
browser checks passed for loading, booking, editing, filters, branch races and
failure/recovery. Browser acceptance found and fixed suppressed authorization
errors after a transient failure. Archive acceptance remains blocked by the
embedded browser's unsupported native prompt; restricted-staff browser coverage
remains pending. Normal-browser connection is unavailable (extension missing),
and the prepared restricted development account still needs interactive Google
sign-in before it can supply browser evidence. Repeated automated checks
pass; restricted-staff server write probes pass. The separate security candidate
addresses the prior branch-read failure locally; loading browser acceptance remains
incomplete. No commit or deployment.
See [release record](docs/releases/2026-10-01-appointment-loading.md).

## Parity hardening status

The combined candidate passes Node 22.23.3 and Node 24.15.0 validation, including
shared clinical/cache, appointment/file authorization and existing-role regressions.
Node 22 is the release runtime. Missing development media settings were corrected
to the verified effective production policy; production and schema were unchanged.
Separate support sign-in logging alias consistency remains a policy decision.
See [parity evidence and all-file grouping](docs/releases/2026-10-01-parity-hardening.md).

Next acceptance gates: genuine restricted staff/admin browser checks, archive and
restore in a browser supporting native prompts, then explicit review of mixed
cache/support/security hunks and Node 22 validation of each clean patch. Neither
appointment workstream is marked complete or deployed by this validation pass.

Final acceptance attempt: the existing development staff profile is now active
and assigned only Demo Clinic through the existing UI. Google passkey verification,
administrator sign-in and the normal-browser extension connection remain pending.
Standalone loading and security source patches pass Node 22; shared cache/support
also passes with its declared A+B/helper dependencies. Workstreams remain open.
See [final acceptance record](docs/releases/2026-10-01-final-browser-acceptance.md).

Updated user preference: interactive development/acceptance now uses only the
existing Support / Developer account unless the user requests another identity.
Continue synthetic automated ordinary-role checks; real staff/admin browser
coverage remains unverified and is deferred under this preference. Support-account
workflow and native-prompt archive/restore acceptance still need completion; do not
close either workstream by relabeling Support access as another role's evidence.

The referenced prepared demo/staff fixtures above are historical acceptance evidence.
They were subsequently removed in the user-requested development cleanup. Do not
reseed the clean development database for onboarding tests; use disposable fixtures.
