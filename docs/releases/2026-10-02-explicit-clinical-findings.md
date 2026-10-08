# Patient intake — Release 3A: explicit clinical findings

Local-only October 2, 2026. No commit, push, deployment, schema migration, production
write or review/treatment gate. This is an independently useful portion of Release 3.

## Audit and scope decision

Allergies/medications/conditions were free text. Empty profile values said Not provided;
new registration defaulted skin type to Normal. No intake-version/review record or
patient/guardian-source metadata exists. VisitForm treatmentService is a placeholder
Cleaning/Check-up/Treatment selector, not a service catalog with requires-review
configuration. Existing clinicalPatientRoles allow full patient editing for admin,
doctor and existing support roles, but that does not establish who may sign a clinician
review. Do not reinterpret generic administrative edit access as clinician authority.

Implement explicit states first without changing treatment or edit rules. Service
review requirements and first-applicable-treatment entry points need a separate
audited implementation. Release 1 exact/estimated-age browser saves, responsive
checks and Release 2 native confirmation checks remain open; this work does not
close them or claim the original acceptance backlog was completed.

## Exact changes

New JSONB fields allergiesStatus, medicationsStatus and medicalConditionsStatus:
unknown, none_known, present. Shared frontend/server validation defaults missing
status to Unknown regardless of legacy text. Existing text is preserved and shown
as unconfirmed; it is never parsed into a negative finding. Present requires details;
None Known with details is rejected without automatically erasing information.
Profiles explicitly show Unknown, None Known (reported), Present, or contradictory
historical data. New skin type defaults to unassessed, while historical values remain.
Clinical entry is explicitly described as not constituting clinician review.

Existing registration roles may encode these states during creation under the
existing patient-create permission. Existing restricted demographic edit allowlists
exclude clinical status fields; staff cannot bypass clinical edit restrictions.
No new clinician role, review signature, intake provenance assertion or audit exemption.
Existing mutation authors/audits still identify who saved the record.

## Evidence

All 27 commands passed on Node 22.23.3, fresh source and disposable PostgreSQL 17:
TypeScript/build plus 23 suites. New state helper: 30 checks; clinical API: 32 real
HTTP/PostgreSQL checks covering valid states, contradictory/invalid states, inactive
account denial and existing staff edit restrictions. Birth/registration, duplicate,
lookup, appointment loading/read authorization, shared cache/profile, parity, RBAC,
audit, support and account lifecycle suites pass. Disposable fixtures/containers
removed. Existing large-bundle warning and eight moderate dependency findings remain.
Final whitespace/diff check passes.

Real local browser with unchanged Mark Support / Developer identity:
- PASS: three status selectors default Unknown; skin type defaults Not assessed.
- PASS: Present without details rejected with explicit guidance.
- PASS: None Known with details rejected; entries are not erased.
- PASS: valid synthetic registration saved with Present allergy/Unknown other states.
- PASS: opened profile shows Present details, Unknown findings and Not assessed skin.

No clinical review, restricted-user browser sign-off, treatment gate, responsive
visual sign-off or full console/network sign-off is claimed. The local backend was
restarted to load the new validator. Normal-browser date/native-confirmation tests
remain tracked in the preceding release records.

## Files, cleanup, recovery and next scope

New src/utils/clinicalFindings.ts, scripts/test-clinical-findings.ts and
scripts/test-clinical-findings-api.ts. Changed server.ts, PatientForm.tsx,
PatientProfile.tsx, package.json and roadmap/changelog/development documentation.
Review individual hunks because earlier local releases share these files.

One uniquely identified browser fixture/identity key removed after checking zero
appointment/visit references; audit history and issued ID counter retained. Zero
development patients/appointments/visits remain; two original users preserved.
No ordinary demo data seeded. No bulk legacy data conversion or schema changes.

Ready for remaining acceptance, not full Release 3 closure or deployment. Recovery
must preserve these explicit status values: an older full-edit client could lose
certainty metadata, so disable incompatible clinical edits rather than silently
downgrading records or interpreting blanks as None Known.

Next Release 3B audit/design: patient/guardian source and staff encoder attribution;
immutable intake versions; authenticated authorized-clinician review of a specific
version; patient no-change confirmations; invalidation after relevant changes or
concerns; explicit service review configuration; server checks at every applicable
treatment entry point. Establish signer authority and applicable services before
enforcement. Existing editor roles and placeholder service text cannot supply those
rules by themselves. This release implements none of those review claims.
