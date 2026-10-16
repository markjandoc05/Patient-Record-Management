import assert from 'node:assert/strict';
import path from 'node:path';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';

// Actual components and protected transport adapters, using the established
// controlled hook harness. These checks are not interactive browser evidence.
const harness = await buildControlledForms(['ClinicalChartModal', 'ClinicalChartsTab', 'VisitForm', 'PatientProfile', 'PatientTimeline', 'VisitHistoryDashboard'], path.resolve(process.argv[2] || process.cwd()));
const actor = { uid: 'doctor', name: 'Synthetic Doctor', role: 'doctor' };
const profile = () => ({ id: 'doctor', email: 'doctor@example.invalid', fullName: actor.name, role: 'doctor', active: true, assignedBranches: ['A'], permissionOverrides: {} });
const visit = { id: 'visit', patientId: 'patient', patientName: 'Synthetic Patient', doctorId: 'doctor', branchId: 'A', branchName: 'Synthetic Branch', visitDate: '2035-01-01T10:00', visitType: 'Treatment Session', status: 'Completed' };
const context = { visitId: visit.id, patientId: visit.patientId, patientName: visit.patientName, branchId: visit.branchId, branchName: visit.branchName, doctorId: visit.doctorId, doctorName: actor.name, visitDate: visit.visitDate, visitType: visit.visitType, serviceId: null, serviceNameSnapshot: null, serviceDurationMinutesSnapshot: null, serviceCatalogueVersion: null };
const marker = { id: 'point', map: 'face', x: 0.5, y: 0.4, label: 'Saved marker', notes: 'Saved marker note' };
const draft = () => ({ markers: [{ ...marker }], notes: 'Saved chart note', kind: 'initial', reason: '', createdAt: '2035-01-01T11:00:00Z', updatedAt: '2035-01-01T11:00:00Z', createdBy: actor, updatedBy: actor, context: { ...context }, contextKey: 'context-current' });
const response = (extra: any = {}) => ({ visitId: visit.id, chart: null, visitContext: { ...context }, contextKey: 'context-current', permissions: { canEdit: true, canSign: false, canAmend: false }, readOnlyReason: null, ...extra });
const chartResponse = (extra: any = {}) => response({ chart: { schemaVersion: 1, version: 1, visitId: visit.id, draft: draft(), revisions: [], createdAt: '2035-01-01T11:00:00Z', createdBy: actor }, ...extra });
const signedResponse = (extra: any = {}) => chartResponse({ chart: { schemaVersion: 1, version: 2, visitId: visit.id, draft: null, revisions: [{ ...draft(), revision: 1, signedAt: '2035-01-01T11:01:00Z', signedBy: actor }], createdAt: '2035-01-01T11:00:00Z', createdBy: actor }, permissions: { canEdit: false, canSign: false, canAmend: true }, ...extra });

