# Vine: PostgreSQL migration and Dokploy deployment

Target domain: https://app.vineaesthetics.com

## What changed

The existing React UI now reads through authenticated backend APIs. Express
uses PostgreSQL for all structured records and stores uploads in a private
persistent volume. Google OAuth identifies users; opaque HttpOnly session
cookies and server-stored CSRF tokens replace Firebase Auth tokens. Sessions
expire after 12 hours and can be revoked through account lifecycle operations.
New Google users remain inactive until approved. There is no public admin signup.

The first migration preserves existing record fields and IDs in the PostgreSQL
`app_records` JSONB table. This is a compatibility stage, not a fully normalized
clinic schema. Existing multi-record writes are serialized using a PostgreSQL
transaction advisory lock. Dedicated relational tables and scoped row locks
should be introduced for the planned financial, package and stock-ledger modules.
The new feature expansion has not been implemented by this infrastructure change.

Screens refresh subscriptions every five seconds rather than using Firestore
realtime listeners. Browser data access is authorized by the backend. Private
notes retain their restricted role access; the existing shared patient/clinical
continuity read policy is preserved. Google OAuth is the only runtime Google
integration needed. Firebase Admin remains a development-only export dependency;
legacy Firebase config/rules are retained for export and rollback reference.

## Required configuration

Set these in Dokploy's environment editor, not committed files:

- `APP_URL=https://app.vineaesthetics.com` (use a staging domain for staging).
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, from a Google OAuth **web
  application** client. Register exactly
  `https://app.vineaesthetics.com/api/auth/google/callback` as the production
  redirect URI. Register the equivalent staging URI before staging tests.
- `POSTGRES_PASSWORD`: a URL-safe random password for the Compose database.

`compose.yaml` derives `DATABASE_URL` and attaches only the app to
`dokploy-network`. PostgreSQL has no public port. Dokploy should route the domain
to the **app** service, port **8080**, with HTTPS enabled. Keep named database and
file volumes across deployments. The application runs as the container's `node`
user; imported files must be readable/writable by that user (UID 1000).

The Docker image runs versioned SQL migrations before starting. Changed already
applied migrations are rejected. Back up before deploying future migrations.

## Local development

Copy `.env.example` to `.env`, configure a disposable PostgreSQL database and
Google web OAuth credentials (localhost callback `/api/auth/google/callback`).
Run `npm ci`, `npm run db:migrate`, then `npm run dev`.

For a brand-new installation, sign in with Google once to create a pending
profile, then run `npm run admin:bootstrap -- verified-admin@example.com` from a
trusted CLI connected to that database. This command refuses to run if an active
administrator already exists. Existing installations should import identities
and profiles instead, preserving existing roles.

## Migrate the existing Firebase installation

Do not change production DNS during preparation.

1. Back up the live installation and identify its complete Firebase project,
   database and storage bucket. The exporter uses `firebase-applet-config.json`.
2. On a trusted machine, provide Firebase export credentials through
   `GOOGLE_APPLICATION_CREDENTIALS` or Application Default Credentials. These
   credentials are only for migration and must not be put into the runtime image.
3. Run `npm run migration:export -- /absolute/private/export-directory`.
   This performs reads only and exports all collections/subcollections, Google
   identity mappings, uploads and branding files. The result contains private
   data; keep it outside Git and transfer through a secure channel.
4. Point `DATABASE_URL` and `STORAGE_DIR` at an **empty staging** database/file
   volume. Run `npm run migration:import -- /absolute/private/export-directory`.
   Import rejects a nonempty database, preserves Firebase UIDs, links verified
   Google subjects to the same users, and rewrites Firebase branding URLs.
   It never links an arbitrary Google account by matching an email address.
5. Verify source/destination counts by collection, identity mappings, attachment
   counts/content, timestamps, roles, clinic assignments, patient histories and
   reports. Test Google login with real OAuth credentials and all user roles.
6. For final cutover, pause writes on the old app, take a **fresh final export**,
   and import into the empty final target. A prior staging export is not a final
   backup of a live system. Do not permit writes to both installations.
