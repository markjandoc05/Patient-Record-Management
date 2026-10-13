import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildControlledForms, Renderer, flush, globals } from './controlled-form-harness';

// Native-browser regression: render the actual saved-chart component and load
// its real print stylesheet. No mocked window.print or CSS specificity model.
// Run this loopback fixture server, then visit its cases in screen and print
// media using the supported Browser developer capability (or print preview).
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const root = path.resolve(process.cwd());
const stylesheet = path.resolve(option('--stylesheet') || path.join(root, 'src/components/clinicalCharts.css'));
assert.equal(path.extname(stylesheet), '.css', 'Only a CSS regression input is accepted');
const css = await readFile(stylesheet, 'utf8');
const harness = await buildControlledForms(['ClinicalChartModal'], root);
let markup: string;
try {
  const actor = { uid: 'nurse', name: 'Synthetic Print Nurse', role: 'staff' };
  const profile = { id: 'nurse', email: 'print-nurse@example.invalid', fullName: actor.name,
    role: 'staff', staffDesignation: 'Nurse', active: true, accountStatus: 'active', assignedBranches: ['A'] };
  const visit = { id: 'print-visit', patientId: 'print-patient', patientName: 'Synthetic Print Patient',
    branchId: 'A', branchName: 'Synthetic Clinic', doctorId: null, visitDate: '2035-01-01T10:00',
    visitType: 'Treatment Session', status: 'Completed', performedByUserId: actor.uid,
    performedByNameSnapshot: actor.name, performedByRoleSnapshot: actor.role, performedByDesignationSnapshot: 'Nurse' };
  const context = { ...visit, visitId: visit.id, doctorId: '', doctorName: '',
    serviceId: 'synthetic-service', serviceNameSnapshot: 'Synthetic Print Service',
    serviceDurationMinutesSnapshot: 30, serviceCatalogueVersion: 1 };
  const draft = { kind: 'initial', reason: '', notes: 'Saved synthetic print notes',
    markers: ['face', 'body-front', 'body-back'].map((map, index) => ({
      id: 'point-' + index, map, x: 0.5, y: 0.4, label: 'Synthetic point ' + index, notes: 'Saved marker note ' + index,
    })), context, contextKey: 'synthetic-context', createdBy: actor, updatedBy: actor,
    createdAt: '2035-01-01T11:00:00Z', updatedAt: '2035-01-01T11:00:00Z' };
  globals.servicesTestAuth.currentUser = { uid: actor.uid, email: profile.email, getRequestToken: async () => 'synthetic' };
  globals.fetch = async () => new Response(JSON.stringify({ visitId: visit.id, visitContext: context,
    contextKey: draft.contextKey, chart: { schemaVersion: 1, version: 1, visitId: visit.id,
      draft, revisions: [], createdAt: draft.createdAt, createdBy: actor },
    permissions: { canEdit: true, canSign: false, canAmend: false }, readOnlyReason: null }));
  const renderer = new Renderer(harness.components.ClinicalChartModal);
  try {
    const props = { visit, users: [profile], userProfile: profile, userRole: 'staff', onClose() {} };
    renderer.render(props);
    for (let index = 0; index < 10; index++) {
      renderer.passives.splice(0).forEach(run => run()); await flush();
      if (renderer.dirty) renderer.render(props);
    }
    markup = renderToStaticMarkup(renderer.tree);
    assert.match(markup, /Saved clinical chart print view/, 'Actual saved print component must be present');
  } finally { renderer.unmount(); }
} finally { await harness.cleanup(); }

