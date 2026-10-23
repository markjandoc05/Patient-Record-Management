# Simpler New Invoice form — local implementation

The New Invoice form now follows Patient → Add items → Invoice items → Notes →
Draft total. This is an uncommitted local refinement on top of the pending Admin
payment corrections and OR# reload repair. HEAD remains POS R1A `a012857`.
Nothing was staged, committed, pushed or deployed.

## Behavior and preserved contracts

- One patient search replaces the separate search/dropdown pair. Matching buttons
  show the patient name and recorded patient ID; typing does not select or write.
  Matches load only after at least two trimmed characters are entered.
  The selected identity remains visible while catalogue searches change. An exact,
  active selected-patient identity is read independently of the first30 matches.
- Change patient requires an inline confirmation when items exist. Cancel retains
  the patient and all items. Confirm clears the patient and items while retaining
  invoice notes. Both actions leave financial records unchanged.
- Item type, contextual search and the item selector appear in that order. Service,
  package and saved-quote searches retain their existing backend eligibility and
  branch scope. An options failure exposes a scoped retry.
- Item rows show the name, price source and amount. Catalogue/quote versions and
  authorized Admin adjustments remain available in secondary disclosures. Zero is
  explicitly Free; an unknown package price still requires entry before saving.
- Empty-state guidance and Save draft requirements are visible. Exact cents,
  authoritative saved quotes, original source versions, package selling prices and
  the existing draft request payload remain unchanged. An actual Admin price
  change requires a reason; entering the original price does not.

The only new backend behavior is an additive, authorized `/options` identity
projection: list identities include `patientID`, and `selectedPatient` returns
only `id`, `name` and `patientID`. Blank selection remains compatible, missing or
archived identities return null, and nonempty IDs use existing validation. No
clinical details are projected. Backend bytes outside this read endpoint match
the pre-task snapshot.

Posting, collections, saved quote calculation, payment corrections, correction
history, package funding/usage safeguards, Clinic Sales and permission policy are
unchanged. Existing stale-response guards continue to reject obsolete scope
results. The pending correction-reload OR# preservation fix and unrelated
AppointmentForm/PatientProfile prefills remain intact.

Implementation files: `src/components/PosDashboard.tsx`, `backend/pos.ts`,
`scripts/test-pos-ui.ts`, `scripts/test-pos-api.ts`, this report and `ROADMAP.md`.
No other existing file changed during this refinement.

## Validation

Node22 checks passed:

- TypeScript and production build; existing bundle-size warnings remain.
- POS UI:59 controlled scenarios, preserving the42 prior scenarios and adding17
  for explicit patient selection, patient change/cancellation, identity hydration,
  contextual choices, missing/Free prices, adjustments, removal and stale replies.
  Native required-field behavior is covered for equal and changed prices.
- POS API:313 checks, including25 added identity/search/authorization checks.
- Payment-correction API:122; Treatment Ledger API:234; permissions API:210.
- Patient Billing Profile:9; protected invalidation:14; permission scope:227;
  exact-money/retry/POS-policy checks.
- Whitespace and the focused Impeccable detector passed. Independent finish review
  confirmed the adjustment-reason mismatch was repaired and reported no further
  finding within its requested scope.

Database suites used guarded, empty, disposable loopback PostgreSQL17 databases
with synthetic identities and records. They initialized/repeated the complete
001–009 chain and checked migration checksums. No migration, fixture, invoice or
payment was written to the normal local Vine database for this refinement.

A read-only synthetic browser preview bundled the exact current PosDashboard
component and production CSS, with mocked reads and rejected writes. Desktop and
narrow layouts were inspected (measured CSS widths1163 and354, respectively), with
no horizontal document overflow. Change patient → Keep current patient retained
the synthetic saved-quote item and price. Browser viewport settings were restored.
The tool recorded one source-less MutationObserver error during the earlier iframe
preview; the component rendered and the subsequent direct-page layout checks
completed. This is visual evidence, not live financial/ordinary-role browser
acceptance. No save, posting, payment or package mutation was performed in-browser.

Logs, baseline hashes and synthetic preview screenshots are outside Git at
`/private/tmp/vine-invoice-form-refinement/`. Vine was restarted on localhost3000
to load the additive read projection; PostgreSQL health and the app shell returned
200. Production and DARF were neither accessed nor changed.

