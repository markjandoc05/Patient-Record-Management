# Vine development instructions

Before feature work, read DEVELOPMENT.md, ROADMAP.md, DEPLOYMENT.md and relevant
release notes/code. Preserve existing operational workflows and unrelated working
tree changes. Audit before changing behavior; do not invent clinical, financial,
stock or authorization rules.

## Standing database architecture rule

Read and follow [the complete user-approved database rule](docs/architecture/database-schema-parity.md)
for every feature. Local PostgreSQL 17 and production PostgreSQL 17 share one
application codebase and one immutable, ordered, committed/checksummed migration
history. Local represents the target schema of the version being developed;
production represents the schema of the version deployed. An unreleased feature
may put local ahead; production catches up only through the same committed files
in order during a separately reviewed and authorized compatible deployment.
Instances, credentials, configuration and records remain separate. Normal development
uses local PostgreSQL and synthetic data only; never copy production records or
automatically seed fixtures on startup.

- First assess schema need, current baseline/next number, additive compatibility,
  old-record loading, backfill, old/new application coexistence and recovery.
- Never change an applied migration, bypass migrations with manual DDL/ORM schema
  sync, maintain environment-specific schema designs or make fixtures migrations.
- Never skip/reorder migrations, create fake catch-up migrations duplicating
  committed files, or silently correct unexplained schema drift.
- Use a new numbered forward correction for defects in applied migrations.
- Validate fresh complete-chain initialization and upgrade from the immediately
  previous committed schema with retained synthetic records, plus feature/regression
  checks. Integration databases must be disposable and satisfy test guards.
- Preserve existing JSONB where adequate; normalize only workflows that need it.
- Commit reviewed migrations with their feature only when committing is authorized.
  No commit, push or production deployment is implied by local testing.
- Production migrations are a separately authorized release step: inspect current
  version, assess backup/recovery, apply only missing committed migrations, deploy
  compatible code, and verify health/workflow. Never modify production for an audit.
- Check migration versions/checksums and actual schema divergence when authorized
  and available; otherwise explicitly report parity as unverified.

Local-first migration testing can temporarily place local development ahead of the
deployed production version. Report this pending release explicitly; both still use
one immutable migration chain. Classify this as an expected pending release gap,
not unexplained schema drift. Never force a production update merely for parity.
Verified October 2 baseline: committed/local 001–004, production 001–002; matching
shared/applied checksums, no unexplained manual drift found. Services 1A is not
deployed; production Services tables are not available. Services 1B-A may proceed
locally with production compatibility and ordered catch-up considered.

## Mandatory feature report

1. Schema change required: YES / NO.
2. Committed migration chain.
3. Local applied migration (observed versus unverified).
4. Production applied migration (observed versus unverified).
5. New migrations, if any.
6. Fresh-database validation.
7. Upgrade-path validation.
8. Existing-record compatibility.
9. Production catch-up migrations required.
10. Recovery/rollback implications.
11. Whether any unexplained schema divergence exists.

Use N/A for genuinely inapplicable checks and UNVERIFIED for checks not performed.
Do not substitute build success for workflow or schema-parity evidence. Interactive
development uses the existing markjandoc@gmail.com Support / Developer identity;
automated ordinary-role checks use disposable synthetic identities.
