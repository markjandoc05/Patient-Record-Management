# Support / Developer — full development access

Updated October 1, 2026 to follow the user's request for all modules, features,
functions and Developer tools, with **full access across all branches**. This
supersedes the earlier proposal for restricted Support access. Changes are local;
no commit, push, deployment, production account mutation or migration is included.

## Role and access

The stable identifier is `SUPPORT_DEVELOPER`, displayed as **Support / Developer**.
It has the same full module and action grants as the existing lowercase
`support_developer` role, displayed as **Support / Developer (legacy)**. Central
helpers in `src/rbac.ts` recognize both identities for administrative, clinical,
Developer-tool and global branch access. Other roles retain their existing grants.

| Area | Support / Developer access |
| --- | --- |
| Dashboard, Patients, Appointments | All branches; existing create, edit, archive and restore actions |
| Patient clinical records | Full clinical fields, visit history, notes and media |
| Appointment and visit history | Existing clinical completion and history controls |
| Insights / finance, Inventory | Existing screens and inventory operations, including cross-branch transfers |
| Branches and users | Existing branch management and user role, activation, archive, restore and deletion controls |
| Settings | Branding, timezone, footer and existing administrative settings |
| Audit Trail | Existing search, read and export controls |
| Developer tools | All 13 existing panels and their server actions |
| Branch selector | All branches plus individual branch selection |
| Maintenance mode | Developer toggle and maintenance bypass |

Existing record validation, sealed-record rules, identity requirements and
self-account lifecycle protections remain enforced. Global access does not depend
on `assignedBranches`; a default branch is only a selected workspace preference.

The 13 Developer panels are System Overview, App Version, Database Status, Storage
Monitor, User Count, Patient Count, Appointment Count, Visit Count, Audit Logs,
Error Logs, Refresh Settings, Clear Cache and Maintenance Mode. Database diagnostics
and aggregate counts use trusted APIs. Error capture is for the current browser
session; cache cleanup removes Vine-owned browser storage. These tools retain
their existing behavior and are not production deployment controls.

## Development environment guard

`backend/developmentAccess.ts` permits the uppercase role only when `NODE_ENV` is
not production, PostgreSQL is `127.0.0.1/vine_development` with user `vine_dev`, and
`APP_URL` is HTTP localhost or 127.0.0.1. Role use, assignment and activation are
rejected outside that environment. The new role selector is exposed in the
development frontend. A hosted development environment would require an explicit
change to this guard. Roles are JSON values, so no schema migration is required.

## Named development accounts

Current user preference, October 1: always use `markjandoc@gmail.com` for interactive
development and browser acceptance. Other configured development identities are
not part of routine interactive testing unless explicitly requested. This is a
workflow preference; it does not change roles, grants, activation or production.
Keep restricted-role authorization checks in disposable automated fixtures.
Support browser checks must not be labeled ordinary administrator or restricted
staff browser acceptance.

- `markjandoc@gmail.com`: active `SUPPORT_DEVELOPER`, using its existing verified
  Google identity. It has full branch access. The October 1 user-requested fixture
  cleanup removed all demo branches and cleared its saved default and assignments;
  its role, activation and current session were preserved.
- Other testing profiles, including the preapproved Marketing Administrator,
  were removed from development at the user's request. The clean baseline has
  only the verified Support / Developer profile.

Vine uses Google OAuth, server-side PostgreSQL sessions and origin/CSRF checks.
It has no email/password authentication; no default app password was created.
Use **Sign in with Google** for the retained Support / Developer account.

The following historical, read-only verification commands require the original
seeded dataset and both named profiles. Do not use them to assess the clean
baseline, and do not recreate fixtures just to make them pass:

```sh
npm run dev:accounts:configure -- --verify
npm run dev:access:verify
```

`npm run dev:accounts:configure` without `--verify` reprovisions both original
named grants and requires `demo-branch`. It is an opt-in provisioning command,
not a daily startup or clean-baseline check. Use it only when expressly restoring
that fixture environment.
Provisioning cannot create fake Google identities or sessions. The normal OAuth
callback links a trusted, preapproved development profile only after Google
token, verified email, subject, state and nonce checks pass. Approval is consumed
and audited. Browser profile writes cannot set this trusted approval. Unapproved
accounts retain the normal inactive pending-staff registration flow.

## Authorization and cached data

`server.ts`, `backend/dataApi.ts`, `backend/inventory.ts` and
`backend/maintenance.ts` enforce the role and development guard on the server.
Administrative and Developer routes use the central role lists. Clinical note,
history, attachment, branding and footer controls recognize both developer roles
on the client and server. Appointment reads use
`backend/appointmentReadAccess.ts`: both developer roles are global; ordinary
roles keep their existing branch policy and strict SQL branch membership checks.
The obsolete restricted patient projection and `backend/supportAccess.ts` were
removed. Support transactions recheck current activation and role before reads
or writes where authorization can change during an operation.

Protected responses use `Cache-Control: no-store`. Profile/assignment changes and
401/403 failures invalidate protected subscriptions; an earlier response cannot
publish after invalidation. Existing synchronization polls every five seconds,
so already-delivered browser data clears when the client observes a change.
New requests always enforce current server authorization.

## Synthetic fixtures and verification

These fixtures were removed on October 1, 2026. The commands below describe
optional preparation for a deliberately seeded environment, not normal startup.
Keep routine tests in disposable databases and the interactive account as Mark.

`npm run dev:access:prepare` adds missing fixtures and preserves existing rows.
The placeholder `development-support-001`, email
`support.developer@example.invalid`, stays inactive and pending, with no Google
identity or session. Its default workspace is Demo Clinic. Fixture records in
both `demo-branch` and `acceptance-branch-b` verify global reads. Neither branch
is excluded by this role.

For a separate interactive test account, first sign in through normal Google
OAuth, then prepare its inactive verified profile:

```sh
npm run dev:access:prepare -- --google-email dedicated-test-account@example.com
```

A development administrator can then activate that verified profile through
Settings. Do not activate the unlinked placeholder. Use a staff account for
restricted-branch acceptance; Support / Developer now intentionally has full
access.

Automated checks:

- `test:support-access`: 122 checks on real Express routes with synthetic
  in-memory persistence and sessions. Covers global reads, clinical fields,
  records, private notes, administration, branding, uploads, inventory transfers,
  Developer metrics/diagnostics/activity/maintenance, CSRF, role revocation,
  ordinary-role restrictions and production guard rejection. Temporary upload
  files are removed. No live records or sessions are created by this suite.
- `test:support-ui`: renders all 13 actual Developer panels. This is component
  rendering, not an interactive browser or Google sign-in test.
- `test:support-subscriptions`: six stale-response and cache invalidation cases.
- `test:development-activation`: trusted activation and Google callback checks
  with a simulated provider and synthetic persistence.
- `test:rbac`, `test:audit`, `test:developer-tools`, `test:login-activity`:
  existing grants and policies.
- `dev:access:verify`: read-only real development PostgreSQL verification of
  Mark's saved role and cross-branch queries.
- `lint` and `build`: TypeScript and bundled application validation.

After restarting the local backend, refresh and sign in as Mark to verify the
full navigation, All branches selector and Developer tools interactively.
Marketing's first Google sign-in remains a manual step. Backend edits require
restarting `npm run dev`; Vite refreshes frontend edits only.

Destructive database suites require their own disposable test databases and must
not run against shared development or production. No production rollout is
authorized by this development change.
