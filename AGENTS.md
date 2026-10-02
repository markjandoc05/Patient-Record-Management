# Vine development instructions

Before feature work, read DEVELOPMENT.md, ROADMAP.md, DEPLOYMENT.md and relevant
release notes/code. Preserve existing operational workflows and unrelated working
tree changes. Audit before changing behavior; do not invent clinical, financial,
stock or authorization rules.

## Standing database architecture rule

Read and follow [the complete user-approved database rule](docs/architecture/database-schema-parity.md)
for every feature. Local PostgreSQL 17 and production PostgreSQL 17 share one
application codebase, database design and committed, checksummed migration history.
Instances, credentials, configuration and records remain separate. Normal development
uses local PostgreSQL and synthetic data only; never copy production records or
automatically seed fixtures on startup.

- First assess schema need, current baseline/next number, additive compatibility,
  old-record loading, backfill, old/new application coexistence and recovery.
- Never change an applied migration, bypass migrations with manual DDL/ORM schema
  sync, maintain environment-specific schema designs or make fixtures migrations.
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
one immutable migration chain. Never force a production update merely for parity.

## Mandatory feature report

1. Schema change required: YES / NO.
2. Current committed migration baseline.
3. New migrations, if any.
4. Fresh-database migration result.
5. Upgrade-from-previous-schema result.
6. Existing-record compatibility.
7. Local schema status (observed versus unverified).
8. Production schema compatibility assessment (observed versus unverified).
9. Whether production migration is required.
10. Rollback/recovery implications.
11. Confirmation of one shared migration history; identify any pending version gap.

Use N/A for genuinely inapplicable checks and UNVERIFIED for checks not performed.
Do not substitute build success for workflow or schema-parity evidence. Interactive
development uses the existing markjandoc@gmail.com Support / Developer identity;
automated ordinary-role checks use disposable synthetic identities.
