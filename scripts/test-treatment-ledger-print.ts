import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildControlledForms, Renderer, flush, globals } from './controlled-form-harness';

// Saved React statement + real stylesheet structure. Native media/layout and
// physical printing remain separate manual acceptance checks.
const css = await readFile('src/components/treatmentLedger.css', 'utf8');
const main = await readFile('src/index.css', 'utf8');
assert.match(main, /@import "\.\/components\/treatmentLedger\.css"/);
assert.match(css, /\.treatment-ledger-print\s*\{\s*display:\s*none/);
assert.match(css, /html\.treatment-ledger-printing body > :not\(\.treatment-ledger-print\)\s*\{\s*display:\s*none !important/);
assert.match(css, /thead\s*\{\s*display:\s*table-header-group/);
assert.match(css, /tr\s*\{\s*break-inside:\s*avoid/);
assert.doesNotMatch(css, /document\.write|position:\s*fixed/);
const harness = await buildControlledForms(['TreatmentLedgerTab']);
let markup = '';
try {
  globals.servicesTestAuth.currentUser = { uid: 'synthetic-print-admin', getRequestToken: async () => 'synthetic' };
  globals.document.documentElement = { classList: { remove() {} } };
  const actor = { uid: 'synthetic-print-admin', name: 'Synthetic Recorder', role: 'admin' };
  const data = { patientId: 'patient', patientName: 'Synthetic Print Patient', redemptionPolicy: 'authorized_branches', capabilities: { canPurchase: false, canAdjust: false, canEditOrNumber: false }, branches: [], activeVisitUsages: [],
    purchases: [{ id: 'purchase', patientId: 'patient', packageName: 'Synthetic Package', branchId: 'A', branchNameSnapshot: 'Synthetic Clinic', timezoneSnapshot: 'Asia/Manila', purchaseDate: '2026-10-14', notes: 'Saved note <script>unsafe()</script>', orNumber: 'SYNTHETIC-OR', metadataRedacted: false, version: 1, actor, recordedAt: '2026-10-14T02:00:00Z', capabilities: { canEditNotes: false, canAdjust: false, canEditOrNumber: false }, lines: [{ id: 'line', serviceId: 'service', serviceNameSnapshot: 'Saved Historical Service', serviceCatalogueVersion: 1, purchasedSessions: 10, adjustmentSessions: 0, usedSessions: 1, remainingSessions: 9, version: 2 }] }],
    events: [{ id: 'usage', type: 'usage', purchaseId: 'purchase', lineId: 'line', visitId: 'visit', sessionsDelta: 0, usedDelta: 1, recordedAt: '2026-10-14T02:00:00Z', treatmentDate: '2026-10-14T10:00', actor, reason: null, reversesEventId: null, balanceAfter: { purchasedSessions: 10, adjustmentSessions: 0, usedSessions: 1, remainingSessions: 9 }, visitSnapshot: { timezoneSnapshot: 'Asia/Manila', branchNameSnapshot: 'Saved Visit Clinic', performedByNameSnapshot: 'Saved Performer', performedByDesignationSnapshot: 'Nurse', assistingStaffText: 'Synthetic Assistant', diagnosis: 'PRIVATE CLINICAL DIAGNOSIS', notes: 'PRIVATE VISIT NOTES' } }] };
  globals.fetch = async () => new Response(JSON.stringify(data));
  const renderer = new Renderer(harness.components.TreatmentLedgerTab);
  const props = { patient: { id: 'patient', patientID: 'PT-SYNTHETIC', name: data.patientName }, userRole: 'admin' };
  try {
    renderer.render(props);
    for (let i = 0; i < 10; i++) { renderer.passives.splice(0).forEach(run => run()); await flush(); if (renderer.dirty) renderer.render(props); }
    assert.equal(renderer.portals.length, 1); assert.equal(renderer.portals[0].container, globals.document.body);
    markup = renderToStaticMarkup(renderer.portals[0].children);
    assert.match(markup, /Saved treatment session statement/);
    assert.match(markup, /Purchased 2026-10-14/);
    assert.match(markup, /10:00\s*(?:AM|am).*Asia\/Manila/);
    assert.match(markup, /9 remaining after/);
    assert.match(markup, /Clinic: Saved Visit Clinic/);
    assert.match(markup, /Performed by: Saved Performer · Nurse/);
    assert.match(markup, /Assisting staff: Synthetic Assistant/);
    assert.match(markup, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(markup, /PRIVATE CLINICAL DIAGNOSIS|PRIVATE VISIT NOTES|<script>/);
    assert.doesNotMatch(markup, /<button|<input|<textarea|<select/);
    assert.equal((markup.match(/<table>/g) || []).length, 2);
  } finally { renderer.unmount(); }
} finally { await harness.cleanup(); }
const outputAt = process.argv.indexOf('--output');
if (outputAt >= 0 && process.argv[outputAt + 1]) await writeFile(process.argv[outputAt + 1], `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic saved session statement</title><style>${css}</style></head><body><div style="position:fixed;inset:0;overflow:hidden">Synthetic workspace and patient drawer</div>${markup}</body></html>`);
console.log('19/19 treatment ledger saved-print structure checks passed; native print media/layout remains unverified.');
