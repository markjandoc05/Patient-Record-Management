# Vine development

## Hybrid access-control local checks — October 3

Read [the capability/default map](docs/architecture/hybrid-access-control.md) before changing authorization. `users.manage` edits operational user details; `access.manage` governs security policy and remains Administrator/guarded Support only. Clinical redaction is server-side; initial Staff/Manager clinical-view defaults are preserved. Own-profile polling discovers changed access, then clears protected data and rejects old responses.

Run `npm run test:permissions` and `npm run test:permissions-scope` for policy/redaction and controlled client races. `npm run test:permissions-api` requires an existing empty disposable loopback database named `vine_permissions_test`, `ALLOW_TEST_DATABASE=yes`, temporary `STORAGE_DIR`, production-mode middleware and a synthetic `.invalid` `APP_URL`; never point it at `vine_development` or production. The suite migrates only that guarded database and uses synthetic identities/records. Preserve the main development `.env`; use process-local test configuration without printing credentials. Existing Services, patient/Visit, Support/RBAC and audit suites remain required. See [release evidence](docs/releases/2026-10-03-hybrid-access-control.md) for actual results and browser limitations. No new migration or production action.


Read-only schema inspection on October 2, 2026 directly observed local migrations
001–004 and production 001–002. Shared platform/auth definitions and checksums match,
and no unexplained manual schema drift was found. Migrations 003/004 are an
**expected pending release gap** because Services 1A has not been deployed.
Production Services tables are not yet available. See
[verified baseline](docs/architecture/schema-parity-2026-10-02.md).
Services 1B-A and other local development may proceed against target schema 004;
keep production compatibility explicit. No schema was corrected.

## Standing architecture rule

Follow [the permanent database rule](docs/architecture/database-schema-parity.md)
and [repository instructions](AGENTS.md) for every feature. Both environments share
one immutable, ordered migration history; records remain separate. Local represents
the target schema of the version being developed, production the schema of the
version deployed. Different applied versions can be an expected pending release
gap, not unexplained drift. Every feature report includes schema need, committed
chain, local and production applied migrations, new migrations, fresh/upgrade
validation, record compatibility, catch-up migrations, recovery and unexplained
divergence. Report uninspected versions as UNVERIFIED. Production catches up only
through every missing committed migration in order with an approved compatible
release and recovery plan; no manual final-schema construction or automatic update.

Use the same application code and numbered migrations locally and in production,
with separate databases, credentials, records and private files. Local development
uses synthetic data. Never copy production patients/media or synchronize fixtures
into production.

## Local startup

Prerequisites: Node/npm and a running **local** Docker engine. On this Mac, use
`colima start` if needed. Do not select a remote Docker context.

First setup, from this repository:

```sh
npm run dev:setup
npm run dev:db:up
npm run db:migrate
npm run dev:fixtures   # optional minimal branches and Support profile
```

Then start Vine:

```sh
npm run dev
```

Open **http://localhost:3000**. Daily startup is just `npm run dev:db:up`, then
`npm run dev`. No SSH, remote database or desktop browser integration is required.

`compose.development.yaml` runs only PostgreSQL 17, exposes
`127.0.0.1:55439`, and persists data in the `vine-local-development_postgres-data`
Docker volume. Database/user: `vine_development` / `vine_dev`. The normal backend
uses `DATABASE_URL`; there is no separate local business logic or schema.

```sh
npm run dev:db:status
npm run dev:db:restart
npm run dev:db:stop
```

Stopping/recreating the container preserves its volume. Do not remove the volume
unless deliberately resetting synthetic data. Do not run the production
`compose.yaml` for local development.

### Configuration, OAuth and files

The ignored `.env` contains:

| Group | Variables |
| --- | --- |
| App | `NODE_ENV`, `APP_URL`, `PORT` |
| Database | `DATABASE_URL`, `LOCAL_POSTGRES_PASSWORD` (local Compose only) |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Private files | `STORAGE_DIR` |

`dev:setup` generates a local password, preserves existing OAuth values, and
preserves an existing remote development tunnel configuration in ignored
`.env.tunnel`. It refuses production configuration and does not rotate an existing
local database password. Do not commit or print either environment file.

