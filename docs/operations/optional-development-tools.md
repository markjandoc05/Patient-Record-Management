# Optional development tools

Normal Vine startup uses local PostgreSQL on loopback port 55439. Use
[DEVELOPMENT.md](../../DEVELOPMENT.md) for the daily workflow.

## Remote development tunnel

The existing isolated remote development database is an optional diagnostic target.
Its records are not copied into the local database. No remote infrastructure is
created, changed or restarted by local setup.

`npm run dev:setup` preserves an existing tunnel configuration in ignored,
private `.env.tunnel`. For a new configuration, supply only these names locally:
`DATABASE_URL`, `DEV_DATABASE_SERVICE`, `DEV_SSH_HOST`, `DEV_SSH_KEY`,
`DEV_SSH_KNOWN_HOSTS`. Never commit or print credential values.

`npm run dev:db:tunnel` reads that file. It requires the isolated development
database/user, loopback binding, key authentication and pinned host verification.
The optional remote endpoint is port 56439; normal Vine `.env` stays on port 55439.
Keep one tunnel process. A listener alone does not prove PostgreSQL health.
After unexpected SSH exit, retry the optional command. Do not use production URLs
or change normal startup to depend on this tunnel.

Recovery snapshots, historical acceptance artifacts, desktop browser integration,
and broader provider audits are separate operational work. Do not copy real
patient records or production media into local development. No desktop browser
automation is required for local coding, migration checks or automated tests.
