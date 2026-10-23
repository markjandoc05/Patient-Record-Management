# Appointment-to-Visit Service sync and Visit pricing — local

Date: October 23, 2026. Base HEAD: `469ff1fb6aa5b805eccf9b08097c71d884cecf6b`.
Extends the uncommitted appointment Special Price, Booking Price Summary and
stale-price repair. No staging, commit, push, deployment or production action.

## Behavior

New linked Visits load the latest authorized appointment before showing the
draft. A booking without a canonical Service starts with No Service; it never
falls back to the first catalogue option or an earlier captured booking object.
A booked Service is proposed and verified against the current catalogue. New
selections still require an active, available, priced or explicitly Free Service.
Historical Visit snapshots remain readable without automatic catalogue rewrites.
Staff may deliberately choose a different performed Service or remove it.

Linked creation sends `expectedBookingContext` containing the opened booking
pricing revision, Service ID and catalogue version. Inside the authorized
transaction, the server checks the latest booking before creating a Visit or
using package sessions. Missing/stale context returns 409. The draft remains
open with its notes, price and manual Service intent. **Review latest booking**
reads the latest record; **Use reviewed booking** explicitly acknowledges it.
Untouched inherited Service proposals follow that reviewed booking, including
removal. Deliberate performed-Service choices and typed/cleared prices remain.
Changed patient, clinic, assignment, schedule, archive or existing-Visit binding
requires reopening; acknowledgement cannot bypass those existing rules.

Each Visit has an optional **Special Price:** input and **Visit Price Summary**:
Service price, Special Price and Visit total (quote). Blank uses the known Service
base; zero means Free; absent prices remain Price not set. Amounts are normalized
decimal strings using the existing booking-price parser. No POS, invoice or
payment endpoint is required.

The server owns `visitQuote` JSONB: PHP amounts, Service/branch/version context,
total/source, author/time and nullable booking ID/revision provenance. A new linked
Visit with matching performed context inherits the saved booking base and Special
Price, including a no-Service booking with Special Price. A different performed
Service uses its current eligible base and does not inherit an unrelated Special
Price. Changing Service/version/clinic clears the inherited price for review.
Existing Visit quotes freeze their base on unrelated edits and explicit price
set/clear. Clearing returns to that frozen base, never today's catalogue price.
Old Visits without a quote remain unpriced on unrelated edits.

`specialPrice` is a write command only; it is stored inside the server quote.
Client-written quote amounts/attribution are rejected. Existing Visit-version
checks protect price set/clear, notes and all other changes together. Conflicts
retain the draft until an explicit saved-Visit review/reload. Archived, signed or
finalized Visits remain read-only. Appointment quotes and history are preserved.

Active package usage continues locking its existing binding fields. Special Price
can be edited separately; it neither consumes nor reverses sessions. Transaction
and audit failures roll back together. Creation retry fingerprints include the
quote, preserving the existing uncertain-save/session-command protections.

No capability or branch grant was added. Existing appointment and Visit write
permissions, performer rules and original/target branch checks remain. Shared
clinical history remains readable under its existing policy, while Visit quotes
and quote-derived retry hashes are hidden outside an authorized operating branch.
Constrained queries cannot infer those hidden values. Existing closed operational
projections expose only the allowlisted quote fields. Identity/scope/generation
and abort guards suppress obsolete reads, denials and saves.

## Files

- `backend/visitPricing.ts`: transactional freshness, price commands and quotes.
- `server.ts`: Visit creation/update integration, audit and retry fingerprints.
- `backend/clinicalRedaction.ts`: safe quote projection and branch price boundary.
- `src/utils/visitPricingPolicy.ts`: booking fingerprint and quote-preview helpers.
- `src/components/VisitForm.tsx`: fresh booking boundary, explicit review,
  Special Price, price summary and draft/conflict protection.
- `src/components/AppointmentServicePicker.tsx`: separate automatic booked
  verification callback, retaining manual Service intent tracking.
- Visit API/UI, performer UI/API, ledger API/UI and sequential parity/PostgreSQL/
  Support fixtures: regression coverage and fresh-booking/version preconditions.
- This release note. Earlier uncommitted appointment pricing files are preserved.

## Validation

- Visit Services API: **265 passed**. Visit component/scope: **318/318** (233
  original plus 85 new scenarios). Negative control before UI implementation kept
  all 233 original scenarios and failed all 83 then-added new scenarios.
- Appointment Services API/component: **322/219** passed. Read authorization:
  **236**. Performer API/component: **240/63** passed.
- Treatment Ledger API/component: **229/46** passed. Active-usage price set/clear
  retains byte-identical purchases, lines, events and usages. Ledger policy:
  **136/136** passed.
- Visit save-conflict API: **67** passed. Clinical chart API/policy/transport:
  **273/33/18** passed.
- Permission API/policy/scope: **210/223/227** passed. Protected invalidation:
  **14** passed. PostgreSQL/session/inventory: **54** passed. Shared clinical,
  uploads, parity and audit regression: **142** passed. RBAC, audit policy,
  Support role selector and price parser/quote utility checks pass.
- TypeScript, production build and whitespace checks pass. Existing build chunk
  warnings and three incumbent Visit UI detector findings remain; no new detector
  findings. Independent source review and independent 318-scenario component run
  found no remaining blocker after corrections.
- The broader in-memory Support suite reaches an existing Inventory transfer mock
  mismatch after its linked Visit lifecycle passes. The same Inventory assertion
  fails against reconstructed HEAD with equivalent prerequisite fixture shims.
  Assertions and unexpected-SQL guards remain intact; Inventory behavior was not
  changed to accommodate that older mock. This suite is not reported as passing.

Integration checks used guarded disposable loopback PostgreSQL databases,
synthetic identities/records and temporary files. Local Vine was restarted on
port 3000; PostgreSQL health and app shell both return 200. No browser acceptance
or visual/print sign-off is claimed by these controlled component checks.

## Database architecture report

1. **Schema change required: NO.** Existing Visit JSONB stores the additive quote;
   the booking fingerprint and Special Price are commands, not new SQL columns.
2. **Committed migration chain:** 001–007; unchanged.
3. **Local applied:** observed PostgreSQL 17.11, 001–007. All checksums match the
   committed files. Read-only structure comparison matches a freshly migrated
   disposable database (334 schema entries).
4. **Production applied:** UNVERIFIED for this task; production was not contacted.
5. **New migrations:** none; no migration was applied to normal local development.
6. **Fresh database:** complete immutable 001–007 initialization passes in the
   disposable API databases; migration idempotency checks pass.
7. **Upgrade path:** SQL upgrade N/A because the chain is unchanged. Retained
   legacy Visits/bookings without quote/revision fields pass the API regressions.
8. **Existing records:** unchanged quotes/text/snapshots survive unrelated saves;
   no historical price backfill, account migration or production data copying.
9. **Production catch-up:** no additional migration for this feature. A separately
   authorized release must inspect production and apply any missing existing
   committed 001–007 migrations in order before compatible deployment.
10. **Recovery:** no DDL rollback. Older code ignores additive quote JSONB;
    preserve it. Older clients missing the new linked-creation precondition receive
    a safe 409 and must refresh. No automatic data reversal or repricing.
11. **Unexplained divergence:** none found between local and fresh committed
    structure/checksums. Production parity remains UNVERIFIED.

Detailed private evidence: `/private/tmp/vine-visit-price-sync-fmobb5bb`.
Ready for final scoped commit-readiness review; not staged or committed.
