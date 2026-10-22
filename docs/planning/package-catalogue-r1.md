# Package Catalogue R1

Approved October 22, 2026. Local implementation only; no commit, push,
deployment or production access is authorized by this work.

Services → Packages manages reusable definitions. Patient Profile → Treatment
Ledger → Record purchase adds a Catalogue package source alongside the existing
Manual package source. Both keep purchase clinic/date, patient-specific notes,
Admin OR#, existing actor/branch authority and the current Visit usage workflow.
There are no prices/payments, expiry, reservations, package-specific branch rules,
multi-Service Visit redemptions, new roles or Ledger print action in this release.

Package viewing requires packages.view and services.view. Management additionally
requires packages.manage (administrative defaults; explicit Module Access grants
and denials remain authoritative). These grants do not confer global branch
scope or ledger/accounting/clinical authority. Existing Ledger purchase/read
capabilities remain required. Eligible purchase lists require an authorized clinic
and contain no branch-price amounts. Every included Service must be active,
available, priced or explicitly Free at purchase. Current Service and package
versions are checked again in the same transaction as the purchase.

Each catalogue mutation creates the next immutable version, including activation
changes. Name, description, Service identities/snapshots, session allowances,
author and timestamp remain historical. Definitions use 1–20 distinct Services
and 1–10,000 whole sessions per Service, matching existing purchase limits.
Stable command IDs protect create/edit retries. Retained inactive Services can
appear in definitions/history; they cannot authorize new catalogue purchases.

Catalogue purchases send only a package/version reference and reviewed Service
versions with purchase metadata. The server supplies the name and allowances.
Overrides of catalogue contents are rejected; custom terms use the explicit
manual path. Purchase retries replay the original command before resolving the
current catalogue, retaining successful purchases after later catalogue changes.
Existing session events/balance rules/redemptions remain unchanged.

Migration 006 adds catalogue roots, sealed immutable revisions/lines and nullable
purchase references. Existing purchase rows get NULL references; no historical
events, terms, balances or Visit bindings are rewritten or backfilled. Applied
001–005 bytes must remain unchanged. Validate fresh 001–006 and retained-record
005→006 on guarded disposable local PostgreSQL before applying locally. Production
was last verified at 005 on October 17; current production is not inspected here.
Older code can retain the additive columns but cannot manage catalogue versions;
rollback must preserve all version rows and purchase links.

## Direction contract

THESIS: Extend the existing Services list and Ledger purchase form with reusable
package terms, keeping the patient's remaining sessions as the operating record.

OWN-WORLD: Inherit Vine's teal actions, slate text, white forms, existing labels,
rounded borders, native selects, focus rings and responsive spacing.

STORY: Admin defines a version; staff selects and reviews its contents; the saved
patient purchase freezes those terms. Manual entry remains explicit and available.

FIRST VIEWPORT: Services/Packages navigation, searchable package rows with status,
version and included sessions; the Admin create action stays in the list header.
The existing Ledger form gains a source selector and a read-only package preview.

FORM: Precisely scoped extension, code-led, no concept seed or visual-world change.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
