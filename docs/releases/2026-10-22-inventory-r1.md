# Simple Inventory R1 — local implementation

Baseline: `1503ff8af756669758621f6ea10233a3aa11ea33`, October 22, 2026.
Local only. No staging, commit, push, deployment, production or DARF access.

## Delivered behavior

The existing Stocks & Levels, Suppliers and Stock Transfers tabs remain. The
selected clinic is the default inventory branch. Add items/suppliers, receive
stock, record manual usage, inspect per-item movement history, and create/complete
transfers. Administrators/guarded Support can append signed corrections with a
reason and expected balance version. Current stock, low-stock warnings and
attributed history replace direct balance editing.

Use one unit per item and quantities with up to three decimal places. Dates for
receipts/usage/corrections use Vine's active clinic timezone; transfer stock moves
at completion time. Actual occurrence and server recording time are separate.
Service/Visit/package workflows do not deduct inventory. No batch/expiry,
quarantine, purchasing, valuation, accounting or unit conversion is introduced.

All stock writes use one transactional posting path. Existing stock IDs and
extra JSONB fields remain; valid historical stock is adopted on first write with
an explicit opening fact and provenance. The original receipt date stays unknown.
Invalid/duplicate balances remain readable as needing review and refuse mutation.
Commands bind content and actor; uncertain retries cannot duplicate stock actions.
Transfers recheck availability at completion and update both branches atomically.
Pending transfers retain their existing no-reservation behavior.

Current `inventory.view`, `inventory.manage` and `inventory.transfer` defaults and
overrides remain; no new role or grant. The management label now describes
receiving and usage. Corrections additionally require administrative access.
Overview/history use current server authorization and independent branch checks.
Transfer lists and item history show named source → destination routes. New
transfers freeze server-authoritative branch-name snapshots; legacy transfers use
current authorized names without read-time backfill. Transfer details require
both branches. A restricted branch's movement projection
omits foreign branch names, transfer ID, notes and reference, while retaining its
own stock fact.
The client shares Services' scope generation, CSRF and stale-denial protection.
Branch/access/account changes end old editors and requests. Current denials clear
protected contents and require explicit retry; old-scope denials cannot clear
new-scope data. Uncertain results retain the draft and its command for exact retry.

## Validation

Initial regression checks used Node 24.15.0 on this Mac. Final Inventory API,
migration, policy, transport, component, TypeScript and build checks also pass on
Node 22.23.3, matching the production runtime major. Integration databases use
isolated PostgreSQL 17.11 in a dedicated local Docker container.

| Check | Result |
| --- | --- |
| Inventory HTTP/auth/transaction suite | 187 passed |
| Inventory migration fresh/upgrade/checksum suite | 33 passed |
| Inventory policy validation | 38 passed |
| Inventory transport races | 21 passed |
| Actual Inventory component controlled scenarios | 51 passed |
| Existing PostgreSQL/session/authorization/inventory | 54 passed |
| Existing parity/clinical/upload/audit | 142 passed |
| Existing permission-management HTTP suite | 210 passed |
| Package Catalogue HTTP suite | 114 passed |
| Treatment Ledger HTTP suite | 225 passed |
| Clinical chart HTTP suite | 273 passed |
| Services / Package / Ledger / Visit UI suites | 76 / 82 / 44 / 233 passed |
| Permission policy / repair / scope | 223 / 37 / 227 passed |
| Protected invalidation / Support role selector | 14 / 41 passed |
| RBAC, audit, Services, package and Ledger policy suites | Passed |
| TypeScript, production build, whitespace | Passed |
| Impeccable mechanical detector | No findings |

Regression coverage includes exact retry identity, concurrent overspending,
competing pending transfers, stale correction versions, paired rollback, numeric
precision, strict calendar dates, current/old permission denials, branch/account
races, legacy malformed stock, SQL history/mirror guards and preserved records.
Independent backend and UI reviews found and resolved a misleading transfer-date
input, an unrenderable transfer creation timestamp and differing UI quantity
precision. Focused tests cover each resulting behavior.

