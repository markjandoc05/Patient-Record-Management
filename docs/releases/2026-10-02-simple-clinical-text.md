# Simple allergies and current medications entry

## Follow-up: medical conditions also simplified

The user subsequently requested removal of Medical conditions status as well.
All three findings now use labelled textareas with no status selectors. The same
preservation/unconfirmed edit behavior applies to medical conditions. Existing
server validation and stored states remain; no data migration or negative inference.
Focused tests expanded to 48 checks. This follow-up supersedes the original scope
below, which records the earlier two-field change.

User-requested local refinement, October 2, 2026. Remove only the Allergies status
and Current medications status selectors from PatientForm (registration and full
edit). Keep Allergies and Current medications textareas. Medical conditions retains
its existing state selector. Birthday/age, emergency contact and other fields remain.

The shared reportedFindingEdit helper preserves a stored state for unchanged details.
Editing either text field resets that finding to Unknown/unconfirmed; it never
infers None Known or Present from text. Clearing Present details therefore saves
Unknown rather than leaving an invisible validation failure. Adding details to an
old None Known finding also clears the stale structured assertion. Existing untouched
reported findings and legacy text are retained. Server validation, profile labels,
role restrictions, JSONB structure and clinical review policy are unchanged.

Validation this pass: TypeScript passes; production build passes with the existing
large-chunk warning; clinical-finding helper suite passes 42 checks (12 additional
preservation/edit/blank/validation scenarios). Live browser verified both selectors
absent, both text fields accept entries and medical-conditions selector remains.
Synthetic unsaved entries discarded through the existing confirmation; no database
fixtures or patient records created. Mark's existing Support / Developer session used.
No new save/API integration or clinician-review evidence is claimed in this pass.
Checks ran on the local runtime; prior Node 22 full validation is separate evidence.

Files: PatientForm.tsx, clinicalFindings.ts, test-clinical-findings.ts and these
roadmap/changelog/release notes. Recovery is source-only; preserve stored records.
No commit, push, deployment, schema migration or production data change.
