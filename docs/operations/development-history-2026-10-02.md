# Historical development notes

Archived October 2, 2026. These notes describe the previous remote development
database and earlier acceptance runs. They are retained as evidence, not current
startup instructions. Use [DEVELOPMENT.md](../../DEVELOPMENT.md) for local startup.
No copied production records or media belong in the new local database.

# Local development with VPS PostgreSQL

Simple registration: run `npm run test:simple-registration`; API checks use
`npm run test:simple-registration-api` with the same disposable vine_parity_test
guards as the other registration API suites. Never point these truncating suites
at shared development/production. See [simple-registration evidence](../releases/2026-10-02-simple-age-emergency-contact.md).

## Clinical finding checks

Run `npm run test:clinical-findings`. `npm run test:clinical-findings-api` requires
the same disposable loopback vine_parity_test guards and temporary files as the
registration suite; it migrates/truncates that guarded test database. Never target
shared development or production. Clinical states are not review signatures; see
[Release 3A](../releases/2026-10-02-explicit-clinical-findings.md).

## Registration warning checks

`npm run test:patient-duplicates` verifies advisory matching without a database.
Run existing birth/registration/lookup/RBAC suites alongside it. Browser failure
tests may intercept only synthetic development requests; clear interception and
remove marked fixtures afterward. See [Release 2 evidence](../releases/2026-10-02-patient-registration-warnings.md)
for actual checks and remaining native-dialog/responsive acceptance.

## Patient registration foundation checks

Run `npm run test:patient-birth`. Run `npm run test:patient-registration-api` only
against disposable loopback `/vine_parity_test` with ALLOW_TEST_DATABASE=yes,
NODE_ENV=production, HTTPS .invalid APP_URL and temporary STORAGE_DIR; the suite
migrates/truncates that guarded test database. Never use shared development or
production. Browser acceptance gaps and compatibility recovery are documented in
[registration evidence](../releases/2026-10-02-patient-registration-foundation.md).

## Patient lookup validation

Run `npm run test:patient-lookup` for pure matching/static component checks.
`npm run test:patient-lookup-api` requires disposable loopback `/vine_parity_test`,
`ALLOW_TEST_DATABASE=yes`, `NODE_ENV=production`, an HTTPS `.invalid` APP_URL and
temporary STORAGE_DIR. It migrates/truncates that guarded test database; never use
shared development or production. Remove the disposable database/files afterward.
Browser evidence and its limits are in the
[lookup release note](../releases/2026-10-02-reliable-patient-lookup.md).
Create only explicitly identified minimal synthetic fixtures; clean them up after
checking references. Do not reseed the removed demo dataset. Development patients,
appointments and visits are clean again after the October 2 lookup acceptance.

Full development access across all branches: see [Support / Developer setup and verification](../support-developer-access.md).

Use `markjandoc@gmail.com` with the existing `SUPPORT_DEVELOPER` role for all
interactive development and browser testing, per the user's October 1 preference.
Do not switch to other interactive test identities unless the user explicitly
requests it. Automated authorization suites continue using disposable synthetic
roles. Full Support / Developer access is not restricted-staff or administrator
browser evidence; record that coverage separately and honestly.

For the Reliable User Onboarding acceptance task, the user explicitly allowed a
separate development Google identity. Obtain the intended test email first. Mark
remains Support / Developer throughout; test disable/archive only on the disposable
account. An unlinked synthetic profile may verify administrator controls but cannot
provide employee sign-in or browser session-revocation evidence. Create only the
minimum identified fixture, verify archive/audit retention before cleanup, and
remove that fixture and its test-only artifacts afterward. Do not recreate the
removed demo dataset. See [browser acceptance](../releases/2026-10-01-user-onboarding-browser-acceptance.md).

Production and development use PostgreSQL 17 and the same `migrations/` files,
but have separate services, credentials, records and file storage.

- Dokploy project: Vine System → development → Vine Development PostgreSQL.
- Database/user: `vine_development` / `vine_dev`.
- Mac endpoint: `127.0.0.1:56439`, available only while the SSH tunnel runs.
- VPS relay: container `vine-development-db-tunnel`, listening only on
  `127.0.0.1:15439`. It routes to the development service on `dokploy-network`.
- No public PostgreSQL port. The SSH server host key is pinned.
- Local `.env` contains development credentials and is ignored by Git.
- Local attachments: `data/development-files`; no production files copied.

## Daily workflow

### Development copy reverted — October 2, 2026

