# Legacy UI cleanup — local only

Implemented on `f3a685a8bda3e6bb542f573e22b101b7a8e9a987` without staging,
commit, push, deployment, production or DARF changes.

## Presentation changes

- Both supported Support identifiers display as Support / Developer in ordinary
  screens. Existing lowercase identifiers retain their stored value and selection
  in account administration, with an existing-account label and older-role hint.
  That identifier is no longer offered for new UI assignments. No account is
  converted, and all backend compatibility/authorization guards remain unchanged.
- The read-only role reference presents one Support row. The compatibility entry
  remains in RBAC; identical grants and separate development guards are preserved.
- Existing meaningful treatment text is labelled Previously recorded treatment.
  Empty/whitespace-only fields and text duplicating the saved canonical Service
  snapshot are hidden. Visibility uses the original saved record, so explicitly
  clearing an editable historical field does not make it disappear mid-edit.
  Hidden values remain in form state/payload unchanged; distinct historical text,
  Visit history and existing read-only/sealed rules are retained.
- Older Gallery photos display Label not recorded. The existing `unclassified`
  filter value and all saved metadata remain unchanged; no classification is
  inferred or written.
- Branding fallbacks and sample placeholders use Vine terminology. Stored branding
  values are not rewritten. The upload description omits obsolete deployment
  wording; upload settings/optimization are unchanged. No feature menus were
  removed without evidence that their workflows are unused.

## Scope

Source: `src/rbac.ts` (display helper only), `src/App.tsx`,
`src/components/UserRoleSelect.tsx`, `src/components/AdminSettings.tsx`,
`src/components/VisitForm.tsx`, `src/components/PatientGallery.tsx`.
Tests: `scripts/test-support-role-selector.ts`, `scripts/test-visit-services-ui.ts`,
`scripts/test-patient-gallery-ui.ts`. This release note is the tenth scoped path.

The earlier Visits Clear filters alignment and pending Treatment Ledger print
removal remain separate, unchanged working-tree changes. Backend/API permission
rules, migration files and local ignored environment files are unchanged.

## Validation

The isolated HEAD + cleanup reconstruction excludes unrelated work and passes:

| Check | Result |
| --- | --- |
| Support selector/round-trip/development guard | 41 PASS |
| Visit Services/form/history/scope and new preservation cases | 179 PASS |
| Gallery components/data preservation/scope | 190 PASS |
| Appointment/Visit performer components | 63 PASS |
| Chart components | 71 PASS |
| Permission policy / permission scope | 223 / 227 PASS |
| Protected invalidation | 14 PASS |
| Real HTTP access/branch/redaction/revocation | 210 PASS |
| RBAC | PASS |
| TypeScript / production build / whitespace | PASS |

1,218 scenarios pass, plus RBAC. The preexisting build chunk warning remains.
Additional role rendering cases cover no new lowercase-role choices for either
Support actor in development/production, unchanged existing selection and both
display labels. Five new Visit cases cover empty/whitespace values, duplicate
snapshots, distinct read-only historical text and explicit clearing without losing
the editor. Existing Gallery preservation checks now expect the clearer wording.

A separate supported browser tab used the retained normal local Support session.
Vine defaults appeared, the new-assignment dropdown excluded the old identifier,
the role reference contained one Support row, and desktop/mobile account settings
had no page overflow. Sample-clinic placeholders and obsolete upload-platform copy
were absent. No role, branch, designation, branding or historical record changes
were saved. Viewport overrides were reset and only the check tab was closed.
Existing older accounts and historical/photo cases use synthetic component/HTTP
evidence; fresh restricted-role Google login is not claimed.

## Mandatory schema report

1. Schema change required: NO; presentation and form visibility only.
2. Committed migration chain:001–005 unchanged.
3. Local applied: directly observed001–005 with matching checksums, read-only.
4. Production applied: UNVERIFIED; production was not contacted.
5. New migrations: none. No main-development migration or account conversion.
6. Fresh-database validation: N/A for this presentation-only change; no new schema
   or migration. The existing chain is validated by the guarded permission suite.
7. Upgrade path: N/A; no DDL, data backfill or account migration.
8. Compatibility: both role identifiers/grants persist; hidden form values, saved
   Service snapshots, historical text/photos and configured branding are retained.
9. Production catch-up: no new migration introduced; inspect actual deployed state
   during a separately authorized release and apply only missing committed files.
10. Rollback/recovery: revert UI code without changing any record/schema; no data
    recovery needed for the cleanup. Compatibility/security rules stay in place.
11. Divergence: local migration checksums match; production structural parity is
    UNVERIFIED. A pending release gap is not unexplained drift.

HEAD/index, unrelated files and ignored environment hashes remain preserved.
Evidence is outside Git under `/private/tmp/vine-legacy-ui-j__250ra/`.
Next: independent scoped commit-readiness review; no commit is authorized yet.