Prefer a dedicated development Google OAuth client. Local callback:
`http://localhost:3000/api/auth/google/callback`. Production uses
`https://app.vineaesthetics.com/api/auth/google/callback`. Keep credentials separate.
OAuth console setup and interactive login are separate checks; they do not block
migration work or automated tests. Production OAuth validation is unchanged.

`dev:fixtures` is explicit and idempotent: two synthetic branches, local branding,
and an inactive Support placeholder with an `.invalid` email. It creates no
patients, appointments, Google identities or sessions. Existing records stay intact.
For Mark's interactive account, sign in with Google once, then run:

```sh
npm run dev:fixtures -- --activate-support
```

This local-only CLI requires Mark's verified Google identity and pending profile;
it grants the intended Support role, audits the change and revokes old sessions.
Sign in again afterward. It uses the committed authentication flow and creates no
identity or session itself. Fresh Google login remains **unverified**; the placeholder
is not a login account. Production OAuth and onboarding are unchanged.
Existing records are preserved; fixtures never run automatically on app startup.
Additional synthetic records should be created only when a feature needs them.

Local uploads use private `data/local-development-files`, ignored by Git.
Production retains its own persistent private storage. Do not copy production
attachments, exports or historical recovery snapshots into the local environment.

### Migrations and validation

Initialize/apply schema with `npm run db:migrate`. The checksummed runner applies
committed migrations `001` through `004` and future numbered migrations.
Never edit an applied migration; add `005_...sql`, `006_...sql`, etc.
Fixtures define records separately from schema migrations.

For each feature: specify scope/rules/acceptance, implement locally, add a forward
migration if needed, test a clean database and an upgrade from the previous schema,
run focused tests/regressions, TypeScript (`npm run lint`) and build (`npm run build`),
then commit only the reviewed scope. Manual browser checks are useful where
practical; desktop automation is optional.

Destructive integration suites require their own fresh, disposable databases and
temporary file storage. Keep each suite's existing database-name/loopback/
`ALLOW_TEST_DATABASE=yes` guards. Never run them against `vine_development` or
production. See [Services tests](docs/releases/2026-10-02-services-1a.md) and the
individual guarded test scripts. Tests using simulated Google tokens prove server
behavior, not a genuine Google browser login.

## Production

`https://app.vineaesthetics.com` remains on Hostinger/Dokploy with PostgreSQL 17,
real clinic records, production Google OAuth and private persistent media.
Both environments use `NODE_ENV`, `APP_URL`, `PORT`, `DATABASE_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `STORAGE_DIR`, with separate values.
`LOCAL_POSTGRES_PASSWORD` is exclusively for local Docker.

**Directly verified baseline: local 004; production 002.** Shared checksums match;
003/004 remain pending the authorized Services release. This expected gap does not
block local development and does not mean Services is available in production.

Production preparation/deployment is a separate, explicitly authorized task:
review the migration and recovery plan, back up before risky schema/data changes,
deploy the compatible reviewed version, apply every missing committed migration in
order (currently 003 then 004), and check
health plus the affected workflow. Never connect local development to production
or automatically run destructive production migrations.

Every feature must assess existing-record preservation, old-record loading,
production compatibility, additive migration options and whether rollback needs
data recovery or only code rollback. Normalize the workflow being improved; do
not redesign the entire database. See [deployment operations](DEPLOYMENT.md).

## Optional tools and next work

`npm run dev:db:tunnel` reads `.env.tunnel` and accesses only the separate remote
development database on port 56439. It is an opt-in troubleshooting tool, never a
normal startup requirement. It does not change the app's local `.env`. To inspect
that remote environment, use an explicitly selected configuration in a separate
task; do not repoint normal local development or contact production.

[Optional development tools](docs/operations/optional-development-tools.md) document
the tunnel configuration. Historical recovery/acceptance artifacts stay outside
the normal startup workflow.
Keep ignored recovery snapshots private. SSH reliability, desktop browser runtime,
legacy infrastructure cleanup and staging setup are separate operational work.

Next feature: **Services 1B-A — Appointment Service Selection**, followed by
Services 1B-B (Visit / Performed Service), Clinical Records, Interactive Charts,
Inventory, POS/Payments, Packages/Treatment Integration, then Reporting/Automation.
Production deployment is always separate from feature implementation.
