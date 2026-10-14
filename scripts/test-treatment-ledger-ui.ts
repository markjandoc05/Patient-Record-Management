import assert from 'node:assert/strict';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';

// Actual React components and transport adapters, with controlled replies.
// These assertions do not claim browser, print-preview, or physical-printer QA.
const harness = await buildControlledForms(['TreatmentLedgerTab', 'VisitSessionUsagePicker', 'VisitForm', 'PatientProfile']);
const ids = { service: '11111111-1111-4111-8111-111111111111', line: '22222222-2222-4222-8222-222222222222', purchase: '33333333-3333-4333-8333-333333333333', event: '44444444-4444-4444-8444-444444444444' };
const actor = { uid: 'admin', name: 'Synthetic Administrator', role: 'admin' };
const service = { id: ids.service, name: 'Saved Laser Service', active: true, version: 4, default_duration_minutes: 30, branches: ['A', 'B'].map(id => ({ id, operationallyAvailable: true, effectivePrice: { mode: 'free', amount: '0.00' } })) };
const visitSnapshot = { patientId: 'patient', branchId: 'A', branchNameSnapshot: 'Clinic A', timezoneSnapshot: 'Asia/Manila', visitDate: '2035-01-01T10:00', serviceId: ids.service, serviceNameSnapshot: service.name, performedByUserId: 'provider', performedByNameSnapshot: 'Saved Nurse', performedByDesignationSnapshot: 'Nurse', assistingStaffText: 'Saved Assistant', diagnosis: 'DO NOT EXPORT', notes: 'DO NOT EXPORT' };
const ledger = (overrides: any = {}) => ({ patientId: 'patient', patientName: 'Synthetic Patient', redemptionPolicy: 'authorized_branches', branches: [{ id: 'A', name: 'Clinic A', status: 'Active' }], capabilities: { canPurchase: true, canAdjust: true, canEditOrNumber: true }, purchases: [{ id: ids.purchase, patientId: 'patient', packageName: 'Saved Treatment Package', purchaseDate: '2035-01-01', branchId: 'B', branchNameSnapshot: 'Clinic B', timezoneSnapshot: 'Asia/Manila', notes: 'Saved package note', orNumber: 'OR-SYNTHETIC', version: 2, actor, recordedAt: '2035-01-01T02:00:00Z', metadataRedacted: false, capabilities: { canEditNotes: true, canAdjust: true, canEditOrNumber: true }, lines: [{ id: ids.line, serviceId: ids.service, serviceNameSnapshot: service.name, serviceCatalogueVersion: 4, purchasedSessions: 10, adjustmentSessions: 0, usedSessions: 2, remainingSessions: 8, version: 3 }] }], events: [{ id: ids.event, type: 'usage', purchaseId: ids.purchase, lineId: ids.line, visitId: 'visit', branchId: 'A', purchaseBranchId: 'B', sessionsDelta: 0, usedDelta: 2, recordedAt: '2035-01-01T02:00:00Z', treatmentDate: '2035-01-01T10:00', actor, reason: null, visitSnapshot, reversesEventId: null, balanceAfter: { purchasedSessions: 10, adjustmentSessions: 0, usedSessions: 2, remainingSessions: 8 } }], activeVisitUsages: [], ...overrides });
const profile = { id: 'admin', email: 'admin@example.invalid', fullName: actor.name, role: 'admin', active: true, assignedBranches: ['A'] };
const provider = { id: 'provider', role: 'doctor', fullName: 'Current Doctor', active: true, assignedBranches: ['A'] };
class Fixture {
  renderer: Renderer; props: any; requests: any[] = []; printed = 0; frames: (() => void)[] = []; changes: any[] = []; binding = false; closes = 0;
  constructor(component = 'TreatmentLedgerTab') {
    globals.servicesTestInvalidations = 0;
    globals.servicesTestAuth.currentUser = { uid: 'admin', email: profile.email, getRequestToken: async () => 'synthetic' };
    globals.document.documentElement = { classList: { add() {}, remove() {} } };
    globals.window.print = () => this.printed++; globals.window.requestAnimationFrame = (run: () => void) => this.frames.push(run);
    globals.fetch = (url: string, init: any) => {
      if (url.startsWith('/api/services?')) return Promise.resolve(new Response(JSON.stringify({ services: [service], total: 1 })));
      if (url.startsWith('/api/services/')) return Promise.resolve(new Response(JSON.stringify(service)));
      return new Promise((resolve, reject) => this.requests.push({ url, init, deliver: (body: any, status = 200) => resolve(new Response(JSON.stringify(body), { status })), fail: () => reject(new TypeError('Connection interrupted')) }));
    };
    this.renderer = new Renderer(harness.components[component]);
    this.props = { patient: { id: 'patient', name: 'Synthetic Patient', patientID: 'PT-SYNTHETIC' }, userRole: 'admin' };
    if (component === 'VisitSessionUsagePicker') this.props = { patientId: 'patient', branchId: 'A', serviceId: ids.service, visitDate: '2035-01-01T10:00', disabled: false, serviceUnresolved: false, userRole: 'admin', value: null,
      onChange: (value: any) => { this.props.value = value; this.changes.push(value); this.renderer.dirty = true; }, onBinding: (active: boolean) => { this.binding = active; } };
    if (component === 'VisitForm') this.props = { patients: [{ id: 'patient', name: 'Synthetic Patient' }], branches: [{ id: 'A', branchName: 'Clinic A', status: 'Active' }], users: [profile, provider], userRole: 'admin',
      visit: { id: 'visit', patientId: 'patient', branchId: 'A', doctorId: 'provider', performedByUserId: 'provider', performedByNameSnapshot: 'Saved Doctor', visitDate: '2035-01-01T10:00', visitType: 'Treatment Session', status: 'Completed', serviceId: ids.service, serviceNameSnapshot: service.name, serviceCatalogueVersion: 4 }, onClose: () => this.closes++, onSave() {} };
  }
  render() { this.renderer.render(this.props); }
  async settle() { for (let i = 0; i < 10; i++) { this.renderer.passives.splice(0).forEach(run => run()); await flush(); if (this.renderer.dirty) this.render(); } }
  async start() { this.render(); await this.settle(); }
  async loaded(data = ledger()) { await this.start(); this.requests.find(request => request.url.endsWith('/treatment-ledger')).deliver(data); await this.settle(); }
  button(label: string) { const node = find(this.renderer.tree, value => value.type === 'button' && text(value).trim() === label); assert.ok(node, 'Missing button: ' + label); return node; }
  input(id: string) { const node = find(this.renderer.tree, value => value.props?.id === id); assert.ok(node, 'Missing input: ' + id); return node; }
  label(label: string) { const node = find(this.renderer.tree, value => value.type === 'label' && text(value).replace(/\s+/g, ' ').includes(label)); assert.ok(node, 'Missing label: ' + label); const input = find(node.props.children, value => ['input', 'select', 'textarea'].includes(value.type)); assert.ok(input); return input; }
  async click(label: string) { this.button(label).props.onClick(); await this.settle(); }
  async change(node: any, value: any) { node.props.onChange({ target: { value, checked: value } }); await this.settle(); }
  async submit() { find(this.renderer.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await this.settle(); }
  stop() { this.renderer.unmount(); }
}
const results: { name: string; passed: boolean; error?: string }[] = [];
async function check(name: string, run: (fixture: Fixture) => Promise<void>, component?: string) { const fixture = new Fixture(component); try { await run(fixture); results.push({ name, passed: true }); } catch (error: any) { results.push({ name, passed: false, error: error.message }); } finally { fixture.stop(); } }
try {
  for (const action of ['Print / Save PDF', 'Export saved ledger']) for (const role of ['admin', 'staff']) {
    await check(`${action} retains the ${role} metadata draft version until explicit reload`, async f => {
      f.props.userRole = role;
      const original = ledger();
      if (role === 'staff') {
        original.capabilities.canEditOrNumber = false;
        original.purchases[0].capabilities.canEditOrNumber = false;
      }
      await f.loaded(original);
      await f.click('Edit package details');
      await f.change(f.label('Package notes'), 'Draft notes based on version two');
      if (role === 'admin') await f.change(f.label('OR#'), '0000003');
      const concurrent = ledger();
      concurrent.purchases[0].version = 3;
      concurrent.purchases[0].notes = 'Concurrent saved notes';
      concurrent.purchases[0].orNumber = '0000004';
      concurrent.purchases[0].lines[0].remainingSessions = 7;
      if (role === 'staff') {
        concurrent.capabilities.canEditOrNumber = false;
        concurrent.purchases[0].capabilities.canEditOrNumber = false;
      }
      let downloaded: Blob | undefined;
      const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
      const oldElement = globals.document.createElement;
      URL.createObjectURL = blob => { assert.ok(blob instanceof Blob); downloaded = blob; return 'blob:metadata-regression'; };
      URL.revokeObjectURL = () => {};
      globals.document.createElement = () => ({ click() {} });
      try {
        await f.click(action);
        assert.equal(f.requests.at(-1).init.method, 'GET');
        f.requests.at(-1).deliver(concurrent);
        await f.settle();
        assert.equal(f.label('Package notes').props.value, 'Draft notes based on version two');
        if (role === 'admin') assert.equal(f.label('OR#').props.value, '0000003');
        if (action === 'Print / Save PDF') {
          f.frames.splice(0).forEach(run => run());
          assert.equal(f.printed, 1);
          const statement = find(f.renderer.tree, node => node.props?.['aria-label'] === 'Saved treatment session statement');
          assert.match(text(statement), /Concurrent saved notes/);
          assert.match(text(statement), /0000004/);
          assert.doesNotMatch(text(statement), /Draft notes based on version two|0000003/);
        } else {
          assert.ok(downloaded);
          const saved = JSON.parse(await downloaded!.text());
          assert.equal(saved.purchases[0].notes, 'Concurrent saved notes');
          assert.equal(saved.purchases[0].orNumber, '0000004');
          assert.equal(saved.purchases[0].lines[0].remainingSessions, 7);
        }
        await f.submit();
        const stale = JSON.parse(f.requests.at(-1).init.body);
        assert.equal(stale.expectedVersion, 2, 'A saved-statement refresh must not rebase an open metadata draft');
        assert.equal(stale.notes, 'Draft notes based on version two');
        if (role === 'admin') assert.equal(stale.orNumber, '0000003');
        else assert.ok(!Object.hasOwn(stale, 'orNumber'));
        f.requests.at(-1).deliver({ error: 'Package metadata changed.', code: 'VERSION_CONFLICT' }, 409);
        await f.settle();
        assert.match(text(f.renderer.tree), /Reload balances and review/);
        assert.equal(f.label('Package notes').props.value, stale.notes);
        if (role === 'admin') assert.equal(f.label('OR#').props.value, stale.orNumber);
        await f.click('Reload balances');
        f.requests.at(-1).deliver(concurrent);
        await f.settle();
        assert.ok(!find(f.renderer.tree, node => node.type === 'form'));
        await f.click('Edit package details');
        assert.equal(f.label('Package notes').props.value, concurrent.purchases[0].notes);
        if (role === 'admin') assert.equal(f.label('OR#').props.value, concurrent.purchases[0].orNumber);
        await f.change(f.label('Package notes'), 'Reviewed notes based on version three');
        await f.submit();
        const reviewed = JSON.parse(f.requests.at(-1).init.body);
        assert.equal(reviewed.expectedVersion, 3);
        assert.equal(reviewed.notes, 'Reviewed notes based on version three');
        assert.notEqual(reviewed.commandId, stale.commandId);
        if (role === 'admin') assert.equal(reviewed.orNumber, '0000004');
        else assert.ok(!Object.hasOwn(reviewed, 'orNumber'));
        const confirmed = ledger();
        confirmed.purchases[0] = { ...concurrent.purchases[0], version: 4, notes: reviewed.notes };
        f.requests.at(-1).deliver(confirmed);
        await f.settle();
        assert.ok(!find(f.renderer.tree, node => node.type === 'form'));
        assert.match(text(f.renderer.tree), /Package details saved/);
      } finally {
        URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
        globals.document.createElement = oldElement;
      }
    });
  }
  await check('uncertain metadata save retains its version and exact command through Retry', async f => {
    await f.loaded(); await f.click('Edit package details');
    await f.change(f.label('Package notes'), 'Retry unchanged metadata draft');
    await f.change(f.label('OR#'), '0000005');
    await f.submit();
    const pending = f.requests.at(-1), submitted = JSON.parse(pending.init.body);
    pending.fail(); await f.settle();
    assert.equal(submitted.expectedVersion, 2);
    assert.equal(f.button('Print / Save PDF').props.disabled, true);
    assert.equal(f.button('Export saved ledger').props.disabled, true);
    const beforeRetry = f.requests.length;
    await f.click('Print / Save PDF'); await f.click('Export saved ledger');
    assert.equal(f.requests.length, beforeRetry);
    await f.submit();
    assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), submitted);
    const confirmed = ledger();
    confirmed.purchases[0] = { ...confirmed.purchases[0], version: 3, notes: submitted.notes, orNumber: submitted.orNumber };
    f.requests.at(-1).deliver(confirmed); await f.settle();
    assert.ok(!find(f.renderer.tree, node => node.type === 'form'));
    assert.match(text(f.renderer.tree), /Package details saved/);
  });
  await check('saved balances and historical names lead the ledger', async f => { await f.loaded(); assert.match(text(f.renderer.tree), /Saved Treatment Package/); assert.match(text(f.renderer.tree), /Saved Laser Service/); assert.match(text(f.renderer.tree), /8 remaining after/); assert.ok(text(f.renderer.tree).indexOf('Remaining') < text(f.renderer.tree).indexOf('Session history')); });
  await check('saved statement uses a direct body portal and preserves purchase calendar date', async f => { await f.loaded(); assert.equal(f.renderer.portals.length, 1); assert.equal(f.renderer.portals[0].container, globals.document.body); const statement = find(f.renderer.tree, node => node.props?.['aria-label'] === 'Saved treatment session statement'); assert.match(text(statement), /Purchased\s+2035-01-01/); assert.doesNotMatch(text(statement), /DO NOT EXPORT/); });
  await check('empty state explains purchase and Visit usage', async f => { await f.loaded(ledger({ purchases: [], events: [] })); assert.match(text(f.renderer.tree), /No package purchases recorded/); assert.match(text(f.renderer.tree), /matching performed Service/); });
  await check('Staff can purchase and edit notes without an OR input or adjustment controls', async f => { f.props.userRole = 'staff'; const data = ledger(); data.capabilities.canAdjust = false; data.capabilities.canEditOrNumber = false; data.purchases[0].capabilities = { canEditNotes: true, canAdjust: false, canEditOrNumber: false }; await f.loaded(data); await f.click('Record purchase'); assert.ok(!find(f.renderer.tree, node => node.type === 'label' && text(node).includes('OR#'))); assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node) === 'Adjust sessions')); });
  await check('cross-branch balances retain redacted metadata and hide originating-branch edits', async f => { const data = ledger(); data.purchases[0] = { ...data.purchases[0], notes: '', orNumber: null, metadataRedacted: true, capabilities: { canEditNotes: false, canAdjust: false, canEditOrNumber: false } }; await f.loaded(data); assert.doesNotMatch(text(f.renderer.tree), /Saved package note|OR-SYNTHETIC/); assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node) === 'Edit package details')); });
  await check('purchase validates and submits Service IDs with verified versions', async f => { await f.loaded(); await f.click('Record purchase'); await f.change(f.label('Package name'), 'Synthetic New Package'); await f.change(f.label('Service 1'), ids.service); await f.change(f.label('Sessions'), '6'); await f.submit(); const request = f.requests.at(-1), body = JSON.parse(request.init.body); assert.equal(request.init.method, 'POST'); assert.deepEqual(body.lines, [{ serviceId: ids.service, expectedServiceVersion: 4, purchasedSessions: 6 }]); assert.equal(body.purchaseDate, '2035-01-01'); assert.ok(!Object.hasOwn(body.lines[0], 'serviceNameSnapshot')); assert.ok(find(f.renderer.tree, node => node.type === 'fieldset' && node.props.disabled)); });
  await check('uncertain purchase keeps submitted command stable across Retry', async f => { await f.loaded(); await f.click('Record purchase'); await f.change(f.label('Package name'), 'Synthetic Retry Package'); await f.change(f.label('Service 1'), ids.service); await f.submit(); const first = f.requests.at(-1); first.fail(); await f.settle(); assert.match(text(f.renderer.tree), /result is uncertain/); await f.submit(); assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), JSON.parse(first.init.body)); });
  await check('lost adjustment response blocks print/export and Retry reuses the exact command', async f => { await f.loaded(); await f.click('Adjust sessions'); await f.change(f.label('Session adjustment'), '1'); await f.change(f.label('Reason'), 'Synthetic correction'); await f.submit(); const committed = f.requests.at(-1), submitted = JSON.parse(committed.init.body); committed.fail(); await f.settle(); assert.equal(f.button('Print / Save PDF').props.disabled, true); assert.equal(f.button('Export saved ledger').props.disabled, true); const count = f.requests.length; await f.click('Print / Save PDF'); await f.click('Export saved ledger'); assert.equal(f.requests.length, count); await f.submit(); assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), submitted); const fresh = ledger(); fresh.purchases[0].lines[0].remainingSessions = 9; fresh.purchases[0].lines[0].version = 4; f.requests.at(-1).deliver(fresh); await f.settle(); assert.ok(!find(f.renderer.tree, node => node.type === 'form')); });
  await check('Reload after lost adjustment discards the pending editor without applying another adjustment', async f => { await f.loaded(); await f.click('Adjust sessions'); await f.change(f.label('Reason'), 'Synthetic correction'); await f.submit(); f.requests.at(-1).fail(); await f.settle(); await f.click('Reload balances'); const fresh = ledger(); fresh.purchases[0].lines[0].remainingSessions = 9; fresh.purchases[0].lines[0].version = 4; f.requests.at(-1).deliver(fresh); await f.settle(); assert.ok(!find(f.renderer.tree, node => node.type === 'form')); assert.equal(f.requests.filter(request => request.url.endsWith('/adjustments')).length, 1); assert.equal(f.button('Print / Save PDF').props.disabled, false); });
  await check('metadata saves only editable fields and carries optimistic version', async f => { const data = ledger(); data.purchases[0].capabilities.canEditOrNumber = false; await f.loaded(data); await f.click('Edit package details'); await f.change(f.label('Package notes'), 'Updated note'); await f.submit(); const body = JSON.parse(f.requests.at(-1).init.body); assert.equal(body.expectedVersion, 2); assert.equal(body.notes, 'Updated note'); assert.ok(!Object.hasOwn(body, 'orNumber')); });
  await check('adjustment requires reason and cannot create negative remaining sessions', async f => { await f.loaded(); await f.click('Adjust sessions'); await f.change(f.label('Session adjustment'), '-9'); await f.change(f.label('Reason'), 'Synthetic correction'); await f.submit(); assert.equal(f.requests.length, 1); assert.match(text(f.renderer.tree), /nonnegative balance/); });
  await check('usage reversal retains explicit reason and both version guards', async f => { const data = ledger({ activeVisitUsages: [{ visitId: 'visit', eventId: ids.event, lineId: ids.line, sessions: 2, version: 1, visitSnapshot }] }); await f.loaded(data); await f.click('Reverse usage'); await f.change(f.label('Reason'), 'Synthetic duplicate recording'); await f.submit(); const body = JSON.parse(f.requests.at(-1).init.body); assert.equal(body.expectedLineVersion, 3); assert.equal(body.expectedUsageVersion, 1); assert.equal(body.reason, 'Synthetic duplicate recording'); });
  await check('usage reversal is hidden when the purchase branch is not editable', async f => { const data = ledger({ activeVisitUsages: [{ visitId: 'visit', eventId: ids.event, lineId: ids.line, sessions: 2, version: 1, visitSnapshot }] }); data.purchases[0].capabilities.canAdjust = false; await f.loaded(data); assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === 'Reverse usage')); });
  await check('usage reversal is hidden when its treatment branch is unauthorized', async f => { const data = ledger({ activeVisitUsages: [{ visitId: 'visit', eventId: ids.event, lineId: ids.line, sessions: 2, version: 1, visitSnapshot: { ...visitSnapshot, branchId: 'C' } }] }); data.events[0].branchId = 'C'; await f.loaded(data); assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === 'Reverse usage')); });
  await check('print refreshes saved server ledger, excludes unsaved drafts and cleans class', async f => { await f.loaded(); await f.click('Record purchase'); await f.change(f.label('Package name'), 'UNSAVED PURCHASE'); await f.click('Print / Save PDF'); const current = ledger(); current.purchases[0].lines[0].remainingSessions = 7; f.requests.at(-1).deliver(current); await f.settle(); f.frames.splice(0).forEach(run => run()); assert.equal(f.printed, 1); const statement = find(f.renderer.tree, node => node.props?.['aria-label'] === 'Saved treatment session statement'); assert.doesNotMatch(text(statement), /UNSAVED PURCHASE/); assert.equal(f.label('Package name').props.value, 'UNSAVED PURCHASE'); });
  await check('denied fresh print never prints the prior snapshot', async f => { await f.loaded(); await f.click('Print / Save PDF'); f.requests.at(-1).deliver({ error: 'Denied current statement' }, 403); await f.settle(); f.frames.splice(0).forEach(run => run()); assert.equal(f.printed, 0); assert.equal(f.renderer.portals.length, 0); });
  await check('export refreshes saved statement and strips clinical narrative', async f => { await f.loaded(); let downloaded: Blob | undefined; const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL, revoked: string[] = []; URL.createObjectURL = blob => { assert.ok(blob instanceof Blob); downloaded = blob; return 'blob:synthetic'; }; URL.revokeObjectURL = url => { revoked.push(url); }; globals.document.createElement = () => ({ click() {} }); try { await f.click('Export saved ledger'); f.requests.at(-1).deliver(ledger()); await f.settle(); const value = JSON.parse(await downloaded!.text()); assert.equal(value.purchases[0].lines[0].remainingSessions, 8); assert.equal(value.history[0].balanceAfter.remainingSessions, 8); assert.equal(value.history[0].visit.timezoneSnapshot, 'Asia/Manila'); assert.equal(value.history[0].visit.performedByDesignation, 'Nurse'); assert.equal(value.history[0].visit.assistingStaffText, 'Saved Assistant'); assert.ok(!JSON.stringify(value).includes('DO NOT EXPORT')); assert.deepEqual(revoked, ['blob:synthetic']); } finally { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; } });
  for (const status of [200, 401, 403, 409]) for (const change of ['patient', 'account', 'invalidate', 'unmount']) await check(`late ledger ${status} discarded after ${change}`, async f => { await f.start(); const old = f.requests[0]; if (change === 'patient') { f.props.patient = { ...f.props.patient, id: 'new-patient' }; f.render(); } if (change === 'account') { globals.servicesTestAuth.currentUser = { ...globals.servicesTestAuth.currentUser, uid: 'new-account' }; f.render(); } if (change === 'invalidate') { for (const listener of globals.appointmentInvalidationListeners) listener(); f.render(); } if (change === 'unmount') f.stop(); old.deliver(status === 200 ? ledger() : { error: 'OLD_SCOPE_ERROR' }, status); await f.settle(); assert.equal(globals.servicesTestInvalidations, 0); assert.doesNotMatch(text(f.renderer.tree), /Saved Treatment Package|OLD_SCOPE_ERROR/); assert.equal(f.renderer.lateSetters, 0); });
  await check('Visit matching sessions include a package purchased at another authorized-use clinic', async f => { await f.loaded(); await f.change(f.label('Use package sessions'), true); assert.equal(f.props.value.lineId, ''); assert.equal(f.props.value.sessions, 1); assert.equal(f.props.value.valid, false); assert.match(text(f.input('visit-session-line')), /Clinic B/); await f.change(f.input('visit-session-line'), ids.line); assert.equal(f.props.value.valid, true); assert.equal(f.props.value.expectedLineVersion, 3); await f.change(f.input('visit-session-count'), '9'); assert.equal(f.props.value.valid, false); }, 'VisitSessionUsagePicker');
  await check('performed Service change clears package choice and old response cannot restore it', async f => { await f.loaded(); await f.change(f.label('Use package sessions'), true); await f.change(f.input('visit-session-line'), ids.line); f.props.serviceId = 'other-service'; f.render(); await f.settle(); assert.equal(f.props.value, null); }, 'VisitSessionUsagePicker');
  await check('existing active usage is read-only and freezes binding fields while unrelated saves omit usage', async f => { await f.loaded(ledger({ activeVisitUsages: [{ visitId: 'visit', eventId: ids.event, lineId: ids.line, sessions: 2, version: 1, visitSnapshot }] })); assert.match(text(f.renderer.tree), /Recorded session usage/); for (const id of ['visit-branch', 'visit-doctor', 'visit-performed-by', 'visit-assisting-staff']) assert.equal(f.input(id).props.disabled, true); await f.change(f.input('visit-notes'), 'Unrelated note'); await f.submit(); assert.ok(!Object.hasOwn(JSON.parse(f.requests.at(-1).init.body), 'sessionUsage')); }, 'VisitForm');
  await check('persisted Visit binding fields are disabled during ledger lookup and unlock only for unbound Visit', async f => { await f.start(); for (const id of ['visit-branch', 'visit-doctor', 'visit-performed-by', 'visit-assisting-staff']) assert.equal(f.input(id).props.disabled, true); assert.ok(!find(f.renderer.tree, node => node.props?.id === 'visit-service')); f.requests[0].deliver(ledger()); await f.settle(); assert.equal(f.input('visit-branch').props.disabled, false); assert.ok(f.input('visit-service')); }, 'VisitForm');
  await check('persisted Visit failed binding lookup retains protection and offers an explicit Retry', async f => { await f.start(); f.requests[0].deliver({ error: 'Temporary ledger failure' }, 503); await f.settle(); assert.equal(f.input('visit-performed-by').props.disabled, true); assert.equal(f.input('visit-assisting-staff').props.value, ''); await f.click('Retry session balances'); const data = ledger({ activeVisitUsages: [{ visitId: 'visit', eventId: ids.event, lineId: ids.line, sessions: 2, version: 1, visitSnapshot }] }); f.requests.at(-1).deliver(data); await f.settle(); assert.equal(f.input('visit-performed-by').props.value, 'provider'); assert.equal(f.input('visit-performed-by').props.disabled, true); assert.match(text(f.renderer.tree), /Recorded session usage/); }, 'VisitForm');
  await check('Visit submits explicit usage and locks every draft field while saving', async f => { await f.loaded(); await f.change(f.label('Use package sessions'), true); await f.change(f.input('visit-session-line'), ids.line); await f.submit(); const body = JSON.parse(f.requests.at(-1).init.body); assert.deepEqual(Object.keys(body.sessionUsage).sort(), ['commandId', 'expectedLineVersion', 'expectedUsageVersion', 'lineId', 'sessions'].sort()); assert.equal(body.sessionUsage.sessions, 1); assert.ok(find(f.renderer.tree, node => node.type === 'fieldset' && node.props.disabled)); }, 'VisitForm');
  await check('new Visit usage keeps clientVisitId and command ID through uncertain create Retry', async f => { f.props.appointment = { id: 'appointment', patientId: 'patient', branchId: 'A', doctorId: 'provider', appointmentDate: '2035-01-01T10:00', serviceId: ids.service, serviceNameSnapshot: service.name, serviceCatalogueVersion: 4 }; delete f.props.visit; await f.start(); f.requests.at(-1).deliver(ledger()); await f.settle(); await f.change(f.label('Use package sessions'), true); await f.change(f.input('visit-session-line'), ids.line); await f.submit(); const first = f.requests.at(-1), body = JSON.parse(first.init.body); assert.ok(body.clientVisitId); first.fail(); await f.settle(); assert.match(text(f.renderer.tree), /save result is uncertain/); await f.submit(); assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), body); }, 'VisitForm');
  console.log(JSON.stringify(results, null, 2)); console.log(`Treatment ledger components: ${results.filter(row => row.passed).length}/${results.length} passed.`); if (results.some(row => !row.passed)) process.exitCode = 1;
} finally { await harness.cleanup(); }
