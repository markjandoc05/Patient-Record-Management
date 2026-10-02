# Standing Vine database architecture rule

Adopted October 2, 2026 from the user's explicit instruction.

## Latest direct verification — October 2, 2026

**Not at parity:** local PostgreSQL 17.11 has committed migrations 001–004;
production PostgreSQL 17.11 has 001–002. Shared checksums and platform/auth schema
match. Production is missing Services tables/constraints/indexes and the 004 name
normalization function. This is a known pending migration gap, with no unexplained
manual structural drift found in the inspected scope. Neither database was modified.
See [the factual read-only report and evidence](schema-parity-2026-10-02.md).
Do not mark full parity verified or apply production migrations automatically.

Apply this rule to all future Vine development.

## Permanent database rule

Local development and production must always use the **same database schema and the same committed migration history**.

Local PostgreSQL must accurately represent the production schema structure.

The databases may contain different data, but they must not evolve into different database designs.

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

Current production/local history:

`001 → 002 → 003 → 004`

If a new feature needs schema changes:

Create:

`005_feature_name.sql`

Both environments eventually become:

`001 → 002 → 003 → 004 → 005`

Do not create one schema for local and another for production.

## Never do these

Do not:

- manually add a local column/table without a migration;
- manually modify production schema without recording the change in migrations;
- edit migration 001/002/003/etc. after it has been applied and checksummed;
- maintain local-only production-schema changes;
- maintain production-only schema changes;
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
- apply only missing committed migrations;
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

If production inspection is not authorized or available, state that parity is expected from committed migration history but remains unverified.

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
2. Current migration baseline
3. New migration(s), if any
4. Fresh-database migration result
5. Upgrade-from-previous-schema result
6. Existing-record compatibility
7. Local schema status
8. Production schema compatibility assessment
9. Whether production migration is required
10. Rollback/recovery implications
11. Confirmation local and production still share one migration history

Treat this as a standing architecture rule for all Vine development.