const cases = ['direct', 'visit-details', 'patient-drawer', 'no-chart'];
const results = new Map<string, any>();
const expected = cases.flatMap(name => ['screen', 'print'].map(media => name + ':' + media));
const server = createServer(async (req, res) => {
  if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) {
    res.writeHead(403).end(); return;
  }
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url || '/', origin);
  if (req.method === 'POST' && url.pathname === '/result' && req.headers.origin === origin) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 65536) { res.writeHead(413).end(); return; } }
    let result: any;
    try { result = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    const key = result.case + ':' + result.media;
    if (!expected.includes(key) || !Array.isArray(result.checks) || !result.checks.length) { res.writeHead(400).end(); return; }
    results.set(key, result); res.writeHead(200).end('Recorded');
    if (results.size === expected.length) void finish();
    return;
  }
  const name = url.pathname.slice(1), media = url.searchParams.get('media');
  if (!cases.includes(name) || !['screen', 'print'].includes(media || '')) { res.writeHead(404).end(); return; }
  const chart = name === 'no-chart' ? '' : name === 'direct' ? markup
    : `<div class="${name}" style="position:fixed;inset:0;overflow:hidden;max-height:60vh;transform:translateX(1px)"><div style="overflow:auto;max-height:50vh">${markup}</div></div>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Vine chart print regression</title>
    <style>.hidden{display:none}.clinical-chart-dialog{position:fixed;inset:0}.clinical-chart-dialog>div{max-height:90vh;overflow:auto} ${css}</style></head>
    <body><nav id="workspace">Synthetic workspace navigation</nav>${chart}<pre id="results"></pre>
    <script>
      const name=${JSON.stringify(name)}, expectedMedia=${JSON.stringify(media)};
      let recorded=false;
      function run(){
        const media=matchMedia('print').matches?'print':'screen';
        if(recorded || media!==expectedMedia)return;recorded=true;
        const checks=[],check=(name,passed)=>checks.push({name,passed});
        const section=document.querySelector('.clinical-chart-print'), workspace=document.querySelector('#workspace');
        if(name==='no-chart')check('Normal workspace remains visible without a chart',getComputedStyle(workspace).visibility==='visible'&&getComputedStyle(workspace).display!=='none');
        else if(media==='screen'){
          check('Saved print section remains hidden on screen',getComputedStyle(section).display==='none');
          check('Workspace remains visible on screen',getComputedStyle(workspace).visibility==='visible');
          check('Chart editor remains visible on screen',Array.from(document.querySelectorAll('.clinical-chart-no-print')).every(n=>getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility==='visible'));
        }else{
          const nodes=[section,...section.querySelectorAll('*')];
          const hidden=nodes.filter(n=>getComputedStyle(n).visibility!=='visible');
          check('All saved print descendants are visible',hidden.length===0);
          check('Saved print section has layout',section.getBoundingClientRect().height>0&&section.getBoundingClientRect().width>0);
          check('All face/front/back maps are printed',section.querySelectorAll('.clinical-chart-map').length===3);
          check('All saved marker rows are printed',section.querySelectorAll('li').length===3);
          check('Saved notes and Nurse attribution are retained',section.textContent.includes('Saved synthetic print notes')&&section.textContent.includes('Synthetic Print Nurse'));
          check('Workspace navigation is excluded',getComputedStyle(workspace).display==='none');
          check('Editor controls are excluded',Array.from(document.querySelectorAll('.clinical-chart-no-print')).every(n=>getComputedStyle(n).display==='none'));
          let ancestor=section.parentElement,unclipped=true;
          while(ancestor&&ancestor!==document.body){const s=getComputedStyle(ancestor);if(s.display==='none'||s.overflow!=='visible'||s.maxHeight!=='none')unclipped=false;ancestor=ancestor.parentElement;}
          check('Nested drawer/modal ancestors do not clip the print view',unclipped);
        }
        const result={case:name,media,checks,passed:checks.every(c=>c.passed)};
        document.querySelector('#results').textContent=JSON.stringify(result);
        fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
      }
      matchMedia('print').addEventListener('change',run);run();
    </script></body></html>`);
});
server.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const origin = 'http://127.0.0.1:' + address.port;
console.log(JSON.stringify({origin,stylesheet,cases,media:['screen','print'],requires:'Native Browser media emulation or print preview; no database or authentication'}));
let finished = false;
const timeout = setTimeout(() => { console.error('Native-browser print regression timed out; missing '+expected.filter(key=>!results.has(key)).join(', ')); void finish(true); }, 300000);
async function finish(timedOut = false) {
  if (finished) return; finished = true; clearTimeout(timeout);
  const rows = [...results.values()], passed = !timedOut && rows.length === expected.length && rows.every(r=>r.passed);
  const report = { passed, cases: rows, checks: rows.reduce((count,row)=>count+row.checks.length,0), stylesheet };
  if (option('--output')) await writeFile(path.resolve(option('--output')!), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report)); process.exitCode = passed ? 0 : 1; server.close();
}
