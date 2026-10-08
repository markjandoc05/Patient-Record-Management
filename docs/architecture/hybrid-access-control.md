# Vine hybrid access-control foundation

Local implementation, October 3, 2026. This document records the approved policy and
implemented foundation. Clinical Records R1 workflows remain a separate release.

## Resolution and authority

`src/permissions.ts` owns the stable capability registry and compatibility defaults.
`hasCapability(actor, permission, context)` requires an active, approved, nonarchived
account with a known role; reads the default; applies the user's explicit override;
then applies independent branch context. DENY wins over the role default. Missing
maps preserve legacy defaults; malformed stored maps fail closed.

The authoritative map is the existing `users` JSONB profile:

```json
{
  "permissionOverrides": {
    "clinical.view": "deny",
    "services.manage": "allow"
  },
  "accessRevision": 3
}
```

Only explicit lowercase `allow` / `deny` values are persisted. A command's `inherit`
removes the key. No per-user copies of inherited permissions or SQL migration are
needed. The browser's profile mirror is ephemeral UI guidance, never API authority.

`backend/permissions.ts` reads the current session and profile inside serialized
write transactions. Generic data reads, Services and inventory use that same current
actor model. Session expiry is checked against real clock time after lock waits.
The canonical `SUPPORT_DEVELOPER` environment guard remains required; the legacy
lowercase alias retains its existing compatibility. Ordinary ALLOW grants cannot
turn a Manager into an access administrator or enable Developer tools.

## Operational management and security administration

`users.manage` permits validated operational employee details (name, contact and
existing demographic fields). It cannot change roles, authorization branches,
overrides, account lifecycle, clinical authority or Developer authority.

`access.manage` requires both effective capability and Administrator or guarded
Support authority. The dedicated `PATCH /api/users/:id/access` accepts a current
`expectedAccessRevision`, optional role/branch/default changes, and
`permissionChanges`. A stale revision returns 409. Unknown fields/permissions and
invalid values are rejected. Another authorized administrator must change a user's
own role or overrides; Administrator cannot manage Support targets or grant Support
roles. Existing own Administrator branch-assignment behavior is preserved.
Account lifecycle additionally requires `users.manage` and retains its existing
self-target and Support-target safeguards. This release does not introduce a new
last-administrator policy.

Role, authorization branches/defaults, and permission overrides use only the revisioned
access endpoint. Generic profile writes reject centrally classified security/lifecycle
fields, including their derived branch names. Account activation/archive remains on
its existing dedicated transaction-guarded lifecycle routes. Assignment cleanup uses
individual revisioned access commands, stops on conflict and reports prior successful
updates; it does not silently overwrite another administrator’s policy. Clinical
record writes cannot bypass dedicated record APIs through the generic data API.

## Branch and resource scope

Capability grants do not confer global branch scope. Global branch policy remains
role based; ordinary users retain their assigned branches. Appointment reads and
record writes preserve existing branch/provider/resource checks. Doctor Visit
writes retain existing ownership checks. Service prices/settings stay scoped;
`services.manage` and `services.pricing` are independent, and only an actual price
change requires pricing authority. Existing inventory capabilities guard only the
already present item/supplier/transfer operations; no new stock workflow is added.

Shared patient and longitudinal Visit reads remain shared for compatibility.
Clinical denial changes their field projection, not their operational readability.
No new per-clinician clinical scope is invented here. Clinical R1 must add its
approved resource/authority rules to these hooks.

## Clinical server projection

`backend/clinicalRedaction.ts` applies a closed operational field projection to
patient, appointment and Visit payloads when `clinical.view` is denied. It keeps
identity, required demographics, branch/date/status/provider, historical canonical
Service snapshots and legacy Service labels, plus approved workflow metadata.
Clinical notes, diagnoses, treatment plans, concerns, allergies, medications,
conditions, prescriptions, findings, attachments and unknown/nested JSONB content
are absent from the response. Even an object smuggled into a nominally scalar
operational field is discarded. Timestamp objects retain only their timestamp.

Collection/direct-document data queries and the patient directory use the same
projection. Clinical-field filter/order queries are denied before database predicates run to prevent
inference. Denied clinical readers may query/order audit logs only by safe metadata:
action, resource/ID, branch, actor ID/name/role, timestamp, event type and source.
Narrative, before/after changes and unknown fields are rejected uniformly regardless
of term, match, sorting or pagination. There is no generic audit text-search/facet
endpoint. UI search runs on redacted payloads. Authorized clinical audit readers retain
existing narrative query behavior.
Private notes and protected media require clinical viewing plus their existing
parent/resource permissions. Attachment writes recheck current authority in their
transaction; browser blob previews clear on protected invalidation.

Redacted edit forms must not erase hidden values with empty defaults. Protected
clinical write fields are retained or rejected server-side. Existing Staff/Manager
patient edit field masks remain in force; granting `patients.edit` does not remove
those domain restrictions. Existing patient-registration reported intake and
appointment note policy are preserved where clinical viewing is allowed. Full
patient clinical edits and Visit documentation require `clinical.edit_draft`.
Surrounding whitespace in legacy string values is compared canonically with trim;
matching representations are removed from unauthorized writes, preserving stored
bytes exactly. Internal whitespace/structured changes remain semantic changes;
empty defaults do not clear meaningful protected content.

Staff and Manager retain `clinical.view` as an initial default because shared
clinical reads existed before this release. Removing that default is a separate
business-policy release. Administrators may explicitly DENY it now.

## Audit and concurrent access changes

