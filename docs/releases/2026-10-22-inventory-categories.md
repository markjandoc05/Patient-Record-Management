# Inventory categories — local follow-up

October 22, 2026. Extends the existing uncommitted Simple Inventory R1 on HEAD
`1503ff8af756669758621f6ea10233a3aa11ea33`. Local only; no staging, commit, push,
deployment, production or DARF access.

## Behavior

Stocks & Levels → **Manage categories** supports create, rename, deactivate and
reactivate. Category changes require existing `inventory.manage`; category reads
and filters require `inventory.view`. Permission defaults and branch scope are
unchanged. The existing three Inventory tabs remain. No new Staff/Nurse grants.

The new-item Category field is an optional dropdown of active definitions, with
Uncategorized as the explicit empty choice. New forms submit a category ID;
the server checks its existence/active state and derives the category name.
Renaming changes the current label on linked items without rewriting their stored
recorded category text. Inactive definitions stay linked/readable on existing
items but cannot be newly selected. Categories cannot be hard-deleted.

Definitions use normalized whitespace/case name uniqueness, including inactive
definitions, optimistic versions, actor-bound commands and trusted audit changes.
Duplicate-name errors leave the editor editable. Stale-version errors preserve
the draft until an explicitly confirmed reload. Uncertain results lock fields and
retry the same command. Old branch/account/permission responses cannot publish
data or invalidate the current scope.

Stock filters distinguish managed category IDs, Uncategorized and existing
recorded text. Matching a managed category's name does not silently convert an
old text-only item. A selected category remains visible as inactive even if it
has no linked items, preventing a dropdown/table mismatch after deactivation.

Compatibility requests without `categoryId` may still create recorded free-text
categories through the established item metadata contract. They do not create or
impersonate canonical definitions. Generic category writes and generic item writes
of canonical category fields are blocked; canonical selections use the dedicated
inventory endpoint. Existing items, stocks and transfers are not backfilled.

## Files

- `backend/inventory.ts`: definitions, current-label projection, server selection,
  versions, retries and audit events.
- `backend/dataApi.ts`: read authorization and canonical-write bypass guards.
- `src/inventoryPolicy.ts`: category name/version/input validation.
- `src/components/InventoryDashboard.tsx`: category manager, dropdown and filter.
- `src/permissions.ts`: management label describes categories; policy unchanged.
- `scripts/test-inventory-categories-api.ts`: focused guarded HTTP regressions.
- `scripts/test-inventory-ui.ts`: additional real-component controlled scenarios.
- `package.json`: focused category API test command.
- `ROADMAP.md` and this report: scoped implementation evidence.

## Validation

Node 22.23.3; disposable local PostgreSQL 17.11, synthetic records only.

| Check | Result |
| --- | --- |
| Focused category HTTP/API suite | 90 passed |
| Inventory component suite | 84 passed, including previous 51 |
| Existing Inventory stock/transfer HTTP suite | 187 passed |
| Inventory policy / transport | 38 / 21 passed |
| Permission policy / scope / protected invalidation | 223 / 227 / 14 passed |
| TypeScript, production build and whitespace | Passed |
| Impeccable mechanical detector | No findings |

Independent backend review found no actionable defects. Independent component
review reproduced the selected-unused-category deactivation filter mismatch;
the minimal fix and a controlled component regression pass. Coverage also verifies
category duplicate races, stale edits, retries after deactivation, actor/content
command reuse, spoofed names, generic write bypasses, permission revocation,
branch-private stock reads, old record preservation and stale responses.

The production build retains the previously documented large frontend chunk
warning. The pre-existing Support in-memory SQL-stub limitation remains recorded
in the base Inventory R1 report; this task does not claim full application or
restricted-role browser release acceptance.

## Browser evidence

The existing Support / Developer development session loaded the new controls.
Created synthetic `QA — Consumables (synthetic)` (v1), deactivated it (v2), then
renamed/reactivated it as `QA — Clinical supplies (synthetic)` (v3). Verified the
managed category in stock filters and the new-item dropdown, with Uncategorized
available. The existing item retains `Synthetic test supplies` as recorded text.
No new item or stock movement was created in this follow-up browser check.
The synthetic category remains clearly labelled in local development for review.
Browser console error inspection returned no entries. Responsive and ordinary-role
browser acceptance were not performed; authorization checks above are automated.

Screenshots and detailed temporary evidence:
`/private/tmp/vine-inventory-categories-3xJCjv/`.

## Mandatory schema report

1. **Schema change required: NO.** Category definitions fit existing `app_records`
   JSONB; existing Inventory command storage provides retry integrity.
2. **Committed migration chain:** 001–006. HEAD unchanged.
3. **Local applied:** directly observed PostgreSQL 17.11 at 001–007, unchanged by
   this follow-up. Migration 007 belongs to the earlier uncommitted Inventory R1.
4. **Production applied: UNVERIFIED.** No production connection or inspection.
5. **New migrations: none.** All existing source/applied checksums unchanged.
6. **Fresh database:** complete 001–007 initialization passed in both the focused
   category and stock regression suites; no category fixtures run at startup or
   through migrations. Actual local schema equals the fresh schema (334 entries).
7. **Upgrade path:** no DDL upgrade needed for categories. Existing-record loading,
   continued writes, definition edits and preserved history are exercised by the
   focused suite. The prior Inventory 006→007 upgrade evidence remains separate.
8. **Existing-record compatibility:** all four pre-existing local Inventory JSONB
   rows were hash-verified unchanged; stock accounts and full movement history
   remain identical. Existing text-only categories are not reassigned or rewritten.
9. **Production catch-up:** no additional category migration. Any missing committed
   migrations and reviewed/committed Inventory 007 still require a separately
   authorized release after inspecting the actual production baseline.
10. **Recovery/coexistence:** no category-specific schema rollback. Retain category
    records/IDs and recorded item text; older code can read item snapshot text.
    Restoring the prior Inventory R1 code hides category management but does not
    require deleting definitions. Earlier ledger-backed stock writer/recovery
    restrictions still apply; this follow-up does not relax them.
11. **Unexplained divergence:** none found locally; actual schema and applied
    checksums match source. Production parity remains UNVERIFIED. Local pending
    007 is the existing expected release gap, not unexplained drift.

Existing unrelated changes and ignored environment files were preserved; 305
non-target baseline files were hash-verified unchanged. Index remains empty.
Next: independent scoped review of Inventory R1 plus this category follow-up.