At the user's request, reverted the production-derived development refresh.
Removed all 462 tagged copied records (including synthetic patients, appointments,
visits, private-note placeholders, historical audit placeholders, identity keys
and eight disabled synthetic employee profiles) and four copied branding files.
Restored the original two development clinics and three settings documents from
the verified pre-refresh recovery snapshot. No patient, appointment or visit
records remain. Preserved both existing development Google accounts, their roles,
assignments and sessions, plus legitimate local audit and sign-in history.
Production was not connected to or changed during this rollback.

The original private snapshot, checksum and rollback result are retained in the
Git-ignored `data/development-refresh/2026-10-01T17-54-34-418Z/` directory.
Snapshot restoration was verified in a temporary PostgreSQL table before deletion;
the database rollback committed atomically, with account/authentication preservation
checked before commit. Local `/api/health` returned healthy afterward. Development
remains a separate PostgreSQL database through the SSH tunnel, not the live database.
Do not automatically refresh, seed or copy production records on startup.

From this repository, keep one terminal running:

```sh
npm run dev:db:tunnel
```

In a second terminal:

```sh
npm run dev
```

If the tunnel is already running, reuse it. Open http://localhost:3000.
Run `npm run db:migrate` only when initializing a database or applying new reviewed
migrations. Demo seeding is optional, not a daily startup step.
The seed and tunnel scripts reject a production database URL.
The generic migration command targets DATABASE_URL: always use local `.env` for
local development. Never copy a production DATABASE_URL into this file.

### Clean development baseline — October 1, 2026

At the user's request, removed 4 synthetic patients, 3 synthetic appointments,
2 demo branches, 5 testing profiles, their one linked development identity and
6 associated test audit entries. Preserved `markjandoc@gmail.com`, its verified
Google identity, active session, `SUPPORT_DEVELOPER` role, account history and all
3 application settings documents. Removed its references to deleted demo branches;
global Support / Developer access does not require a branch assignment.

Start with your own branch configuration and records through the existing UI.
The local app still connects to isolated Dokploy development PostgreSQL through
the SSH tunnel; this cleanup did not move PostgreSQL onto the Mac or copy live
patient records. Production was not modified.

A private, Git-ignored recovery snapshot is in `data/development-cleanup/`, with
a SHA-256 sidecar. Its record and removed-identity data was restored into temporary
PostgreSQL tables and compared before deletion. The cleanup committed atomically.
Keep this directory private; do not commit or share its contents.

Do not run `dev:db:seed`, `dev:access:prepare`, or `dev:accounts:configure` during
normal startup: these are opt-in fixture/provisioning tools and can recreate demo
data or testing accounts. Their fixture-dependent verification commands expect
the previous seeded dataset and do not describe this clean baseline. Automated
authorization tests must continue using separate disposable test databases.

## Google sign-in

For normal employee registration and administrator approval, follow
[User onboarding](../user-onboarding.md). Existing installations approve users
through Settings → Access; the bootstrap command below is for a new installation
without an administrator, not routine onboarding or a way to change Mark's role.

The existing Google OAuth client credentials are configured locally. Add
`http://localhost:3000/api/auth/google/callback` to its authorized redirect URIs
without removing the production callback. The first local sign-in creates a
pending profile. Promote that verified profile in DEVELOPMENT only using:

```sh
npm run admin:bootstrap -- your-google-email@example.com
```

No production identities or patient records were copied. Google console callback
registration and the first interactive sign-in must be verified separately.

## Reliable onboarding validation

Run `npm run test:user-onboarding-ui` for pure guidance and static component checks.
The real server/PostgreSQL suite requires a new disposable database named
`vine_onboarding_test`, loopback PostgreSQL, `ALLOW_TEST_DATABASE=yes`, production-mode
middleware, an `.invalid` HTTPS APP_URL, and fresh temporary file storage. It initializes
and truncates only that guarded test database. Never point it at shared development
or production. Use synthetic Google configuration; the provider is simulated.

```sh
DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/vine_onboarding_test' \
ALLOW_TEST_DATABASE=yes NODE_ENV=production APP_URL=https://onboarding-test.invalid \
GOOGLE_CLIENT_ID=synthetic-client.invalid GOOGLE_CLIENT_SECRET=synthetic-test-only \
STORAGE_DIR=/absolute/path/to/fresh/temporary/test-files npm run test:user-onboarding
```

Remove the disposable database and temporary files afterward. These tests prove
callback state/persistence and server approval/session behavior, not a genuine
Google browser sign-in. Do not recreate fixture accounts in the clean development
database. See [Release 1 evidence](../releases/2026-10-01-reliable-user-onboarding.md).

## Schema changes and releases

