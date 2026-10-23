# Visit retry fingerprint upgrade repair — October 23, 2026

Local repair only. No staging, commit, push, deployment or production access.
The other pending appointment/Visit pricing, Service sync, patient prefill and
Booking Price Summary changes are preserved.

## Defect and repair

The pending Visit pricing implementation unconditionally added `visitQuote` to
the saved-record retry fingerprint. A retained Visit created by committed HEAD
`469ff1fb6aa5b805eccf9b08097c71d884cecf6b` has no such property. Hashing an extra
`visitQuote: null` incorrectly rejected an identical creation retry with
`409 CREATE_RETRY_CHANGED`.

`visitCreatedRecordIntent` now includes `visitQuote` only when the saved record
owns that property. The old fingerprint remains valid without rewriting old
records. New quote-bearing records keep their existing fingerprint. Introducing
an explicit null or object quote on a historical record, removing/nulling/changing
a new quote, or changing clinical content still rejects the old retry. There is
no fallback accepting multiple fingerprints, backfill, repricing, permission change
or history rewrite.

## Validation

Both the Visit API and real package-session usage upgrade cases failed with the
expected false 409 before the repair, then passed after it. The regression helper
freezes the literal pre-quote field list and canonical SHA-256 algorithm from
HEAD; it does not import the current fingerprint implementation.

- Visit API: **302 checks passed**. Retained linked and Walk-In retries return
  the same ID/version with byte-identical records, counters, timestamps and audit
  history. No historical quote is added. Current branch loss, inactive account
  and Visit-create denial remain 403. Clinical/quote changes remain conflicts.
- Treatment Ledger API: **234 checks passed**. A retained Visit with an actual
  consumed session retries without changing purchases, balances, usage bindings
  or immutable session events. Existing quote set/clear and usage tests pass.
- Visit save conflicts: 67; performer API: 240; permission API: 210;
  parity/shared clinical/upload/audit regressions: 142 — all passed.
- Visit UI: 318; appointment UI: 222; performer UI: 63; Ledger UI: 46;
  Ledger policy: 136; permission policy: 223; permission scope: 227;
  protected invalidation: 14; Support role selector: 41; booking quote utility:
  25; Special Price utility: 64 — all passed. RBAC and audit suites also passed.
- **19 regression suites, TypeScript, production build and whitespace checks
  passed.** Build retains the existing large-chunk warning.
- Independent read-only review of this repair found no actionable issue.
- Vine restarted on `http://localhost:3000`; health and app shell return 200.
  No new browser acceptance evidence is claimed.

Integration tests used only guarded, disposable loopback databases with synthetic
records. The temporary test container was removed after validation.
Evidence is retained outside Git in
`/private/tmp/vine-retry-fingerprint-fix-194xgyw2/`.

## Required schema report

1. **Schema change required: NO.** The defect is in fingerprint construction.
2. **Committed migration chain:** immutable 001–007, unchanged.
3. **Local applied migrations:** 001–007 observed on PostgreSQL 17.11 using a
   read-only transaction. All applied checksums match the migration files.
4. **Production applied migrations:** UNVERIFIED; production was not contacted.
5. **New migrations:** none. No migration ran against normal development.
6. **Fresh-database validation:** the complete chain applied repeat-safely in
   disposable databases during the API suites. Fresh/local schema snapshots match
   across 334 columns, constraints, indexes, functions, triggers and enum entries.
7. **Upgrade-path validation:** retained pre-quote Walk-In, linked and real
   session-usage records use the frozen HEAD fingerprint and unchanged request
   intent. Retries pass without record or balance changes. No new SQL migration
   upgrade is applicable to this repair.
8. **Existing-record compatibility:** no quote backfill, history rewrite,
   counter/version changes or duplicate session deduction on retry.
9. **Production catch-up migrations:** none introduced by this repair. Any
   existing production gap remains UNVERIFIED and requires separate inspection
   and authorization before deployment.
10. **Recovery/rollback:** this repair changes no stored data or schema; reverting
    this repair restores the false-conflict defect for pre-quote retries.
11. **Unexplained schema divergence:** none found locally against the fresh
    complete chain. Production parity remains UNVERIFIED.

The repaired combined pricing work remains uncommitted and requires its next
scoped commit-readiness review before staging is requested.
