# Booking Price Summary — local implementation

Date: October 23, 2026. Base HEAD: `469ff1fb6aa5b805eccf9b08097c71d884cecf6b`.
This extends the uncommitted [Appointment Special Price implementation](2026-10-23-appointment-special-price.md).

## Behavior

Appointment booking, editing and viewing display a Booking Price Summary directly
below Special Price. It lists Service price, Special Price and Booking total (quote).
This calculation has no POS dependency and records neither a charge nor a payment.
The existing single-Service booking, scheduling, provider, clinical and Visit flows
are unchanged.

- Selecting a current eligible Service previews its effective price for the selected
  branch. A branch override takes precedence over the standard price. Free is zero.
- A valid Special Price replaces the Service price, rather than being added to it.
  Clearing it restores the frozen Service price, when known. Special Price also
  works without a canonical Service. Invalid amounts do not display a misleading
  fallback total or Free.
- Without either price, the summary shows **Price not set**. Zero and missing prices
  are different states. Existing Service eligibility and version checks still apply;
  Special Price does not make an unpriced or unavailable Service selectable.
- New bookings save a server-calculated `bookingQuote` JSONB snapshot, including
  currency PHP, branch, Service ID/version, base amount, Special Price, total,
  source and trusted staff/time attribution. Amounts are exact decimal strings.
- Unrelated edits preserve the stored quote exactly. Later catalogue price, name,
  availability or version changes do not rewrite it. Special Price-only edits reuse
  the frozen base, including a historical Free price.
- Explicitly selecting/reviewing a current Service refreshes the quote from that
  Service version. Clinic/Service changes clear Special Price for review and prevent
  the previous context's live price from appearing as the new context's price.
- Historical appointments without a quote are not backfilled from today's catalogue.
  Their existing Special Price remains usable; an unknown historical Service base
  stays unknown until staff deliberately selects/confirms a current Service.

The client sends only the existing Service selection and Special Price commands.
The server rejects client-computed quote totals/snapshots/attribution and calculates
the authoritative quote inside the authorized appointment/audit transaction. A failed
audit rolls back the entire write. Existing create/edit capabilities, original and
target branch checks, clinical restrictions, archive/sealed checks and protected
request lifetimes remain in force. Operational appointment reads expose only the
closed set of scalar quote fields; unknown nested fields and object-based quote
queries cannot bypass clinical redaction. No role grants were added.

## Changed files

- `src/components/AppointmentForm.tsx`: summary, frozen/draft price display and copy.
- `src/utils/appointmentBookingQuote.ts`: quote validation and exact preview logic.
- `backend/appointmentBookingQuote.ts`: authoritative quote resolution and write guard.
- `server.ts`: appointment transaction integration.
- `backend/clinicalRedaction.ts`: closed appointment-only quote projection/query guard.
- `scripts/test-appointment-booking-quote.ts`: 25 preview/snapshot checks.
- `scripts/test-appointment-services-ui.ts`: 37 additional summary scenarios.
- `scripts/test-appointment-services-api.ts`: quote persistence/authorization regressions.
- This release note.

Prior Special Price edits and unrelated working files are preserved. No Visit,
patient, chart, package, Treatment Ledger, inventory, POS, account, OAuth, deployment
or environment sources were changed for this follow-up.

## Validation

| Check | Result |
| --- | --- |
| TypeScript | Pass |
| Production build | Pass; existing large-chunk warnings remain |
| Booking quote preview/snapshot utility | 25 checks |
| Special Price parser | 30 checks |
| Appointment Services UI | 163 scenarios: all 126 previous plus 37 new |
| Appointment Services API | 243 checks |
| Appointment read authorization | 236 checks |
| Permission API | 210 checks |
| Permission policy / scope | 223 / 227 checks |
| Protected invalidation | 14 checks |
| Visit Services API | 152 checks |
| Appointment/Visit performer component / API | 63 / 240 checks |
| PostgreSQL/session/inventory regression | 54 checks |
| Parity/shared-clinical/upload/audit regression | 142 checks |
| RBAC / audit policy | Pass |
| Support role selector | 41 checks |

Integration checks used separate guarded synthetic databases in an isolated local
PostgreSQL 17 container; they did not write to the normal development database.
API negative paths deliberately exercise permission denials and injected audit
failures. During test authoring, fixtures were corrected for JSONB object ordering,
existing Staff clinical-note restrictions and the collection-query request shape;
the final complete API run passes without weakening permissions or test guards.

The UI negative control removes only the summary from a temporary source copy:
all 126 previous scenarios still pass and all 37 new scenarios fail. The real source
is unchanged by that control. The source detector reports only the same two
incumbent gray-on-color warnings; no new findings. Summary rows use the existing
typography, neutral borders, wrapping layout and tabular amounts.

The updated Vine server was restarted on `http://localhost:3000`. The app shell and
two consecutive PostgreSQL-backed health requests returned 200, and the served form
contains the summary. No interactive browser acceptance is claimed; the user is
performing manual browser checks.

## Mandatory schema report

1. **Schema change required: NO.** Appointment JSONB supports the additive quote.
2. **Committed migration chain:** immutable migrations 001–007.
3. **Local applied migration:** observed PostgreSQL 17.11, applied 001–007; every
   applied checksum matches its committed migration. Inspection was read-only.
4. **Production applied migration:** UNVERIFIED; production was not contacted.
5. **New migrations:** none. No applied migration was edited or run against the
   normal development database in this task.
6. **Fresh-database validation:** complete 001–007 initialization passed in disposable
   databases; applied checksums match committed files.
7. **Upgrade-path validation:** N/A for new schema because there is no schema change.
   The appointment regression also upgraded a synthetic 002 baseline through 007,
   retaining the legacy record's JSONB values and timestamps.
8. **Existing-record compatibility:** missing quotes remain readable and are not
   automatically repriced/backfilled. Unrelated edits retain existing quotes and
   historical Service snapshots; decimal zero and unknown remain distinct.
9. **Production catch-up migrations required:** none introduced here. Any pre-existing
   deployment gap is UNVERIFIED and must be assessed during a separately authorized
   release using the same ordered chain.
10. **Recovery/rollback implications:** no schema rollback or data deletion is needed.
    A code rollback retains quote JSONB, but older code cannot maintain these quote
    snapshots; quote-related edits must stop until compatible code is restored.
11. **Unexplained schema divergence:** none found locally. All 334 inspected public
    schema entries match a freshly initialized 001–007 database. Production parity
    remains UNVERIFIED.

## Status

Implemented and validated locally, ready for independent scoped commit-readiness
review. No staging, commit, push, deployment or production action was performed.
HEAD, index, migrations, local configuration and unrelated files remain preserved.
The disposable test container and its temporary credential file are removed after
validation; normal local Vine and PostgreSQL remain running.
