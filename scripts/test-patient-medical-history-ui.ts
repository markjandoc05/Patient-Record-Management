import assert from 'node:assert/strict';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';

const harness = await buildControlledForms(['PatientForm']);
type Pending = { init: any; url: string; deliver: (body: any, status?: number) => void };
class Fixture {
  renderer = new Renderer(harness.components.PatientForm); requests: Pending[] = []; saves = 0; closes = 0;
  profile: any = { id: 'admin', email: 'admin@example.invalid', role: 'admin', active: true, assignedBranches: ['A'], accessRevision: 0 };
  props: any = { db: {}, user: { uid: 'admin' }, users: [this.profile], userProfile: this.profile, patients: [],
    branches: [{ id: 'A', branchName: 'Synthetic A', status: 'Active' }], defaultBranchId: 'A',
    patient: { id: 'patient', name: 'Synthetic Patient', contactNumber: '09171234567', email: '', gender: 'Female', address: '',
      birthDateStatus: 'unknown', mainConcern: 'Synthetic concern', homeBranchId: 'A', status: 'Active',
      medicalHistory: '  Retained history  ', healthConcerns: 'Retained concern', clinicalHistoryVersion: 3, lastUpdatedAt: '2035-01-01T10:00:00Z' },
    onSave: () => this.saves++, onClose: () => this.closes++ };
  async start() {
    globals.servicesTestAuth.currentUser = { uid: 'admin', email: this.profile.email, getRequestToken: async () => 'synthetic' };
    globals.servicesTestInvalidations = 0;
    globals.fetch = (url: string, init: any) => new Promise<Response>(resolve => this.requests.push({ url, init,
      deliver: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })) }));
    this.render(); await this.settle();
  }
  render() { this.renderer.render(this.props); }
  async settle() { for (let i = 0; i < 12; i++) { this.renderer.passives.splice(0).forEach(run => run()); await flush(); if (this.renderer.dirty) this.render(); } }
  node(id: string) { const node = find(this.renderer.tree, n => n.props?.id === id); assert.ok(node, id); return node; }
  disabled(id: string) {
    // Native controls outside a fieldset's legend also inherit its disabled state.
    const visit = (node: any, fieldsetDisabled = false): boolean | undefined => {
      if (Array.isArray(node)) {
        for (const child of node) { const result = visit(child, fieldsetDisabled); if (result !== undefined) return result; }
      } else if (node && typeof node === 'object') {
        const inherited = fieldsetDisabled || node.type === 'fieldset' && Boolean(node.props?.disabled);
        if (node.props?.id === id) return inherited || Boolean(node.props.disabled);
        return visit(node.props?.children, inherited);
      }
    };
    const disabled = visit(this.renderer.tree); assert.notEqual(disabled, undefined, id); return disabled;
  }
  async edit(id: string, value: string) {
    if (this.disabled(id)) return false;
    this.node(id).props.onChange({ target: { value } }); await this.settle(); return true;
  }
  async save() { find(this.renderer.tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await this.settle(); }
  scope() { this.profile = { ...this.profile, accessRevision: this.profile.accessRevision + 1 }; this.props.users = [this.profile]; this.props.userProfile = this.profile; this.render(); }
  stop() { this.renderer.unmount(); }
}
let checks = 0;
async function check(name: string, fn: (f: Fixture) => Promise<void>) {
  const f = new Fixture();
  try { await fn(f); checks++; } catch (error) { console.error('FAIL: ' + name); throw error; }
  finally { f.stop(); }
}
try {
  await check('existing history selected and submits exact opened revision', async f => {
    await f.start(); assert.equal(f.node('patient-medicalHistory').props.value, '  Retained history  ');
    await f.edit('patient-medicalHistory', 'New reported history'); await f.save();
    const body = JSON.parse(f.requests[0].init.body); assert.equal(body.medicalHistory, 'New reported history');
    assert.equal(body.expectedClinicalHistoryVersion, 3); assert.equal(body.expectedLastUpdatedAt, f.props.patient.lastUpdatedAt);
    assert.ok(!Object.hasOwn(body, 'clinicalHistoryUpdatedByUid'));
    f.requests[0].deliver({ id: 'patient' }); await f.settle(); assert.equal(f.saves, 1); assert.equal(f.closes, 1);
  });
  for (const field of ['medicalHistory', 'healthConcerns']) for (const status of [200, 409, 500]) {
    await check(`pending ${field} save ${status} locks the submitted draft`, async f => {
      // Reproduce the parent's successful-close unmount, including the finally path.
      f.props.onClose = () => { f.closes++; f.stop(); };
      await f.start(); const id = `patient-${field}`, submitted = `Submitted ${field}`, newer = `Newer ${field}`;
      assert.equal(f.disabled(id), false); assert.equal(await f.edit(id, submitted), true); await f.save();
      assert.equal(f.requests.length, 1); const pending = f.requests[0];
      assert.equal(JSON.parse(pending.init.body)[field], submitted); assert.equal(f.saves, 0); assert.equal(f.closes, 0);
      for (const historyField of ['medicalHistory', 'healthConcerns']) assert.equal(f.disabled(`patient-${historyField}`), true);
      assert.equal(f.disabled('patient-name'), true); assert.equal(await f.edit('patient-name', 'Newer patient draft'), false);
      assert.equal(await f.edit(id, newer), false); assert.equal(f.node(id).props.value, submitted);
      await f.save(); assert.equal(f.requests.length, 1);
      pending.deliver(status === 200 ? { id: 'patient' } : { error: `Current save failed ${status}` }, status); await f.settle();
      if (status !== 200) {
        assert.equal(f.saves, 0); assert.equal(f.closes, 0); assert.equal(f.node(id).props.value, submitted);
        assert.match(text(f.renderer.tree), new RegExp(`Current save failed ${status}`));
        for (const historyField of ['medicalHistory', 'healthConcerns']) assert.equal(f.disabled(`patient-${historyField}`), false);
        assert.equal(f.disabled('patient-name'), false); assert.equal(await f.edit(id, newer), true); await f.save();
        assert.equal(f.requests.length, 2); assert.equal(JSON.parse(f.requests[1].init.body)[field], newer);
        f.requests[1].deliver({ id: 'patient' }); await f.settle();
      }
      assert.equal(f.saves, 1); assert.equal(f.closes, 1); assert.equal(f.renderer.frames.size, 0); assert.equal(f.renderer.lateSetters, 0);
    });
  }
  await check('background poll cannot replace the opened conflict tokens', async f => {
    await f.start(); await f.edit('patient-medicalHistory', 'Unsaved old draft');
    f.props.patient = { ...f.props.patient, medicalHistory: 'Other writer', clinicalHistoryVersion: 4, lastUpdatedAt: '2035-01-01T11:00:00Z' };
    f.render(); await f.save(); const body = JSON.parse(f.requests[0].init.body);
    assert.equal(body.medicalHistory, 'Unsaved old draft'); assert.equal(body.expectedClinicalHistoryVersion, 3);
    assert.equal(body.expectedLastUpdatedAt, '2035-01-01T10:00:00Z');
    f.requests[0].deliver({ error: 'Medical history changed.', code: 'PATIENT_HISTORY_VERSION_CHANGED' }, 409); await f.settle();
    assert.equal(f.closes, 0); assert.equal(f.node('patient-medicalHistory').props.value, 'Unsaved old draft'); assert.match(text(f.renderer.tree), /Medical history changed/);
  });
  await check('legacy missing fields do not become negative findings', async f => {
    delete f.props.patient.medicalHistory; delete f.props.patient.healthConcerns; delete f.props.patient.clinicalHistoryVersion;
    await f.start(); assert.equal(f.node('patient-medicalHistory').props.value, ''); await f.save();
    const body = JSON.parse(f.requests[0].init.body); assert.equal(body.medicalHistory, ''); assert.equal(body.expectedClinicalHistoryVersion, 0);
    assert.equal(body.allergiesStatus, 'unknown');
  });
  await check('legacy over-limit text remains unchanged; changed over-limit input fails', async f => {
    f.props.patient.medicalHistory = 'L'.repeat(5100); await f.start(); await f.save();
    assert.equal(JSON.parse(f.requests[0].init.body).medicalHistory, f.props.patient.medicalHistory);
    f.requests[0].deliver({ id: 'patient' }); await f.settle();
    await f.edit('patient-medicalHistory', 'N'.repeat(5101)); await f.save(); assert.equal(f.requests.length, 1);
    assert.match(text(f.renderer.tree), /5000 characters/);
  });
  await check('imported non-text background stays visible, read-only and omitted from unrelated edits', async f => {
    f.props.patient.medicalHistory = { reported: ['Historical entry'] }; await f.start();
    assert.equal(f.node('patient-medicalHistory').props.disabled, true);
    assert.match(f.node('patient-medicalHistory').props.value, /Historical entry/);
    await f.save(); assert.ok(!Object.hasOwn(JSON.parse(f.requests[0].init.body), 'medicalHistory'));
  });
  for (const role of ['staff', 'manager']) await check(role + ' patient edit remains limited', async f => {
    f.profile.role = role; f.profile.staffDesignation = 'Nurse'; await f.start(); assert.equal(f.node('patient-medicalHistory').props.disabled, true);
    await f.save(); const body = JSON.parse(f.requests[0].init.body);
    assert.ok(!Object.hasOwn(body, 'medicalHistory') && !Object.hasOwn(body, 'healthConcerns') && !Object.hasOwn(body, 'expectedClinicalHistoryVersion'));
  });
  await check('own profile without a document id remains operational', async f => {
    delete f.profile.id; f.props.users = []; await f.start(); assert.ok(f.node('patient-medicalHistory'));
  });
  await check('fresh own-role profile wins over a stale shared user row', async f => {
    f.props.userProfile = { ...f.profile, role: 'staff', staffDesignation: 'Nurse', accessRevision: 1 };
    await f.start(); assert.equal(f.node('patient-medicalHistory').props.disabled, true);
    await f.save(); assert.ok(!Object.hasOwn(JSON.parse(f.requests[0].init.body), 'medicalHistory'));
  });
  await check('clinical editing denied keeps history read-only and omitted', async f => {
    f.profile.permissionOverrides = { 'clinical.edit_draft': 'deny' }; await f.start();
    assert.equal(f.node('patient-medicalHistory').props.disabled, true); await f.save();
    assert.ok(!Object.hasOwn(JSON.parse(f.requests[0].init.body), 'medicalHistory'));
  });
  for (const status of [200, 401, 403, 409]) for (const change of ['scope', 'logout', 'invalidate', 'unmount']) {
    await check(`old save ${status} after ${change} cannot affect new scope`, async f => {
      await f.start(); await f.edit('patient-medicalHistory', 'Old unsaved scope'); await f.save(); const old = f.requests[0];
      if (change === 'scope') f.scope();
      if (change === 'logout') { globals.servicesTestAuth.currentUser = null; f.render(); }
      if (change === 'invalidate') { for (const listener of globals.appointmentInvalidationListeners) listener(); f.render(); }
      if (change === 'unmount') f.stop();
      old.deliver(status === 200 ? { id: 'patient' } : { error: 'OBSOLETE_HISTORY_SAVE' }, status); await flush();
      assert.equal(f.saves, 0); assert.equal(f.closes, 0); assert.equal(globals.servicesTestInvalidations, 0); assert.equal(f.renderer.lateSetters, 0);
      if (change !== 'unmount') { await f.settle(); assert.ok(!text(f.renderer.tree).includes('OBSOLETE_HISTORY_SAVE') && !text(f.renderer.tree).includes('Old unsaved scope')); }
      if (change === 'scope') {
        await f.edit('patient-medicalHistory', 'Current scope'); await f.save(); assert.equal(f.requests.length, 2);
        f.requests[1].deliver({ id: 'patient' }); await f.settle(); assert.equal(f.saves, 1); assert.equal(f.closes, 1);
      }
    });
  }
  for (const status of [401, 403]) await check('current denial ' + status + ' still invalidates', async f => {
    await f.start(); await f.save(); f.requests[0].deliver({ error: 'Current denial' }, status); await f.settle();
    assert.equal(globals.servicesTestInvalidations, 1); assert.equal(f.closes, 0); assert.match(text(f.renderer.tree), /Patient access changed/);
  });
  await check('new registration exposes optional fields without a history version command', async f => {
    f.props.patient = undefined; await f.start(); await f.edit('patient-name', 'Synthetic New Patient');
    const contact = find(f.renderer.tree, n => n.props?.['data-patient-field'] === 'contactNumber');
    contact.props.onChange({ target: { value: '09171234567' } }); await f.settle();
    await f.edit('patient-main-concern', 'Synthetic reason'); await f.edit('patient-medicalHistory', 'Reported history'); await f.save();
    const body = JSON.parse(f.requests[0].init.body); assert.equal(body.medicalHistory, 'Reported history'); assert.ok(!Object.hasOwn(body, 'expectedClinicalHistoryVersion'));
    f.requests[0].deliver({ id: 'created', patientID: 'SYNTHETIC' }, 201); await f.settle(); assert.equal(f.saves, 1);
  });
  console.log(`${checks} patient medical history controlled form/race checks passed (not browser evidence).`);
} finally { await harness.cleanup(); }
