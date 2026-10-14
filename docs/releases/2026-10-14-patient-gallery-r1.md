# Patient Gallery R1 — local implementation

Implemented October 14, 2026 on HEADc0060e8. Local only; not staged or committed.
No push, deployment, production or DARF action.

Patient Profile → Gallery now supports saved-Visit Before/After/Progress uploads,
selection previews, date/time and area/caption, editing, protected downloads,
comparison and zoom. Every Visit upload path enforces four images, including
legacy/unclassified images. Other file limits/settings and all existing permissions
remain authoritative. Existing files/data and the separate pending Treatment Ledger
print-removal work are preserved. No new role or SQL migration.

## Validation

| Check | Result |
| --- | --- |
| Gallery policy/calendar/permission | 67 PASS |
| Gallery real HTTP | 114 PASS |
| Gallery protected transport | 177 PASS |
| Gallery actual React components | 179 PASS |
| Existing shared clinical/upload/audit HTTP | 142 PASS |
| Existing permission/branch/redaction/revocation HTTP | 210 PASS |
| Existing permission policy | 223 PASS |
| Existing permission scope | 227 PASS |
| Existing protected invalidation | 14 PASS |
| Existing medical-history UI | 35 PASS |
| Existing Treatment Ledger UI | 44 PASS |
| Existing chart UI | 71 PASS |
| Existing RBAC | PASS |
| TypeScript, build, whitespace | PASS |

Tests use synthetic records, controlled component/transport responses or guarded
separate disposable loopback databases. Expected denial/conflict/interrupted-save
cases intentionally exercise error responses. The build's preexisting large-bundle
warning remains; it is not a build failure.

Independent source review found and regression tests repaired two local overlay
issues: a local upload overriding newer saved metadata, and an acknowledged local
upload reappearing after another tab's deletion. Uncertain upload retries require a
saved-photo reload, and existing total-file/format/size settings now constrain the
Gallery rather than merely relying on a server rejection.

## Browser evidence

Supported browser automation used the retained normal development Support session
against localhost3000, with owned synthetic PNG patterns only. Actual filechooser
selection/upload, optimization, protected preview, caption edit and removal passed.
Four images at one Visit produced4/4, zero remaining and disabled selection.
Comparison across two Visits and Zoom150% passed. Desktop side-by-side and mobile
stacked comparison were visually inspected; overlays stay in front of the patient
profile/sidebar. Temporary viewport overrides were reset. All five test uploads
were removed through the authenticated Gallery; the preexisting synthetic patient
and Visits were retained. No existing non-test photos or user roles were changed.

The native walkthrough used Support. Nurse/Medical Staff/restricted-branch behavior
is verified by real synthetic HTTP and component tests; fresh interactive restricted
Google identity testing is not claimed. Native OS dialogs/physical printing are not
part of Gallery R1. Temporary images/screenshots/logs/configuration/evidence remain
outside Git under `/private/tmp/vine-gallery-r1-ukl9nyh3/`.

## Mandatory schema report

1. Schema change required: NO; optional attachment metadata uses existing JSONB.
2. Committed migration chain:001–005, unchanged.
3. Local applied: directly observed001–005; every checksum matches source.
4. Production applied: UNVERIFIED in this task; production was not contacted.
5. New migrations: none; none run on main development or production.
6. Fresh database: existing001–005 applied/verified in guarded Gallery/parity/
   permission test databases; no Gallery-specific schema added.
7. Upgrade path: N/A for this additive JSONB/UI change; no new migration.
8. Existing-record compatibility: old images/documents remain readable, old
   attribution/IDs/paths/notes are retained, over-limit Visits are not rewritten,
   legacy classification is explicit and unrelated workflows regressions pass.
9. Production catch-up: inspect the actual deployed version during a separately
   authorized release; apply only missing committed migrations in order. Do not
   infer the current production version from old reports.
10. Recovery/rollback: preserve private files and JSONB attachment metadata;
    code rollback restores older UI/API behavior without deleting new records.
    Gallery metadata/cap enforcement requires the updated upload-serving code.
11. Unexplained schema divergence: production structural parity UNVERIFIED; no
    migration drift/change observed locally. A pending release gap is not drift.

Next: independent scoped commit-readiness review of Gallery R1. No staging, commit
or complete browser/production acceptance is implied by this evidence.

## Follow-up: three independent P2 findings repaired locally

The subsequent scoped review reproduced three additional cases. These are repaired
without changing the server, permission rules, database schema or other workflows:

- A saved photo observed and deleted while its upload response was pending no
  longer reappears when that response arrives. Acknowledgement history is retained
  for the protected workspace and local upload overlays yield to it.
- Deleting the last photo on a later page, receiving its deletion through the
  parent list, or editing it out of a label filter immediately shows the remaining
  valid page; the paginator cannot leave a hidden set of twelve photos.
- The existing Visit-file selector permits PDF-only additions to Visits with more
  than four historical photos when the configured overall file allowance permits
  them. It continues rejecting new images over the photo cap and respecting
  explicit permission denials and overall file limits.

Eleven new actual-component scenarios cover these cases and their file-limit,
image-cap and denial controls. Before the source repairs, five targeted scenarios
failed while all179 earlier Gallery scenarios passed. After repair,190/190 pass.
Three additional real HTTP checks verify a permitted legacy PDF upload, retention
of every existing image/metadata entry and continued rejection of a further image.
The shared form harness's new document/permission bridge is opt-in and used only
to exercise the actual Visit attachment selector in these tests.

The repaired **HEAD + Gallery-only** reconstruction preserves committed Ledger
printing and excludes the separate pending print-removal work. Validation:

| Check | Result |
| --- | --- |
| Gallery policy | 67 PASS |
| Gallery HTTP/concurrency/branch/legacy | 117 PASS |
| Gallery protected transport | 177 PASS |
| Gallery actual components, including selector regressions | 190 PASS |
| Shared clinical/upload/audit HTTP | 142 PASS |
| Permission/branch/redaction/revocation HTTP | 210 PASS |
| Permission policy / scope | 223 / 227 PASS |
| Protected invalidation | 14 PASS |
| Medical-history / chart UI | 35 / 71 PASS |
| Committed Ledger UI / saved-print structure | 45 / 19 PASS |
| RBAC, TypeScript, production build, whitespace | PASS |
| Existing localhost3000 shell / health | HTTP200 / HTTP200 |

The existing build chunk warning remains. These are automated checks; no new
native-browser, restricted Google-login or print-media acceptance is claimed.

Schema change required: NO. Committed/local001–005 were rechecked with matching
checksums. The unchanged full chain was initialized, reapplied idempotently and
verified in a fresh disposable local test database. Gallery upgrade migration:
N/A. Retained synthetic legacy records pass; no data backfill or main-development
migration was run. Production applied version/structural parity remains UNVERIFIED;
production was not contacted. Catch-up and rollback rules in the schema report
above remain unchanged. No unexplained local migration discrepancy was found.

HEAD/index and unrelated working files/environment remain preserved. No staging,
commit, push, deployment, production or DARF action. Repair evidence and logs:
`/private/tmp/vine-gallery-repair-phe4_t8r/`. Next: renewed independent scoped
commit-readiness review of the repaired candidate.