Access commands update the profile, increment `accessRevision` and create
`access_policy_changed` in one PostgreSQL transaction. Events carry target, server
actor/role/time, old/new role/authorization branches/default and old/new override
states. Audit failure rolls back the access write. Access events contain no clinical
narrative. Denied clinical readers receive only safe audit metadata, never legacy
clinical narrative values.

Current account/profile checks occur inside the same lock used by security writes,
so a queued write cannot use an old permission after revocation commits. Permission
changes do not require new Google sign-in. The existing five-second own-profile
subscription discovers changes in the browser; there is no new push channel. Once
observed, role/branch/map/revision changes synchronously invalidate protected state.
Sign-out and current 401/403 denials also invalidate protected state.

Requests capture identity and protected generation before awaiting tokens, transport
and body consumption. Old success/error/401/403 responses cannot restore removed
content or invalidate a new scope. Own-profile/public settings recovery reads are
protected-generation exemptions but still identity bound. Existing Services and
appointment/Visit intent/lifetime guards remain in place.

## Administration surface

Existing Settings/User management adds operational User details and a distinct
Module Access section. Native expandable module groups show inherited role behavior
and explicit Inherited/Allow/Deny controls. Security controls require `access.manage`;
self override controls and protected Support targets remain disabled. The layout
uses the incumbent slate/teal controls and stacks labels/selects on smaller screens.
No new visual system or raster assets were introduced.

## Namespace and exact initial role matrix

ALLOW means the capability default only, subject to account, environment, branch,
resource and field rules. Both Support aliases share these defaults; canonical
Support still requires the isolated-development guard. Reserved finalization and
prescription capabilities have no role ALLOW and no new workflow endpoint.

| Capability | Administrator | Support / Developer | Manager | Doctor | Staff |
|---|---|---|---|---|---|
| `dashboard.view` | Allow | Allow | Allow | Allow | Allow |
| `patients.view` | Allow | Allow | Allow | Allow | Allow |
| `patients.create` | Allow | Allow | Allow | Allow | Allow |
| `patients.edit` | Allow | Allow | Allow | Allow | Allow |
| `patients.archive` | Allow | Allow | Deny | Deny | Deny |
| `patients.attachments.manage` | Allow | Allow | Deny | Allow | Deny |
| `appointments.view` | Allow | Allow | Allow | Allow | Allow |
| `appointments.create` | Allow | Allow | Allow | Allow | Allow |
| `appointments.edit` | Allow | Allow | Allow | Allow | Allow |
| `appointments.archive` | Allow | Allow | Deny | Deny | Deny |
| `appointments.attachments.manage` | Allow | Allow | Allow | Allow | Allow |
| `visits.view` | Allow | Allow | Allow | Allow | Allow |
| `visits.create` | Allow | Allow | Deny | Allow | Deny |
| `visits.edit` | Allow | Allow | Deny | Allow | Deny |
| `visits.archive` | Allow | Allow | Deny | Deny | Deny |
| `visits.attachments.manage` | Allow | Allow | Deny | Allow | Deny |
| `services.view` | Allow | Allow | Allow | Allow | Allow |
| `services.manage` | Allow | Allow | Deny | Deny | Deny |
| `services.pricing` | Allow | Allow | Deny | Deny | Deny |
| `clinical.view` | Allow | Allow | Allow | Allow | Allow |
| `clinical.edit_draft` | Allow | Allow | Deny | Allow | Deny |
| `clinical.finalize` | Deny | Deny | Deny | Deny | Deny |
| `clinical.prescription_draft` | Deny | Deny | Deny | Deny | Deny |
| `clinical.private_notes.view` | Allow | Allow | Deny | Allow | Deny |
| `clinical.private_notes.create` | Allow | Allow | Deny | Allow | Deny |
| `users.view` | Allow | Allow | Allow | Allow | Allow |
| `users.manage` | Allow | Allow | Deny | Deny | Deny |
| `access.manage` | Allow | Allow | Deny | Deny | Deny |
| `branches.view` | Allow | Allow | Allow | Allow | Allow |
| `branches.manage` | Allow | Allow | Deny | Deny | Deny |
| `settings.view` | Allow | Allow | Deny | Deny | Deny |
| `settings.manage` | Allow | Allow | Deny | Deny | Deny |
| `audit.view` | Allow | Allow | Deny | Deny | Deny |
| `audit.export` | Allow | Allow | Deny | Deny | Deny |
| `reports.view` | Allow | Allow | Allow | Allow | Allow |
| `inventory.view` | Allow | Allow | Deny | Deny | Deny |
| `inventory.manage` | Allow | Allow | Deny | Deny | Deny |
| `inventory.transfer` | Allow | Allow | Deny | Deny | Deny |
| `developer.access` | Deny | Allow | Deny | Deny | Deny |

## Clinical R1 and release recovery

Clinical R1 must use `clinical.view`, `clinical.edit_draft`, `clinical.finalize` and
`clinical.prescription_draft`, plus its separately approved clinician/resource
policy. This foundation does not implement encounters, signing, prescriptions or
clinical completion. Explicit reserved-capability overrides do not create those
workflows or settle who is qualified to finalize/prescribe.

No schema backfill is needed. The immutable chain remains 001–004; reported
production 002 still requires separately approved 003→004 catch-up. Rollback has no
SQL reversal, but code that predates this framework ignores overrides. Do not treat
that rollback as preserving explicit DENY security: retain an enforcing version or
review/revoke affected access and sessions before any authorized rollback.

See [local release evidence](../releases/2026-10-03-hybrid-access-control.md).
