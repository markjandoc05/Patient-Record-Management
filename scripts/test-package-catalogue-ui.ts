import assert from 'node:assert/strict';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';
const harness = await buildControlledForms(['TreatmentLedgerTab', 'PackageCatalogueDashboard', 'ServicesDashboard'], process.cwd(), { exposePermissionState: true, useProductionInvalidation: true });
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor = { uid: 'account', name: 'Synthetic Admin', role: 'admin' };
const service = { id: sid, name: 'Synthetic Service', active: true, version: 4, default_duration_minutes: 30, branches: ['A', 'B'].map(id => ({ id, operationallyAvailable: true, effectivePrice: { mode: 'free', amount: '0.00' } })) };
const packageRow = (extra: any = {}) => ({ id, name: 'Synthetic package', description: 'Synthetic package details', active: true, version: 1, actor, recordedAt: '2035-01-01T01:00:00Z', eligible: true,
  lines: [{ serviceId: sid, serviceName: 'Original Service name', currentServiceName: service.name, serviceCatalogueVersion: 3, currentServiceVersion: 4, serviceActive: true, sessions: 6 }], ...extra });
const ledger = (extra: any = {}) => ({ patientId: 'patient', patientName: 'Synthetic Patient', purchases: [], events: [], activeVisitUsages: [], branches: [{ id: 'A', name: 'Clinic A', status: 'Active' }], capabilities: { canPurchase: true, canAdjust: true, canEditOrNumber: true }, redemptionPolicy: 'authorized_branches', ...extra });
class Fixture {
  renderer: Renderer; props: any; requests: any[] = []; profile: any; closes = 0;
  constructor(public component = 'TreatmentLedgerTab') {
    globals.servicesTestInvalidations = 0;
    globals.servicesTestAuth.currentUser = { uid: 'account', getRequestToken: async () => 'synthetic' };
    globals.window.confirm = () => false;
    globals.document.documentElement = { classList: { add() {}, remove() {} } };
    this.profile = { id: 'account', fullName: actor.name, role: 'admin', active: true, assignedBranches: ['A', 'B'], accessRevision: 1 };
    harness.modules[component].publishPermissionProfile(this.profile);
    globals.fetch = (url: string, init: any) => {
      if (url.startsWith('/api/services?')) return Promise.resolve(new Response(JSON.stringify({ services: [service], branches: [{ id: 'A', name: 'Clinic A' }], total: 1 })));
      if (url.startsWith('/api/services/')) return Promise.resolve(new Response(JSON.stringify(service)));
      if (url.startsWith('/api/service-categories')) return Promise.resolve(new Response(JSON.stringify({ categories: [] })));
      return new Promise((resolve, reject) => this.requests.push({ url, init, deliver: (body: any, status = 200) => resolve(new Response(JSON.stringify(body), { status })), fail: () => reject(new TypeError('Synthetic lost response')) }));
    };
    this.renderer = new Renderer(harness.components[component]);
    this.props = component === 'TreatmentLedgerTab' ? { patient: { id: 'patient', name: 'Synthetic Patient' }, userRole: 'admin' }
      : { userProfile: this.profile, activeBranchId: 'A', onServices: () => this.closes++ };
  }
  render() { this.renderer.render(this.props); }
  async settle() { for (let i = 0; i < 12; i++) { this.renderer.passives.splice(0).forEach(f => f()); await flush(); if (this.renderer.dirty) this.render(); } }
  async start() { this.render(); await this.settle(); }
  button(label: string) { const n = find(this.renderer.tree, n => n.type === 'button' && text(n).trim() === label); assert.ok(n, 'Missing button ' + label); return n; }
  label(label: string) { const n = find(this.renderer.tree, n => n.type === 'label' && text(find(n.props.children, c => c.type === 'span')).replace(/\s+/g, ' ').includes(label)); assert.ok(n, 'Missing label ' + label); const input = find(n.props.children, n => ['input', 'select', 'textarea'].includes(n.type)); assert.ok(input); return input; }
  async click(label: string) { const n = this.button(label); if (!n.props.disabled) n.props.onClick(); await this.settle(); }
  async change(label: string, value: any) { this.label(label).props.onChange({ target: { value, checked: value } }); await this.settle(); }
  async submit() { const form = find(this.renderer.tree, n => n.type === 'form'); assert.ok(form); form.props.onSubmit({ preventDefault() {} }); await this.settle(); }
  async loaded(data = ledger()) { await this.start(); this.requests[0].deliver(data); await this.settle(); }
  async purchase(total = 1, data = ledger()) { await this.loaded(data); await this.click('Record purchase'); if (data.branches.length > 1) await this.change('Purchase clinic', 'A'); await this.change('Purchase source', 'catalogue'); this.requests.at(-1).deliver({ packages: [packageRow()], total }); await this.settle(); }
  async select(p = packageRow()) { await this.change('Catalogue package', p.id); this.requests.at(-1).deliver(p); await this.settle(); }
  async catalogue(p = packageRow()) { await this.start(); this.requests[0].deliver({ packages: [p], total: 1 }); await this.settle(); await this.click('Edit'); this.requests.at(-1).deliver(p); await this.settle(); }
  permission(profile: any, render = true) { this.profile = profile; harness.modules[this.component].publishPermissionProfile(profile); if (this.component !== 'TreatmentLedgerTab') this.props.userProfile = profile; else this.props.userRole = profile.role; if (render) this.render(); }
  stop() { this.renderer.unmount(); }
}
const packageLists = (f: Fixture) => f.requests.filter(request => request.url.startsWith('/api/packages?'));
const query = (request: any) => new URL(request.url, 'http://synthetic.invalid').searchParams;
const hasButton = (f: Fixture, label: string) => !!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === label);
async function remainsSettled(f: Fixture, requestCount: number) {
  for (let pass = 0; pass < 3; pass++) { f.render(); await f.settle(); assert.equal(f.requests.length, requestCount, 'Settling or rerendering must not start another request'); }
}
function assertCatalogueBlocked(f: Fixture) {
  assert.match(text(f.renderer.tree), /Package catalogue access changed/);
  assert.ok(hasButton(f, 'Retry packages'));
  assert.ok(!hasButton(f, 'Create package') && !hasButton(f, 'Save new version'));
  assert.doesNotMatch(text(f.renderer.tree), /Synthetic package details|OLD_PROTECTED_PACKAGE|OLD_PROTECTED_DRAFT/);
}
async function changeCatalogueScope(f: Fixture, kind: string) {
  if (kind === 'branch') { f.props.activeBranchId = 'B'; f.render(); }
  else if (kind === 'account') {
    globals.servicesTestAuth.currentUser = { ...globals.servicesTestAuth.currentUser, uid: 'new-account' };
    f.permission({ ...f.profile, id: 'new-account' });
  } else if (kind === 'permission') f.permission({ ...f.profile, permissionOverrides: { 'packages.manage': 'deny' } });
  else f.permission({ ...f.profile, accessRevision: f.profile.accessRevision + 1 });
  await f.settle();
}
async function purchaseMetadata(f: Fixture) {
  await f.change('Package notes', 'KEEP PAGED NOTE'); await f.change('OR#', '000042'); await f.change('Purchase date', '2035-01-09');
}
function assertPurchaseMetadata(f: Fixture, selected = true) {
  assert.equal(f.label('Package notes').props.value, 'KEEP PAGED NOTE');
  assert.equal(f.label('OR#').props.value, '000042'); assert.equal(f.label('Purchase date').props.value, '2035-01-09');
  if (selected) { assert.equal(f.label('Catalogue package').props.value, id); assert.match(text(f.renderer.tree), /6\s+sessions/); }
}
async function pendingCatalogueRequest(f: Fixture, kind: string) {
  if (kind === 'retry') {
    await f.start(); f.requests[0].deliver({ error: 'Initial denied' }, 403); await f.settle(); await f.click('Retry packages');
  } else if (kind === 'detail') {
    await f.start(); f.requests[0].deliver({ packages: [packageRow({ name: 'OLD_PROTECTED_PACKAGE' })], total: 1 }); await f.settle(); await f.click('Edit');
  } else {
    await f.catalogue(packageRow({ name: 'OLD_PROTECTED_PACKAGE' }));
    if (kind === 'save') { await f.change('Package name', 'OLD_PROTECTED_DRAFT'); await f.submit(); }
    else await f.click('View version history');
  }
  return f.requests.at(-1);
}
const results: { name: string; passed: boolean; error?: string }[] = [];
async function check(name: string, run: (f: Fixture) => Promise<void>, component?: string) {
  const f = new Fixture(component); try { await run(f); results.push({ name, passed: true }); } catch (e: any) { results.push({ name, passed: false, error: e.message }); } finally { f.stop(); }
}
try {
  await check('catalogue purchase posts only reviewed references and preserves purchase metadata', async f => {
    await f.purchase(); await f.change('Package notes', 'Unsubmitted patient note'); await f.change('OR#', '000009'); await f.change('Purchase date', '2035-01-07'); await f.select();
    assert.match(text(f.renderer.tree), /6\s+sessions/); assert.ok(!find(f.renderer.tree, n => n.type === 'input' && n.props.type === 'number'));
    await f.submit(); const body = JSON.parse(f.requests.at(-1).init.body);
    assert.equal(body.catalogueSelection.packageId, id); assert.equal(body.catalogueSelection.expectedVersion, 1);
    assert.deepEqual(body.catalogueSelection.serviceVersions, [{ serviceId: sid, expectedServiceVersion: 4 }]);
    assert.equal(body.notes, 'Unsubmitted patient note'); assert.equal(body.orNumber, '000009'); assert.equal(body.purchaseDate, '2035-01-07');
    assert.ok(!Object.hasOwn(body, 'lines') && !Object.hasOwn(body, 'packageName'));
    assert.ok(find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled));
  });
  await check('stale package requires review; reload preserves date notes and OR while adopting reviewed contents', async f => {
    await f.purchase(); await f.select(); await f.change('Package notes', 'KEEP NOTE'); await f.change('OR#', '000007'); await f.change('Purchase date', '2035-01-08');
    await f.submit(); f.requests.at(-1).deliver({ error: 'Package changed', code: 'PACKAGE_VERSION_CHANGED' }, 409); await f.settle();
    assert.equal(f.button('Save package purchase').props.disabled, true);
    await f.click('Reload selected package'); const fresh = packageRow({ version: 2, name: 'Revised package', lines: [{ ...packageRow().lines[0], sessions: 9, currentServiceVersion: 5 }] });
    f.requests.at(-1).deliver(fresh); await f.settle();
    assert.equal(f.label('Package notes').props.value, 'KEEP NOTE'); assert.equal(f.label('OR#').props.value, '000007'); assert.equal(f.label('Purchase date').props.value, '2035-01-08');
    assert.match(text(f.renderer.tree), /9\s+sessions/); await f.submit(); const body = JSON.parse(f.requests.at(-1).init.body);
    assert.equal(body.catalogueSelection.expectedVersion, 2); assert.equal(body.catalogueSelection.serviceVersions[0].expectedServiceVersion, 5);
  });
  await check('lost catalogue purchase response freezes controls and retries the exact command', async f => {
    await f.purchase(); await f.select(); await f.submit(); const first = JSON.parse(f.requests.at(-1).init.body);
    f.requests.at(-1).fail(); await f.settle(); assert.ok(find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled));
    const count = f.requests.length; await f.click('Reload selected package'); assert.equal(f.requests.length, count);
    await f.submit(); assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), first);
  });
  await check('manual purchase remains available and emits its unchanged contract', async f => {
    await f.loaded(); await f.click('Record purchase'); assert.equal(f.label('Purchase source').props.value, 'manual');
    await f.change('Package name', 'Custom purchase'); await f.change('Service 1', sid); await f.change('Sessions', '3'); await f.submit();
    const body = JSON.parse(f.requests.at(-1).init.body); assert.equal(body.packageName, 'Custom purchase'); assert.equal(body.lines[0].purchasedSessions, 3); assert.ok(!Object.hasOwn(body, 'catalogueSelection'));
  });
  await check('empty eligible list offers manual fallback', async f => { await f.loaded(); await f.click('Record purchase'); await f.change('Purchase source', 'catalogue'); f.requests.at(-1).deliver({ packages: [], total: 0 }); await f.settle(); assert.match(text(f.renderer.tree), /No eligible packages match/); assert.equal(f.button('Save package purchase').props.disabled, true); });
  await check('purchase picker refetches page one when page two shrinks from 26 packages to one and preserves the reviewed purchase', async f => {
    await f.purchase(26); await f.select(); await purchaseMetadata(f); await f.click('Next packages');
    assert.equal(query(f.requests.at(-1)).get('page'), '2'); f.requests.at(-1).deliver({ packages: [], total: 1 }); await f.settle();
    assert.equal(packageLists(f).length, 3); assert.equal(query(f.requests.at(-1)).get('page'), '1');
    assert.doesNotMatch(text(f.renderer.tree), /No eligible packages match/);
    f.requests.at(-1).deliver({ packages: [packageRow({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Remaining eligible package' })], total: 1 }); await f.settle();
    assert.match(text(f.label('Catalogue package')), /Remaining eligible package/); assertPurchaseMetadata(f);
    assert.ok(!hasButton(f, 'Previous packages') && !hasButton(f, 'Next packages')); await remainsSettled(f, f.requests.length);
    await f.submit(); const body = JSON.parse(f.requests.at(-1).init.body);
    assert.equal(body.catalogueSelection.packageId, id); assert.equal(body.purchaseDate, '2035-01-09'); assert.equal(body.notes, 'KEEP PAGED NOTE'); assert.equal(body.orNumber, '000042');
  });
  await check('purchase picker clamps page three to page two after the eligible total shrinks to 26', async f => {
    await f.purchase(51); await f.select(); await purchaseMetadata(f); await f.click('Next packages');
    f.requests.at(-1).deliver({ packages: [packageRow()], total: 51 }); await f.settle(); await f.click('Next packages');
    assert.equal(query(f.requests.at(-1)).get('page'), '3'); f.requests.at(-1).deliver({ packages: [], total: 26 }); await f.settle();
    assert.equal(packageLists(f).length, 4); assert.equal(query(f.requests.at(-1)).get('page'), '2');
    f.requests.at(-1).deliver({ packages: [packageRow({ name: 'Valid second page' })], total: 26 }); await f.settle();
    assert.match(text(f.renderer.tree), /Page\s+2/); assert.equal(f.button('Previous packages').props.disabled, false); assert.equal(f.button('Next packages').props.disabled, true);
    assertPurchaseMetadata(f); await remainsSettled(f, f.requests.length);
  });
  await check('purchase picker reaches the valid first-page empty state when no packages remain', async f => {
    await f.purchase(26); await f.select(); await purchaseMetadata(f); await f.click('Next packages');
    f.requests.at(-1).deliver({ packages: [], total: 0 }); await f.settle(); assert.equal(packageLists(f).length, 3); assert.equal(query(f.requests.at(-1)).get('page'), '1');
    assert.doesNotMatch(text(f.renderer.tree), /No eligible packages match/); f.requests.at(-1).deliver({ packages: [], total: 0 }); await f.settle();
    assert.match(text(f.renderer.tree), /No eligible packages match/); assert.ok(!hasButton(f, 'Previous packages') && !hasButton(f, 'Next packages'));
    assertPurchaseMetadata(f); await remainsSettled(f, f.requests.length);
  });
  for (const transition of ['search', 'branch']) for (const status of [200, 401, 403]) await check(`old purchase page ${status} cannot replace results or clamp after ${transition} changes`, async f => {
    await f.purchase(26, ledger({ branches: [{ id: 'A', name: 'Clinic A' }, { id: 'B', name: 'Clinic B' }] })); await f.select(); await purchaseMetadata(f);
    await f.click('Next packages'); const old = f.requests.at(-1);
    if (transition === 'search') await f.change('Find a package', 'current'); else await f.change('Purchase clinic', 'B');
    const current = f.requests.at(-1), count = f.requests.length; assert.notEqual(current, old); assert.equal(query(current).get('page'), '1');
    assert.equal(query(current).get(transition === 'search' ? 'q' : 'branchId'), transition === 'search' ? 'current' : 'B');
    current.deliver({ packages: [packageRow({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'CURRENT_SCOPE_RESULT' })], total: 1 }); await f.settle();
    old.deliver(status === 200 ? { packages: [], total: 0 } : { error: 'OLD_PAGE_DENIAL' }, status); await f.settle();
    assert.match(text(f.label('Catalogue package')), /CURRENT_SCOPE_RESULT/); assert.doesNotMatch(text(f.renderer.tree), /OLD_PAGE_DENIAL|No eligible packages match|Loading packages/);
    assertPurchaseMetadata(f, transition === 'search'); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0); await remainsSettled(f, count);
  });
  await check('unavailable package detail cannot become selected', async f => { await f.purchase(); await f.select(packageRow({ eligible: false })); assert.match(text(f.renderer.tree), /unavailable at this clinic/); assert.equal(f.button('Save package purchase').props.disabled, true); });
  await check('catalogue reload keeps an open manual draft and purchase metadata', async f => {
    await f.loaded(); await f.click('Record purchase'); await f.change('Package name', 'KEEP CUSTOM'); await f.change('Package notes', 'KEEP NOTES');
    await f.change('Purchase source', 'catalogue'); f.requests.at(-1).deliver({ packages: [], total: 0 }); await f.settle(); await f.change('Purchase source', 'manual');
    assert.equal(f.label('Package name').props.value, 'KEEP CUSTOM'); assert.equal(f.label('Package notes').props.value, 'KEEP NOTES');
  });
  for (const status of [200, 401, 403, 409]) await check(`old package detail ${status} discarded after purchase branch change`, async f => {
    await f.loaded(ledger({ branches: [{ id: 'A', name: 'Clinic A' }, { id: 'B', name: 'Clinic B' }] })); await f.click('Record purchase'); await f.change('Purchase clinic', 'A'); await f.change('Purchase source', 'catalogue'); f.requests.at(-1).deliver({ packages: [packageRow()], total: 1 }); await f.settle();
    await f.change('Catalogue package', id); const old = f.requests.at(-1); await f.change('Purchase clinic', 'B');
    old.deliver(status === 200 ? packageRow({ name: 'OLD_PACKAGE_DETAIL' }) : { error: 'OLD_PACKAGE_ERROR' }, status); await f.settle();
    assert.doesNotMatch(text(f.renderer.tree), /OLD_PACKAGE_DETAIL|OLD_PACKAGE_ERROR|6 sessions/); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
  });
  for (const status of [200, 401, 403, 409]) await check(`old catalogue purchase ${status} ignored after account change`, async f => {
    await f.purchase(); await f.select(); await f.submit(); const old = f.requests.at(-1);
    globals.servicesTestAuth.currentUser = { ...globals.servicesTestAuth.currentUser, uid: 'new-account' }; f.render();
    old.deliver(status === 200 ? ledger() : { error: 'OLD_SCOPE_ERROR' }, status); await f.settle();
    assert.doesNotMatch(text(f.renderer.tree), /OLD_SCOPE_ERROR|Package purchase saved/); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
  });
  await check('current catalogue denial invalidates normally', async f => { await f.purchase(); await f.change('Catalogue package', id); f.requests.at(-1).deliver({ error: 'Current denied' }, 403); await f.settle(); assert.equal(globals.servicesTestInvalidations, 1); });
  await check('old manual purchases remain readable and no Ledger print action returns', async f => {
    await f.loaded(ledger({ purchases: [{ id, packageName: 'Old manual package', purchaseDate: '2034-01-01', branchNameSnapshot: 'Saved clinic', notes: '', orNumber: null, capabilities: {}, lines: [{ id: sid, serviceNameSnapshot: 'Old Service', purchasedSessions: 6, usedSessions: 2, adjustmentSessions: 0, remainingSessions: 4 }] }] }));
    assert.match(text(f.renderer.tree), /Old manual package|Old Service/); assert.ok(!find(f.renderer.tree, n => n.type === 'button' && text(n).includes('Print')));
  });
  await check('catalogue purchase displays its frozen version in Ledger and JSON', async f => {
    const purchase = { id, catalogue: { packageId: id, version: 1 }, packageName: 'Frozen purchased package', purchaseDate: '2034-01-01', branchNameSnapshot: 'Saved clinic', notes: '', orNumber: null, capabilities: {}, lines: [] };
    await f.loaded(ledger({ purchases: [purchase] })); assert.match(text(f.renderer.tree), /Catalogue version\s+1/);
    const saved = harness.modules.TreatmentLedgerTab.treatmentSessionStatement(ledger({ purchases: [purchase] }), f.props.patient); assert.deepEqual(saved.purchases[0].catalogue, purchase.catalogue);
  });
  await check('catalogue is reached through existing Services page', async f => { await f.start(); await f.click('Packages'); assert.match(f.requests.at(-1).url, /^\/api\/packages\?/); }, 'ServicesDashboard');
  await check('package editor submits a new immutable version with current Service versions', async f => {
    await f.catalogue(); await f.change('Package name', 'Revised draft'); await f.change('Sessions', '8'); await f.submit(); const body = JSON.parse(f.requests.at(-1).init.body);
    assert.equal(f.requests.at(-1).init.method, 'PATCH'); assert.equal(body.expectedVersion, 1); assert.equal(body.name, 'Revised draft'); assert.equal(body.lines[0].sessions, 8); assert.equal(body.lines[0].expectedServiceVersion, 4);
  }, 'PackageCatalogueDashboard');
  await check('pending catalogue save locks fields; conflict retains draft until explicit reload', async f => {
    await f.catalogue(); await f.change('Package name', 'KEEP PACKAGE DRAFT'); await f.submit(); assert.ok(find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled));
    f.requests.at(-1).deliver({ error: 'Version changed' }, 409); await f.settle(); assert.equal(f.label('Package name').props.value, 'KEEP PACKAGE DRAFT'); assert.equal(f.button('Save new version').props.disabled, true);
    await f.click('Reload saved package'); assert.equal(f.label('Package name').props.value, 'KEEP PACKAGE DRAFT');
    globals.window.confirm = () => true; await f.click('Reload saved package'); f.requests.at(-1).deliver(packageRow({ version: 2, name: 'Current saved package' })); await f.settle(); assert.equal(f.label('Package name').props.value, 'Current saved package');
  }, 'PackageCatalogueDashboard');
  await check('Cancel keeps an unsaved catalogue draft', async f => { await f.catalogue(); await f.change('Description', 'KEEP DRAFT'); await f.click('Back to packages'); assert.equal(f.label('Description').props.value, 'KEEP DRAFT'); }, 'PackageCatalogueDashboard');
  await check('uncertain definition save retries its exact command', async f => { await f.catalogue(); await f.change('Sessions', '7'); await f.submit(); const first = JSON.parse(f.requests.at(-1).init.body); f.requests.at(-1).fail(); await f.settle(); assert.ok(find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled)); await f.submit(); assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), first); }, 'PackageCatalogueDashboard');
  for (const status of [200, 401, 403, 409]) await check(`old definition save ${status} cannot affect a new branch scope`, async f => {
    await f.catalogue(); await f.change('Package name', 'OLD SAVING DRAFT'); await f.submit(); const old = f.requests.at(-1); f.props.activeBranchId = 'B'; f.render();
    old.deliver(status === 200 ? packageRow() : { error: 'OLD_SAVE_ERROR' }, status); await f.settle(); assert.doesNotMatch(text(f.renderer.tree), /OLD_SAVE_ERROR|OLD SAVING DRAFT/); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
  }, 'PackageCatalogueDashboard');
  for (const status of [200, 401, 403, 409]) await check(`permission-mirror change rejects old definition save ${status} before rerender`, async f => {
    await f.catalogue(); await f.change('Package name', 'Submitted draft'); await f.submit(); const old = f.requests.at(-1);
    f.permission({ ...f.profile, accessRevision: 2, permissionOverrides: { 'packages.manage': 'deny' } }, false);
    old.deliver(status === 200 ? packageRow() : { error: 'OLD_PERMISSION_ERROR' }, status); await f.settle();
    assert.doesNotMatch(text(f.renderer.tree), /OLD_PERMISSION_ERROR/); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
  }, 'PackageCatalogueDashboard');
  await check('read-only Staff can view definitions and history but cannot save', async f => {
    f.permission({ ...f.profile, role: 'staff', assignedBranches: ['A'] }); await f.start(); f.requests[0].deliver({ packages: [packageRow()], total: 1 }); await f.settle(); assert.ok(!find(f.renderer.tree, n => n.type === 'button' && text(n) === 'Create package'));
    await f.click('View'); f.requests.at(-1).deliver(packageRow()); await f.settle(); assert.ok(find(f.renderer.tree, n => n.type === 'fieldset' && n.props.disabled)); assert.ok(!find(f.renderer.tree, n => n.type === 'button' && text(n) === 'Save new version'));
    await f.click('View version history'); f.requests.at(-1).deliver({ versions: [packageRow()], total: 1, page: 1 }); await f.settle(); assert.match(text(f.renderer.tree), /Version\s+1/);
  }, 'PackageCatalogueDashboard');
  await check('catalogue permission loss clears protected package data', async f => { await f.catalogue(); f.permission({ ...f.profile, accessRevision: 2, permissionOverrides: { 'packages.view': 'deny' } }); await f.settle(); assert.doesNotMatch(text(f.renderer.tree), /Synthetic package details/); assert.match(text(f.renderer.tree), /access is unavailable/); }, 'PackageCatalogueDashboard');
  await check('list failures are retryable and do not masquerade as empty catalogue', async f => { await f.start(); f.requests[0].deliver({ error: 'Synthetic unavailable' }, 503); await f.settle(); assert.match(text(f.renderer.tree), /Synthetic unavailable/); assert.doesNotMatch(text(f.renderer.tree), /No packages yet/); await f.click('Retry packages'); f.requests.at(-1).deliver({ packages: [], total: 0 }); await f.settle(); assert.match(text(f.renderer.tree), /No packages yet/); }, 'PackageCatalogueDashboard');
  for (const status of [401, 403]) await check(`current catalogue list ${status} blocks automatic requests and each explicit retry permits one request`, async f => {
    await f.start(); assert.equal(f.requests.length, 1); f.requests[0].deliver({ error: 'Current denied' }, status); await f.settle();
    assertCatalogueBlocked(f); assert.equal(globals.servicesTestInvalidations, 1); await remainsSettled(f, 1);
    await f.click('Retry packages'); assert.equal(f.requests.length, 2); assert.equal(packageLists(f).length, 2); assert.equal(query(f.requests.at(-1)).get('branchId'), 'A');
    await remainsSettled(f, 2); f.requests.at(-1).deliver({ error: 'Retry denied again' }, status); await f.settle();
    assertCatalogueBlocked(f); assert.equal(globals.servicesTestInvalidations, 2); await remainsSettled(f, 2);
    await f.click('Retry packages'); assert.equal(f.requests.length, 3); f.requests.at(-1).deliver({ packages: [packageRow({ name: 'Recovered package' })], total: 1 }); await f.settle();
    assert.match(text(f.renderer.tree), /Recovered package/); assert.doesNotMatch(text(f.renderer.tree), /Package catalogue access changed/);
    assert.equal(globals.servicesTestInvalidations, 2); assert.equal(f.renderer.lateSetters, 0); await remainsSettled(f, 3);
  }, 'PackageCatalogueDashboard');
  for (const kind of ['detail', 'save', 'history']) for (const status of [401, 403]) await check(`current catalogue ${kind} ${status} removes protected workspace and waits for explicit retry`, async f => {
    const pending = await pendingCatalogueRequest(f, kind), count = f.requests.length;
    pending.deliver({ error: 'Current denied' }, status); await f.settle(); assertCatalogueBlocked(f);
    assert.equal(globals.servicesTestInvalidations, 1); assert.equal(f.renderer.lateSetters, 0); await remainsSettled(f, count);
    await f.click('Retry packages'); assert.equal(f.requests.length, count + 1); assert.match(f.requests.at(-1).url, /^\/api\/packages\?/);
    f.requests.at(-1).deliver({ packages: [packageRow({ name: 'Fresh retry result' })], total: 1 }); await f.settle();
    assert.match(text(f.renderer.tree), /Fresh retry result/); assert.doesNotMatch(text(f.renderer.tree), /OLD_PROTECTED_PACKAGE|OLD_PROTECTED_DRAFT/);
    await remainsSettled(f, count + 1);
  }, 'PackageCatalogueDashboard');
  for (const kind of ['access revision', 'permission', 'branch', 'account']) await check(`a changed ${kind} permits one fresh catalogue request after denial`, async f => {
    await f.start(); f.requests[0].deliver({ error: 'Current denied' }, 403); await f.settle(); assertCatalogueBlocked(f);
    await changeCatalogueScope(f, kind); assert.equal(f.requests.length, 2); assert.match(f.requests.at(-1).url, /^\/api\/packages\?/);
    assert.doesNotMatch(text(f.renderer.tree), /Package catalogue access changed/);
    f.requests.at(-1).deliver({ packages: [packageRow({ name: 'New access result' })], total: 1 }); await f.settle();
    assert.match(text(f.renderer.tree), /New access result/); assert.equal(globals.servicesTestInvalidations, 1); await remainsSettled(f, 2);
  }, 'PackageCatalogueDashboard');
  await check('publishing refreshed access before global invalidation does not latch the new profile scope', async f => {
    await f.catalogue(packageRow({ name: 'OLD_PROTECTED_PACKAGE' })); const count = f.requests.length;
    f.permission({ ...f.profile, accessRevision: 2 }, false);
    harness.modules.PackageCatalogueDashboard.invalidateProtectedData({ reason: 'Synthetic access refresh' }); f.render();
    assert.doesNotMatch(text(f.renderer.tree), /OLD_PROTECTED_PACKAGE|Synthetic package details/); await f.settle();
    assert.equal(f.requests.length, count + 1); assert.doesNotMatch(text(f.renderer.tree), /Package catalogue access changed/);
    f.requests.at(-1).deliver({ packages: [packageRow({ name: 'Refreshed profile package' })], total: 1 }); await f.settle();
    assert.match(text(f.renderer.tree), /Refreshed profile package/); assert.equal(globals.servicesTestInvalidations, 1); await remainsSettled(f, count + 1);
  }, 'PackageCatalogueDashboard');
  for (const capability of ['packages.view', 'services.view']) await check(`frontend ${capability} denial offers no retry or catalogue request`, async f => {
    f.permission({ ...f.profile, accessRevision: 2, permissionOverrides: { [capability]: 'deny' } }); await f.start();
    assert.match(text(f.renderer.tree), /Package catalogue access is unavailable/); assert.ok(!hasButton(f, 'Retry packages')); await remainsSettled(f, 0);
    f.permission({ ...f.profile, accessRevision: 3, permissionOverrides: {} }); await f.settle(); assert.equal(f.requests.length, 1);
    f.requests.at(-1).deliver({ error: 'Current denied' }, 403); await f.settle(); const oldRetry = f.button('Retry packages').props.onClick;
    f.permission({ ...f.profile, accessRevision: 4, permissionOverrides: { [capability]: 'deny' } }); await f.settle();
    oldRetry(); await f.settle(); assert.match(text(f.renderer.tree), /Package catalogue access is unavailable/); assert.ok(!hasButton(f, 'Retry packages'));
    assert.equal(globals.servicesTestInvalidations, 1); await remainsSettled(f, 1);
  }, 'PackageCatalogueDashboard');
  for (const kind of ['retry', 'detail', 'save']) for (const transition of ['branch', 'account', 'access revision']) for (const status of [401, 403]) await check(`old catalogue ${kind} ${status} cannot invalidate a fresh ${transition} scope`, async f => {
    const old = await pendingCatalogueRequest(f, kind), previousInvalidations = globals.servicesTestInvalidations;
    await changeCatalogueScope(f, transition); const current = f.requests.at(-1), count = f.requests.length; assert.notEqual(current, old);
    old.deliver({ error: 'OLD_SCOPE_DENIAL' }, status); await f.settle();
    assert.equal(globals.servicesTestInvalidations, previousInvalidations); assert.doesNotMatch(text(f.renderer.tree), /Package catalogue access changed|OLD_SCOPE_DENIAL/); assert.equal(f.requests.length, count);
    current.deliver({ packages: [packageRow({ name: 'CURRENT_SCOPE_PACKAGE' })], total: 1 }); await f.settle();
    assert.match(text(f.renderer.tree), /CURRENT_SCOPE_PACKAGE/); assert.doesNotMatch(text(f.renderer.tree), /OLD_PROTECTED_PACKAGE|OLD_PROTECTED_DRAFT/);
    assert.equal(f.renderer.lateSetters, 0); await remainsSettled(f, count);
  }, 'PackageCatalogueDashboard');
  for (const kind of ['retry', 'detail', 'save']) await check(`old catalogue ${kind} success cannot unblock a denied replacement scope`, async f => {
    const old = await pendingCatalogueRequest(f, kind), previousInvalidations = globals.servicesTestInvalidations;
    await changeCatalogueScope(f, 'branch'); const count = f.requests.length;
    f.requests.at(-1).deliver({ error: 'New branch denied' }, 403); await f.settle(); assertCatalogueBlocked(f);
    old.deliver(kind === 'retry' ? { packages: [packageRow({ name: 'OLD_SUCCESS' })], total: 1 } : packageRow({ name: 'OLD_SUCCESS' })); await f.settle();
    assertCatalogueBlocked(f); assert.doesNotMatch(text(f.renderer.tree), /OLD_SUCCESS/); assert.equal(globals.servicesTestInvalidations, previousInvalidations + 1);
    assert.equal(f.renderer.lateSetters, 0); await remainsSettled(f, count);
  }, 'PackageCatalogueDashboard');
  for (const kind of ['branch', 'account', 'access revision']) await check(`an old Retry packages callback cannot unblock a denied ${kind} scope`, async f => {
    await f.start(); f.requests[0].deliver({ error: 'Initial scope denied' }, 403); await f.settle(); const oldRetry = f.button('Retry packages').props.onClick;
    await changeCatalogueScope(f, kind); const count = f.requests.length; f.requests.at(-1).deliver({ error: 'Replacement scope denied' }, 401); await f.settle();
    oldRetry(); await f.settle(); assertCatalogueBlocked(f); assert.equal(globals.servicesTestInvalidations, 2); await remainsSettled(f, count);
  }, 'PackageCatalogueDashboard');
  console.log(JSON.stringify(results, null, 2)); assert.ok(results.every(r => r.passed), 'Package component failures');
  console.log(`Package catalogue UI: ${results.length}/${results.length} controlled component scenarios passed (not browser acceptance).`);
} finally { await harness.cleanup(); }
