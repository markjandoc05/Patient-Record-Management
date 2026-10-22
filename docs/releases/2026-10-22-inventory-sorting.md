# Inventory stock sorting — local follow-up

Extends the existing uncommitted Inventory R1 and category controls on HEAD
`1503ff8af756669758621f6ea10233a3aa11ea33`. No staging, commit, push, deployment,
production or DARF access.

## Behavior

The Stocks & Levels toolbar includes **Sort by** with Name A–Z (default), Name
Z–A, Remaining low to high, Remaining high to low and Status needs attention
first. Status priority follows the existing displayed states: Needs review,
Low stock, In stock, then Threshold not set. No new stock status is introduced.

Sorting uses only the selected branch's quantities and composes with search and
category filters. A missing stock account remains zero; issue or invalid balances
sort last in either quantity direction. Name comparisons are case-insensitive and
numeric-aware; SKU and ID break ties deterministically. Sorting affects a filtered
copy, preserving catalogue order, transfer pickers, records and movement history.
The choice survives Inventory refresh and editor return. Branch/access scope
replacement retains the existing workspace reset and stale-response safeguards.
Read-only users can sort without acquiring mutation controls or permissions.

## Validation

- Node 22.23.3 TypeScript and production build passed; the existing large frontend
  chunk warning remains.
- Inventory component suite: **92/92**, including 84 existing scenarios and eight
  sorting regressions. Covers numeric/alphabetical/status ordering, unavailable
  balances, branch isolation, deterministic ties, filters, refresh, unchanged
  catalogue order and read-only controls.
- Inventory transport: **21/21**. Permission policy: **223 checks passed**.
- Whitespace and Impeccable detector passed; independent sorting review found no
  blocking correctness or permission issues.
- Existing local Support / Developer browser session: verified all five choices,
  observed reversed item order, checked search and confirmed quantity sorting
  survives Inventory refresh. No records or stock movements created/edited.
  Desktop screenshot saved; no new responsive or ordinary-role browser acceptance
  is claimed. Console error/warning inspection returned no entries.

Temporary evidence: `/private/tmp/vine-inventory-sort-cs8u2m1b/`.

## Mandatory schema report

1. **Schema change required: NO.** Client-side presentation only.
2. **Committed migration chain:** 001–006; HEAD unchanged.
3. **Local applied:** previously observed 001–007 in the category follow-up;
   current database schema not re-inspected for sorting (UNVERIFIED this task).
4. **Production applied: UNVERIFIED.** Production not accessed.
5. **New migrations: none.** Existing migration files unchanged.
6. **Fresh-database validation: N/A** for this schema-free follow-up; previous
   Inventory initialization evidence remains in the earlier reports.
7. **Upgrade-path validation: N/A.** No DDL, backfill or write contract changes.
8. **Existing-record compatibility:** no data writes; sorting copies filtered
   items and leaves quantities/history untouched. Regression coverage includes
   missing/invalid balances and legacy category text.
9. **Production catch-up:** sorting adds none. Any missing committed migrations
   and the earlier pending Inventory 007 remain a separate release decision.
10. **Recovery/rollback:** revert the sorting UI/tests; no data restoration or
    schema rollback needed. Existing Inventory recovery constraints remain.
11. **Unexplained schema divergence:** no schema changes made or migration files
    altered; actual database divergence not re-inspected. Production parity stays
    UNVERIFIED; local pending 007 is the previously documented release gap.

Only the Inventory dashboard, its existing component test file and this report
changed in this follow-up. Earlier work, environment files, HEAD and index remain
preserved.
