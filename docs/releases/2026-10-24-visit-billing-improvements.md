# Visit billing improvements — local implementation

## Workflow

In POS & Payments, **Visits needing billing** lists completed, unarchived Visits
from the selected authorized clinic or all authorized clinics. Search and status
filtering cover the entire matching set before 25-record pagination. Needs
attention includes uninvoiced Visits, drafts, missing prices and records requiring
review. Separate filters include already invoiced and package-session Visits.

The queue displays the saved quote and existing linked billing. **Create invoice
from Visit** loads that exact source into a draft; staff still review, save and
post through the existing workflow. Existing invoice actions open the exact linked
invoice, with patient/Visit/branch checked again on the server. An existing draft,
posted invoice, incompatible claim, package usage, unavailable context or missing
quote prevents new invoice creation from this queue. No price is inferred from a
current catalogue or converted from missing to Free.

New invoices default to Saved Visit quote for users with Visit access. Catalogue
Services remain available as explicitly separate sales. Matching names, patients
or amounts never silently attaches an old sale to a Visit. Historical standalone
sales retain their original classification and records; staff should review those
invoices before creating billing for a historical Visit.

Visit billing now shows the frozen item amount separately from the whole invoice
total, collections and outstanding balance. Direct Visit, linked-booking, mixed
and unavailable amount provenance are distinct. A quote difference is shown only
when exactly one direct Visit source has the same saved quote and version. A
claim without item evidence never appears as a zero-priced Visit. Payments remain
whole-invoice values; they are not allocated to individual Visits by this release.

## Sales and refresh

Sales Overview adds Visit quotes, booking quotes, catalogue Services, package
purchases and unclassified historical sources. Each posted line is summed once.
Per-clinic and overall source totals must reconcile to invoiced sales, otherwise
the report fails visibly. Source-filtered records distinguish matching item totals
from whole-invoice totals. Visit/booking IDs require the respective clinical read
capability, authorized branch and matching current source context. No clinical
notes are returned. Excel adds a **Sales sources** sheet with aggregate totals,
without patient details or clinical record IDs.

Successful POS mutations publish an ephemeral, data-free refresh signal. Visit
billing, the visible queue, invoice lists and active Sales reads refresh on changes,
window focus or returning to the view. Cross-tab signals carry no financial,
patient, invoice or branch data. Signals are coalesced and deferred while hidden.
Selected invoice fields, draft notes, payment entries, correction reasons and
unsaved Admin OR# are not automatically rehydrated. Existing version checks remain
authoritative when saving or posting.

New reads retain account/permission generations, current branch checks and abort
guards. Hiding a queue/report retires its pending opening actions. Passive refresh
does not explicitly clear a denied-read pause. The existing POS protected-data
invalidation remounts the workspace and returns to Invoices; queue filters/retry
state do not persist through that security reset. Ordinary navigation preserves
queue filters while viewing its invoice (editing/creating in an all-clinic view
selects the invoice's clinic, as required by the existing draft workflow).

Quotes, Special Price, package funding/usage safeguards, balances, financial write
rules, permissions and history are unchanged. No automatic invoicing, payment,
historical relinking, backfill, new payment allocation or refund workflow was added.

## Validation and scope

Static cross-review, TypeScript compilation and application build were performed.
TypeScript and the application build passed on the final source candidate.
No test suites, browser acceptance, endpoint probes, database checks, synthetic
fixtures or Excel round-trip checks were run, per user instruction. Runtime SQL,
ordinary-role workflow acceptance and responsive browser behavior are
**UNVERIFIED**, not reported as passed. Build bundle-size warnings remain.

The local Vine server was restarted on port 3000 to load the new read route. Its
startup announcement and listener were observed. Only its existing process,
guarded local environment, startup and listener were checked;
no production, DARF, credentials, migrations or live financial records are changed.
Prior dirty work is preserved. No staging, commit, push or deployment.

Changed source in this follow-up: `backend/pos.ts`, `backend/visitBilling.ts`,
`backend/salesOverview.ts`, `src/components/PosDashboard.tsx`,
`src/components/VisitBilling.tsx`, `src/components/SalesOverview.tsx`,
`src/utils/visitBilling.ts`, `src/utils/salesOverview.ts`,
`src/utils/salesOverviewExcel.ts`.

New source: `backend/visitBillingWorklist.ts`,
`src/components/VisitBillingWorklist.tsx`, `src/utils/visitBillingWorklist.ts`,
`src/utils/billingRefresh.ts`. Documentation: this report and `ROADMAP.md`.
Existing pending payment corrections, Visit/POS integration, Sales Overview and
other unrelated patches remain uncommitted. Earlier review manifests do not cover
this expanded candidate.

## Mandatory schema report

1. Schema change required: **NO**.
2. Committed migration chain: **001–008**, observed at HEAD `a012857`.
3. Local applied migration: **UNVERIFIED this task**; previously observed 001–009.
4. Production applied migration: **UNVERIFIED**, production not accessed.
5. New migrations: **none**. Existing pending 009 is preserved and remains a
   prerequisite of the existing payment-correction/net-payment reporting code.
6. Fresh-database validation: **not run**, per user instruction; no schema change.
7. Upgrade-path validation: **not run**, per user instruction; no schema change.
8. Existing-record compatibility: read-only saved-record projections, no rewrites
   or backfill. Missing/malformed quotes remain missing, history is retained and
   catalogue-only sales are not automatically linked to Visits.
9. Production catch-up migrations: **UNVERIFIED**. A later authorized deployment
   must apply any missing reviewed, committed migrations in order. No production
   update is authorized by this feature.
10. Recovery/rollback: revert this scoped read/UI patch while retaining prior POS
    prerequisites. No data rollback or migration is introduced by this follow-up.
11. Unexplained schema divergence: **UNVERIFIED**; no schema inspection performed.
    A pending development release gap alone is not evidence of schema divergence.
