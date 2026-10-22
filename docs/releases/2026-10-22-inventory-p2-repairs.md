# Inventory P2 repairs — local validation

October 22, 2026, on unchanged HEAD
`1503ff8af756669758621f6ea10233a3aa11ea33`. Repairs only the Excel expansion
limit and the Package Catalogue migration-test isolation. No staging, commit,
push, deployment, production access or DARF changes.

## Corrections

- Excel import now streams each ZIP entry through a bounded decoder before
  constructing/loading an ExcelJS workbook. It counts actual decompressed bytes
  across all entries, discards output rather than collecting it, and aborts above
  10 MiB within one 16 KiB output chunk. Forging central-directory sizes or both
  local/central sizes cannot bypass this check. Stored entries are counted too;
  incomplete streams and size mismatches are rejected before workbook parsing.
  Existing file, entry, content, cell and row restrictions remain in place.
- Pako 3.0.2 is pinned as a direct dependency for its public streaming API and
  bundled types; ExcelJS's existing JSZip/Pako dependency remains unchanged at
  its own nested path. No unrelated locked package version changed. The bounded
  decoder adds an approximately 18.43 kB / 6.35 kB gzip lazy build chunk.
  [Versioned upstream streaming implementation](https://github.com/nodeca/pako/blob/3.0.2/src/inflate.ts).
- The Package Catalogue migration test now prepares its exact 001–006 temporary
  migration directory before fresh initialization. Its retained-record setup
  uses 001–005, then upgrades to 006. New assertions check the exact applied names
  on all three steps. Later workspace migrations cannot contaminate the focused
  comparison. The migration runner and every SQL migration remain unchanged.

No stock writer, balance calculation, branch/role permission, purchase, transfer,
category, import transaction or UI workflow changed in these repairs.

## Regression evidence

All checks below passed using Node 22.23.3. Database checks used separate empty
databases in an ephemeral loopback-only PostgreSQL 17 container with synthetic
records and temporary storage. Normal development data was not used for writes.

| Check | Passed |
| --- | ---: |
| Excel serialization/parser, including new regressions | 87 |
| Package Catalogue migration fresh/retained-upgrade/checksums | 33 |
| Inventory migration fresh/retained-upgrade/checksums | 33 |
| Inventory API, balances and transfers | 187 |
| Inventory categories API | 90 |
| Inventory import API, atomicity/replay and branch restrictions | 161 |
| Permission API, branch restrictions and live revocation | 210 |
| Package Catalogue API and retained purchases/balances | 114 |
| Inventory policy / transport | 38 / 21 |
| Inventory components / Excel components | 92 / 48 |
| Permission policy / scope / protected invalidation | 223 / 227 / 14 |
| Treatment Ledger / Package Catalogue components | 44 / 82 |
| RBAC / audit policy | Passed |
| TypeScript / production build / whitespace | Passed |

Excel regressions cover forged central-only sizes, forged matching local/central
sizes, bounded real decoder output, no workbook-parser call on rejected archives,
stored ZIP imports, size mismatches, truncated streams, exactly 10 MiB aggregate
expansion and one byte over. The original bypass fixture now fails at the limit.

Negative controls outside the repository confirmed the forged-size regression
fails against the old parser and the migration-chain assertion fails when fresh
initialization incorrectly uses the workspace chain including 007. The same
focused forged-size probe passes against the repaired parser.

Evidence: `/private/tmp/vine-inventory-repair-a40bysuf/`. Test credentials were
kept out of output and removed after container cleanup. No new browser/native
Excel acceptance is claimed. Existing large application/ExcelJS build-chunk
warnings and the documented prefixed-OOXML portability limitation remain.

## Mandatory schema report

1. **Schema change required: NO.** Parser and test isolation only.
2. **Committed migration chain:** 001–006, unchanged HEAD.
3. **Local applied:** observed 001–007, all source checksums matching, through a
   guarded read-only connection to local `vine_development`.
4. **Production applied: UNVERIFIED.** No production access.
5. **New migrations: none.** All 001–007 SQL files unchanged by these repairs.
6. **Fresh initialization:** complete Inventory 001–007 passed; focused Package
   001–006 passed with exact applied-chain assertions.
7. **Upgrade validation:** retained synthetic Inventory 006→007 and Package
   005→006 passed, including schema equivalence and checksum/rerun guards.
8. **Existing records:** retained purchases, Visit bindings, balances, snapshots,
   legacy JSONB and history passed regression checks. No development data writes.
9. **Production catch-up:** these fixes add none. Existing pending Inventory 007
   requires review/commit and a separately authorized release; any earlier missing
   migrations must precede it in the same ordered chain.
10. **Recovery:** no schema rollback or data repair required. Reverting only the
    parser fix would restore the unsafe expansion behavior; prefer a forward fix.
11. **Divergence:** local actual schema matches a fresh 001–007 test database and
    source checksums match. No unexplained local divergence found. Production
    parity remains UNVERIFIED; uncommitted local 007 is the known release gap.

The repair changes five pre-existing working files plus this report. HEAD, index,
all unrelated working files, environment files and SQL migrations are preserved.
The old review patch/manifest remain historical artifacts; the corrected Inventory
candidate needs a fresh independent scoped review before staging or committing.