## Required schema report

1. Additional schema change required: NO.
2. Committed migration chain:001–008 unchanged.
3. Local applied chain:001–009 was directly observed in the preceding correction
   implementation; migration metadata was not queried again in this task.
4. Production applied chain and live parity:UNVERIFIED and untouched.
5. New or modified migrations:none for this refinement. Pending009 remains intact.
6. Fresh validation:the guarded API suites initialized/repeated001–009 and checked
   checksums. Dedicated schema-shape comparison was not repeated here.
7. Upgrade validation:N/A for this refinement, with no schema transition. The
   preceding correction feature's008→009 retained-data evidence remains historical.
8. Existing-record compatibility:no backfill or stored-data rewrite. Identity
   fields are additive reads; existing IDs without a patient number remain usable.
   Saved financial terms, purchases and balances retain their existing semantics.
9. Production catch-up:unchanged. A separately authorized release must inspect the
   actual version and apply only missing committed migrations in order with
   compatible code.009 is pending/uncommitted and is not authorized for deployment.
10. Recovery:this UI/read-projection refinement can be reverted independently.
    Existing correction-aware recovery requirements still apply once reversals
    exist; older code that sums gross payments is not an acceptable rollback.
11. No schema change or new unexplained divergence was introduced. Live schema
    parity remains UNVERIFIED; local009 is the expected pending feature gap.

## Next step

Independent scoped commit-readiness review of the current candidate. Earlier
review patches/manifests predate the OR# repair and this form refinement and must
not be used to stage the current files. Preserve unrelated changes and review
the reconstructed scope before any separately authorized staging or commit.

## Search-only patient lookup — October24 local follow-up

The empty search previously requested the first30 active patients. The picker now
shows its two-character instruction until staff types at least two non-whitespace
characters. The API skips the patient-list SQL entirely for missing, blank,
whitespace or one-character searches. Matching remains literal, case-insensitive
and bounded to30 results. Selected-patient identity reads remain exact and work
independently with an empty search, including existing draft/Visit launches.

Clearing or shortening a query immediately hides previous matches. Existing
generation guards reject delayed successes and denials after a query is cleared.
No catalogue, saved quote, calculation, payment, package, history or permission
rule changed. Backend comparison confirms the only delta is the patient-list query
guard. Unrelated working files and the Git index remain unchanged.

Validation:65 controlled UI scenarios (six added) and338 guarded POS API checks
(25 added) passed, together with TypeScript, production build, POS policy, Patient
Billing Profile, protected invalidation and permission-scope suites. The API suite
initialized/repeated001–009 in a dedicated disposable loopback PostgreSQL17
database. A read-only independent finish check found no concrete issue.

Local browser verification confirmed an empty/focused field and one character
show no patient choices; a synthetic unmatched query shows the no-match message;
clearing returns to the instruction with no choices. No invoice, payment or other
business record was created. Vine was restarted on localhost3000 and health/app
responses returned200. Evidence is outside Git at
`/private/tmp/vine-invoice-patient-search-only/`. This limited control check does not
replace full financial or ordinary-role browser acceptance.

Follow-up schema report:
1. Additional schema change required:NO.
2. Committed migration chain:001–008 unchanged.
3. Local applied001–009 was previously observed; metadata was not queried here.
4. Production applied chain/parity:UNVERIFIED and untouched.
5. New or modified migrations:none; pending009 is unchanged.
6. Fresh validation:guarded POS API suite initialized/repeated001–009 and verified
   checksums. No new live development migration was run.
7. Upgrade validation:N/A for this change; no schema transition. Previous009
   retained-record upgrade evidence remains historical.
8. Existing records:no backfill, account migration or financial data rewrite.
9. Production catch-up:unchanged; inspect actual state and apply missing committed
   files only during a separately authorized compatible release.009 is uncommitted.
10. Recovery:this search guard can revert independently; existing correction-aware
    financial recovery requirements remain.
11. No schema change or new unexplained divergence introduced; live parity remains
    UNVERIFIED and local009 remains the expected pending feature/release gap.

No staging, commit, push, deployment, production or DARF action was performed.