Create a new numbered migration; do not edit an applied migration. Test locally
against this development database. Commit working milestones; no GitHub push is
needed to run local tests. Production applies the same committed migrations only
when its release is deployed. Schema equality is maintained by migrations, not
by synchronizing development records into production.

Restart the SSH tunnel if the VPS reboots. The relay restarts automatically.
The development database is disposable and does not inherit production's backup
schedule. Destructive integration tests must use a separate test database, not
this shared development database or production.

## Appointment read security tests

Provision an empty disposable local PostgreSQL database named
`vine_appointment_auth_test` and a fresh temporary storage directory. Never use
`vine_development` or production for this suite: it truncates its test database.

```sh
DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/vine_appointment_auth_test' \
ALLOW_TEST_DATABASE=yes NODE_ENV=production APP_URL=https://appointment-security-test.invalid \
STORAGE_DIR=/absolute/path/to/fresh/temporary/test-files npm run test:appointment-read-auth
```

This uses production-mode middleware against synthetic disposable data; it does
not deploy or connect to a production database. Remove the test database/files
afterward. Run the existing `test:postgres` suite in a separate `/vine_test` database.
See [security release checks](../releases/2026-10-01-appointment-read-security.md).

## Production-compatible release validation

Use **Node 22.23.3** as the authoritative runtime before preparing a release.
Node 24.15.0 is an additional compatibility check. Both passed the current
combined candidate on October 1, 2026; see the complete
[parity-hardening report](../releases/2026-10-01-parity-hardening.md).
Use a fresh source snapshot and the existing lockfile:

```sh
node --version
npm ci --include=dev
npm run lint
npm run build
node --import tsx scripts/test-appointment-loading.ts
npm run test:shared-data
npm run test:rbac
npm run test:audit
npm run test:login-activity
npm run test:developer-tools
npm run test:support-access
npm run test:support-ui
npm run test:support-subscriptions
npm run test:development-activation
```

Run `test:appointment-read-auth` against disposable `/vine_appointment_auth_test`,
`test:postgres` against disposable `/vine_test`, and `test:parity-regression` against
disposable `/vine_parity_test`. The latter requires a loopback `127.0.0.1` database,
`ALLOW_TEST_DATABASE=yes`, production-mode middleware, an HTTPS `.invalid` APP_URL
and a fresh temporary STORAGE_DIR. These suites initialize/truncate only their
guarded test databases; never point them at shared development or production.
Use synthetic OAuth placeholders for compiled backend health/session-gate checks;
those do not prove Google browser sign-in. Remove test databases/files afterward.

The missing development media fixture has been configured with the verified
effective production policy: `.png,.jpg,.pdf`, 1 MiB per file, 5 files per record.
This did not change source defaults or production configuration. Check it with:

```sh
npm run dev:media:configure -- --verify
```

Without `--verify`, that command creates only a missing document. It rejects
production/non-isolated targets and refuses to overwrite a different existing
policy. It is not a synchronization command. Keep deliberate future clinic policy
changes in a separate reviewed release.

## Services 1A development and checks

Migration `003_services.sql` adds only catalogue/category/branch-setting tables.
It uses the existing checksummed runner; never edit an applied migration. See
[Services schema](../services-schema.md) and [release evidence](../releases/2026-10-02-services-1a.md).
Canonical appointment/visit service selection and historical snapshots are not implemented.

Run `npm run test:services` for 74 pure policy checks. The real HTTP/PostgreSQL
suite `npm run test:services-api` requires a **disposable**, loopback database
named `vine_services_test`, `ALLOW_TEST_DATABASE=yes`, an HTTPS `.invalid` APP_URL,
`NODE_ENV=production` and fresh temporary STORAGE_DIR. It initializes its synthetic
legacy records and runs the migrations; use a fresh database each run. Never target
shared development or production. Simulated identities prove role enforcement;
they do not prove an interactive Google sign-in.

```sh
DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/vine_services_test' \
ALLOW_TEST_DATABASE=yes NODE_ENV=production APP_URL=https://services-test.invalid \
STORAGE_DIR=/absolute/path/to/fresh/temporary/test-files npm run test:services-api
```

Remove the disposable database/files afterward. Existing guarded database suites
now explicitly truncate service child tables before app_records; their database
guards remain unchanged. No CASCADE reset is used. Do not seed the catalogue from
legacy Cleaning/Check-up/Treatment strings. New services are unavailable until
branches are explicitly enabled. Services writes audit every authorized actor,
including Support in its existing allowed scope; unrelated audit policies stay intact.

This acceptance run used localhost:3001 because another application owns port 3000.
Reuse the existing tunnel and set PORT=3001/APP_URL=http://localhost:3001 only for
that server process; do not stop the unrelated app or change production configuration.
