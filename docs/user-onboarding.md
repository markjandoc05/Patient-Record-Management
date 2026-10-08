# Registering and approving Vine users

Google sign-in remains the registration method. There is no Add User, invitation,
password or automatic email-delivery workflow in this release.

## Employee registration

1. Open the clinic's app and choose **Sign In with Google**.
2. Use the Google account that will be used for work. A new account receives a
   pending Staff profile; registration alone does not grant clinic access.
3. Tell the clinic administrator which Google email was used.
4. Wait for the administrator to assign a role and clinic access and activate the
   account. Then sign in again using the same Google account.

An **Awaiting administrator approval** notice describes this process. An inactive
or archived account has different guidance. Employees cannot approve themselves.

## Administrator approval

1. Create or activate the required clinic branches first.
2. Open **Settings → Access → User access → Pending activation**.
3. Expand the employee's row; verify the email, choose an existing role and select
   permitted clinics. The default clinic is optional and must be assigned when set.
4. Read **Before approval** beneath the row and resolve the listed requirements.
5. Open **More actions → Approve & activate** and confirm.
6. After the success notice, ask the employee to sign in again.

Staff, Doctor and Manager require at least one assigned active clinic, and every
assigned clinic must be active at approval. Global Admin and existing developer
roles do not require clinic assignments or active assigned clinics for their global
access. Assignment IDs must refer to existing clinics, and a configured default
must belong to the assignments. These checks do not change the global read policy.
Support / Developer protections and the development-only uppercase role guard
remain enforced. The server retains the existing verified-identity prerequisite
for activating the uppercase Support / Developer role.

**Role and clinic requirements met** describes the current role/assignment checks;
the server still rechecks authorization and account lifecycle requirements when
the action is submitted. Until the user and clinic lists load successfully, approval
is unavailable. A failed refresh shows **Retry loading user access** instead of
pretending no pending accounts exist. Safe prior lists can remain during a temporary
outage; an authorization failure clears protected list data.

## Approval failures and retries

The confirmation stays open on an approval failure, shows the reason and offers
**Retry action**. For an outage, retry after connectivity returns. For invalid
assignments, cancel, fix the settings and try approval again. While saving, controls
are disabled to prevent repeated submission.

Repeated/concurrent approvals are checked against current server state. Only the
successful transition creates an activation audit; a duplicate returns the existing
already-active conflict. If polling confirms a previous uncertain approval succeeded,
retrying the dialog acknowledges that status without approving a second time.

Disabling or archiving an account removes its sessions with the account-state change.
Google session creation rechecks current state in a transaction, so an overlapping
sign-in cannot recreate a session for an account that was just disabled. Restore
retains the existing profile and revalidates activation requirements.

Find disabled accounts under **Settings → Access → User access → Inactive users**.
Review the existing role/clinic requirements, then choose **More actions → Activate
user**. Pending registrations remain in Pending activation; archived accounts remain
in Archived users and use Restore. No new account status or permission is introduced.

## Development and acceptance

Interactive development uses `markjandoc@gmail.com`. Do not downgrade that account
or recreate the removed demo dataset to demonstrate pending onboarding. Automated
role tests use synthetic identities only in disposable test databases.

Browser acceptance has verified Mark's genuine Google sign-in/re-login and the
administrator controls using one disposable, unlinked synthetic profile. That
fixture was removed afterward. It had no Google identity or login session, so
employee pending/approved sign-in, session-revocation screens and initial clinic
selection remain unverified in the browser. The user explicitly permitted a separate
test Google identity for this acceptance; obtain its email and use the normal Google
flow, with user handoff for authentication challenges. Never forge a browser session
or downgrade Mark to simulate employee access. Synthetic provider tests verify
callback logic and persistence, not real Google employee sign-in.

See the [browser acceptance record](releases/2026-10-01-user-onboarding-browser-acceptance.md)
for completed checks, the two browser-discovered fixes and remaining sign-off gates.