7. After verification, point the existing domain at Dokploy and check TLS,
   sign-in, uploads and the `/api/health` endpoint. Keep the old deployment frozen
   and its backup available until the new deployment is accepted.

A failed file import rolls back database writes but may leave orphaned staging
files. Discard the staging file volume before retrying. The exporter/importer are
prepared and locally tested with synthetic data; no live Firebase export has
been run as part of this code change.

## Backups and restoration

Back up the **application PostgreSQL database** and **clinic-files volume** to
an off-server destination. A backup of Dokploy's own database is not a backup of
these application records. Use Dokploy database/Compose backup facilities and
volume backups appropriate to the VPS setup.

Obtain a consistent initial recovery point while application writes are paused;
retain the matching database dump and files together. Set a retention schedule
and recovery-point target before production cutover. Encrypt backup access and
restrict who can retrieve it. Test restoration into an isolated database and file
volume, then verify counts, identities, attachments and login. Never verify a
restore by overwriting the live database.

If rollback is needed before accepting writes on the new app, route back to the
frozen old installation. After new PostgreSQL writes exist, reverting DNS alone
would lose those changes; reconcile/export them before rolling back.

## Verification

- `npm run lint`
- `npm run build`
- `npm run test:rbac`, `test:audit`, `test:developer-tools`, `test:login-activity`
- `npm run test:migration-import` with a disposable `/vine_import_test` database
  and `ALLOW_TEST_DATABASE=yes`.
- `npm run test:postgres` with `DATABASE_URL` ending in `/vine_test`,
  `ALLOW_TEST_DATABASE=yes` and a disposable `STORAGE_DIR`.

The integration suite uses synthetic data and truncates **only the explicitly
named test database**. It checks concurrent transactions, rollback, access/CSRF
controls, patient/appointment/visit workflows, private files, archive/restore and
repeat-safe stock transfers. Real Google OAuth, live data migration, VPS sizing,
backup destinations and DNS cutover still require staging/server access.

Dokploy reference: https://docs.dokploy.com/docs/core/docker-compose/domains
Google OAuth reference: https://developers.google.com/identity/protocols/oauth2/web-server

## Production preparation status — October 1, 2026

The Dokploy project **Vine System** and its **production** environment exist at
`https://cloud.aiph.tech`. **Vine PostgreSQL** is deployed, with its container
verified running. The one-time **Vine Schema Migration** job exited successfully
with code 0, installed `001_platform.sql` and `002_session_integrity.sql`, and
confirmed zero records in `app_records`. No Firebase data has been imported.

The user approved daily PostgreSQL backups to the existing **CloudFlare**
destination at 03:00 Philippine time (19:00 UTC), retaining the latest 14 backups.
The schedule is enabled and verified in Dokploy. A completed backup and restore
have not yet been tested. Private file storage needs a separate backup policy.

Production code now includes security headers, HTTPS cookie settings, bounded
Google-login/upload request limits, authentication before multipart processing,
connection/query timeouts, graceful shutdown, JSON API errors and server-enforced
write maintenance. `TRUST_PROXY_HOPS=1` matches the intended single Dokploy proxy;
verify the actual proxy topology before cutover. Authentication rate limits are
per process; a multi-instance deployment needs shared rate-limit state.

Remaining activation requirements: app service deployment, real Google OAuth
credentials, a verified choice to import current Firebase records or start empty,
VPS capacity verification, private-file backup configuration, and a tested
database restore. Do not describe this installation as production-ready or live until
those checks and the final migration are completed. DNS has not been changed.

Current database service: `vine-system-postgres-bq7rry`, database `vine`, PostgreSQL
17, generated credentials stored in Dokploy, no configured external port. Health
checks and restart policy were configured. Database connection and migrations
were verified by the successful schema job. DNS and the live Google-hosted app
remain unchanged.

Vine App is configured as a native Dokploy application using the GitHub branch
`deploy/dokploy-postgres` and the repository Dockerfile. Its database connection
uses the internal PostgreSQL service. The named volume `vine-system-private-files`
is mounted at `/app/data/files`. Google OAuth variables must be completed in the
Dokploy Environment editor before deployment. Automatic deployment is disabled
until the first successful launch and migration decision.
