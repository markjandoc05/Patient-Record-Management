# Patient Profile Treatment Ledger R1

Approved October 14, 2026; implemented locally on `bb3504078fdc20fcb16132847df2dffb5981007f` with the existing uncommitted Clinical Records R1 slice preserved. Operate surface: extend Vine's existing labelled teal/slate patient profile; remaining sessions lead, purchases follow, transaction history stays below. A dedicated Treatment Ledger tab preserves Visits and Clinical Charts.

## Scope and workflow

Authorized Staff, Manager and administrative accounts record a patient-owned package name, calendar purchase date, purchase branch, optional notes, and one to twenty distinct canonical Services with positive whole session allowances. This is manual purchase recording, not an invoice/payment confirmation. Admin and existing guarded development Support access may set an optional text OR#; leading zeros remain intact. Existing medical staff Visit permissions do not grant accounting reference authority.

Snapshots preserve the originally purchased Service name/catalogue version and allotted counts. Package definitions, expiry, reservations, billing, payments/refunds and inventory consumption are deferred. No prices are copied into purchases, Visit usage, export or statement.

User-selected policy: sessions can be used at any authorized branch. A Visit's branch must be authorized for the actor and the performed Service must remain currently active, available and priced or Free there. Purchase branch equality and permission to edit the original purchase are not required for redemption. Patient-owned lines cannot be applied to another patient or a different performed Service.

In the existing Visit form, explicitly select Use package sessions, select the owned line, and enter sessions (default one). Treatment time comes from the Visit's saved local date/time; the usage captures the clinic timezone. The recorder's server timestamp is a separate instant. No automatic deduction occurs merely because a Visit is Completed, edited, archived, restored or printed. Existing Doctor ownership, Nurse/Medical Staff designation, branch access, provider/conflict, clinical and archive workflows remain authoritative.

## Storage and consistency

New forward migration `005_treatment_ledger.sql` adds purchases, Service lines, immutable events and active Visit-usage bindings. Existing JSONB Patient/Appointment/Visit records and migrations 001–004 are not rewritten or backfilled. Foreign keys protect patient, branch, Service, purchase/line and active Visit references. A deferred Visit foreign key permits usage and queued new Visit creation to commit together. Immutable history triggers reject event mutation/deletion and unversioned package/line changes. Line row locks and a balance trigger reject mismatched ownership, negative/excessive balances and incorrect after-transaction snapshots.

Balance = purchased sessions + signed adjustments - net usage (usage minus reversals). Each usage/adjustment/reversal freezes its resulting balance. Metadata changes preserve before/after notes and OR values inside the protected ledger, while the initial purchase event preserves original terms. General audit events contain identifiers/field names, not clinical narratives, OR contents or reasons.

Every command uses a stable UUID and normalized content hash. Same actor/content retries return the existing result; changed actor/content conflicts. Metadata and line writes require current versions. A Visit permits one active canonical-Service redemption; unrelated edits omit usage and retain it. Changing its patient, Service snapshots, branch, time or performance attribution requires explicit authorized reversal first. Usage reversals and adjustments require a nonblank reason and current line/usage versions, preserving the original event. Archived Visit corrections remain explicit; archived patient ledger mutations are denied.

Opt-in Visit creation carries a stable `clientVisitId` and full submitted-intent fingerprint. An identical retry does not create another Visit, appointment completion, counter increment or session event. Current rights and patient state are rechecked. A superseded saved clinical record conflicts instead of acknowledging an old draft. Existing Visits without retry IDs or session usage continue through their previous contract.

## Authority and protected data

New capabilities: `treatment_ledger.view` defaults to existing roles; purchase defaults to Staff/Manager/administrative accounts; adjustments default to administrative accounts; OR reference is restricted to actual administrative roles even if another role is explicitly granted that capability. All ledger access additionally requires patient, Visit and clinical viewing. Effective denials and guarded development-only Support checks remain enforced under current transaction authorization.

Ledger balances and treatment facts use the existing shared patient/longitudinal clinical continuity model to support cross-branch redemption. Directory/configuration lists include only authorized branches. Purchase notes, OR values and metadata changes are redacted outside their origin branch; edits/adjustments require origin-branch scope. Reversal also requires the usage branch. Existing appointment/Visit writes and Service branch prices retain their independent restrictions.

Components and adapters use keyed patient/account/permission lifetimes, current permission-mirror checks, abort signals and protected-data invalidation before publishing data or processing delayed denials. Pending forms are disabled. Uncertain commands retain their original ID/version; Print/Export cannot unlock or refresh an uncertain adjustment into a second command. Inspection reload explicitly discards its editor. Persisted Visit bindings lock during lookup and failed lookup until current state is confirmed.

## Presentation and export

Remaining/used/purchased/adjusted counts appear per package Service. History retains treatment time, recorded time, actor, clinic, performer/assisting names, reason and resulting balance. Literal Visit wall-clock times display using their captured timezone without device-zone shifts. Saved JSON exports include timezone/team facts and exclude Visit diagnoses/narratives. Printing refreshes the server-authorized saved snapshot, mounts it outside clipped profile drawers, and isolates it with scoped print CSS. Print is a customer session statement, not an official receipt or signed Visit. Chart signing remains separate; no dental maps.

## Validation and release

See the release report for actual check results, schema report and browser limits. Preserve the separately reviewed Clinical Records R1 hunks and existing roadmap/evidence assets. No staging, commit, push, production migration or deployment is authorized by this local implementation.
