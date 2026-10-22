# Inventory R1 — simple stock tracking

User-approved local scope, October 22, 2026. Extend the existing Stocks & Levels,
Suppliers and Stock Transfers tabs with receiving, manual usage, remaining branch
balances, low-stock status, per-item history and attributed Admin corrections.
No batch/expiry, quarantine, purchasing, valuation, accounting, automatic Visit or
Service deductions, package-session deductions, barcode work or unit conversion.

## Workflow and authority

- One fixed stock unit per item. New quantities have at most three decimal places.
- Receiving and usage use `inventory.manage`, with independent branch scope.
- Corrections additionally require existing administrative access, a reason and
  the expected stock version. Enter a signed change; do not overwrite history.
- Transfers retain `inventory.transfer` and access to both branches. Pending
  transfers do not reserve stock; completion rechecks availability and posts both
  sides atomically. Repeating completion cannot deduct twice.
- Transfer movement time is the completion time. The simple creation form does
  not ask for a pre-completion movement date. Restricted users may read their
  own branch's stock fact, but foreign transfer identifiers and free text are
  redacted unless both endpoints are authorized. Named source → destination routes
  appear in transfer history; new transfers keep server-authored name snapshots
  and older transfers fall back to authorized branch-directory names.
- Viewing requires `inventory.view`. No role default or branch grant is added.
- The server derives recorded time and actor. Treatment time is a separately
  validated supplied fact. Staff notes/reference do not authorize a stock change.
- Idempotent commands protect uncertain-response retries. Changed command content
  cannot reuse a successful identifier. Concurrent writes cannot overspend.

## Compatibility and schema

The starting committed chain is 001–006. A new additive migration 007 introduces
stock-account/movement integrity; existing applied migrations remain immutable.
Items, suppliers, JSONB stock records and historical transfers keep their IDs and
contents. On first mutation, valid existing stock becomes an opening fact with
provenance, not a fabricated historical delivery. Duplicate, malformed or ambiguous
legacy stock must be flagged for review rather than merged or silently zeroed.

All current stock writers, including transfer completion, use the same posting
path. JSONB compatibility balances remain synchronized atomically. Once an account
is adopted, an older inventory writer must not overwrite its ledger-backed stock.
Do not run old and new inventory writers together. Recovery requires retaining
movement/account records and compatible code; do not drop the new schema or edit
applied migration files to roll back. A future production release needs its own
inspection, backup, ordered migration and code/recovery review.

## Verification

Use guarded disposable PostgreSQL databases with synthetic records. Validate the
fresh complete chain and retained-record 006→007 upgrade, unchanged historical
checksums and schema equivalence. Test receiving/usage/corrections, stock precision,
concurrent overspending, retries, transfer completion, malformed old stock,
permission denials, both-branch restrictions, read projections and CSRF/origin.
Component/transport tests must cover delayed old-scope responses, permission loss,
draft retention on errors, explicit retry and double-submission. Run TypeScript,
production build and the relevant existing permission/workflow regressions.

Normal local development remains loopback PostgreSQL 17 and Vine on port 3000.
No production connection, fixture copy, staging, commit, push or deployment is
authorized by this implementation.
