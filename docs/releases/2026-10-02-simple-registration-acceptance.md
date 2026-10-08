# Simplified registration — additional acceptance

October 2, 2026. User asked to proceed after simplified age/emergency-contact work.
This pass tests the current registration release; no new fields, clinical rules,
application code, schema, commit, push or deployment.

Unchanged interactive identity: markjandoc@gmail.com, existing Support / Developer.
One temporary synthetic patient; no production patient data.

| Check | Result |
| --- | --- |
| Mobile 390×844 | PASS: form width 366; scroll/client widths both 364; no horizontal document overflow or inputs beyond viewport. Mobile create/retry/edit/profile actions work. |
| Tablet 768×1024 | PASS: form width 736; no form horizontal overflow or inputs beyond viewport. |
| Desktop 1440×900 | PASS: form width 1024; no form horizontal overflow or inputs beyond viewport. |
| Escape with manual entries | PASS: discard confirmation shown; Keep editing preserves name. |
| Reload/native beforeunload | UNVERIFIED: navigation attempt was paused/rejected, form remained intact, but the tool returned no native dialog to inspect. Do not label native confirmation verified. |
| Failed registration save | PASS: synthetic intercepted HTTP 503 gives visible error and retains name, age 36 and emergency contact. |
| Successful retry | PASS: cleared interception, normal save succeeds; one patient remains in directory. |
| Birthday/contact edit | PASS: invalid contact rejected; birthday changed to 1991-10-02 and valid emergency relationship/phone saved. |
| Profile after edit | PASS: age 35, Sibling and updated emergency phone displayed. |

Geometry/functional browser checks are not a pixel-perfect visual/accessibility audit.
One screenshot capture was unusable, so visual styling claims are not based on it.
Native reload confirmation and exhaustive console/network inspection remain unverified.
Injected 503 is expected acceptance traffic; it is not a normal-operation outage.
Interception was cleared and viewport override reset to the user's normal sizing.

No code defect exposed; no implementation change needed. Existing unchanged source
already passed 29 Node 22 commands in the implementation pass (including TypeScript,
production build, 13 focused age/emergency helper checks and 24 real API checks).
Those suites were not rerun unnecessarily for documentation-only changes. Final
whitespace/diff check passes. Existing warnings remain recorded in the release note.

Cleanup verified exactly one uniquely named synthetic patient and no linked visit/
appointment, then removed patient/identity key only. Audit history and issued counter
retained. Development returns to zero patients/appointments/visits, two original users.
No demo dataset seeded. Updated this note, ROADMAP.md and the implementation release
note only; earlier uncommitted worktree changes remain separate.

The current registration candidate is ready for review with the explicitly noted
native confirmation/visual-inspection limits. No automatic production approval or
claim that all earlier clinical/intake workstreams are closed. Further feature scope
should follow the user's instruction to keep registration simple.
