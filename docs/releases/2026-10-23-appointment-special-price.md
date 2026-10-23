# Appointment Special Price — local implementation

Date: October 23, 2026. Base HEAD: `469ff1fb6aa5b805eccf9b08097c71d884cecf6b`.

## Behavior and scope

Appointment booking and editing now have an optional **Special Price:** input
directly below the existing Service selector. This is a booking quote to confirm
later in POS. It neither changes catalogue prices nor records a payment or charge.
It also works for appointments without a canonical Service.

- Blank means no special quote; `0` explicitly means Free. Amounts are normalized
  to decimal strings with two decimal places. Negative, malformed, over-precision
  and out-of-range values are rejected by both client and server. The maximum is
  PHP 9,999,999,999.99, matching the existing catalogue amount range.
- Existing quotes are loaded when editing. Unrelated edits omit the quote command
  so they preserve the current stored quote and its attribution. Clearing a quote
  explicitly sends null. Old appointments without quote fields need no backfill.
- Changing the clinic, selected Service or selected catalogue version clears the
  entered quote with a visible notice. Staff can enter it again for that context.
  The server requires explicit quote review when changing that context on an
  appointment that already has a quote; frontend filtering is not authoritative.
- Server-controlled fields are `specialPrice`, `specialPriceUpdatedAt`,
  `specialPriceUpdatedByUid` and `specialPriceUpdatedByName`. Client attribution is
  rejected. Quote changes and their audit event use the existing transaction.
- Existing appointment create/edit capabilities, branch checks, archive/sealed
  restrictions and stale-request scope protections remain authoritative. Operational
  appointment projections include the quote for users without clinical access;
  this grants no additional record or branch access.
- The Service and Special Price controls are disabled while saving. Validation and
  denied/stale responses preserve the existing draft and scope behavior.

No Visit, billing, package, inventory, role, account, environment, OAuth or production
changes are included. Existing Service selection, scheduling and layout are retained.

## Files

- `src/components/AppointmentForm.tsx`: field, draft handling and contextual clearing.
- `src/utils/appointmentSpecialPrice.ts`: shared exact-decimal validation.
- `backend/appointmentSpecialPrice.ts`: server quote command, review and attribution.
- `server.ts`: appointment create/update transaction integration and error mapping.
- `backend/clinicalRedaction.ts`: appointment-only operational quote projection.
- `scripts/test-appointment-special-price.ts`: decimal validation regressions.
- `scripts/test-appointment-services-api.ts`: quote, audit, compatibility and access checks.
- `scripts/test-appointment-services-ui.ts`: UI, pending-save and stale-response checks.
- This release note.

## Validation

Passed locally with Node 22 and guarded, disposable synthetic PostgreSQL databases:

| Check | Result |
| --- | --- |
| TypeScript (`npm run lint`) | Pass |
| Production build | Pass; existing large-chunk warnings remain |
| Special Price parser | 30 checks |
| Appointment Services UI | 126 checks, including 34 new scenarios |
| Appointment Services API | 162 checks |
| Permission policy / scope | 223 / 227 checks |
| Protected invalidation | 14 checks |
| Appointment/Visit performer component / API | 63 / 240 checks |
| Appointment read authorization | 236 checks |
| Permission API | 210 checks |
| Visit Services API | 152 checks |
| PostgreSQL/session/inventory regression | 54 checks |
| Parity/shared-clinical/upload/audit regression | 142 checks |
| RBAC / audit policy | Pass |
| Support role selector | 41 checks |

The UI negative control on unchanged HEAD retained all 92 previous passing checks
and failed 33 of the new scenarios, demonstrating that the added assertions detect
the missing implementation. The remaining new scenario is source-independent.

One performer API invocation initially used the wrong disposable database name;
the existing test guard rejected it before writes. It was rerun with the required
`vine_performers_test` database and all 240 checks passed. No guards were weakened.
Deliberately injected authorization/audit failures in API tests are expected and
verify rejection/transaction rollback.

The UI detector reports the same two pre-existing contrast warnings as the HEAD
version; this change adds neither. No unrelated styling changes were made.

Vine was restarted on `http://localhost:3000` with the updated backend. The app shell
and two consecutive database-backed `/api/health` requests returned 200. The served
AppointmentForm module includes the Special Price label. No browser acceptance or
interactive booking result is claimed; manual browser checking remains with the user.

## Mandatory schema report

1. **Schema change required: NO.** Existing appointment JSONB is sufficient.
2. **Committed migration chain:** immutable migrations 001–007.
3. **Local applied migration:** observed PostgreSQL 17.11, migrations 001–007; all
   applied checksums match committed files. The inspection used a read-only transaction.
4. **Production applied migration:** UNVERIFIED for this task; production was not contacted.
5. **New migrations:** none. No applied migration was modified.
6. **Fresh-database validation:** complete 001–007 chain passed in disposable test
   databases. Applied checksums match committed files.
7. **Upgrade-path validation:** no new schema upgrade is required for this field.
   The existing appointment suite upgraded a synthetic 002 baseline through the
   current 007 chain and retained the historical JSONB record and timestamps.
8. **Existing-record compatibility:** absent quote fields remain valid; unrelated
   edits preserve existing quote values and attribution, historical Service
   snapshots and notes. No backfill or account/data migration is needed.
9. **Production catch-up migrations required:** none introduced by Special Price.
   Any pre-existing deployment gap is UNVERIFIED and must be assessed separately
   before an authorized deployment against the same ordered migration chain.
10. **Recovery/rollback:** no schema rollback is needed. Reverting the application
    change leaves any already-recorded quote JSONB fields intact. Older application
    versions do not enforce the new quote-context review, so quote editing would
    need to stop during an application rollback. No data deletion is required.
11. **Unexplained schema divergence:** none found locally. All 334 inspected public
    schema entries (columns, constraints, indexes, functions, triggers and enums)
    match a freshly initialized 001–007 test database. Production parity remains
    UNVERIFIED.

## Delivery status

Implementation and automated checks are complete locally; ready for independent
scoped commit-readiness review and the user's manual check. HEAD and index remain
unchanged. No staging, commit, push, deployment or production migration was performed.
Unrelated working files, ignored local environment files and migration files are
preserved. The disposable test container is removed after validation; the normal
local development PostgreSQL instance remains running.
