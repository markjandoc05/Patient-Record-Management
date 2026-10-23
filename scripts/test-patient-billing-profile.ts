import assert from 'node:assert/strict';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';

// Actual Patient Profile and embedded POS components execute with controlled
// replies. These are permission/lifecycle regressions, not browser evidence.
const h = await buildControlledForms(['PatientProfile'], process.cwd(), { exposePermissionState: true, useProductionInvalidation: true });
const actor = () => ({ active: true, role: 'staff', assignedBranches: ['A', 'B'], accessRevision: 1, permissionOverrides: { 'clinical.view': 'deny' } });
class Fixture {
  profile: any = actor();
  props: any;
  renderer = new Renderer(h.components.PatientProfile);
  requests: any[] = [];
  constructor() {
    globals.servicesTestAuth.currentUser = { uid: 'synthetic-billing', getRequestToken: async () => 'synthetic-csrf' };
    h.modules.PatientProfile.publishPermissionProfile(this.profile);
    globals.fetch = (url: string, init: any) => new Promise(resolve => this.requests.push({ url, init, deliver: (body: any, status = 200) => resolve(new Response(JSON.stringify(body), { status })) }));
    this.props = { patient: { id: 'patient-A', name: 'Synthetic Patient A' }, userProfile: this.profile, userRole: this.profile.role, users: [], branches: [], visits: [], appointments: [], onClose() {} };
  }
  async settle() { for (let n = 0; n < 12; n++) { this.renderer.passives.splice(0).forEach(run => run()); await flush(); if (this.renderer.dirty) this.renderer.render(this.props); } }
  async render() { this.renderer.render(this.props); await this.settle(); }
  billingTab() { return find(this.renderer.tree, node => node.props?.role === 'tab' && text(node).includes('Billing')); }
  async open() {
    await this.render(); assert.ok(this.billingTab(), 'Billing tab must be available');
    this.billingTab().props.onClick(); await this.settle();
    for (const request of this.requests.filter(request => request.url.endsWith('/branches'))) request.deliver({ branches: [{ id: 'A', name: 'Synthetic A', status: 'Active' }, { id: 'B', name: 'Synthetic B', status: 'Active' }] });
    await this.settle();
  }
  listRequest() { const request = this.requests.filter(request => request.url.includes('/invoices?')).at(-1); assert.ok(request, 'Billing must load invoices'); return request; }
  async reprofile(changes: any, updateProp = true) { this.profile = { ...this.profile, ...changes, accessRevision: this.profile.accessRevision + 1 }; h.modules.PatientProfile.publishPermissionProfile(this.profile); if (updateProp) this.props.userProfile = this.profile; await this.render(); }
  stop() { this.renderer.unmount(); }
}
let checks = 0;
try {
  let f = new Fixture();
  try {
    await f.open();
    assert.ok(!text(f.renderer.tree).includes('Medical overview'), 'Billing does not require clinical information');
    assert.equal(new URL(f.listRequest().url, 'https://synthetic.invalid').searchParams.get('patientId'), 'patient-A');
    assert.ok(!find(f.renderer.tree, node => node.props?.role === 'tab' && text(node).includes('Visits')));
    checks++;
  } finally { f.stop(); }
  for (const permission of ['pos.view', 'patients.view']) {
    f = new Fixture();
    try {
      await f.reprofile({ permissionOverrides: { ...f.profile.permissionOverrides, [permission]: 'deny' } });
      assert.ok(!f.billingTab(), permission + ' denial hides Billing');
      assert.equal(f.requests.filter(request => request.url.startsWith('/api/pos')).length, 0);
      checks++;
    } finally { f.stop(); }
  }
  for (const changes of [{ active: false }, { isArchived: true }]) {
    f = new Fixture();
    try { await f.reprofile(changes); assert.ok(!f.billingTab()); assert.equal(f.requests.length, 0); checks++; } finally { f.stop(); }
  }
  for (const permission of ['pos.view', 'patients.view']) {
    f = new Fixture();
    try {
      await f.open(); const pending = f.listRequest(); const before = globals.servicesTestInvalidations;
      // The published profile must override a still-stale prop in the same render.
      await f.reprofile({ permissionOverrides: { ...f.profile.permissionOverrides, [permission]: 'deny' } }, false);
      assert.ok(!f.billingTab());
      assert.equal(pending.init.signal.aborted, true, 'Open Billing unmounts immediately after revocation');
      pending.deliver({ error: 'STALE BILLING DENIAL' }, 403); await f.settle();
      assert.ok(!text(f.renderer.tree).includes('STALE BILLING DENIAL'));
      assert.equal(globals.servicesTestInvalidations, before);
      assert.equal(f.renderer.lateSetters, 0);
      checks++;
    } finally { f.stop(); }
  }
  f = new Fixture();
  try {
    await f.open(); const old = f.listRequest();
    f.props.patient = { id: 'patient-B', name: 'Synthetic Patient B' }; await f.render();
    for (const request of f.requests.filter(request => request.url.endsWith('/branches')).slice(1)) request.deliver({ branches: [{ id: 'A', name: 'Synthetic A', status: 'Active' }] });
    await f.settle();
    assert.equal(old.init.signal.aborted, true, 'Switching patients aborts the old Billing workspace');
    assert.equal(new URL(f.listRequest().url, 'https://synthetic.invalid').searchParams.get('patientId'), 'patient-B');
    old.deliver({ invoices: [{ id: 'old', number: 'STALE PATIENT A INVOICE' }], total: 1 }); await f.settle();
    assert.ok(!text(f.renderer.tree).includes('STALE PATIENT A INVOICE'));
    assert.equal(f.renderer.lateSetters, 0);
    checks++;
  } finally { f.stop(); }
  f = new Fixture();
  try {
    await f.open(); const old = f.listRequest(); const before = globals.servicesTestInvalidations;
    await f.reprofile({ assignedBranches: ['B'] });
    assert.ok(f.billingTab(), 'Remaining authorized clinic retains Billing');
    assert.equal(old.init.signal.aborted, true, 'Changing authorized clinics resets the Billing workspace');
    old.deliver({ error: 'STALE CLINIC A DENIAL' }, 403); await f.settle();
    assert.ok(!text(f.renderer.tree).includes('STALE CLINIC A DENIAL'));
    assert.equal(globals.servicesTestInvalidations, before);
    assert.equal(f.renderer.lateSetters, 0);
    checks++;
  } finally { f.stop(); }
  console.log(`Patient Billing Profile: ${checks} controlled integration scenarios passed (not browser evidence)`);
} finally { await h.cleanup(); }
