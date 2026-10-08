# Patient profile and appointment history audit

October 2, 2026. Audit only: application code and all databases unchanged. No commit,
push or deployment. Existing markjandoc@gmail.com Support / Developer session used.
No additional Google authentication required. No patient or account fixture created.

## Existing implementation

PatientDashboard subscribes to patients, users, branches, appointments and permitted
visits through the existing five-second polling client. Appointment requests are
unfiltered on the client but server-scoped; shared patient reads are a separate
established policy. PatientProfile already has Visits, Appointments, Notes and Media.
PatientAppointments matches patientId, excludes archived appointments, sorts newest
first, pages five records at a time and opens a read-only detail card. It shows visit
type, not a linked service catalog item. Appointment history is not a placeholder.

The generic POST /api/data/query path applies scopeAppointmentRead before client
filters and asserts direct appointment document access. Current assignments are
re-read in the transaction. Administrative roles retain global appointment reads;
other approved roles are restricted to assigned branches. Existing polling guards
prevent cleaned-up or invalidated responses from publishing. This audit found no
reason to remove those controls or change shared patient/visit policy.

## Findings and evidence strength

| Area | Classification | Evidence / impact |
| --- | --- | --- |
| Patient association, archive exclusion, date ordering, labels | Working in render checks | Real component renders matching active appointments only, newest first; provider, clinic and status labels resolve. Populated browser workflow not tested this pass. |
| Directory loading and empty result | Working in browser | Observed loading skeleton followed by zero-record directory in the authenticated local app. |
| Appointment branch read scope | Implemented; helper checks pass | Current collection/direct-read server helpers enforce assigned scope. Prior 236-assertion PostgreSQL/HTTP suite passed; not rerun this audit. |
| Error state in profile appointment tab | Incomplete / misleading empty possible | Dashboard can finish a failed initial appointment request with appointments=[] after patients have loaded. It shows a directory warning, but passes only arrays to the profile. The overlaid history renders “No appointments scheduled yet.” without knowing the request failed. |
| Transient failure retention | Partial | Shared subscription retains data and directory warns. Profile gets no error, stale-data warning or retry action. Directory Retry resets arrays and closes the profile. |
| Pagination after records shrink | Source-confirmed defect | currentPage is not clamped/reset. Page 2 with six records becomes an empty page after the sixth record is archived, despite five records remaining; Next is disabled only on equality, so page 2 of 1 can advance further. No mounted/browser reproduction this pass. |
| Open appointment details after poll changes | Source-confirmed stale-state defect | selectedAppointment stores the old object, with no reconciliation against current props. Updates, archive or removal can leave stale details open. Authorization invalidation at the dashboard closes the profile; this is not evidence of a server read bypass. |
| Open patient demographics after poll changes | Source-confirmed stale-state issue | selectedPatient also stores the original object; demographic fields do not reconcile with the updated patients array. Separate small profile task recommended. |
| Keyboard detail access | Missing | History rows are clickable divs without keyboard interaction or tab focus. Detail overlay lacks dialog semantics. |
| Nested Escape behavior | Incomplete | Profile Escape handler always closes the parent, even when the appointment form/detail overlay is open. Requires focused browser acceptance before claiming a fix. |
| Profile booking continuity | Incomplete | New appointment supplies patients=[patient] but no appointment/default clinic; AppointmentForm initializes patientId to empty. Profile passes all branches rather than accessibleBranches. Server still rejects unauthorized writes; frontend options/context deserve a separate booking task. |
| Service name | Missing data linkage | Existing appointment uses visitType; no verified service ID/catalog linkage. Do not invent a service field for this release. |

## Checks actually performed

- Read current profile, history, directory, appointment form, RBAC, branch helpers,
  generic query authorization, polling lifecycle and relevant roadmap/deployment docs.
- Browser: existing Mark session, normal directory loading and successful empty state.
  Current overview/directory show zero patients/appointments; no data seeded.
- Reran test:shared-data: 32 checks passed, using controlled requests and static
  profile rendering. These are not Google OAuth or PostgreSQL/browser tests.
- Private audit probe: 10 static-render/pure authorization helper checks passed;
  no database connected. Probe is outside the repository and not a release test.
- Existing prior Node 22 combined release validation was reviewed, not rerun or
  relabelled as new evidence. No TypeScript/build rerun needed for audit-only work.
- Populated profile, mounted pagination/selection behavior, real restricted-user
  browser session and comprehensive console/network inspection remain unverified.

## Recommended smallest release: reliable history state

Keep the current layout, branch policies, appointment fields and five-second polling.
Pass appointment request readiness/error/retry status into the existing profile/tab.
Show a successful empty result only after a successful request. On transient failures,
retain previously authorized records with an inline warning. Retry should preserve
the open profile where safe. Authorization failures must clear protected data and
close/reconcile details. Clamp history pagination and derive selected details from
current authorized records by ID, closing if removed or archived. Make the existing
detail action keyboard-accessible without adding booking functionality.

Acceptance: delayed initial data, successful empty, initial failure, loaded data then
503, unchanged-data recovery/retry, 401/403 after failure, cleanup/stale responses,
page shrink, selected record update/archive, correct patient IDs and restricted/admin
scope. Test directly affected directory/profile behavior and existing booking; use
minimal disposable fixtures and remove them. No schema migration or new business
rule needed. Clarification is required only if the clinic wants history from branches
outside the current user's scope, an archived-history view, or service catalog fields.

Source recovery is sufficient because this proposal changes view state only.
No older database snapshot restoration. Current registration, account identities,
permissions and audit history must remain intact. Patient demographic freshness,
profile booking defaults/options and broader focus/Escape behavior should be tracked
separately unless the chosen release directly exposes a necessary related defect.

Audit complete with the stated coverage limits. No fix implemented in this pass.
