// Explicitly isolated UI preview: synthetic HTTP responses, no database/auth
// imports, no clinic identities, and no mutation of the running app on port 3000.
import express from 'express';
import { createServer } from 'vite';
if (!process.argv.includes('--synthetic') || process.env.NODE_ENV === 'production') throw new Error('Use --synthetic in development only');
const app = express();
app.use(express.json());
const profile = { fullName: 'Synthetic Workspace Tester', role: 'SUPPORT_DEVELOPER', active: true, assignedBranches: ['A'], defaultBranchId: 'A' };
const failures = new Map<string, number>();
let signedIn = true;
app.post('/__audit/control', (req, res) => {
  if (req.body.profile) Object.assign(profile, req.body.profile);
  if (typeof req.body.signedIn === 'boolean') signedIn = req.body.signedIn;
  failures.clear();
  for (const [path, status] of Object.entries(req.body.failures || {})) failures.set(path, Number(status));
  res.json({ syntheticOnly: true });
});
const records: Record<string, any[]> = {
  patients: [{ id: 'patient-A', name: 'Synthetic Patient A', patientID: 'SYN-A', homeBranchId: 'A', status: 'Active' }],
  appointments: [{ id: 'appointment-A', patientId: 'patient-A', patientName: 'Synthetic Patient A', branchId: 'A', doctorId: 'doctor', appointmentDate: '2035-01-01T12:00', status: 'Scheduled', visitType: 'Initial Consultation' }],
  visits: [{ id: 'visit-A', patientId: 'patient-A', patientName: 'Synthetic Patient A', branchId: 'A', doctorId: 'doctor', visitDate: '2026-10-02T10:00', status: 'Completed' }],
  users: [{ id: 'workspace-tester', ...profile }, { id: 'doctor', fullName: 'Synthetic Doctor', role: 'doctor', active: true }],
  branches: [{ id: 'A', branchName: 'Synthetic Clinic A', status: 'Active' }, { id: 'B', branchName: 'Synthetic Clinic B', status: 'Active' }],
};
app.get('/api/auth/session', (_req, res) => res.status(signedIn ? 200 : 401).json({ user: signedIn ? { uid: 'workspace-tester', email: 'workspace@example.invalid', providerData: [{ providerId: 'google.com' }] } : null, csrfToken: 'synthetic-preview-only' }));
app.post('/api/auth/logout', (_req, res) => { signedIn = false; res.json({ ok: true }); });
app.post('/api/login-activity/record', (_req, res) => res.json({ ok: true }));
app.post('/api/data/query', async (req, res) => {
  // Controlled delay makes repeated blocking work measurable; it is not a
  // representation of production latency.
  await new Promise(resolve => setTimeout(resolve, 180));
  const { path, kind } = req.body;
  if (failures.has(path)) { res.status(failures.get(path)!).json({ error: 'Synthetic refresh failure' }); return; }
  if (kind === 'document') {
    const data = path === 'users/workspace-tester' ? profile : path === 'settings/branding' ? { appName: 'Synthetic Vine Audit', companyName: 'Synthetic Clinic', maintenanceMode: false } : path === 'settings/timezone' ? { timezone: 'Asia/Manila' } : {};
    res.json({ document: { id: path.split('/').at(-1), data } });
  } else res.json({ documents: (records[path] || []).map(({ id, ...data }) => ({ id, data })) });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Synthetic preview supports reads only' }));
const instrumentation = `
window.__workspaceAudit = {requests:[], transitions:[], mounts:{}, started:performance.now()};
const audit=window.__workspaceAudit, originalFetch=window.fetch;
window.fetch=async (...args)=>{const [url,options]=args;const entry={url:String(url),path:options?.body?JSON.parse(options.body).path:undefined,start:performance.now()};audit.requests.push(entry);try{return await originalFetch(...args)}finally{entry.end=performance.now()}};
const identities=new WeakMap();let nextIdentity=0,previous='';
const identity=(value,alternate)=>{let id=identities.get(value)||identities.get(alternate);if(!id)id=++nextIdentity;identities.set(value,id);if(alternate)identities.set(alternate,id);return id};
new MutationObserver(()=>{const sidebar=document.querySelector('#app-sidebar');let loading=/Loading (?:.*)?workspace\\.\\.\\./.test(document.body.innerText),title=document.querySelector('header h1')?.textContent||'';let state=JSON.stringify([!!sidebar,loading,title]);if(state!==previous){audit.transitions.push({at:performance.now(),shell:!!sidebar,loading,title});previous=state}
for(const el of document.querySelectorAll('#root *')){const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));if(!key)continue;let fiber=el[key];while(fiber){const name=fiber.type?.name;if(['App','BranchDashboard','TimezoneProvider'].includes(name)){const id=identity(fiber,fiber.alternate);(audit.mounts[name]??=[]);if(!audit.mounts[name].includes(id))audit.mounts[name].push(id)}fiber=fiber.return;}}}).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
`;
const vite = await createServer({ server: { middlewareMode: true, hmr: { port: 24679 }, watch: { ignored: ['**/*'] } }, plugins: [{ name: 'synthetic-navigation-audit', transformIndexHtml: () => [{ tag: 'script', children: instrumentation, injectTo: 'head' }] }] });
app.use(vite.middlewares);
const server = app.listen(3001, '127.0.0.1', () => console.log('Synthetic workspace audit preview: http://127.0.0.1:3001 (no database or real authentication)'));
process.once('SIGTERM', async () => { await vite.close(); server.close(); });
