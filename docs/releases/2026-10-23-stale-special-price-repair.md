# Special Price stale-save repair — local

Date: October 23, 2026. Base HEAD: `469ff1fb6aa5b805eccf9b08097c71d884cecf6b`.
This repairs the P2 found in the independent review of the uncommitted
[Special Price](2026-10-23-appointment-special-price.md) and
[Booking Price Summary](2026-10-23-booking-price-summary.md) implementation.

## Repaired behavior

Previously, one staff member could open an S1 booking, another could replace it
with S2 and its own quote, and the older form could set or clear Special Price for
S2 without reviewing that replacement. In the clear case, the old form displayed
PHP 100 while the server saved PHP 250.

Existing-booking Special Price set/clear commands now include the pricing revision
captured when the draft opened. The server checks that precondition inside the
existing authorized transaction, after current access and original/target branch
checks and before applying price changes. Missing or stale revisions return
`409 SPECIAL_PRICE_CONTEXT_CHANGED`, preserving the saved record and audit state.
The check also applies to equal-value and already-null commands.

`bookingPricingRevision` is server-owned JSONB metadata. Quote/context changes,
explicit Service reselection and patient reassignment advance it monotonically.
Unrelated and no-op changes retain it. Historical absent metadata means revision
zero, without backfilling records. Malformed/unsafe revisions fail closed; clients
cannot write the stored revision. `expectedPricingRevision` is a precondition only
and is never persisted. Existing patient reassignment behavior and quote amounts
remain unchanged; advancing its revision prevents an older pricing command from
being accepted for that reassigned booking.

On conflict, the form keeps its Service intent, typed/cleared Special Price, notes,
patient, clinic, date, doctor and other draft fields. Save remains blocked through
further edits or review failures. **Review latest pricing** uses the existing
authorized appointment-document read and displays the latest saved Service, base
price, saved total and proposed draft total. Reading alone does not accept a new
revision. **Use reviewed pricing and keep my draft** explicitly adopts the latest
pricing context and revision while retaining the draft; saving remains a separate
action. Explicitly selected or removed draft Services remain selected/removed.

Review acknowledgement is unavailable when the saved patient/clinic changed or
the appointment became unavailable through archive, Visit sealing or existing role
restrictions. The draft stays visible. Review requests have identity, protected
scope, abort and branch/patient generation checks, including A–B–A transitions.
Stale responses cannot change the draft, adopt a revision or invalidate a newer
scope. Current permission denials still clear protected data normally.

No POS dependency, new capability, billing/Visit operation or branch grant was
introduced. Frozen Service bases, catalogue version/eligibility checks, Free/unset
semantics, quote attribution and transaction/audit atomicity are retained.

## Changed files for this repair

- `backend/appointmentSpecialPrice.ts`: revision precondition and trusted increments.
- `backend/appointmentBookingQuote.ts`: quote/context revision advancement.
- `backend/clinicalRedaction.ts`: appointment-only scalar revision projection.
- `server.ts`: transactional precondition check.
- `src/utils/appointmentSpecialPrice.ts`: shared revision reader.
- `src/utils/recordApi.ts`: guarded appointment pricing-review read; Visit read unchanged.
- `src/components/AppointmentForm.tsx`: captured pricing context, conflict/review flow.
- `scripts/test-appointment-special-price.ts`: parser/revision checks.
- `scripts/test-appointment-services-api.ts`: stale set/clear and revision regressions.
- `scripts/test-appointment-services-ui.ts`: conflict/draft/review lifetime regressions.
- This release note.

## Validation

- Appointment Services API: **322 checks passed**. Includes two-client set/clear
  after Service replacement and same-Service version change, patient reassignment,
  missing/invalid/tampered revisions, same-value/no-op commands, legacy zero,
  monotonic/ABA/reselection behavior, branch denial, frozen bases and audit rollback.
- Appointment Services component/scope: **219 scenarios passed**: all 163 previous
  plus 56 new scenarios. Includes set/clear draft preservation, explicit review,
  blocked retry, retained draft Service/clinic intent, unchanged pricing context on
  prop refresh, failed/malformed review, protected permission changes and delayed
  review/save responses.
- Negative control against the frozen pre-fix implementation: all 163 previous
  scenarios still passed; 49 new scenarios failed. Seven new source-independent
  expectations also passed. The real checkout was not changed for this control.
- Parser/revision utility: **64 checks passed**. Booking quote utility: **25 passed**.
- Independent reproduction of the original HTTP failure now returns 409 for both
  stale set and stale clear and retains S2's PHP 200 quote. Same-context and
  unrelated-edit controls pass; explicitly reviewed retry succeeds for both paths.
- Permission policy/scope (223/227), protected invalidation (14), appointment read
  authorization (236), Permission API (210), Visit Services API (152), performer
  component/API (63/240), PostgreSQL/session/inventory (54), parity/shared-clinical/
  upload/audit (142), RBAC/audit policies and Support role selector (41): pass.
- TypeScript, production build and whitespace: pass. Existing large build-chunk
  warnings and two incumbent UI detector warnings remain; no new detector findings.
- Read-only independent source review found no remaining blocker in the repair.

Integration tests used guarded disposable loopback synthetic databases and temporary
files. The independent HTTP fixture was corrected to compare against the record
after its unrelated-edit control; that control legitimately updates ordinary edit
metadata. No application behavior or permissions were weakened for the test.

Vine was restarted at `http://localhost:3000`. The app shell and two consecutive
PostgreSQL health requests returned 200, and the served form includes pricing review.
No interactive browser acceptance or production release sign-off is claimed.

## Mandatory schema report

1. **Schema change required: NO.** Existing appointment JSONB supports the revision.
2. **Committed migration chain:** immutable 001–007.
3. **Local applied chain:** observed PostgreSQL 17.11, 001–007, matching checksums;
   inspection was read-only.
4. **Production applied chain:** UNVERIFIED; production was not contacted.
5. **New migrations:** none; no applied migration was edited or run against normal
   local development in this task.
6. **Fresh database:** complete 001–007 initialization passed in disposable tests.
7. **Upgrade path:** no new schema upgrade needed. Existing appointment regression
   upgraded synthetic 002 through 007 and retained legacy JSONB/timestamps.
8. **Existing records:** absent revision means zero; unrelated saves do not backfill
   it or alter historical quotes. An explicit successful quote change starts the
   revision sequence. No patient/account/data migration is required.
9. **Production catch-up:** none added by this repair. Any previous release gap is
   UNVERIFIED and must be assessed in a separately authorized release using the
   same ordered migration chain.
10. **Recovery/rollback:** no schema rollback/deletion needed. Older clients may
    still make unrelated edits but must reload before changing Special Price;
    missing preconditions safely conflict. Reverting to older backend code would
    remove this protection, so quote edits must stop until compatible code returns.
11. **Unexplained divergence:** none found locally; all 334 inspected public schema
    entries match freshly initialized 001–007. Production parity UNVERIFIED.

## Status

Implemented and verified locally; ready for a new independent scoped commit-readiness
review. The previous reviewed patch/manifest remains NOT READY and is superseded by
this repair; it is not approval to stage this changed candidate. Prior pricing work,
unrelated files, local environment configuration, migrations, HEAD and the real Git
index are preserved. No staging, commit, push, deployment or production action.
Disposable test containers and their temporary credentials are removed after checks;
normal local Vine and PostgreSQL remain running.
