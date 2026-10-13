# Nurse-led Visit charts — local follow-up

User-approved change: face and front/back body charts may be used on a saved
nurse-led Visit without an assigned Doctor. Local only. No dental maps, commit,
push, deployment, production access or DARF changes.

## Behavior

Save the Visit with a Nurse or Medical Staff member selected under Performed by;
Doctor may remain Unassigned. Open its chart from Patient Profile → Clinical Charts,
Visit details or the saved Visit form. Existing clinical editing permissions are
still required. Add points/notes, undo, save and reopen as before. Signing requires
the existing separate explicit finalization grant.

The server validates the saved performer on every request under the transaction
lock. Without a Doctor, the performer must be an active, approved, nonarchived
Doctor or Staff designated Nurse/Medical Staff and assigned to the Visit branch.
Reception/undesignated Staff, missing/inactive accounts and branch-ineligible
performers do not qualify. Existing Doctor-assigned eligibility and ownership
remain unchanged. A Doctor actor may edit a doctorless Visit only when they are
its recorded performer. Authorized non-Doctor actors retain existing capability
and branch rules; designation alone grants nothing.

Visits without either Doctor or performer retain readable history and require a
performer selection before chart editing. Archived patients/Visits, inactive branches
and clinically sealed Visits remain read-only. Chart actions do not assign a Doctor,
change the booking, complete treatment, bill, consume stock or redeem packages.

Optional performer ID/name/role/designation snapshots are captured from the stored
Visit, included in its server context hash and saved with chart drafts/revisions.
The chart and print view distinguish Performed by from Assigned doctor. Exported
signed history uses the frozen performer rather than a current account name or
later Visit reassignment. Older charts without these optional fields remain valid;
original signed revisions are never backfilled or rewritten. A draft missing new
context must be reviewed and saved against the current context before signing.

The modal request scope now includes recorded performer identity/snapshots. A
performer change unmounts the previous editor, aborts pending requests and reloads
authoritative state. Old save/sign/amend 200/401/403/409 results cannot restore old
content or invalidate the newer cache. Same-performer list refreshes retain drafts.
The prior archive repair remains intact.

## Permissions

No role defaults, user accounts or grants were changed. Staff defaults still permit
clinical history viewing and deny Visit/clinical editing. A Nurse who should chart
needs existing `visits.edit` and `clinical.edit_draft` grants, along with clinical/Visit
viewing and branch access, through the existing authorized Module Access workflow.
Signing separately requires `clinical.finalize`; no role receives it automatically.

## Validation

Final results and exact source/hash evidence are recorded under
`/private/tmp/vine-charts-performer`. Automated controlled components and synthetic
HTTP/PostgreSQL tests do not constitute interactive browser or visual PDF acceptance.

- Chart API: **269 PASS**, including 76 new checks for nurse-led eligibility,
  capabilities, branch scope, clinical denial, performer reassignment, snapshots,
  amendments, explicit signing and queued authority loss.
- Chart controlled UI: **68/68 PASS**. Seventeen additions cover Nurse editing,
  frozen print/export attribution, performer-only scope changes and delayed
  save/sign/amend 200/401/403/409 responses. The old components pass53/68, with
  15 of these new scenarios failing; repaired components pass all68.
- Chart policy33 and protected transport18 PASS: **388 focused checks** total.
- **24 relevant suites PASS** in the combined local candidate, including earlier
  performer API180/UI43, Visit Services API152/UI174, appointment Services,
  RBAC/audit/Support, clinical findings, protected scope/invalidation, permission
  API, appointment authorization, shared clinical/parity and migration regressions.
- Updated HEAD-plus-charts also passes TypeScript/build and chart API269/UI68;
  it imports no uncommitted performer helper. Nurse chart fixtures there use only
  the guarded disposable test database.
- Additional real booking/Visit/chart workflow checks use a temporary synthetic
  HTTP probe: **14 additional checks PASS (283 total including the269 chart checks)**.
  Covers Unassigned booking, nurse-led Visit, all three chart maps, reload,
  separate signing denial and archive/restore. They do not modify the main local
  database or constitute real-browser login evidence.
- TypeScript, production build and whitespace PASS. The existing frontend
  chunk-size warning remains.
- Vine restarted on existing localhost:3000 with unchanged development settings.
  Three consecutive probes returned health200, shell200 and anonymous chart401.
  Main local PostgreSQL read-only health PASS. No credentials were printed.

## Mandatory database report

1. Schema change required: **NO**. Existing Visit/clinical-chart JSONB is adequate.
2. Committed migration chain: **001–004**, unchanged.
3. Local applied migration: **OBSERVED 001–004** in a guarded read-only query;
   all applied checksums match unchanged committed files.
4. Production applied migration: **UNVERIFIED**; production was not accessed.
5. New migrations: **none**. No DDL, backfill or main-development migration.
6. Fresh-database validation: **PASS**, complete 001–004 initializes guarded disposable tests.
7. Upgrade-path validation: feature schema upgrade **N/A**. Existing forward Services
   migration regression **PASS** for 003→004 with retained synthetic records.
8. Existing-record compatibility: **PASS**. Older Doctor charts and performer-free signed
   contexts remain readable; no backfill; archived/history/legacy workflows retained.
9. Production catch-up: no new migration introduced. Actual missing existing
   migrations require separately authorized inspection and ordered catch-up.
10. Recovery/rollback: no destructive SQL. Earlier chart code retains new fields and
    signed records but restores its Doctor requirement. Retain the chart collection.
11. Unexplained divergence: no migration/checksum mismatch found locally; full production/local
    structural parity **UNVERIFIED**.

## Changed scope and next gate

Backend chart eligibility/context, shared optional context fields, chart modal and
patient chart listing, focused chart API/UI tests, roadmap and chart release reports.
No changes to appointment/Visit creation, performers/designation implementations,
Services, role registry, migrations, local OAuth/environment or production settings.

The prior Doctor-required HEAD patch and commit-readiness result are superseded for
the modified chart code. A new scoped review is required before staging/commit.
Earlier uncommitted features remain separate. Next: browser walkthrough and scoped
review, then a separately authorized commit. Treatment Ledger planning follows.