The guarded shared test reset helper includes the new Inventory tables and the
previously missing Package Catalogue dependents. Historical package migration
testing stays bounded to 001–006; its API suite verifies the current chain by
names/checksums instead of assuming exactly six migrations. Controlled form tests
expose the existing timezone helper. No production workflow was altered for tests.

One pre-existing test limitation remains: `test:support-access` uses an in-memory
SQL stub missing the already-committed Ledger branch query. It fails at “Unlinked
branch deletion available” on both this candidate and a separate unmodified HEAD
reconstruction. It was not weakened or broadened to hide that failure. Actual
PostgreSQL authorization/workflow suites above pass. Build retains the existing
large frontend chunk warning; it is not a build error.

## Browser evidence and limitations

Supported in-app browser connected to the existing local Support / Developer
session on `http://localhost:3000`. Reload retained the session. Observed the new
three-tab screen, empty state, item creation, receipt of 10 bottles, usage of 3,
and remaining 7. Created and completed a two-bottle transfer, verified its displayed
creation date, and observed destination stock of 2 bottles plus the named
“Local Development Branch A → Local Development Branch B” route in item history.
All entered stock data is explicitly synthetic, SKU
`QA-INVENTORY-R1-20261022`, and remains local for review with its audit history.

The native “Complete this transfer?” confirmation initially interrupted automation;
the supported focus call timed out and native Codex-app access was tool-blocked.
The confirmation was subsequently completed. A direct local read and resumed
browser observation verified completion, destination stock and named history; the
blocker is resolved for this smoke check. Browser console error inspection returned
no entries. Screenshot: `/private/tmp/vine-inventory-r1-GVzTCU/inventory-history-desktop.png`.
Responsive visual acceptance and real-browser restricted-role acceptance remain
unverified. Both-branch authorization and old-scope races pass the automated
suites; do not relabel controlled/server results as ordinary-role browser evidence.

## Mandatory schema report

1. **Schema change required: YES.** Narrow relational stock accounts, immutable
   movements and idempotency commands; existing JSONB catalogue remains.
2. **Committed migration chain:** 001–006. HEAD remains the baseline above.
3. **Local applied:** directly observed PostgreSQL 17.11 at 001–006 before work;
   applied 007 locally after fresh/upgrade validation. Prior checksums and all
   inventory records were preserved. Current local target is 001–007.
4. **Production applied: UNVERIFIED.** No production inspection or connection.
5. **New migration:** `007_inventory_movements.sql`, uncommitted. No existing
   migration was modified. No fixture data is seeded by migration or startup.
6. **Fresh database:** full 001–007, rerun/checksum rejection and actual schema
   checks passed on a disposable synthetic database.
7. **Upgrade path:** retained synthetic 006→007 passed; old data, checksums and
   applied timestamps unchanged. Fresh/upgraded schemas are equivalent.
8. **Existing-record compatibility:** exact old JSONB records survive migration.
   Historical completed transfers do not replay deductions; pending transfers
   remain completable. Lazy opening facts identify legacy quantities without
   inventing historical receipts. Malformed/duplicate stock is not auto-repaired.
9. **Production catch-up:** inspect actual production version during a separately
   authorized release, then apply every missing committed migration in order and
   reviewed 007 only after it is committed. Never construct final schema manually.
10. **Recovery/coexistence:** additive schema preserves old reads, but old stock
    writers cannot coexist after adoption. Database guards refuse their attempted
    divergence. Retain compatible posting code and full history. Do not drop tables,
    edit applied migrations or assume a code rollback restores old stock writing.
    A future production release needs verified backup and reconciliation/recovery
    planning before accepting stock changes.
11. **Unexplained divergence:** none found locally. All applied checksums match
    source, and actual local schema matches fresh 001–007 across 334 catalogue
    entries (columns, constraints, indexes, functions and triggers). Production
    structural parity remains UNVERIFIED. Local 007 is an expected pending release.

Detailed temporary local evidence: `/private/tmp/vine-inventory-r1-GVzTCU/`.
Existing 18 unrelated files and both ignored environment files were hash-verified
unchanged. Index remains empty and HEAD unchanged. Next: independent scoped
commit-readiness review. This report is not production release approval.