class Fixture {
  renderer: Renderer; props: any; closes = 0; prints = 0; requests: any[] = [];
  constructor(name = 'ClinicalChartModal') {
    globals.servicesTestInvalidations = 0;
    globals.servicesTestAuth.currentUser = { uid: 'doctor', email: 'doctor@example.invalid', getRequestToken: async () => 'synthetic' };
    globals.window.confirm = () => true; globals.window.print = () => this.prints++;
    globals.fetch = (url: string, init: any) => new Promise(resolve => this.requests.push({ url, init, deliver: (body: any, status = 200) => resolve(new Response(JSON.stringify(body), { status })) }));
    this.renderer = new Renderer(harness.components[name]);
    this.props = { visit: { ...visit }, users: [profile()], userProfile: profile(), userRole: 'doctor', onClose: () => this.closes++ };
  }
  render() { this.renderer.render(this.props); }
  async settle() { for (let index = 0; index < 10; index++) { this.renderer.passives.splice(0).forEach(run => run()); await flush(); if (this.renderer.dirty) this.render(); } }
  async start() { this.render(); await this.settle(); }
  async loaded(value = response()) { await this.start(); assert.equal(this.requests[0]?.url, '/api/records/visits/visit/chart'); this.requests[0].deliver(value); await this.settle(); }
  button(label: string) { const node = find(this.renderer.tree, value => value.type === 'button' && text(value).trim().replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1') === label); assert.ok(node, 'missing button: ' + label); return node; }
  field(label: string) { const node = find(this.renderer.tree, value => value.props?.['aria-label'] === label); assert.ok(node, 'missing field: ' + label); return node; }
  async click(label: string) { this.button(label).props.onClick(); await this.settle(); }
  async change(label: string, value: string) { this.field(label).props.onChange({ target: { value } }); await this.settle(); }
  scope() { this.props = { ...this.props, userProfile: { ...profile(), assignedBranches: ['B'], accessRevision: 1 }, users: [{ ...profile(), assignedBranches: ['B'], accessRevision: 1 }] }; this.render(); }
  stop() { this.renderer.unmount(); globals.historyRows = undefined; }
}
const results: { name: string; passed: boolean; error?: string }[] = [];
async function check(name: string, run: (fixture: Fixture) => Promise<void>, component?: string) {
  const fixture = new Fixture(component);
  try { await run(fixture); results.push({ name, passed: true }); }
  catch (error: any) { results.push({ name, passed: false, error: error.message }); }
  finally { fixture.stop(); }
}
async function openPatientChart(f: Fixture, component: string) {
  f.props = { patientId: 'patient', users: [profile()], userRole: 'doctor',
    branches: [{ id: 'A', branchName: 'Synthetic Branch', status: 'Active' }], visits: [{ ...visit }] };
  await f.start();
  if (component === 'PatientTimeline') {
    const card = find(f.renderer.tree, node => node.type === 'div' && node.props?.onClick && text(node).includes(visit.visitDate));
    assert.ok(card); card.props.onClick(); await f.settle();
  }
  await f.click('Open chart');
}
const chartDialog = (f: Fixture) => find(f.renderer.tree, node => node.props?.['data-clinical-chart-dialog'] !== undefined);
const nurseVisit = { ...visit, doctorId: null, performedByUserId: 'nurse', performedByNameSnapshot: 'Recorded Nurse', performedByRoleSnapshot: 'staff', performedByDesignationSnapshot: 'Nurse' };
const nurseContext = { ...context, doctorId: '', doctorName: '', performedByUserId: 'nurse', performedByNameSnapshot: 'Recorded Nurse', performedByRoleSnapshot: 'staff', performedByDesignationSnapshot: 'Nurse' };
function asNurse(f: Fixture, grants = true) {
  const nurseProfile = { ...profile(), id: 'nurse', email: 'nurse@example.invalid', role: 'staff', fullName: 'Current Nurse', staffDesignation: 'Nurse',
    permissionOverrides: grants ? {} : { 'visits.edit': 'deny', 'clinical.edit_draft': 'deny' } };
  globals.servicesTestAuth.currentUser = { uid: 'nurse', email: nurseProfile.email, getRequestToken: async () => 'synthetic' };
  f.props = { ...f.props, visit: { ...nurseVisit }, userProfile: nurseProfile, users: [nurseProfile], userRole: 'staff' };
}
function nurseResponse(signed = false) {
  const value = signed ? signedResponse() : chartResponse();
  value.visitContext = { ...nurseContext };
  const saved = signed ? value.chart.revisions[0] : value.chart.draft;
  saved.context = { ...nurseContext };
  saved.createdBy = { uid: 'nurse', name: 'Chart Nurse', role: 'staff' };
  saved.updatedBy = { ...saved.createdBy };
  if (signed) saved.signedBy = { ...saved.createdBy };
  return value;
}

// Hold the replacement read open while executing the real Visit and chart UI.
async function prepareVisitConflict(f: Fixture, person = 'doctor') {
  const designation = person === 'nurse' ? 'Nurse' : 'Medical Staff';
  const user = person === 'doctor' ? profile() : { ...profile(), id: person, email: person + '@example.invalid',
    role: 'staff', staffDesignation: designation, fullName: 'Synthetic ' + person };
  const record = { ...visit, visitVersion: 1, ...(person === 'doctor' ? {} : { doctorId: null,
    performedByUserId: person, performedByNameSnapshot: user.fullName, performedByRoleSnapshot: 'staff',
    performedByDesignationSnapshot: designation }) };
  globals.servicesTestAuth.currentUser = { uid: person, email: user.email, getRequestToken: async () => 'synthetic' };
  f.props = { visit: record, users: [user], userRole: user.role, patients: [{ id: 'patient', name: 'Synthetic Patient' }],
    branches: [{ id: 'A', branchName: 'Synthetic Branch', status: 'Active' }], visits: [], appointments: [], onSave() {}, onClose() {} };
  await f.start();
  for (const request of f.requests) {
    if (request.url.startsWith('/api/services?')) request.deliver({ services: [], total: 0 });
    if (request.url.endsWith('/treatment-ledger')) request.deliver({ patientId: 'patient', purchases: [], events: [], activeVisitUsages: [],
      branches: [], capabilities: { canPurchase: false, canAdjust: false, canEditOrNumber: false }, redemptionPolicy: 'authorized_branches' });
  }
  await f.settle();
  for (const id of ['visit-notes', 'visit-diagnosis']) {
    find(f.renderer.tree, node => node.props?.id === id).props.onChange({ target: { value: 'UNSAVED_' + id } });
  }
  await f.settle(); find(f.renderer.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await f.settle();
  const save = f.requests.find(request => request.init.method === 'PATCH'); assert.ok(save);
  save.deliver({ error: 'Saved Visit changed', code: 'VISIT_VERSION_CHANGED' }, 409); await f.settle();
  return { ...record, visitVersion: 2, notes: 'Latest saved Visit notes', diagnosis: 'Latest saved diagnosis' };
}
const latestVisitRead = (f: Fixture) => f.requests.filter(request => request.url === '/api/data/query').at(-1);
async function beginVisitReload(f: Fixture, record: any) {
  await f.click('Review saved Visit'); latestVisitRead(f).deliver({ document: { id: 'visit', data: record } }); await f.settle();
  await f.click('Reload saved Visit'); await f.click('Discard draft and reload');
  return latestVisitRead(f);
}
async function retainDirtyChart(f: Fixture) {
  await f.click('Open chart');
  const chart = f.requests.filter(request => request.url === '/api/records/visits/visit/chart').at(-1); assert.ok(chart);
  const record = f.props.visit;
  chart.deliver(response({ visitContext: { ...context, doctorId: record.doctorId || '', doctorName: record.doctorId ? actor.name : '',
    performedByUserId: record.performedByUserId || null, performedByNameSnapshot: record.performedByNameSnapshot || null,
    performedByRoleSnapshot: record.performedByRoleSnapshot || null, performedByDesignationSnapshot: record.performedByDesignationSnapshot || null } })); await f.settle();
  assert.equal(f.field('Chart notes').props.readOnly, false);
  await f.change('Chart notes', 'UNSAVED_CHART_NOTES');
  let prompts = 0; globals.window.confirm = () => { prompts++; return false; };
  const close = find(f.renderer.tree, node => node.props?.['aria-label'] === 'Close clinical chart'); assert.ok(close);
  close.props.onClick(); await f.settle();
  assert.equal(prompts, 1); assert.ok(chartDialog(f)); assert.equal(f.field('Chart notes').props.value, 'UNSAVED_CHART_NOTES');
}
try {
  for (const person of ['doctor', 'nurse', 'medical']) {
    for (const status of [200, 503]) await check(`${person}: confirmed Visit reload ${status} blocks chart opening and retains notes until completion`, async f => {
      const record = await prepareVisitConflict(f, person), pending = await beginVisitReload(f, record);
      const chartRequests = () => f.requests.filter(request => request.url.includes('/chart')).length;
      assert.equal(f.button('Open chart').props.disabled, true);
      // Forced invocation also exercises the action guard, beyond native disabled behavior.
      await f.click('Open chart'); assert.equal(chartRequests(), 0); assert.ok(!chartDialog(f));
      for (const id of ['visit-notes', 'visit-diagnosis']) assert.equal(find(f.renderer.tree, node => node.props?.id === id).props.value, 'UNSAVED_' + id);
      pending.deliver(status === 200 ? { document: { id: 'visit', data: record } } : { error: 'Synthetic reload failure' }, status); await f.settle();
      assert.equal(f.button('Open chart').props.disabled, false);
      assert.equal(find(f.renderer.tree, node => node.props?.id === 'visit-notes').props.value, status === 200 ? record.notes : 'UNSAVED_visit-notes');
      assert.equal(find(f.renderer.tree, node => node.props?.id === 'visit-diagnosis').props.value, status === 200 ? record.diagnosis : 'UNSAVED_visit-diagnosis');
      await retainDirtyChart(f); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
    }, 'VisitForm');
  }
  await check('read-only Visit review keeps charting available and cannot discard a dirty chart', async f => {
    const record = await prepareVisitConflict(f); await f.click('Review saved Visit'); const preview = latestVisitRead(f);
    assert.equal(f.button('Open chart').props.disabled, false); await retainDirtyChart(f);
    preview.deliver({ document: { id: 'visit', data: record } }); await f.settle();
    assert.ok(chartDialog(f)); assert.equal(f.field('Chart notes').props.value, 'UNSAVED_CHART_NOTES');
    assert.equal(find(f.renderer.tree, node => node.props?.id === 'visit-notes').props.value, 'UNSAVED_visit-notes');
  }, 'VisitForm');
  await check('loaded chart escapes parent modal into body portal', async f => {
    await f.loaded(chartResponse());
    assert.equal(f.renderer.portals.length, 1);
    assert.equal(f.renderer.portals[0].container, globals.document.body);
    assert.ok(chartDialog(f).props.className.includes('z-[11000]'));
  });
  await check('chart access-loss message retains foreground body portal', async f => {
    await f.loaded(chartResponse());
    for (const listener of globals.appointmentInvalidationListeners) listener();
    await f.settle();
    assert.equal(f.renderer.portals.length, 1);
    assert.equal(f.renderer.portals[0].container, globals.document.body);
    assert.match(text(f.renderer.tree), /access changed/);
    assert.ok(chartDialog(f).props.className.includes('z-[11000]'));
  });
  await check('unsaved Visit chart warning retains foreground body portal', async f => {
    f.props.visit = {}; await f.start();
    assert.equal(f.renderer.portals.length, 1);
    assert.equal(f.renderer.portals[0].container, globals.document.body);
    assert.equal(f.requests.length, 0);
    assert.match(text(f.renderer.tree), /Save the Visit/);
  });
  await check('persisted Visit is required before any chart fetch', async f => { f.props.visit = {}; await f.start(); assert.equal(f.requests.length, 0); assert.match(text(f.renderer.tree), /Save the Visit/); });
  for (const permission of ['clinical.view', 'visits.view']) await check(`${permission} denial hides chart and makes no request`, async f => { f.props.userProfile.permissionOverrides = { [permission]: 'deny' }; f.props.users = [f.props.userProfile]; await f.start(); assert.equal(f.requests.length, 0); assert.match(text(f.renderer.tree), /access changed/); });
  await check('empty chart offers all three maps, no dental and no default signing', async f => { await f.loaded(); for (const label of ['Face', 'Body — Front', 'Body — Back']) assert.ok(f.button(label)); assert.ok(!text(f.renderer.tree).toLowerCase().includes('dental')); assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === 'Sign saved chart')); assert.equal(f.button('Print / Save PDF').props.disabled, true); });
  await check('authorized Nurse edits and saves doctorless chart with recorded performer', async f => {
    asNurse(f); await f.loaded(nurseResponse());
    assert.match(text(f.renderer.tree), /Recorded Nurse/); assert.match(text(f.renderer.tree), /Unassigned/);
    assert.equal(f.field('Chart notes').props.readOnly, false);
    for (const label of ['Face', 'Body — Front', 'Body — Back']) { await f.click(label); await f.click('Add marker at center'); }
    await f.change('Chart notes', 'Nurse-led chart'); await f.click('Save draft');
    const request = f.requests.at(-1); assert.equal(request.url, '/api/records/visits/visit/chart/draft');
    const payload = JSON.parse(request.init.body); assert.equal(payload.notes, 'Nurse-led chart');
    assert.ok(payload.markers.some((point: any) => point.map === 'face'));
    assert.ok(payload.markers.some((point: any) => point.map === 'body-front'));
    assert.ok(payload.markers.some((point: any) => point.map === 'body-back'));
    assert.ok(!Object.hasOwn(payload, 'doctorId') && !Object.hasOwn(payload, 'performedByUserId'));
    assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === 'Sign saved chart'));
    request.deliver(nurseResponse()); await f.settle(); assert.equal(f.button('Save draft').props.disabled, false);
  });
  await check('Nurse designation without clinical edit grants remains read-only', async f => {
    asNurse(f, false); const value = nurseResponse(); value.permissions.canEdit = false; value.readOnlyReason = 'You do not have permission to edit clinical charts.';
    await f.loaded(value); assert.equal(f.field('Chart notes').props.readOnly, true);
    assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === 'Save draft'));
  });
  await check('signed nurse-led print and JSON retain historical performer after reassignment', async f => {
    asNurse(f); const value = nurseResponse(true); value.visitContext.performedByNameSnapshot = 'Different Current Performer';
    await f.loaded(value); const print = find(f.renderer.tree, node => node.props?.['aria-label'] === 'Saved clinical chart print view');
    assert.ok(print); assert.match(text(print), /Performed by:\s+Recorded Nurse/); assert.match(text(print), /Assigned doctor:\s+Unassigned/);
    assert.ok(!text(print).includes('Different Current Performer'));
    const priorDocument = globals.document, priorCreate = URL.createObjectURL, priorRevoke = URL.revokeObjectURL;
    let downloaded: Blob | undefined;
    globals.document = { ...priorDocument, createElement: () => ({ href: '', download: '', click() {} }) };
    URL.createObjectURL = (blob: Blob) => { downloaded = blob; return 'blob:nurse-chart'; }; URL.revokeObjectURL = () => {};
    try { await f.click('Export saved chart'); assert.ok(downloaded); const exported = JSON.parse(await downloaded.text());
      assert.equal(exported.snapshot.context.performedByUserId, 'nurse'); assert.equal(exported.snapshot.context.performedByNameSnapshot, 'Recorded Nurse');
      assert.ok(!JSON.stringify(exported).includes('Different Current Performer'));
    } finally { globals.document = priorDocument; URL.createObjectURL = priorCreate; URL.revokeObjectURL = priorRevoke; }
  });
  for (const action of ['save', 'sign', 'amend']) for (const status of [200, 401, 403, 409]) await check(`performer reassignment discards old ${action} ${status} without affecting new chart scope`, async f => {
    asNurse(f); f.props.userProfile.permissionOverrides['clinical.finalize'] = 'allow';
    const value = nurseResponse(action === 'amend'); value.permissions.canSign = action === 'sign';
    await f.loaded(value);
    if (action === 'save') { await f.change('Chart notes', 'OLD PERFORMER DRAFT'); await f.click('Save draft'); }
    if (action === 'sign') await f.click('Sign saved chart');
    if (action === 'amend') { await f.change('Amendment reason', 'Correction'); await f.click('Amend latest signed chart'); }
    const old = f.requests.at(-1); assert.equal(f.requests.length, 2);
    f.props.visit = { ...nurseVisit, performedByUserId: 'medical-staff', performedByNameSnapshot: 'Recorded Medical Staff', performedByDesignationSnapshot: 'Medical Staff' };
    f.render(); assert.equal(old.init.signal.aborted, true); await f.settle(); assert.equal(f.requests.length, 3);
    const current = nurseResponse(); current.visitContext = { ...current.visitContext, ...f.props.visit, doctorId: '', doctorName: '' }; current.chart.draft.notes = 'CURRENT PERFORMER DRAFT';
    f.requests.at(-1).deliver(current); await f.settle();
    old.deliver(status === 200 ? nurseResponse() : { error: 'STALE PERFORMER ERROR' }, status); await f.settle();
    assert.equal(f.field('Chart notes').props.value, 'CURRENT PERFORMER DRAFT'); assert.equal(f.button('Save draft').props.disabled, false);
    assert.ok(!text(f.renderer.tree).includes('STALE PERFORMER ERROR')); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
  });
  await check('same performer refresh retains chart request and unsaved draft', async f => {
    asNurse(f); await f.loaded(nurseResponse()); await f.change('Chart notes', 'Retain Nurse draft');
    f.props.visit = { ...nurseVisit }; f.render(); await f.settle(); assert.equal(f.requests.length, 1);
    assert.equal(f.field('Chart notes').props.value, 'Retain Nurse draft');
  });
  await check('Clinical Charts lists nurse-led Visit and opens chart without a Doctor', async f => {
    asNurse(f); f.props = { patientId: 'patient', visits: [{ ...nurseVisit }], users: f.props.users, userRole: 'staff' };
    await f.start(); assert.match(text(f.renderer.tree), /Recorded Nurse/); assert.match(text(f.renderer.tree), /Nurse-led Visits/);
    await f.click('Open chart'); assert.equal(f.requests[0].url, '/api/records/visits/visit/chart');
  }, 'ClinicalChartsTab');
  for (const label of ['Face', 'Body — Front', 'Body — Back']) await check(`${label} draft markers persist normalized coordinates`, async f => {
    await f.loaded(); await f.click(label); await f.click('Add marker at center'); await f.change('Marker label', 'Synthetic point'); await f.change('Marker notes', 'Synthetic note'); await f.change('Chart notes', 'Synthetic chart note');
    await f.click('Save draft'); const request = f.requests.at(-1); assert.equal(request.init.method, 'PUT'); assert.equal(request.url, '/api/records/visits/visit/chart/draft');
    const body = JSON.parse(request.init.body); assert.equal(body.expectedVersion, 0); assert.equal(body.expectedContextKey, 'context-current'); assert.equal(body.markers[0].map, label === 'Face' ? 'face' : label === 'Body — Front' ? 'body-front' : 'body-back'); assert.equal(body.markers[0].x, 0.5); assert.equal(body.markers[0].y, 0.5); assert.equal(body.markers[0].label, 'Synthetic point'); assert.equal(body.notes, 'Synthetic chart note');
    assert.ok(!Object.hasOwn(body, 'createdBy')); assert.equal(f.field('Chart notes').props.readOnly, true);
    request.deliver(chartResponse({ chart: { ...chartResponse().chart, draft: { ...draft(), ...body }, version: 1 } })); await f.settle(); assert.match(text(f.renderer.tree), /Chart draft saved/); assert.equal(f.button('Print / Save PDF').props.disabled, false);
  });
  await check('marker edit remove and undo restore exact prior draft', async f => { await f.loaded(chartResponse()); await f.click('1. Saved marker Face'); await f.change('Marker label', 'Edited'); await f.click('Undo'); assert.match(text(f.renderer.tree), /Saved marker/); await f.click('1. Saved marker Face'); await f.click('Remove marker'); assert.match(text(f.renderer.tree), /No markers recorded/); await f.click('Undo'); assert.match(text(f.renderer.tree), /Saved marker/); });
  await check('schematic click adds bounded point and marker keyboard selects without adding', async f => {
    await f.loaded(); const svg = find(f.renderer.tree, node => node.type === 'svg' && node.props.role === 'img'); svg.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 120 }) }, clientX: 160, clientY: -20 }); await f.settle(); await f.click('Save draft'); const body = JSON.parse(f.requests.at(-1).init.body); assert.equal(body.markers[0].x, 1); assert.equal(body.markers[0].y, 0); const button = find(f.renderer.tree, node => node.type === 'g' && node.props.role === 'button'); button.props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); await f.settle(); assert.equal(f.requests.filter(request => request.init.method === 'PUT').length, 1);
  });
  await check('unsaved edits cannot print or export saved snapshot', async f => { await f.loaded(chartResponse()); await f.change('Chart notes', 'Unsaved sensitive edit'); assert.equal(f.button('Print / Save PDF').props.disabled, true); assert.equal(f.button('Export saved chart').props.disabled, true); assert.ok(!find(f.renderer.tree, node => node.props?.['aria-label'] === 'Saved clinical chart print view')); });
  await check('saved print view shows exact author and historical chart context', async f => { const value = signedResponse(); value.chart.revisions[0].context.doctorName = 'Historical Doctor'; value.visitContext.doctorName = 'Current Doctor'; await f.loaded(value); assert.match(text(f.renderer.tree), /Historical Doctor/); const print = find(f.renderer.tree, node => node.props?.['aria-label'] === 'Saved clinical chart print view'); assert.match(text(print), /Historical Doctor/); assert.match(text(print), /Signed revision 1/); await f.click('Print / Save PDF'); assert.equal(f.prints, 1); });
  await check('JSON export contains only chosen saved signed snapshot and revokes download URL', async f => {
    const value = signedResponse(); value.chart.revisions[0].context.doctorName = 'Historical Doctor'; value.visitContext.doctorName = 'Current Doctor'; value.chart.draft = { ...draft(), kind: 'amendment', reason: 'Correction', notes: 'Saved amendment note' }; value.permissions.canEdit = true; await f.loaded(value); await f.change('Chart notes', 'UNSAVED AMENDMENT'); await f.click('Signed revision 1');
    const priorDocument = globals.document, priorCreate = URL.createObjectURL, priorRevoke = URL.revokeObjectURL;
    let downloaded: Blob | undefined, clicks = 0; const revoked: string[] = [];
    const anchor = { href: '', download: '', click() { clicks++; } };
    globals.document = { ...priorDocument, createElement(name: string) { assert.equal(name, 'a'); return anchor; } };
    URL.createObjectURL = (blob: Blob) => { downloaded = blob; return 'blob:synthetic-saved-chart'; };
    URL.revokeObjectURL = url => { revoked.push(url); };
    try {
      await f.click('Export saved chart'); assert.equal(clicks, 1); assert.equal(anchor.download, 'vine-clinical-chart-visit-revision-1.json'); assert.equal(anchor.href, 'blob:synthetic-saved-chart'); assert.deepEqual(revoked, ['blob:synthetic-saved-chart']);
      assert.ok(downloaded); const body = JSON.parse(await downloaded.text()); assert.equal(body.state, 'signed'); assert.equal(body.snapshot.revision, 1); assert.equal(body.snapshot.context.doctorName, 'Historical Doctor'); assert.equal(body.snapshot.signedBy.uid, actor.uid); assert.equal(body.snapshot.notes, 'Saved chart note'); assert.equal(body.snapshot.markers[0].notes, 'Saved marker note'); assert.ok(!JSON.stringify(body).includes('UNSAVED AMENDMENT')); assert.ok(!JSON.stringify(body).includes('Current Doctor'));
    } finally { globals.document = priorDocument; URL.createObjectURL = priorCreate; URL.revokeObjectURL = priorRevoke; }
  });
  await check('signed revision is read-only and amendment preserves signed content', async f => {
    await f.loaded(signedResponse()); assert.equal(f.field('Chart notes').props.readOnly, true); assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === 'Save draft'));
    await f.change('Amendment reason', 'Correct location'); await f.click('Amend latest signed chart'); const request = f.requests.at(-1); assert.equal(request.url, '/api/records/visits/visit/chart/amendment'); assert.deepEqual(JSON.parse(request.init.body), { expectedVersion: 2, expectedContextKey: 'context-current', reason: 'Correct location' });
    const value = signedResponse(); value.chart.version = 3; value.chart.draft = { ...draft(), kind: 'amendment', reason: 'Correct location' }; value.permissions.canEdit = true; value.permissions.canAmend = false; request.deliver(value); await f.settle(); assert.match(text(f.renderer.tree), /Amendment draft/); assert.equal(f.field('Chart notes').props.readOnly, false); await f.change('Chart notes', 'Correction'); await f.click('Signed revision 1'); assert.equal(f.field('Chart notes').props.value, 'Saved chart note'); await f.click('Amendment draft'); assert.equal(f.field('Chart notes').props.value, 'Correction');
  });
  await check('amendment requires explicit reason', async f => { await f.loaded(signedResponse()); await f.click('Amend latest signed chart'); assert.equal(f.requests.length, 1); assert.match(text(f.renderer.tree), /Enter a reason/); });
  await check('explicit finalization capability permits signing only a saved unchanged draft', async f => {
    f.props.userProfile.permissionOverrides = { 'clinical.finalize': 'allow' }; f.props.users = [f.props.userProfile]; await f.loaded(chartResponse({ permissions: { canEdit: true, canSign: true, canAmend: false } })); assert.equal(f.button('Sign saved chart').props.disabled, false);
    await f.change('Chart notes', 'Unsaved'); assert.equal(f.button('Sign saved chart').props.disabled, true); await f.click('Undo'); await f.click('Sign saved chart'); const request = f.requests.at(-1); assert.equal(request.url, '/api/records/visits/visit/chart/sign'); assert.deepEqual(JSON.parse(request.init.body), { expectedVersion: 1, expectedContextKey: 'context-current' }); request.deliver(signedResponse()); await f.settle(); assert.match(text(f.renderer.tree), /signed revision is read-only/);
  });
  await check('changed Visit context blocks signing until draft is saved against current context', async f => { f.props.userProfile.permissionOverrides = { 'clinical.finalize': 'allow' }; f.props.users = [f.props.userProfile]; const value = chartResponse({ permissions: { canEdit: true, canSign: true, canAmend: false } }); value.chart.draft.contextKey = 'old-context'; await f.loaded(value); assert.equal(f.button('Sign saved chart').props.disabled, true); assert.match(text(f.renderer.tree), /Visit details changed/); await f.click('Save draft'); assert.equal(JSON.parse(f.requests.at(-1).init.body).expectedContextKey, 'context-current'); });
  await check('backend read-only permission disables draft mutation even for clinical Doctor', async f => { await f.loaded(chartResponse({ permissions: { canEdit: false, canSign: false, canAmend: false }, readOnlyReason: 'Assigned to another doctor.' })); assert.equal(f.field('Chart notes').props.readOnly, true); assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === 'Add marker at center')); assert.match(text(f.renderer.tree), /Assigned to another doctor/); });
  for (const status of [409, 500]) await check(`mutation ${status} requires authoritative reload before retry`, async f => { await f.loaded(chartResponse()); await f.change('Chart notes', 'New local draft'); await f.click('Save draft'); f.requests.at(-1).deliver({ error: status === 409 ? 'Version conflict' : 'Cannot confirm action', code: 'CHART_VERSION_CHANGED' }, status); await f.settle(); assert.match(text(f.renderer.tree), /Reload the saved chart before/); assert.equal(f.button('Save draft').props.disabled, true); assert.equal(f.field('Chart notes').props.value, 'New local draft'); await f.click('Reload saved chart'); f.requests.at(-1).deliver(chartResponse()); await f.settle(); assert.equal(f.field('Chart notes').props.value, 'Saved chart note'); assert.equal(f.button('Save draft').props.disabled, false); });
  for (const status of [200, 401, 403, 409]) for (const change of ['scope', 'logout', 'unmount']) await check(`old save ${status} cannot affect ${change} scope`, async f => {
    await f.loaded(chartResponse()); await f.change('Chart notes', 'Old scope draft'); await f.click('Save draft'); const request = f.requests.at(-1);
    if (change === 'scope') f.scope(); if (change === 'logout') { globals.servicesTestAuth.currentUser = null; f.render(); } if (change === 'unmount') f.stop();
    request.deliver(status === 200 ? chartResponse() : { error: 'STALE ERROR' }, status); await f.settle(); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0); assert.ok(!text(f.renderer.tree).includes('STALE ERROR')); if (change !== 'unmount') assert.ok(!find(f.renderer.tree, node => node.props?.value === 'Old scope draft'));
  });
  for (const status of [401, 403]) await check(`current chart save ${status} invalidates and clears protected draft`, async f => { await f.loaded(chartResponse()); await f.change('Chart notes', 'Protected draft'); await f.click('Save draft'); f.requests.at(-1).deliver({ error: 'Access denied' }, status); await f.settle(); assert.equal(globals.servicesTestInvalidations, 1); assert.ok(!find(f.renderer.tree, node => node.props?.value === 'Protected draft')); assert.match(text(f.renderer.tree), /access changed/); });
  await check('late detail response after branch/access change is discarded', async f => { await f.start(); const old = f.requests[0]; f.scope(); await f.settle(); old.deliver(chartResponse()); await f.settle(); assert.ok(!text(f.renderer.tree).includes('Saved chart note')); assert.equal(f.renderer.lateSetters, 0); });
  await check('VisitForm exposes chart only for existing persisted Visit', async f => {
    f.props = { patients: [{ id: 'patient', name: 'Synthetic Patient' }], branches: [{ id: 'A', branchName: 'A', status: 'Active' }], users: [profile()], userRole: 'doctor', defaultBranchId: 'A', visits: [], appointments: [], onSave() {}, onClose() {} }; await f.start(); assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === 'Open chart'));
    f.props.visit = { ...visit }; f.render(); await f.settle(); assert.ok(f.button('Open chart')); await f.click('Open chart'); assert.ok(f.requests.some(request => request.url === '/api/records/visits/visit/chart'));
  }, 'VisitForm');
  await check('patient Clinical Charts tab lists saved Visits and opens linked chart', async f => { f.props = { patientId: 'patient', users: [profile()], userRole: 'doctor', visits: [{ ...visit }] }; await f.start(); assert.equal(f.requests.length, 0); await f.click('Open chart'); assert.equal(f.requests[0].url, '/api/records/visits/visit/chart'); }, 'ClinicalChartsTab');
  for (const component of ['ClinicalChartsTab', 'PatientTimeline']) {
    await check(`${component}: subscription removal aborts old detail and restoration requires explicit reopening`, async f => {
      await openPatientChart(f, component); const old = f.requests[0];
      f.props.visits = []; f.render(); assert.ok(!chartDialog(f)); await f.settle();
      assert.equal(old.init.signal.aborted, true);
      old.deliver(chartResponse()); await f.settle();
      assert.ok(!chartDialog(f)); assert.ok(!text(f.renderer.tree).includes('Saved chart note'));
      assert.equal(f.renderer.lateSetters, 0); assert.equal(globals.servicesTestInvalidations, 0);
      f.props.visits = [{ ...visit }]; f.render(); await f.settle();
      assert.ok(!chartDialog(f)); assert.equal(f.requests.length, 1);
      await f.click('Open chart'); assert.equal(f.requests.length, 2);
      const current = chartResponse(); current.chart.draft.notes = 'Current restored chart';
      f.requests[1].deliver(current); await f.settle();
      assert.equal(f.field('Chart notes').props.value, 'Current restored chart');
      assert.equal(f.button('Save draft').props.disabled, false);
    }, component);
    await check(`${component}: archived row closes loaded unsaved editor and removes chart actions`, async f => {
      await openPatientChart(f, component); f.requests[0].deliver(chartResponse()); await f.settle();
      await f.change('Chart notes', 'Unsaved archived draft');
      f.props.visits = [{ ...visit, isArchived: true }]; f.render(); await f.settle();
      assert.ok(!chartDialog(f)); assert.ok(!text(f.renderer.tree).includes('Unsaved archived draft'));
      for (const label of ['Open chart', 'Save draft', 'Print / Save PDF', 'Export saved chart']) {
        assert.ok(!find(f.renderer.tree, node => node.type === 'button' && text(node).trim() === label));
      }
      assert.equal(f.requests.length, 1); assert.equal(f.renderer.lateSetters, 0);
    }, component);
    for (const status of [200, 401, 403, 409]) await check(`${component}: old save ${status} after archive cannot restore data or invalidate restored scope`, async f => {
      await openPatientChart(f, component); f.requests[0].deliver(chartResponse()); await f.settle();
      await f.change('Chart notes', 'Old archived draft'); await f.click('Save draft'); const old = f.requests.at(-1);
      f.props.visits = []; f.render(); await f.settle(); assert.equal(old.init.signal.aborted, true);
      f.props.visits = [{ ...visit }]; f.render(); await f.settle(); await f.click('Open chart');
      const current = chartResponse(); current.chart.draft.notes = 'Restored current scope';
      f.requests.at(-1).deliver(current); await f.settle();
      old.deliver(status === 200 ? chartResponse() : { error: 'STALE ARCHIVED ERROR' }, status); await f.settle();
      assert.equal(f.field('Chart notes').props.value, 'Restored current scope');
      assert.equal(f.button('Save draft').props.disabled, false);
      assert.ok(!text(f.renderer.tree).includes('STALE ARCHIVED ERROR'));
      assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
    }, component);
    await check(`${component}: unrelated list refresh preserves active chart and unsaved edits`, async f => {
      await openPatientChart(f, component); const old = f.requests[0];
      f.props.visits = [{ ...visit }, { ...visit, id: 'unrelated-visit' }]; f.render(); await f.settle();
      assert.equal(old.init.signal.aborted, false); assert.equal(f.requests.length, 1);
      old.deliver(chartResponse()); await f.settle(); await f.change('Chart notes', 'Keep current unsaved draft');
      f.props.visits = [{ ...visit }]; f.render(); await f.settle();
      assert.equal(f.field('Chart notes').props.value, 'Keep current unsaved draft');
      assert.equal(f.requests.length, 1); assert.equal(f.button('Save draft').props.disabled, false);
    }, component);
  }
  await check('patient profile exposes Clinical Charts tab alongside existing workflow tabs', async f => { f.props = { patient: { id: 'patient', name: 'Synthetic Patient' }, users: [profile()], branches: [{ id: 'A', branchName: 'A' }], visits: [{ ...visit }], appointments: [], userRole: 'doctor', onClose() {} }; await f.start(); const tab = find(f.renderer.tree, node => node.props?.role === 'tab' && text(node).includes('Clinical Charts')); assert.ok(tab); tab.props.onClick(); await f.settle(); assert.ok(f.button('Open chart')); assert.match(text(f.renderer.tree), /Face and front\/back body charts/); }, 'PatientProfile');
} finally { await harness.cleanup(); }
const failures = results.filter(result => !result.passed);
for (const failure of failures) console.error(failure.name + ': ' + failure.error);
console.log(`Clinical chart UI: ${results.length - failures.length}/${results.length} controlled component scenarios passed (not browser evidence)`);
if (failures.length) process.exitCode = 1;
