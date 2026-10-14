# Patient Gallery R1

Approved October 14, 2026; local implementation on c0060e8.

Patient Profile → Gallery replaces the existing Media presentation. Photos remain
attachments of saved Visits. No new appointment, Visit, Doctor assignment, package,
billing, chart or permission workflow is introduced.

## Photo workflow

Authorized users choose a saved Visit, label a selected batch Before, After or
Progress, confirm the clinic-local photo date/time, and optionally enter an area or
angle and a note. Selected thumbnails can be removed before upload. Up to four
images belong to each Visit; Progress uses the same allowance. There are no fixed
quotas per label. Generic Visit image uploads also count, preventing an alternate
upload path from bypassing the cap. Existing overall file-count, extension and
size settings still apply; documents can reduce available upload slots.

Uploads use existing image optimization/private attachment storage. The browser
resizes images and removes EXIF during optimization. Server checks file signatures,
allowed formats, size, current permissions and image counts. The four-image check
runs again in the save transaction, including parallel uploads and legacy images.

A partial batch retains only files whose success was not confirmed. An uncertain
network/5xx result blocks another upload until an explicit saved-Visit reload;
reload discards the ambiguous selection and asks the user to select only missing
photos. No automatic retry or duplicate upload is introduced.

## Presentation and preservation

Newest photos appear first. Label/date/treatment-area search, paged protected
previews, full-size zoom and a two-photo comparison are provided. Any two photos
from the same patient can be compared, including photos from different Visits.
Comparison is side by side on desktop and stacked on mobile. Overlays mount into
the body above the patient drawer/sidebar with keyboard closure and focus handling.

Existing photos remain Unclassified; existing notes, IDs, storage paths, upload
attribution and binaries are preserved. Visits already above four photos stay
readable without forced deletion. Nonimage Visit attachments remain in Other Visit
files with their existing protected open/download actions. General patient and
appointment file workflows remain unchanged. Archived Visits remain excluded from
this gallery as they were from Media; their existing protected content read policy
is unchanged.

Photo metadata is optional JSONB attachment data:
`photo = {schemaVersion, stage, takenAt, area, timezone, version, updatedAt,
updatedByUid}`. The attachment's existing `note` remains its caption. Photo time is
literal clinic wall-clock time; upload/update timestamps are server instants.
Timezone and update identity/version are server-authored. Legacy classification
starts at expectedVersion0; subsequent saves require the captured version. A409
retains the draft/version until explicit Reload photo and review. Local upload
previews yield to acknowledged server records, newer metadata and deletion.
Acknowledgement history lasts for the protected Gallery workspace, including
photos observed and deleted before a pending upload response arrives. A late
upload reply cannot restore those photos. Pagination clamps immediately when
deletion or a metadata/filter change reduces the available pages. The Visit
attachment selector still allows document-only additions to over-limit historical
photo collections within the existing total-file limit; new images remain capped.

## Permissions and scope

Reads retain the existing shared patient/longitudinal clinical model and require
Patient, Visit and clinical viewing. Upload/edit/remove requires the existing
Visit-file capability, clinical viewing and access to the Visit's operating branch.
Existing Doctor, Admin and designated Nurse/Medical Staff defaults apply; ordinary
Staff/Manager defaults and explicit denials remain unchanged. No new role/grant or
Doctor ownership rule is created. Archived patient/Visit writes are denied, and
actor, patient relationship, archive state and branch scope are rechecked in each
transaction. File removal and metadata edits are attributed in audit history;
clinical captions are not copied into audit entries.

Patient/account/permission/Visit-context lifetimes guard previews, upload drafts,
settings, metadata writes and removals. Late replies cannot restore removed photos,
modify a new scope or invalidate a newer session. Object URLs are revoked when
previews change, access ends or the component unmounts.

## Schema and release boundary

Existing `app_records` JSONB and private file storage are adequate. No SQL migration
or data backfill. Committed migrations001–005 remain immutable. Old clients can
continue using ordinary attachments; older APIs lack Gallery metadata editing and
the new cap, so future deployment must update the upload-serving instances together.
Code rollback preserves photo files/metadata but loses Gallery-specific controls.
Private media remains part of the existing file-volume backup/recovery boundary.
Local validation is not production deployment or a full restricted-role browser
release sign-off.
