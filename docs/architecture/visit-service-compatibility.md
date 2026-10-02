# Visit / Service compatibility

Services 1B-B uses the existing Visit JSONB record. No migration or backfill.
An Appointment's four canonical Service fields describe **booked** Service; the
same fields on a Visit describe **performed** Service. The record boundaries keep
these facts separate. No alternate namespace or current-catalogue name resolution
is needed to read historical records.

## Dedicated write contract

POST/PATCH `/api/records/visits` accepts `serviceSelection` only as intent:

- Omitted: no canonical selection on create, or retain historical snapshot on edit.
- Object `{ serviceId, expectedVersion }`: validate current eligibility and capture
  authoritative ID, name, duration and version. Mirror the authoritative name into
  `treatmentService` for legacy readers. Direct snapshot fields are rejected.
- Null: explicit removal of all four canonical fields. Clear `treatmentService`
  when it equals the former canonical name; preserve a distinct imported description
  exactly. Removal is audited and available only on an otherwise editable Visit.

No command, price, invoice, payment, consumable usage, package redemption or new
completion transaction is stored. Existing clinical create/edit, patient summaries,
appointment linking/completion, archive/restore and trusted audit transactions stay.
Generic data writes continue to reject Visit mutations.

New selections require an active Service, active Visit branch, Service availability,
configured effective price or explicit Free, matching version, current clinical
write permission and branch access. Inheritance/branch overrides use Services 1A.
The same transaction lock serializes catalogue revisions and Visit writes. Writer
role/access is re-read inside the lock. Doctors remain limited to their own Visits.

## Historical and older records

Untouched `treatmentService` is retained byte-for-byte on edit, including whitespace
and imported text beyond today's entry limit. Changed free text follows existing
validation. Omission does not erase text. Unknown JSONB, `servicePerformed`, records
with no canonical fields and orphan/inactive/unavailable/unpriced snapshots survive.
No matching by name and no automatic conversion of an appointment-linked legacy Visit.

Display order: recorded canonical name when its ID is present; `treatmentService`;
`servicePerformed`; the existing per-view fallback. History and timeline do not look
up live catalogue names. The selector labels price as current catalogue reference;
it is neither a charged price nor an amount due.

For appointment-derived new Visits the booked snapshot is visible and proposed,
with explicit current-detail review/confirmation required. Another eligible Service
or explicit no-Service choice is possible. Visit writes never rewrite booked fields;
the existing create path still links and completes the appointment.

Persisted performed history survives branch navigation and catalogue failure/retry.
A→B→A without Service interaction retains the command omission. A permanent change
requires an eligible replacement or explicit removal. New unsaved selections reset
to omission on branch change. A version 409 requires targeted review, explicit
confirmation of displayed/submitted version together, and a manual save; no auto retry.
Branch/scope generations, keyed workspaces, abort/current guards and protected-data
invalidation discard old list/detail/save/token/follow-up responses and denials.
Save UI also captures an immutable performed-Service intent revision (kind, ID,
version, branch and review state). A newer choice or confirmation makes old conflict,
error, close and follow-up feedback stale, including intent A→B→A. Current conflicts
still require explicit review/manual save. Protected-scope 401/403 invalidation stays
authoritative even if Service intent changed. A successful create keeps its returned
Visit ID and the newer unsaved draft; a later save updates that record instead of
creating another, including after refreshed appointment/Visit data arrives.

## Clinical policy and existing limitations

The committed application has no clinical signature/finalization or amendment flow.
`Completed` is an operational Visit status and remains editable through existing
clinical permissions and audit. Explicit `isSigned`, `isFinalized`, `signedAt`,
`finalizedAt`, `Signed` or `Finalized` markers make the Visit read-only in the form and
server edit route. This defensive guard does not establish a signing or amendment
policy; that design remains a separate release.

Existing `assertDoctorAvailability` excludes a Visit when its `appointmentId`
matches the exclusion value, including two null values for unlinked Visits.
Consequently duplicate walk-in slot protection has a pre-existing gap. Services
1B-B preserves this logic; it adds neither a conflict repair nor duration scheduling.
Booking conflicts and linked-Visit consistency protections remain enforced.

## Schema and deployment compatibility

One immutable migration chain: 001 → 002 → 003 → 004. No 005. Local development
ledger observed at 004 with matching committed checksums. Production remains
reported at 002; not connected or inspected during this task. Future deployment must
separately authorize and apply the same committed 003 then 004, then compatible code.
The pending release gap is expected; new actual-schema parity was not audited here.

Older clients can omit selection and edit other fields within the existing branch.
Older application writers preserve unknown JSONB on updates but do not enforce this
selection/seal contract; do not run mixed writer versions with canonical performance
writes enabled. A rollback must suspend new selection writes and assess historical
snapshot/alias preservation before enabling old writers. No destructive schema
rollback is required or supplied. Production and DARF remain untouched.
