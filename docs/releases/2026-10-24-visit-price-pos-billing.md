# Visit prices and POS billing — local implementation

Visits now show the saved quote below the Service on desktop rows and compact
cards. View details adds the saved Service price, Special Price and Visit total,
followed by the linked billing history. This builds on the pending payment
corrections and invoice-form work; HEAD remains POS R1A `a012857`. No staging,
commit, push, deployment, production or DARF action was performed.

## Workflow and history

- Display uses the existing saved `visitQuote` reader only. Catalogue changes do
  not reprice history. Zero is Free; a missing/invalid historical quote is Price
  not recorded. No quote or legacy data is backfilled.
- Billing distinguishes Not invoiced, Draft invoice, Invoice unpaid/partially
  paid/paid, void history and Package session used. A failed, missing, incompatible
  or truncated read never implies an unbilled Visit.
- Create invoice from Visit retains the existing exact Visit source, patient,
  clinic and saved quote workflow. Existing drafts offer Continue draft, or View
  draft for users without management authority. Posted/void invoices offer View
  invoice. Multiple drafts are listed explicitly; none is selected automatically.
- Existing invoice launch opens that exact invoice for review. Editing, saving,
  posting and collecting remain explicit existing actions. Launch performs GETs
  only. Returning to Visits remounts its billing lookup; Refresh/Retry billing
  supports an explicit current-scope refresh.
- Payment figures are labelled Invoice totals because an invoice may contain
  several Visits or other items. Visit quotes remain separate from final billed
  amounts and whole-invoice collections. Net paid respects recorded reversals.
- Visit and linked appointment claims are both checked, including an appointment
  invoiced before the Visit existed. Existing posted-source claims, package usage
  and authoritative write/version checks still prevent duplicate treatment billing.
  Posted terms, purchases, session balances and payment history are unchanged.

## Implementation and scope

The new read-only GET `/api/pos/visit-billing?visitIds=...` accepts1–50 unique valid
Visit IDs. Current POS, patient, Visit and branch authorization is required. The
complete requested Visit set is authorized before any financial lookup. It derives
links from existing source claims and frozen invoice-item snapshots, plus existing
package usage and `pos_paid_cents`. Only20 related invoices per Visit are returned,
with a history indicator; active-state checks consider all linked records. Cross
patient/branch source inconsistencies fail closed without exposing those invoices.
Archived Visits remain readable but cannot start new billing.

Optional `visitId` on invoice-detail GET proves the source relationship server-side
independently of the summary cap. Existing GET behavior without it is retained.
The client also verifies the returned invoice ID, patient and clinic before showing
it. All financial write paths remain byte-identical to the pre-task snapshot.

The UI requests only authorized Visits on the current page, with a separate
one-Visit request if details remain open off-page. Identity, policy, active branch,
Visit IDs and saved context/version define its lifetime. Render-time guards hide
cached quotes and financial summaries when scope changes. Obsolete successes and
401/403 replies cannot replace or invalidate a new scope. Current denial clears
and pauses the read until explicit retry or a real context/authority change,
preventing an automatic denial/retry loop. No permission defaults were changed.

Changed files: `src/App.tsx`, `src/components/VisitHistoryDashboard.tsx`,
`src/components/PosDashboard.tsx`, `backend/pos.ts`, `scripts/test-pos-api.ts`,
`scripts/test-pos-ui.ts`, `package.json`, `ROADMAP.md` and this report.
New implementation/test files: `backend/visitBilling.ts`,
`src/components/VisitBilling.tsx`, `src/utils/visitBilling.ts` and
`scripts/test-visit-billing-ui.ts`. Unrelated working changes remain intact.

## Validation

Node22 checks passed:

- TypeScript and production build, retaining existing bundle-size warnings.
- POS API418 checks, including80 added checks for the projection, quotes, source
  claims, pre-Visit billing, drafts/voids, packages, limits, source linkage, net
  reversal balances, authorization, incompatible history and read-only behavior.
- POS controlled UI92 scenarios (65 existing plus27 exact-invoice launch cases).
- Visit billing controlled UI59 scenarios: frozen/Special/Free/missing prices,
  actions and labels, read-only users, current denials, obsolete200/401/403 replies,
  branch/account/sign-out transitions, bounded pages/off-page details, truncation,
  archival and version-only context changes.
- Existing payment corrections API122, Treatment Ledger API234, permissions
  API210, clinical/parity142 and appointment read-authorization236.
- Visit Services UI318, Patient Billing Profile9, protected invalidation14,
  permission scope227, POS money/policy and RBAC checks.
- Whitespace passed. Focused UI detector reported three pre-existing style
  warnings on unchanged archive controls; no new-component finding. Those controls
  were left unchanged. Independent backend and UI/launch cross-reviews reported
  no blocking finding; read-only draft wording was clarified during finish review.

Database suites used task-owned disposable loopback PostgreSQL17 databases,
synthetic records and temporary storage, with complete001–009 migration/checksum
validation. Test-guard and sandbox/CLI refusals were resolved by using the correct
disposable database and Node import runner; all listed checks completed. No
migration, fixture, invoice or payment was added to the normal development DB.

A read-only synthetic browser preview of the Visit table and details was inspected
at desktop and narrow sizes. Saved amounts, billing labels and Invoice totals
rendered correctly. Measured document widths1545 and354 CSS pixels showed no
horizontal overflow; the narrow modal scrolled normally. No financial browser
write was performed. This visual check does not claim full live ordinary-role
financial acceptance. Logs, baseline hashes and screenshots are outside Git at
`/private/tmp/vine-visit-price-billing/`.

Vine was restarted on localhost3000 to load the new read routes. Local health and
the app shell returned200; no normal-development migration or fixture command ran.
The retained local Support workspace finished loading after restart, and its Visits
page displayed saved prices and completed billing summaries without mutations.

## Required schema report

1. Schema change required:NO. Existing quote JSONB, invoice items/claims, payments
   and package relations cover this read-only integration.
2. Committed migration chain:001–008 unchanged.
3. Local applied chain:001–009 was directly observed in the preceding correction
   implementation; metadata was not queried again here.
4. Production applied chain and live parity:UNVERIFIED and untouched.
5. New or modified migrations:none. Pending009 remains byte-identical.
6. Fresh validation:guarded suites initialized/repeated the complete001–009 chain
   and checked checksums. No dedicated schema-shape comparison was repeated.
7. Upgrade validation:N/A for this feature, with no schema transition. The prior
   correction feature's008→009 retained-record evidence remains historical.
8. Existing-record compatibility:no migration, backfill or quote rewrite. Missing
   historical prices stay missing. Existing invoices, accounts, payments, purchases
   and session balances retain their semantics.
9. Production catch-up:unchanged. This work depends on the pending correction-aware
   POS baseline. A separately authorized release must inspect the actual version
   and apply only missing committed migrations in order with compatible code.
   009 is uncommitted and is not authorized for production.
10. Recovery:the display/read integration can revert independently. Existing
    correction-aware recovery requirements remain once reversal records exist;
    preserve financial history and never revert to gross-payment calculations.
11. No schema change or new unexplained divergence introduced. Live parity remains
    UNVERIFIED; local009 ahead of committed/deployed versions is the expected
    pending feature/release gap.

## Next step

Independent scoped commit-readiness review, accounting for the pending payment
correction and invoice-form prerequisites. Earlier review patches/manifests are
not a review of this combined current candidate. No staging or commit is implied.
