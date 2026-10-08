# Services 1A schema and migration

`migrations/003_services.sql` adds exactly three tables using the existing numbered,
SHA-256 checksummed migration runner. Applied migrations are immutable. No JSONB
collection is normalized, renamed or rewritten. No catalogue seed is included.

| Table | Main fields and constraints |
| --- | --- |
| service_categories | UUID primary key; 1–80 character name; global normalized unique expression index, including inactive rows; active; positive version; created/updated timestamps and text actor IDs |
| services | UUID primary key; 1–120 character global normalized unique name; optional category FK with RESTRICT; description ≤2,000 characters; integer duration 1–1,440 minutes; nullable numeric(12,2) standard_price; active; positive version; attribution/timestamps |
| service_branch_settings | UUID primary key; service FK with RESTRICT; unique(service_id, branch_id); fixed branches collection path; composite branch FK with RESTRICT; available default false; nullable numeric(12,2) override; attribution/timestamps |

Migration 004 replaces the original name indexes with `services_normalized_name(name)`.
The immutable function applies `lower(btrim(regexp_replace(name, <whitespace>+, ' ', 'g')))`: collapse before trim, then lowercase. Its explicit whitespace class matches JavaScript `trim()`/`\s` (tabs/newlines, spaces, NBSP, Unicode separators and BOM). Both tables use exactly the same function for uniqueness and new nonblank checks; original length constraints remain. API input also trims/collapses whitespace; names remain reserved when inactive. Category
selection is optional. Existing associations with inactive categories remain
readable; new inactive category associations are rejected by the API.

## Branch FK verified

The actual development `app_records` has PRIMARY KEY(collection_path, id), both
text NOT NULL, and the expected JSON-object check. The migration therefore uses:

```sql
branch_collection_path text NOT NULL DEFAULT 'branches'
  CHECK (branch_collection_path = 'branches'),
FOREIGN KEY (branch_collection_path, branch_id)
  REFERENCES app_records(collection_path, id) ON DELETE RESTRICT
```

A patient or other collection sharing a branch ID cannot satisfy this FK. Existing
branch storage stays in app_records. The branch deletion API checks for service
settings and directs the user to deactivate the branch instead. PostgreSQL also
rejects deletion of a referenced branch. No cascading deletion is introduced.

## Money, availability and versions

Positive decimals represent priced services; zero represents an explicit Free
choice; standard null means Not configured; override null means inherit. API
amounts must be decimal strings with at most two decimal places. Inputs are
validated in integer minor units before SQL, so API writes never silently round.
SQL numeric scale itself is not an input-intent validator: direct administrative
SQL can apply PostgreSQL numeric rounding. Finite nonnegative range checks reject
negative, NaN and Infinity values. API price modes must be used for app writes.

Operational availability requires active service, Active branch, existing setting
and available=true. Missing settings are unavailable and are not auto-created.
Inactive branches cannot be newly enabled; previously enabled settings can be
retained, with operational availability false. Duration has no branch override.

Canonical or submitted branch changes advance the parent service version once.
No-op edits do not advance it. Every PATCH requires expectedVersion; stale requests
return 409 before writes. Categories have equivalent version checks. Changes and
existing JSONB audit writes share the same PostgreSQL transaction, including the
existing transaction advisory lock. No new audit table or price-history table.
Actor text IDs deliberately reference existing authenticated identities by value;
users are not normalized and no new user FK is invented.

## Rehearsal and rollout boundary

Rehearsed on empty disposable PostgreSQL 17 and synthetic legacy JSONB records;
legacy content/timestamps remain unchanged and migration replay is checksummed.
Applied to the isolated development database only. All app_records were compared
before/after migration; no record content changed. No production application.

There is no down migration: do not drop these tables after records are in use.
For an eventual release, review the exact source/migration set, rehearse on staging
and use the existing backup/recovery process. Production rollout requires its own
explicit task. Clinical service selection/snapshots belong to Services 1B.

## Forward correction: 004_services_name_identity.sql

Migration 003 is immutable and unchanged (SHA-256
`7c1f6534769aa22b6a7bb2a0db99c22acb0c77dafb210c83b24f237493aca77c`).
004 locks both name-bearing tables, checks normalized collisions and whitespace-only
names, and raises an exception before replacing indexes if any are found. The runner
rolls back the whole migration, including its function and checksum entry. It never
merges/deletes records or updates display names. Resolve conflicts through an explicit
reviewed data-correction task before retrying; no automatic repair is included.

Run `npm run test:services-migration` only against a fresh disposable loopback
`vine_services_migration_test` database with `ALLOW_TEST_DATABASE=yes`. It verifies
001→004, existing 003 upgrades, valid displays, whitespace/case uniqueness, nonblank
checks, collision rollback, unchanged JSONB and immutable 003/004 checksum behavior.
The fixture teardown drops only Services tables in that specifically guarded test
database; never run this suite against shared development or production.

004 is now applied to the inspected empty local development catalogue. The before/after
JSONB snapshot hash and 003 checksum matched; no production migration occurred.
