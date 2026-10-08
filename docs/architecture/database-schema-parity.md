# Standing Vine database architecture rule

Adopted and refined October 2, 2026 from the user's explicit instructions.

## Latest direct verification — October 2, 2026

**Expected pending release gap:** local PostgreSQL 17.11 is at migration 004;
production PostgreSQL 17.11 is at migration 002. The committed chain is
001 → 002 → 003 → 004. All shared/applied checksums match committed source.
Migrations 003 and 004 are pending the Services 1A production release. Production
Services tables and name-normalization structures are not yet available. No
unexplained/manual structural drift was found in the inspected scope.
Neither database was modified. This is a verified version baseline, not a claim
that both environments currently have identical applied schemas.
See [the factual read-only report and evidence](schema-parity-2026-10-02.md).
The release gap does not block Services 1B-A or other local development against
the committed target schema. Production compatibility still requires assessment;
production migration remains separately reviewed and authorized.

Apply this rule to all future Vine development.

## Permanent database rule

Vine local development and production must share one immutable, ordered migration
history. Local development represents the target schema of the application version
currently being developed. Production represents the schema of the application
version currently deployed. Local may therefore be ahead of production while an
unreleased feature is under development. Production catches up only through the
exact same committed migrations, in order, during a separately reviewed and
authorized deployment. Different current applied migration numbers are allowed;
different migration histories or unexplained schema changes are not.

## Environment model

### Local Development
- Vine on localhost
- local PostgreSQL 17
- synthetic/test records only
- used for feature development and validation

### Production
- `https://app.vineaesthetics.com`
- production PostgreSQL 17
- real clinic records
- production credentials/configuration

Local and production use:
- the same application codebase;
- the same migration files;
- the same schema evolution rules;
- the same backend/domain assumptions.

They use different:
- database instances;
- credentials;
- records/data;
- environment configuration.

## Schema changes

Whenever a feature requires a database change:

1. Create a **new numbered forward migration**.
2. Never modify an already-applied/checksummed migration.
3. Apply the new migration locally first.
4. Validate it from:
   - a fresh database using the complete migration chain;
   - the immediately previous schema version upgrading forward.
5. Confirm existing records remain compatible.
6. Confirm the application works against the upgraded schema.
7. Commit the migration with the feature.
8. Use that exact committed migration later for production deployment.

Example:

Committed history:

`001 → 002 → 003 → 004`

During Services development, local is 001 → 002 → 003 → 004 while production is
001 → 002. This is an expected pending release gap. After the authorized Services
release, both may be at 001 → 002 → 003 → 004.

If a new feature needs schema changes:

Create:

`005_feature_name.sql`

Local may reach 001 → 002 → 003 → 004 → 005 while production remains at 002.
When an approved compatible application release and migration/recovery plan are
deployed, production must apply every missing committed migration in order:

`003 → 004 → 005`

Both environments then reach:

`001 → 002 → 003 → 004 → 005`

Do not construct a final schema manually or skip intermediate migrations.

## Never do these

Do not:

- manually add a local column/table without a migration;
- manually modify production schema without recording the change in migrations;
- edit migration 001/002/003/etc. after it has been applied and checksummed;
- use different migration files or histories for local and production;
- skip or reorder migrations;
- create fake catch-up migrations duplicating existing committed migrations;
- silently resolve unexplained schema drift;
- copy local synthetic records into production;
- use production patient/clinical data for normal local development;
- synchronize databases by copying full database contents;
- let test fixtures become schema migrations;
- use automatic ORM schema synchronization that bypasses the migration history.

## Forward corrections

If an existing migration has a defect after it has already been applied:

Do NOT edit the old migration.

Create a new forward correction.

Example:

`004_services_name_identity.sql`

rather than rewriting:

`003_services.sql`

Preserve old migration checksums.

## Before implementing each feature

First answer:

1. Does this feature require a schema change?
2. If yes, what is the next migration number?
3. Can the change be additive/backward-compatible?
4. Will existing production records still load?
5. Does any data require safe backfill?
6. Can old application behavior coexist temporarily with the new schema?
7. What happens if deployment must be rolled back?

Do not introduce schema changes unless the feature actually needs them.

## Feature validation

For every feature involving database changes, validate:

### Fresh database
Run every migration from 001 through the newest migration.

Expected:
- all migrations apply;
- checksums pass;
- final schema matches expectations.

### Upgrade database
Start from the previous committed schema and apply only the new migration(s).

When production is further behind, also plan/validate its complete ordered catch-up
path using disposable synthetic data before the authorized release. For example,
production 002 to target 005 must use committed 003 → 004 → 005, not a fake shortcut.

Expected:
- existing records remain;
- migration succeeds;
- constraints/indexes are valid;
- feature works.

### Regression
Verify unrelated workflows continue working.

## Production deployment rule

Production migration is a separate authorized release step.

Before production:

- review migration;
- check backup/recovery implications;
- confirm current production migration version;
- apply every missing committed migration in order, only with the approved compatible application release and migration/recovery plan;
- deploy compatible application version;
- verify production health;
- verify affected workflow.

Never automatically deploy just because local migration succeeded.

## Schema parity check

Whenever practical, provide a schema-parity check that confirms:

- local migration version;
- production migration version;
- expected migration files/checksums;
- no unknown/manual schema divergence.

Do not modify production merely to perform the check.

Distinguish an expected pending release gap (different deployed/development
versions on one immutable chain) from unexplained schema drift (objects or
definitions not accounted for by that chain). When inspection is unavailable,
report the applied versions and structural status as unverified; never infer
production catch-up from committed source files alone.

## Synthetic data

Keep data separate from schema.

Migrations:
- tables;
- columns;
- constraints;
- indexes;
- required structural transformations.

Development fixtures:
- test branches;
- test users;
- synthetic patients;
- appointments;
- services;
- stock;
- invoices.

Fixtures must never be required in production unless separately designed as legitimate reference/seed data.

## Existing JSONB compatibility

Vine currently retains some legacy records in PostgreSQL JSONB.

Do not normalize the whole application merely to achieve schema parity.

When a new high-integrity workflow requires relational structures:

- add them through migrations;
- preserve existing records;
- adopt new structures gradually;
- keep compatibility paths until migration is proven;
- retire old structures only in a later reviewed release.

## Required report for every future Vine feature

Whenever a feature is implemented, report:

1. Schema change required: YES / NO
2. Committed migration chain
3. Local applied migration
4. Production applied migration
5. New migration(s), if any
6. Fresh-database validation
7. Upgrade-path validation
8. Existing-record compatibility
9. Production catch-up migrations required
10. Recovery/rollback implications
11. Whether any unexplained schema divergence exists

Use N/A for inapplicable checks and UNVERIFIED for checks not performed. Do not
present the expected pending release gap as unexplained drift. Services 1B and
other local features may proceed against the committed local target schema;
consider the deployed production baseline and upgrade path for every release.

Treat this as a standing architecture rule for all Vine development.
