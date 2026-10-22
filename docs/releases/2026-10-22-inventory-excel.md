# Inventory Excel management — local implementation

October 22, 2026. Extends the uncommitted Inventory R1, categories and sorting on
HEAD `1503ff8af756669758621f6ea10233a3aa11ea33`. No staging, commit, push, deployment,
production or DARF access. Vine remains on localhost:3000.

## Workflow

**Export Excel** downloads the selected tab: stock levels, suppliers or transfer
history. The server rechecks current branch access before each download. Stock
export includes the displayed item selection/order with fresh authorized quantities;
search/category filters determine that selection. Unavailable stock remains blank
with its review status/note, rather than becoming zero. Transfer source/destination
names are retained; transfer dates are typed Excel dates labelled UTC. Workbooks
include branch/export-time context. Text is stored literally, including text that
begins with formula characters. ExcelJS is loaded only when a file action needs it.

**Import Excel** appears in Stocks & Levels for existing `inventory.manage` users
at an active authorized branch. Download the blank template, enter new item rows
in its Items worksheet and choose the file. It accepts .xlsx files up to 2 MiB and
250 nonempty rows, with up to three decimal places in quantities. Archive metadata
checks also reject oversized expansions, encrypted/macro/embedded/external-link
content. Plain text and numeric cells are supported; formulas/opaque cell objects
are refused. The template has item name, SKU, category, stock unit, low-stock
threshold and optional opening quantity. Category names must uniquely resolve to
active managed definitions; no category is created implicitly.

The authoritative preview marks ready, skipped and invalid rows. Existing SKUs
match without case/outer whitespace and are always skipped, preserving existing
items and balances. Duplicate SKUs within one workbook are errors. Every error
must be corrected before any new item is saved. No existing stock corrections,
receipts for existing SKUs, supplier/transfer imports, XLS/CSV import or automatic
catalogue updates are included.

Confirming creates all ready items in one transaction. Positive opening quantities
use the existing stock receipt/account/movement logic at the selected branch, with
the chosen date/time, authenticated actor, notes and `Excel import` reference.
Zero opening quantity creates the item only. A server-derived preview hash binds
the planned rows and category ID/name/version. A catalogue/category change requires
explicit preview refresh. Actor-bound immutable commands make uncertain retries
safe; the UI freezes the submitted file/date/notes and reuses the exact command.
Current denials still invalidate protected state. Old file parsing, previews,
saves, template generation and workbook downloads cannot publish after their
request/view/branch/account/permission scope ends.

## Validation

Node 22.23.3; real HTTP tests use disposable loopback PostgreSQL 17 databases,
production middleware, synthetic identities and temporary storage.

| Check | Result |
| --- | --- |
| Import HTTP/API, including atomicity/replay/branch restrictions | 161 passed |
| Existing stock/transfer HTTP/API | 187 passed |
| Existing category HTTP/API | 90 passed |
| Actual XLSX serialization/loadback and file validation | 73 passed |
| New Excel component workflow/lifetime scenarios | 48 passed |
| Existing Inventory component scenarios | 92 passed |
| Inventory transport | 21 passed |
| Permission policy / scope / protected invalidation | 223 / 227 / 14 passed |
| TypeScript, production build, whitespace, Impeccable detector | Passed |

Independent backend and UI reviews found no blocking issues. A direct auth-UID
guard additionally rejects an old generated export even before the new profile
publishes or React renders; the focused component suite exercises that case.
The build retains large frontend/ExcelJS chunk warnings. This task does not claim
whole-application browser or native Microsoft Excel acceptance.

Browser verification used the existing local Support / Developer session. Actual
stock, supplier and transfer XLSX files and the blank template downloaded and
reopened successfully. A two-row synthetic workbook previewed one ready item and
one existing-SKU skip, imported only the new item with 4.5 pieces at Branch B,
and displayed the attributed receipt/date/notes in movement history. Reuploading
the same workbook showed zero ready and two skipped, with import disabled.
An unsupported workbook showed a clear read error before any server mutation.
Browser error/warning inspection returned no entries. No responsive or ordinary-
role browser acceptance is claimed; restricted roles/branches are tested by the
guarded API/component suites.

All seven pre-existing local inventory records were hash-verified unchanged.
One clearly labelled synthetic item, one stock mirror and two immutable movements
(zero opening plus receipt) remain in development as acceptance evidence.

Evidence and screenshots: `/private/tmp/vine-inventory-excel-quf5d3j6/`.

## Dependencies and portability

ExcelJS 4.4.0 is pinned using its documented browser/buffer APIs:
[versioned upstream documentation](https://github.com/exceljs/exceljs/blob/v4.4.0/README.md).
A scoped override pins only its UUID dependency to 11.1.1. No existing locked
package version changed. The final dependency audit has no finding on newly added
package paths; 12 pre-existing findings remain outside this feature's scope.

Use Vine's import template. ExcelJS cannot parse some otherwise valid OOXML files
with prefixed spreadsheet XML elements. An independently generated Artifact Tool
fixture reproduced that limitation and was rejected with no writes; no parser
internals or XML namespaces were patched. Vine-generated files roundtrip in the
supported template format; a reference stock/transfer export uses different
columns and is not an import template. Native Excel open/save was not performed.

## Mandatory schema report

1. **Schema change required: NO.** Uses existing JSONB catalogue and Inventory
   accounts/movements/commands; no direct balance overwrite or backfill.
2. **Committed migration chain:** 001–006. HEAD unchanged.
3. **Local applied:** directly observed 001–007 with matching source checksums
   before/after browser checks. Existing pending 007 is earlier Inventory R1 work.
4. **Production applied: UNVERIFIED.** Production not accessed.
5. **New migrations: none.** All existing migration files unchanged.
6. **Fresh-database validation:** guarded import/core/category suites initialized
   the complete 001–007 chain in separate empty disposable databases and passed.
7. **Upgrade-path validation:** no DDL upgrade for Excel. Existing-record and
   ongoing stock writer compatibility passed; prior Inventory 006→007 evidence
   remains separate. No additional upgrade migration run on development.
8. **Existing-record compatibility:** existing SKUs are skipped; existing JSONB
   records, balances and movement history are preserved. No automatic fixtures.
9. **Production catch-up:** Excel adds none. Any missing committed migrations
   and reviewed/committed Inventory 007 require a separate authorized release.
10. **Recovery/rollback:** removing Excel controls/endpoints needs no schema
    rollback. Imported items/receipts remain normal auditable records. Corrections
    use existing authorized movement workflows, never deletion of history.
11. **Unexplained divergence:** no migration or schema changes made; local applied
    checksums match source. Actual structural parity was not re-inspected here.
    Production parity remains UNVERIFIED. Pending local 007 is the known release gap.

Earlier Inventory and unrelated changes, ignored environment files and Git index
remain preserved. Ready for independent scoped commit-readiness review.
