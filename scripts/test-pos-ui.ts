import assert from 'node:assert/strict';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';
const h = await buildControlledForms(['PosDashboard'], process.cwd(), { exposePermissionState: true, useProductionInvalidation: true });
let checks = 0;
const syntheticPatient = { id: 'p', name: 'Synthetic patient', patientID: 'SYN-001' };
const otherPatient = { id: 'p2', name: 'Another synthetic patient', patientID: 'SYN-002' };
const syntheticService = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic service', version: 1, price: '100.00' };
class Fixture {
    profile: any = { active: true, role: 'staff', assignedBranches: ['A', 'B'], accessRevision: 1 };
    props: any;
    renderer: Renderer;
    requests: any[] = [];
    constructor() { globals.servicesTestAuth.currentUser = { uid: 'synthetic', getRequestToken: async () => 'csrf' }; h.modules.PosDashboard.publishPermissionProfile(this.profile); globals.fetch = (url: string, init: any) => new Promise((resolve, reject) => this.requests.push({ url, init, deliver: (body: any, status = 200) => resolve(new Response(JSON.stringify(body), { status })), fail: () => reject(new TypeError('Synthetic lost reply')) })); this.props = { userProfile: this.profile, activeBranchId: 'A' }; this.renderer = new Renderer(h.components.PosDashboard); }
    async settle() { for (let n = 0; n < 12; n++) {
        this.renderer.passives.splice(0).forEach((f: any) => f());
        await flush();
        if (this.renderer.dirty)
            this.renderer.render(this.props);
    } }
    async init() { this.renderer.render(this.props); await this.settle(); this.requests.find(r => r.url.endsWith('/branches')).deliver({ branches: [{ id: 'A', name: 'Synthetic A', status: 'Active' }, { id: 'B', name: 'Synthetic B', status: 'Active' }] }); this.requests.find(r => r.url.includes('/invoices?')).deliver({ invoices: [], total: 0 }); await this.settle(); }
    field(label: string) { const l = find(this.renderer.tree, n => n.type === 'label' && text(Array.isArray(n.props.children) ? n.props.children[0] : n.props.children).trim() === label); assert.ok(l, 'field ' + label); return find(l, n => ['input', 'select', 'textarea'].includes(n.type)); }
    disabled(node: any) { return Boolean(node.props.disabled || find(this.renderer.tree, n => n.type === 'fieldset' && n.props.disabled && find(n.props.children, child => child === node))); }
    button(label: string) { const b = find(this.renderer.tree, n => n.type === 'button' && text(n).trim() === label); assert.ok(b, 'button ' + label); return b; }
    async click(label: string) { this.button(label).props.onClick(); await this.settle(); }
    async change(label: string, value: string) { this.field(label).props.onChange({ target: { value } }); await this.settle(); }
    patientResult(patient = syntheticPatient) { const b = find(this.renderer.tree, n => n.type === 'button' && text(n).includes(patient.name) && text(n).includes(patient.patientID || patient.id)); assert.ok(b, 'patient result ' + patient.patientID); return b; }
    async choosePatient(patient = syntheticPatient) { await this.change('Patient', patient.patientID || patient.name); await this.options({ patients: [patient] }); this.patientResult(patient).props.onClick(); await this.settle(); }
    async optionsRequest() { await new Promise(r => setTimeout(r, 170)); await this.settle(); const req = this.requests.filter(r => r.url.includes('/options?')).at(-1); assert.ok(req, 'options request'); return req; }
    async options(body: any = {}) { const req = await this.optionsRequest(); const params = new URL(req.url, 'https://synthetic.invalid').searchParams; const patients = body.patients || (params.get('q') ? [syntheticPatient] : []); const patientId = params.get('patientId'); req.deliver({ patients, selectedPatient: [...patients, syntheticPatient, otherPatient].find(p => p.id === patientId) || null, services: [syntheticService], packages: [], sources: [], ...body }); await this.settle(); return req; }
    assertNoPatientChoices() { assert.ok(!find(this.renderer.tree, n => n.props?.['aria-label'] === 'Matching patients'), 'short searches have no patient result list'); assert.ok(!text(this.renderer.tree).includes('Searching patients…'), 'short searches have no patient search loading state'); assert.ok(!text(this.renderer.tree).includes('No matching patients.'), 'short searches have no no-matches message'); for (const patient of [syntheticPatient, otherPatient]) assert.ok(!find(this.renderer.tree, n => n.type === 'button' && text(n).includes(patient.patientID)), 'short searches cannot render cached patient choices'); }
    async sourceRequest() { await new Promise(r => setTimeout(r, 170)); await this.settle(); return this.requests.filter(r => r.url.includes('/sources?')).at(-1); }
    async sources(body: any, status = 200) { const req = await this.sourceRequest(); assert.ok(req, 'source request'); req.deliver(body, status); await this.settle(); return req; }
    async newDraft() { await this.init(); await this.click('New invoice'); await this.options(); }
    async draft() { await this.newDraft(); await this.choosePatient(); await this.options(); await this.change('Item', syntheticService.id); await this.click('Add item'); await this.change('Invoice notes', 'KEEP UNSAVED NOTES'); }
    async submit() { find(this.renderer.tree, n => n.type === 'form').props.onSubmit({ preventDefault() { } }); await this.settle(); return this.requests.filter(r => r.init.method === 'POST').at(-1); }
    async invoice(detail: any) { await this.init(); await this.click('Refresh'); this.requests.filter(r => r.url.includes('/invoices?')).at(-1).deliver({ invoices: [detail], total: 1, page: 1 }); await this.settle(); await this.click('Open'); this.requests.at(-1).deliver(detail); await this.settle(); }
    async correct() { const form = find(this.renderer.tree, n => n.type === 'form' && n.props['aria-label'] === 'Payment correction'); assert.ok(form, 'payment correction form'); form.props.onSubmit({ preventDefault() {} }); await this.settle(); return this.requests.filter(r => r.init.method === 'POST').at(-1); }
    stop() { this.renderer.unmount(); }
}
try {
    const emptyDraft = new Fixture();
    try {
        await emptyDraft.newDraft();
        assert.equal(emptyDraft.field('Patient').type, 'input', 'Patient is one search field');
        assert.equal(emptyDraft.field('Patient').props.type, 'search');
        assert.ok(!find(emptyDraft.renderer.tree, n => n.type === 'label' && text(Array.isArray(n.props.children) ? n.props.children[0] : n.props.children).trim() === 'Search patient'), 'no separate patient search and selection controls');
        assert.ok(text(emptyDraft.renderer.tree).includes('Add items to calculate'));
        assert.ok(text(emptyDraft.renderer.tree).includes('Choose a patient and add an item.'));
        assert.ok(emptyDraft.button('Save draft').props.disabled);
        assert.ok(emptyDraft.disabled(emptyDraft.field('Item')), 'items require an explicitly selected patient');
        assert.equal(emptyDraft.requests.filter(r => r.init.method !== 'GET').length, 0, 'opening a draft does not write');
        checks++;
    } finally { emptyDraft.stop(); }
    for (const query of ['', '   ', ' S ']) {
        const searchThreshold = new Fixture();
        try {
            await searchThreshold.newDraft();
            searchThreshold.field('Patient').props.onFocus?.(); await searchThreshold.settle();
            await searchThreshold.change('Patient', query);
            searchThreshold.assertNoPatientChoices();
            const req = await searchThreshold.options({ patients: [syntheticPatient, otherPatient] });
            assert.equal(new URL(req.url, 'https://synthetic.invalid').searchParams.get('q'), '', 'empty, whitespace and one-character searches send no patient query');
            searchThreshold.assertNoPatientChoices();
            assert.ok(text(searchThreshold.renderer.tree).includes('Type at least 2 characters to search by name or patient ID.'));
            assert.equal(searchThreshold.requests.filter(r => r.init.method !== 'GET').length, 0);
            checks++;
        } finally { searchThreshold.stop(); }
    }
    const twoCharacterSearch = new Fixture();
    try {
        await twoCharacterSearch.newDraft();
        await twoCharacterSearch.change('Patient', '  SY  ');
        assert.ok(text(twoCharacterSearch.renderer.tree).includes('Searching patients…'));
        const req = await twoCharacterSearch.options({ patients: [syntheticPatient] });
        assert.equal(new URL(req.url, 'https://synthetic.invalid').searchParams.get('q'), 'SY', 'two trimmed characters trigger the bounded patient lookup');
        assert.ok(find(twoCharacterSearch.renderer.tree, n => n.props?.['aria-label'] === 'Matching patients'));
        twoCharacterSearch.patientResult();
        assert.ok(!find(twoCharacterSearch.renderer.tree, n => n.props?.['aria-label'] === 'Selected patient'), 'matches still require an explicit choice');
        assert.ok(twoCharacterSearch.button('Save draft').props.disabled);
        assert.equal(twoCharacterSearch.requests.filter(r => r.init.method !== 'GET').length, 0);
        checks++;
    } finally { twoCharacterSearch.stop(); }
    for (const status of [200, 403]) {
        const clearedSearch = new Fixture();
        try {
            await clearedSearch.newDraft();
            await clearedSearch.change('Patient', 'SYN-001');
            const old = await clearedSearch.optionsRequest();
            await clearedSearch.change('Patient', '');
            clearedSearch.assertNoPatientChoices();
            const invalidations = globals.servicesTestInvalidations;
            old.deliver(status === 200 ? { patients: [syntheticPatient], selectedPatient: null, services: [], packages: [], sources: [] } : { error: 'Obsolete cleared patient search denial' }, status);
            await clearedSearch.settle();
            assert.equal(globals.servicesTestInvalidations, invalidations, 'cleared search rejects old denial invalidation');
            clearedSearch.assertNoPatientChoices();
            assert.ok(!text(clearedSearch.renderer.tree).includes('Obsolete cleared patient search denial'));
            const current = await clearedSearch.options();
            assert.equal(new URL(current.url, 'https://synthetic.invalid').searchParams.get('q'), '');
            clearedSearch.assertNoPatientChoices();
            assert.equal(clearedSearch.field('Patient').props.value, '');
            assert.equal(clearedSearch.requests.filter(r => r.init.method !== 'GET').length, 0);
            checks++;
        } finally { clearedSearch.stop(); }
    }
    const patientSearch = new Fixture();
    try {
        await patientSearch.newDraft();
        await patientSearch.change('Patient', 'SYN-002');
        const searched = await patientSearch.options({ patients: [syntheticPatient, otherPatient] });
        const params = new URL(searched.url, 'https://synthetic.invalid').searchParams;
        assert.equal(params.get('q'), 'SYN-002');
        assert.equal(params.get('patientId'), '', 'typing a matching ID does not select the patient');
        assert.ok(!find(patientSearch.renderer.tree, n => n.props?.['aria-label'] === 'Selected patient'));
        assert.ok(patientSearch.disabled(patientSearch.field('Item')));
        assert.ok(patientSearch.button('Save draft').props.disabled);
        patientSearch.patientResult(otherPatient);
        assert.equal(patientSearch.requests.filter(r => r.init.method !== 'GET').length, 0);
        await patientSearch.choosePatient(otherPatient);
        const selected = find(patientSearch.renderer.tree, n => n.props?.['aria-label'] === 'Selected patient');
        assert.ok(selected, 'the clicked result is shown as the selected patient');
        assert.ok(text(selected).includes(otherPatient.name));
        assert.ok(text(selected).includes(otherPatient.patientID), 'selected patient keeps a visible distinguishing ID');
        assert.ok(!find(patientSearch.renderer.tree, n => n.type === 'input' && n.props.type === 'search' && n.props.value === 'SYN-002'), 'selection replaces the search field');
        const selectedOptions = await patientSearch.options({ patients: [], selectedPatient: otherPatient });
        assert.equal(new URL(selectedOptions.url, 'https://synthetic.invalid').searchParams.get('patientId'), otherPatient.id);
        assert.ok(text(find(patientSearch.renderer.tree, n => n.props?.['aria-label'] === 'Selected patient')).includes(otherPatient.patientID), 'exact selection survives an empty search window');
        await patientSearch.change('Item', syntheticService.id); await patientSearch.click('Add item');
        assert.ok(!find(patientSearch.renderer.tree, n => n.type === 'label' && /^Quantity\b/i.test(text(n))), 'invoice lines do not introduce quantity');
        assert.equal(patientSearch.requests.filter(r => r.init.method !== 'GET').length, 0, 'selection and Add item do not auto-save');
        const save = await patientSearch.submit(), body = JSON.parse(save.init.body);
        assert.equal(body.patientId, otherPatient.id); assert.equal(body.branchId, 'A');
        assert.deepEqual(body.items, [{ kind: 'service', id: syntheticService.id, expectedVersion: 1 }]);
        checks++;
    } finally { patientSearch.stop(); }
    for (const status of [200, 403]) {
        const stalePatientSearch = new Fixture();
        try {
            await stalePatientSearch.newDraft();
            await stalePatientSearch.change('Patient', 'obsolete patient');
            const obsolete = await stalePatientSearch.optionsRequest();
            await stalePatientSearch.change('Patient', 'SYN-002');
            await stalePatientSearch.options({ patients: [otherPatient] });
            const invalidations = globals.servicesTestInvalidations;
            obsolete.deliver(status === 200 ? { patients: [syntheticPatient], selectedPatient: null, services: [], packages: [], sources: [] } : { error: 'Obsolete patient search denial' }, status);
            await stalePatientSearch.settle();
            assert.equal(globals.servicesTestInvalidations, invalidations, 'old search denial cannot invalidate the current patient search');
            assert.equal(stalePatientSearch.field('Patient').props.value, 'SYN-002');
            stalePatientSearch.patientResult(otherPatient);
            assert.ok(!find(stalePatientSearch.renderer.tree, n => n.type === 'button' && text(n).includes(syntheticPatient.patientID)), 'old results cannot replace current matches');
            assert.ok(!text(stalePatientSearch.renderer.tree).includes('Obsolete patient search denial'));
            assert.equal(stalePatientSearch.requests.filter(r => r.init.method !== 'GET').length, 0);
            checks++;
        } finally { stalePatientSearch.stop(); }
    }
    const keepPatient = new Fixture();
    try {
        await keepPatient.draft();
        await keepPatient.click('Change patient');
        assert.ok(text(keepPatient.renderer.tree).includes('Changing the patient will remove all invoice items. Your notes will be kept.'));
        assert.ok(text(keepPatient.renderer.tree).includes(syntheticPatient.patientID));
        assert.ok(keepPatient.button('Remove'), 'the item remains until change is confirmed');
        await keepPatient.click('Keep current patient');
        assert.ok(!find(keepPatient.renderer.tree, n => n.type === 'button' && text(n).trim() === 'Confirm change patient'));
        assert.equal(keepPatient.field('Invoice notes').props.value, 'KEEP UNSAVED NOTES');
        assert.equal(keepPatient.field('Clinic').props.value, 'A');
        assert.ok(text(find(keepPatient.renderer.tree, n => n.props?.['aria-label'] === 'Selected patient')).includes(syntheticPatient.patientID));
        assert.equal(keepPatient.requests.filter(r => r.init.method !== 'GET').length, 0, 'canceling a patient change makes no financial write');
        const save = await keepPatient.submit(), body = JSON.parse(save.init.body);
        assert.equal(body.patientId, syntheticPatient.id); assert.equal(body.branchId, 'A');
        assert.equal(body.notes, 'KEEP UNSAVED NOTES');
        assert.deepEqual(body.items, [{ kind: 'service', id: syntheticService.id, expectedVersion: 1 }]);
        checks++;
    } finally { keepPatient.stop(); }
    const changePatient = new Fixture();
    try {
        await changePatient.draft();
        await changePatient.click('Change patient'); await changePatient.click('Confirm change patient');
        assert.equal(changePatient.field('Patient').props.value, '');
        assert.ok(!find(changePatient.renderer.tree, n => n.props?.['aria-label'] === 'Selected patient'));
        assert.ok(!find(changePatient.renderer.tree, n => n.type === 'button' && text(n).trim() === 'Remove'), 'confirmed change clears every prior item');
        assert.equal(changePatient.field('Invoice notes').props.value, 'KEEP UNSAVED NOTES');
        assert.equal(changePatient.field('Clinic').props.value, 'A');
        assert.ok(changePatient.button('Save draft').props.disabled);
        assert.ok(changePatient.disabled(changePatient.field('Item')));
        assert.equal(changePatient.requests.filter(r => r.init.method !== 'GET').length, 0, 'confirmed change only changes the unsaved draft');
        await changePatient.options({ patients: [otherPatient] }); await changePatient.choosePatient(otherPatient);
        await changePatient.options({ patients: [], selectedPatient: otherPatient });
        assert.ok(!find(changePatient.renderer.tree, n => n.type === 'button' && text(n).trim() === 'Remove'), 'new selection cannot inherit prior items');
        await changePatient.change('Item', syntheticService.id); await changePatient.click('Add item');
        const save = await changePatient.submit(), body = JSON.parse(save.init.body);
        assert.equal(body.patientId, otherPatient.id); assert.equal(body.branchId, 'A');
        assert.equal(body.notes, 'KEEP UNSAVED NOTES'); assert.equal(body.items.length, 1);
        checks++;
    } finally { changePatient.stop(); }
    const catalogueSearch = new Fixture();
    try {
        await catalogueSearch.draft();
        await catalogueSearch.change('Search Services', 'updated service');
        let req = await catalogueSearch.options({ services: [{ ...syntheticService, version: 2, price: '300.00' }] });
        assert.equal(new URL(req.url, 'https://synthetic.invalid').searchParams.get('itemSearch'), 'updated service');
        await catalogueSearch.change('Item type', 'package');
        await catalogueSearch.change('Search packages', 'package name');
        req = await catalogueSearch.options({ services: [{ ...syntheticService, version: 2, price: '300.00' }] });
        assert.equal(new URL(req.url, 'https://synthetic.invalid').searchParams.get('itemSearch'), 'package name');
        const save = await catalogueSearch.submit(), body = JSON.parse(save.init.body);
        assert.equal(body.notes, 'KEEP UNSAVED NOTES');
        assert.deepEqual(body.items, [{ kind: 'service', id: syntheticService.id, expectedVersion: 1 }], 'searches do not reprice or replace an existing line');
        checks++;
    } finally { catalogueSearch.stop(); }
    for (const price of ['0', '1250.25']) {
        const packageDraft = new Fixture();
        try {
            await packageDraft.newDraft(); await packageDraft.choosePatient();
            await packageDraft.options({ packages: [{ id: 'package-synthetic', name: 'Synthetic package', version: 3, price: null }] });
            await packageDraft.change('Item type', 'package'); await packageDraft.change('Item', 'package-synthetic'); await packageDraft.click('Add item');
            assert.equal(packageDraft.field('Package selling price (PHP)').props.value, '');
            assert.ok(packageDraft.field('Package selling price (PHP)').props.required);
            assert.ok(packageDraft.button('Save draft').props.disabled, 'a package with no selling price cannot be saved');
            assert.ok(text(packageDraft.renderer.tree).includes('Enter a package selling price.'));
            await packageDraft.change('Package selling price (PHP)', price);
            assert.equal(Boolean(packageDraft.button('Save draft').props.disabled), false, 'zero is a valid explicit selling price');
            assert.ok(text(packageDraft.renderer.tree).includes(price === '0' ? '₱0.00' : '₱1,250.25'));
            const save = await packageDraft.submit();
            assert.deepEqual(JSON.parse(save.init.body).items, [{ kind: 'package', id: 'package-synthetic', expectedVersion: 3, amount: price }]);
            checks++;
        } finally { packageDraft.stop(); }
    }
    for (const price of ['0.00', null]) {
        const servicePrice = new Fixture();
        try {
            await servicePrice.newDraft(); await servicePrice.choosePatient();
            await servicePrice.options({ services: [{ ...syntheticService, price }] });
            await servicePrice.change('Item', syntheticService.id); await servicePrice.click('Add item');
            assert.equal(Boolean(servicePrice.button('Save draft').props.disabled), price === null, 'free and unconfigured prices remain distinct');
            if (price === null) assert.ok(text(servicePrice.renderer.tree).includes('Confirm missing prices before saving.'));
            else {
                assert.ok(/Free|₱0\.00/.test(text(servicePrice.renderer.tree)));
                const save = await servicePrice.submit();
                assert.deepEqual(JSON.parse(save.init.body).items, [{ kind: 'service', id: syntheticService.id, expectedVersion: 1 }], 'a free Service uses its catalogue price');
            }
            checks++;
        } finally { servicePrice.stop(); }
    }
    for (const role of ['staff', 'manager', 'admin-denied']) {
        const noAdjustment = new Fixture();
        try {
            noAdjustment.profile = { ...noAdjustment.profile, role: role === 'admin-denied' ? 'admin' : role, ...(role === 'admin-denied' ? { permissionOverrides: { 'pos.adjust': 'deny' } } : {}) };
            noAdjustment.props = { ...noAdjustment.props, userProfile: noAdjustment.profile }; h.modules.PosDashboard.publishPermissionProfile(noAdjustment.profile);
            await noAdjustment.draft();
            assert.ok(!find(noAdjustment.renderer.tree, n => n.type === 'summary' && text(n).includes('Admin price adjustment')), role + ' has no price adjustment disclosure');
            assert.ok(!find(noAdjustment.renderer.tree, n => n.type === 'label' && text(n).includes('Price override (optional, PHP)')), role + ' has no price override input');
            const save = await noAdjustment.submit();
            assert.deepEqual(JSON.parse(save.init.body).items, [{ kind: 'service', id: syntheticService.id, expectedVersion: 1 }]);
            checks++;
        } finally { noAdjustment.stop(); }
    }
    const adjustment = new Fixture();
    try {
        adjustment.profile = { ...adjustment.profile, role: 'admin' };
        adjustment.props = { ...adjustment.props, userProfile: adjustment.profile }; h.modules.PosDashboard.publishPermissionProfile(adjustment.profile);
        await adjustment.draft();
        assert.ok(find(adjustment.renderer.tree, n => n.type === 'summary' && text(n).includes('Admin price adjustment')));
        await adjustment.change('Price override (optional, PHP)', '75.25');
        assert.ok(adjustment.field('Adjustment reason').props.required, 'an Admin adjustment still needs a reason');
        await adjustment.change('Adjustment reason', 'Synthetic authorized concession');
        const save = await adjustment.submit();
        assert.deepEqual(JSON.parse(save.init.body).items, [{ kind: 'service', id: syntheticService.id, expectedVersion: 1, amount: '75.25', reason: 'Synthetic authorized concession' }]);
        checks++;
    } finally { adjustment.stop(); }
    const unchangedPrice = new Fixture();
    try {
        unchangedPrice.profile = { ...unchangedPrice.profile, role: 'admin' };
        unchangedPrice.props = { ...unchangedPrice.props, userProfile: unchangedPrice.profile }; h.modules.PosDashboard.publishPermissionProfile(unchangedPrice.profile);
        await unchangedPrice.draft();
        await unchangedPrice.change('Price override (optional, PHP)', '100.00');
        assert.equal(Boolean(unchangedPrice.button('Save draft').props.disabled), false, 'entering the original price remains saveable');
        assert.equal(unchangedPrice.field('Adjustment reason').props.required, false, 'an unchanged price does not require a reason');
        assert.ok(text(find(unchangedPrice.renderer.tree, n => n.props?.['aria-label'] === 'Invoice items')).includes('Clinic price'));
        await unchangedPrice.change('Price override (optional, PHP)', '90');
        assert.equal(unchangedPrice.field('Adjustment reason').props.required, true);
        assert.ok(unchangedPrice.button('Save draft').props.disabled, 'a changed price requires an entered reason');
        assert.ok(text(unchangedPrice.renderer.tree).includes('Enter a reason for the price adjustment.'));
        await unchangedPrice.change('Adjustment reason', 'Synthetic authorized discount');
        assert.equal(Boolean(unchangedPrice.button('Save draft').props.disabled), false);
        const save = await unchangedPrice.submit();
        assert.deepEqual(JSON.parse(save.init.body).items, [{ kind: 'service', id: syntheticService.id, expectedVersion: 1, amount: '90', reason: 'Synthetic authorized discount' }]);
        checks++;
    } finally { unchangedPrice.stop(); }
    const removeLine = new Fixture();
    try {
        await removeLine.draft(); await removeLine.click('Remove');
        assert.ok(!find(removeLine.renderer.tree, n => n.type === 'button' && text(n).trim() === 'Remove'));
        assert.ok(text(removeLine.renderer.tree).includes('Add items to calculate'));
        assert.ok(removeLine.button('Save draft').props.disabled);
        assert.equal(removeLine.field('Invoice notes').props.value, 'KEEP UNSAVED NOTES');
        assert.equal(removeLine.requests.filter(r => r.init.method !== 'GET').length, 0, 'removing a line keeps the draft local');
        checks++;
    } finally { removeLine.stop(); }
    // A launched Visit must load by exact ID, independently of the options window.
    const directSource = { id: 'history-124', kind: 'visit', name: 'Saved special quote', version: 4, price: '70.00' };
    let launched = new Fixture();
    try {
        launched.props.launch = { patientId: 'p', branchId: 'A', visitId: directSource.id };
        await launched.init(); const selectedOptions = await launched.options();
        const selectedParams = new URL(selectedOptions.url, 'https://synthetic.invalid').searchParams;
        assert.equal(selectedParams.get('q'), '', 'direct launches do not enumerate patients');
        assert.equal(selectedParams.get('patientId'), 'p', 'direct launch resolves only the selected identity');
        const launchedPatient = find(launched.renderer.tree, n => n.props?.['aria-label'] === 'Selected patient');
        assert.ok(text(launchedPatient).includes(syntheticPatient.name));
        assert.ok(text(launchedPatient).includes(syntheticPatient.patientID), 'the exact selected identity survives blank patient lookup results');
        assert.ok(!find(launched.renderer.tree, n => n.props?.['aria-label'] === 'Matching patients'));
        const exact = launched.requests.find(r => r.url.includes('/sources/visit/history-124?'));
        assert.ok(exact, 'exact source request must not depend on options sources');
        assert.ok(find(launched.renderer.tree, n => n.type === 'fieldset').props.disabled, 'block editing until the exact quote is known');
        exact.deliver({ source: directSource }); await launched.settle();
        assert.ok(text(launched.renderer.tree).includes('Saved special quote'));
        assert.ok(text(launched.renderer.tree).includes('70.00'));
        const req = await launched.submit();
        assert.deepEqual(JSON.parse(req.init.body).items, [{ kind: 'visit', id: directSource.id, expectedVersion: 4 }]);
        checks++;
    } finally { launched.stop(); }
    launched = new Fixture();
    try {
        launched.props.launch = { patientId: 'p', branchId: 'A', visitId: directSource.id };
        await launched.init();
        const exact = launched.requests.find(r => r.url.includes('/sources/visit/'));
        exact.deliver({ error: 'Source temporarily unavailable' }, 503); await launched.settle();
        assert.ok(text(launched.renderer.tree).includes('Source temporarily unavailable'));
        assert.ok(find(launched.renderer.tree, n => n.type === 'fieldset').props.disabled, 'failed exact load cannot silently save another invoice');
        await launched.click('Retry saved Visit');
        launched.requests.filter(r => r.url.includes('/sources/visit/')).at(-1).deliver({ source: directSource });
        await launched.settle();
        assert.ok(text(launched.renderer.tree).includes('Saved special quote'));
        checks++;
    } finally { launched.stop(); }
    launched = new Fixture();
    try {
        launched.props.launch = { patientId: 'p', branchId: 'A', visitId: directSource.id };
        await launched.init();
        const exact = launched.requests.find(r => r.url.includes('/sources/visit/'));
        launched.props = { ...launched.props, launch: null, activeBranchId: 'B' };
        launched.renderer.render(launched.props); await launched.settle();
        const before = globals.servicesTestInvalidations;
        exact.deliver({ error: 'Obsolete exact-source denial' }, 403); await launched.settle();
        assert.equal(globals.servicesTestInvalidations, before);
        assert.ok(!text(launched.renderer.tree).includes('Obsolete exact-source denial'));
        assert.ok(!text(launched.renderer.tree).includes('Saved special quote'));
        checks++;
    } finally { launched.stop(); }
    const linkedInvoice = (state = 'posted') => ({ id: 'invoice-history-124', number: 124, patient_id: 'p', patient_name: 'Linked synthetic patient', branch_id: 'A', branch_name: 'Synthetic A', state, version: 7, total_cents: 7000, paid_cents: 0, outstanding_cents: 7000, or_number: 'LINKED-OR', notes: 'Keep linked invoice notes', payments: [], events: [], items: [{ id: 'line-linked', kind: 'visit', name: 'Frozen Special Price', amount_cents: 7000, snapshot: { input: { kind: 'visit', id: directSource.id, expectedVersion: 4 }, originalAmount: 7000 } }] });
    const linkedLaunch = { patientId: 'p', branchId: 'A', visitId: directSource.id, invoiceId: 'invoice-history-124' };
    const invoiceLaunchRequest = (fixture: Fixture) => { const req = fixture.requests.filter(r => r.url.includes('/invoices/invoice-history-124?')).at(-1); assert.ok(req, 'linked invoice resolves by exact ID'); assert.equal(req.init.method, 'GET'); const params = new URL(req.url, 'https://synthetic.invalid').searchParams; assert.equal(params.get('patientId'), 'p'); assert.equal(params.get('visitId'), directSource.id); return req; };
    for (const state of ['posted', 'draft']) {
        const fixture = new Fixture();
        try {
            fixture.props.launch = linkedLaunch; await fixture.init();
            assert.ok(text(fixture.renderer.tree).includes('Loading linked invoice'));
            assert.ok(!find(fixture.renderer.tree, n => n.props?.['aria-label'] === 'Invoice draft'), 'linked launch never starts a new draft');
            assert.ok(!find(fixture.renderer.tree, n => n.props?.['aria-label'] === 'Invoice lookup'), 'first page cannot substitute for the requested invoice');
            invoiceLaunchRequest(fixture).deliver(linkedInvoice(state)); await fixture.settle();
            assert.ok(text(fixture.renderer.tree).includes('Invoice # 124') || text(fixture.renderer.tree).includes('Invoice #124'));
            assert.ok(text(fixture.renderer.tree).includes('Frozen Special Price'));
            assert.ok(text(fixture.renderer.tree).includes('70.00'));
            assert.ok(!fixture.requests.some(r => r.url.includes('/sources/') || r.url.includes('/options?')), 'invoice review does not initialize a new source or patient picker');
            assert.equal(fixture.requests.filter(r => r.init.method !== 'GET').length, 0);
            if (state === 'draft') {
                await fixture.click('Edit draft'); await fixture.options(); await fixture.change('Invoice notes', 'KEEP LINKED EDIT DRAFT');
                await fixture.change('Search Services', 'other catalogue search'); await fixture.options();
                assert.equal(fixture.field('Invoice notes').props.value, 'KEEP LINKED EDIT DRAFT', 'existing invoice initialization cannot reset an edited draft');
                assert.equal(fixture.requests.filter(r => r.url.includes('/invoices/invoice-history-124?')).length, 1);
                find(fixture.renderer.tree, n => n.props?.['aria-label'] === 'Invoice draft').props.onSubmit({ preventDefault() {} }); await fixture.settle(); const saved = fixture.requests.filter(r => r.init.method === 'PATCH').at(-1); assert.ok(saved); assert.equal(saved.init.method, 'PATCH'); assert.equal(saved.url, '/api/pos/invoices/invoice-history-124');
                const body = JSON.parse(saved.init.body); assert.equal(body.expectedVersion, 7); assert.equal(body.notes, 'KEEP LINKED EDIT DRAFT'); assert.deepEqual(body.items, [{ kind: 'visit', id: directSource.id, expectedVersion: 4 }]);
            }
            checks++;
        } finally { fixture.stop(); }
    }
    for (const mismatch of [{ id: 'other-invoice' }, { patient_id: 'p2' }, { branch_id: 'B' }]) {
        const fixture = new Fixture();
        try {
            fixture.props.launch = linkedLaunch; await fixture.init(); invoiceLaunchRequest(fixture).deliver({ ...linkedInvoice(), ...mismatch }); await fixture.settle();
            assert.ok(text(fixture.renderer.tree).includes('does not match the selected Visit'));
            assert.ok(!text(fixture.renderer.tree).includes('Frozen Special Price'));
            assert.ok(!find(fixture.renderer.tree, n => n.props?.['aria-label'] === 'Invoice draft' || n.props?.['aria-label'] === 'Invoice details'));
            assert.equal(fixture.requests.filter(r => r.init.method !== 'GET').length, 0); checks++;
        } finally { fixture.stop(); }
    }
    const linkedRetry = new Fixture();
    try {
        linkedRetry.props.launch = linkedLaunch; await linkedRetry.init(); invoiceLaunchRequest(linkedRetry).deliver({ error: 'Linked invoice temporarily unavailable' }, 503); await linkedRetry.settle();
        assert.ok(text(linkedRetry.renderer.tree).includes('Linked invoice temporarily unavailable')); assert.ok(!find(linkedRetry.renderer.tree, n => n.props?.['aria-label'] === 'Invoice draft'));
        await linkedRetry.click('Retry linked invoice'); invoiceLaunchRequest(linkedRetry).deliver(linkedInvoice()); await linkedRetry.settle();
        assert.ok(text(linkedRetry.renderer.tree).includes('Frozen Special Price')); assert.equal(linkedRetry.requests.filter(r => r.init.method !== 'GET').length, 0); checks++;
    } finally { linkedRetry.stop(); }
    const linkedReadOnly = new Fixture();
    try {
        linkedReadOnly.profile = { ...linkedReadOnly.profile, permissionOverrides: { 'pos.manage': 'deny', 'pos.collect': 'deny', 'pos.adjust': 'deny' } }; linkedReadOnly.props = { ...linkedReadOnly.props, userProfile: linkedReadOnly.profile, launch: linkedLaunch }; h.modules.PosDashboard.publishPermissionProfile(linkedReadOnly.profile);
        await linkedReadOnly.init(); invoiceLaunchRequest(linkedReadOnly).deliver(linkedInvoice('draft')); await linkedReadOnly.settle();
        assert.ok(text(linkedReadOnly.renderer.tree).includes('Frozen Special Price')); assert.ok(!find(linkedReadOnly.renderer.tree, n => n.type === 'form'));
        assert.ok(!find(linkedReadOnly.renderer.tree, n => n.type === 'button' && ['Edit draft', 'Post invoice', 'New invoice'].includes(text(n).trim()))); assert.equal(linkedReadOnly.requests.filter(r => r.init.method !== 'GET').length, 0); checks++;
    } finally { linkedReadOnly.stop(); }
    const cannotCreate = new Fixture();
    try {
        cannotCreate.profile = { ...cannotCreate.profile, permissionOverrides: { 'pos.manage': 'deny' } }; cannotCreate.props = { ...cannotCreate.props, userProfile: cannotCreate.profile, launch: { patientId: 'p', branchId: 'A', visitId: directSource.id } }; h.modules.PosDashboard.publishPermissionProfile(cannotCreate.profile);
        cannotCreate.renderer.render(cannotCreate.props); await cannotCreate.settle(); assert.ok(text(cannotCreate.renderer.tree).includes('Invoice creation is unavailable.')); assert.equal(cannotCreate.requests.length, 0); checks++;
    } finally { cannotCreate.stop(); }
    for (const invoiceId of [undefined, linkedLaunch.invoiceId]) {
        const fixture = new Fixture();
        try {
            fixture.profile = { ...fixture.profile, assignedBranches: ['B'] }; fixture.props = { ...fixture.props, userProfile: fixture.profile, launch: { ...linkedLaunch, invoiceId } }; h.modules.PosDashboard.publishPermissionProfile(fixture.profile);
            fixture.renderer.render(fixture.props); await fixture.settle(); assert.ok(text(fixture.renderer.tree).includes('Billing access is unavailable.')); assert.equal(fixture.requests.length, 0, 'a Visit launch cannot request another branch before server validation'); checks++;
        } finally { fixture.stop(); }
    }
    const linkedBack = new Fixture();
    try {
        linkedBack.props.launch = linkedLaunch; await linkedBack.init(); invoiceLaunchRequest(linkedBack).fail(); await linkedBack.settle();
        assert.ok(text(linkedBack.renderer.tree).includes('Synthetic lost reply')); await linkedBack.click('Back to invoices');
        assert.ok(find(linkedBack.renderer.tree, n => n.props?.['aria-label'] === 'Invoice lookup')); assert.ok(!find(linkedBack.renderer.tree, n => n.props?.['aria-label'] === 'Invoice draft'));
        assert.equal(linkedBack.requests.filter(r => r.url.includes('/invoices/invoice-history-124?')).length, 1, 'leaving a failed launch does not reinitialize it'); assert.equal(linkedBack.requests.filter(r => r.init.method !== 'GET').length, 0); checks++;
    } finally { linkedBack.stop(); }
    const changeLaunchScope = async (fixture: Fixture, change: string) => {
        if (change === 'branch') fixture.props = { ...fixture.props, launch: null, activeBranchId: 'B' };
        else if (change === 'permission') { fixture.profile = { ...fixture.profile, accessRevision: 2, permissionOverrides: { 'pos.view': 'deny' } }; fixture.props = { ...fixture.props, userProfile: fixture.profile }; h.modules.PosDashboard.publishPermissionProfile(fixture.profile); }
        else if (change === 'identity') globals.servicesTestAuth.currentUser = { uid: 'replacement-synthetic', getRequestToken: async () => 'csrf' };
        else fixture.props = { ...fixture.props, launch: { ...linkedLaunch, invoiceId: 'replacement-invoice' } };
        fixture.renderer.render(fixture.props); await fixture.settle();
    };
    for (const status of [200, 401, 403]) for (const change of ['branch', 'permission', 'identity', 'launch']) {
        const fixture = new Fixture();
        try {
            fixture.props.launch = linkedLaunch; await fixture.init(); const old = invoiceLaunchRequest(fixture); await changeLaunchScope(fixture, change); const invalidations = globals.servicesTestInvalidations;
            old.deliver(status === 200 ? linkedInvoice() : { error: 'Obsolete linked invoice denial' }, status); await fixture.settle();
            assert.equal(globals.servicesTestInvalidations, invalidations, 'old invoice response cannot invalidate replacement scope'); assert.ok(!text(fixture.renderer.tree).includes('Obsolete linked invoice denial')); assert.ok(!text(fixture.renderer.tree).includes('Frozen Special Price')); assert.equal(fixture.renderer.lateSetters, 0); assert.equal(fixture.requests.filter(r => r.init.method !== 'GET').length, 0); checks++;
        } finally { fixture.stop(); }
    }
    for (const change of ['branch', 'permission', 'identity']) {
        const fixture = new Fixture();
        try {
            fixture.props.launch = linkedLaunch; await fixture.init(); invoiceLaunchRequest(fixture).deliver({ error: 'Retry this linked invoice' }, 503); await fixture.settle(); await fixture.click('Retry linked invoice'); const oldRetry = invoiceLaunchRequest(fixture);
            await changeLaunchScope(fixture, change); const invalidations = globals.servicesTestInvalidations; oldRetry.deliver({ error: 'Obsolete linked retry denial' }, 403); await fixture.settle();
            assert.equal(globals.servicesTestInvalidations, invalidations); assert.ok(!text(fixture.renderer.tree).includes('Obsolete linked retry denial')); assert.equal(fixture.renderer.lateSetters, 0); checks++;
        } finally { fixture.stop(); }
    }
    const linkedUnmount = new Fixture();
    try {
        linkedUnmount.props.launch = linkedLaunch; await linkedUnmount.init(); const old = invoiceLaunchRequest(linkedUnmount); linkedUnmount.stop(); const invalidations = globals.servicesTestInvalidations;
        old.deliver({ error: 'Unmounted linked denial' }, 403); await flush(); assert.equal(globals.servicesTestInvalidations, invalidations); assert.equal(linkedUnmount.renderer.lateSetters, 0); checks++;
    } finally { linkedUnmount.stop(); }
    for (const kind of ['visit', 'appointment']) {
        const paged = new Fixture();
        try {
            await paged.draft(); await paged.change('Item type', kind);
            let req = await paged.sources({ sources: [{ ...directSource, id: 'first', kind }], page: 1, total: 125 });
            assert.equal(new URL(req.url, 'https://synthetic.invalid').searchParams.get('kind'), kind);
            await paged.click('Next quotes');
            req = await paged.sources({ sources: [{ ...directSource, id: 'middle', kind }], page: 2, total: 125 });
            assert.equal(new URL(req.url, 'https://synthetic.invalid').searchParams.get('page'), '2');
            await paged.click('Next quotes');
            await paged.sources({ sources: [{ ...directSource, kind }], page: 3, total: 125 });
            await paged.change('Item', directSource.id); await paged.click('Add item');
            assert.ok(paged.button('Next quotes').props.disabled);
            await paged.change('Search saved quotes', 'history-124');
            req = await paged.sources({ sources: [{ ...directSource, kind }], page: 1, total: 1 });
            assert.equal(new URL(req.url, 'https://synthetic.invalid').searchParams.get('page'), '1');
            assert.equal(new URL(req.url, 'https://synthetic.invalid').searchParams.get('q'), 'history-124');
            const save = await paged.submit();
            const body = JSON.parse(save.init.body);
            assert.equal(body.notes, 'KEEP UNSAVED NOTES');
            assert.deepEqual(body.items[1], {kind, id: directSource.id, expectedVersion: 4});
            checks++;
        } finally { paged.stop(); }
    }
    const staleSources = new Fixture();
    try {
        await staleSources.draft(); await staleSources.change('Item type', 'visit');
        const old = await staleSources.sourceRequest();
        await staleSources.change('Search saved quotes', 'current');
        await staleSources.sources({ sources: [{ ...directSource, id: 'current' }], page: 1, total: 1 });
        const before = globals.servicesTestInvalidations;
        old.deliver({error:'Obsolete source search denial'},403); await staleSources.settle();
        assert.equal(globals.servicesTestInvalidations, before);
        assert.ok(!text(staleSources.renderer.tree).includes('Obsolete source search denial'));
        assert.ok(text(staleSources.field('Item')).includes('Saved special quote'));
        assert.equal(staleSources.field('Invoice notes').props.value,'KEEP UNSAVED NOTES');
        checks++;
    } finally { staleSources.stop(); }
    const row = { id:'invoice-b', number:52, patient_id:'p', patient_name:'Synthetic patient', branch_id:'B', branch_name:'Synthetic B', state:'posted', version:2, total_cents:10000, paid_cents:2500, outstanding_cents:7500, created_at:'2035-02-01T16:30:00Z' };
    const listing = new Fixture();
    try {
        await listing.init();
        await listing.click('Refresh');
        listing.requests.filter(r=>r.url.includes('/invoices?')).at(-1).deliver({invoices:[row],total:35,page:1}); await listing.settle();
        await listing.click('Next');
        let req=listing.requests.filter(r=>r.url.includes('/invoices?')).at(-1);
        assert.equal(new URL(req.url,'https://test.invalid').searchParams.get('page'),'2');
        req.deliver({invoices:[row],total:35,page:2}); await listing.settle();
        await listing.change('Search invoices','payment%_ref');
        req=listing.requests.filter(r=>r.url.includes('/invoices?')).at(-1);
        assert.equal(new URL(req.url,'https://test.invalid').searchParams.get('page'),'1');
        assert.equal(new URL(req.url,'https://test.invalid').searchParams.get('q'),'payment%_ref');
        await listing.change('Invoice status','partial');
        await listing.change('Invoice date from','2035-02-02');
        let singleBound=new URL(listing.requests.filter(r=>r.url.includes('/invoices?')).at(-1).url,'https://test.invalid').searchParams;
        assert.equal(singleBound.get('from'),'2035-02-02');assert.equal(singleBound.has('to'),false);
        await listing.change('Invoice date to','2035-02-02');
        req=listing.requests.filter(r=>r.url.includes('/invoices?')).at(-1);
        const params=new URL(req.url,'https://test.invalid').searchParams;
        assert.equal(params.get('status'),'partial'); assert.equal(params.get('from'),'2035-02-02'); assert.equal(params.get('to'),'2035-02-02');
        await listing.click('Clear invoice filters');
        req=listing.requests.filter(r=>r.url.includes('/invoices?')).at(-1);
        assert.equal(new URL(req.url,'https://test.invalid').searchParams.get('status'),'all');
        assert.equal(new URL(req.url,'https://test.invalid').searchParams.has('from'),false);assert.equal(new URL(req.url,'https://test.invalid').searchParams.has('to'),false);
        await listing.click('Outstanding balances');
        assert.equal(new URL(listing.requests.filter(r=>r.url.includes('/invoices?')).at(-1).url,'https://test.invalid').searchParams.get('status'),'outstanding');
        await listing.change('Clinic','All');
        req=listing.requests.filter(r=>r.url.includes('/invoices?')).at(-1);
        assert.equal(new URL(req.url,'https://test.invalid').searchParams.has('branchId'),false);
        assert.ok(listing.button('New invoice').props.disabled,'all-clinic lookup requires a specific clinic for new drafts');
        assert.equal(listing.requests.filter(r=>r.init.method!=='GET').length,0,'filters perform no writes');
        checks++;
    } finally {listing.stop();}
    const billing = new Fixture();
    try {
        billing.props.patientContext={id:'p',name:'Synthetic patient'};billing.props.embedded=true;
        await billing.init();
        let req=billing.requests.find(r=>r.url.includes('/invoices?'));
        let params=new URL(req.url,'https://test.invalid').searchParams;
        assert.equal(params.get('patientId'),'p');assert.equal(params.has('branchId'),false);assert.equal(params.has('from'),false);assert.equal(params.has('to'),false);
        assert.ok(!find(billing.renderer.tree,n=>n.type==='button' && ['New invoice','Clinic sales'].includes(text(n))));
        await billing.click('Refresh');
        billing.requests.filter(r=>r.url.includes('/invoices?')).at(-1).deliver({invoices:[row],page:1,total:1,summary:{invoicedCents:10000,paidCents:2500,outstandingCents:7500}});await billing.settle();
        assert.ok(text(billing.renderer.tree).includes('75.00'));
        assert.ok(find(billing.renderer.tree,n=>n.type==='section'&&n.props['aria-label']==='Patient billing totals'));
        await billing.click('Open');
        req=billing.requests.at(-1);assert.equal(req.url,'/api/pos/invoices/invoice-b?patientId=p');
        const detail={...row,items:[],payments:[],events:[],notes:''};req.deliver(detail);await billing.settle();
        await billing.change('Payment amount (PHP)','25');await billing.change('Cash tendered (PHP)','30');
        req=await billing.submit();assert.equal(req.url,'/api/pos/invoices/invoice-b/payments');
        const body=JSON.parse(req.init.body);assert.equal(body.expectedVersion,2);assert.equal(body.amount,'25');assert.equal(body.tender,'30');
        req.deliver({...detail,version:3,paid_cents:5000,outstanding_cents:5000,payments:[{id:'payment-ack',amount_cents:2500,tender_cents:3000,method:'cash',reference:'',actor:{name:'Synthetic staff'},recorded_at:'2035-02-02T10:00:00Z'}]});await billing.settle();
        assert.ok(text(billing.renderer.tree).includes('50.00'));assert.ok(text(billing.renderer.tree).includes('Change'));
        assert.equal(billing.requests.filter(r=>r.init.method==='POST'&&r.url==='/api/pos/invoices').length,0,'later collection never creates another invoice');
        billing.requests.filter(r=>r.url.includes('/invoices?')).at(-1).deliver({invoices:[{...row,paid_cents:5000,outstanding_cents:5000}],total:1,page:1,summary:{invoicedCents:10000,paidCents:5000,outstandingCents:5000}});await billing.settle();
        await billing.click('Back to invoices');assert.ok(text(billing.renderer.tree).includes('50.00'));
        checks++;
    } finally {billing.stop();}
    const staleFilter = new Fixture();
    try {
        await staleFilter.init();await staleFilter.change('Search invoices','obsolete');
        const old=staleFilter.requests.filter(r=>r.url.includes('/invoices?')).at(-1);
        await staleFilter.change('Search invoices','current');
        staleFilter.requests.filter(r=>r.url.includes('/invoices?')).at(-1).deliver({invoices:[row],total:1,page:1});await staleFilter.settle();
        const before=globals.servicesTestInvalidations;
        old.deliver({error:'Obsolete invoice-filter denial'},403);await staleFilter.settle();
        assert.equal(globals.servicesTestInvalidations,before);assert.ok(!text(staleFilter.renderer.tree).includes('Obsolete invoice-filter denial'));
        assert.ok(text(staleFilter.renderer.tree).includes('Synthetic patient'));checks++;
    } finally {staleFilter.stop();}
    const allSales = new Fixture();
    try {
        allSales.profile={...allSales.profile,role:'manager'};allSales.props={...allSales.props,userProfile:allSales.profile};h.modules.PosDashboard.publishPermissionProfile(allSales.profile);
        await allSales.init();await allSales.change('Clinic','All');await allSales.click('Clinic sales');
        const req=allSales.requests.at(-1);assert.ok(req.url.startsWith('/api/pos/sales?'));
        assert.equal(new URL(req.url,'https://test.invalid').searchParams.has('branchId'),false,'All clinic selection must not be sent as a real branch ID to sales');checks++;
    } finally {allSales.stop();}
    const readOnly = new Fixture();
    try {
        readOnly.profile={...readOnly.profile,permissionOverrides:{'pos.collect':'deny','pos.manage':'deny','pos.adjust':'deny'}};
        readOnly.props={...readOnly.props,userProfile:readOnly.profile,patientContext:{id:'p'},embedded:true};h.modules.PosDashboard.publishPermissionProfile(readOnly.profile);
        await readOnly.init();await readOnly.click('Refresh');
        readOnly.requests.filter(r=>r.url.includes('/invoices?')).at(-1).deliver({invoices:[row],total:1,page:1});await readOnly.settle();await readOnly.click('Open');
        readOnly.requests.at(-1).deliver({...row,items:[],payments:[],events:[],notes:''});await readOnly.settle();
        assert.ok(!find(readOnly.renderer.tree,n=>n.type==='form'),'read-only billing has no mutation form');checks++;
    } finally {readOnly.stop();}
    let loading = new Fixture();
    try {
        loading.renderer.render(loading.props); await loading.settle();
        assert.ok(text(loading.renderer.tree).includes('Loading clinic records'));
        assert.ok(!text(loading.renderer.tree).includes('No matching invoices'));
        loading.requests.find(r => r.url.includes('/invoices?')).deliver({ error: 'Synthetic read failure' }, 500);
        await loading.settle();
        assert.ok(text(loading.renderer.tree).includes('Synthetic read failure'));
        assert.ok(!text(loading.renderer.tree).includes('No matching invoices'));
        await loading.click('Refresh');
        loading.requests.filter(r => r.url.includes('/invoices?')).at(-1).deliver({ invoices: [], total: 0 });
        await loading.settle();
        assert.ok(text(loading.renderer.tree).includes('No matching invoices'));
        checks++;
    } finally { loading.stop(); }
    let f = new Fixture();
    try {
        await f.draft();
        const req = await f.submit();
        assert.equal(JSON.parse(req.init.body).notes, 'KEEP UNSAVED NOTES');
        assert.equal(JSON.parse(req.init.body).items.length, 1);
        assert.equal(JSON.parse(req.init.body).items[0].kind, 'service');
        req.deliver({ error: 'Changed quote' }, 409);
        await f.settle();
        assert.equal(f.field('Invoice notes').props.value, 'KEEP UNSAVED NOTES');
        assert.ok(text(f.renderer.tree).includes('Changed quote'));
        checks++;
    }
    finally {
        f.stop();
    }
    f = new Fixture();
    try {
        await f.draft();
        const req = await f.submit();
        req.fail();
        await f.settle();
        const before = req.init.body;
        await f.click('Retry request');
        const retried = f.requests.at(-1);
        assert.equal(retried.init.body, before);
        checks++;
    }
    finally {
        f.stop();
    }
    f = new Fixture();
    try {
        await f.draft();
        const req = await f.submit();
        f.props = { ...f.props, activeBranchId: 'B' };
        f.renderer.render(f.props);
        await f.settle();
        const before = globals.servicesTestInvalidations;
        req.deliver({ error: 'Old denial' }, 403);
        await f.settle();
        assert.equal(globals.servicesTestInvalidations, before);
        assert.ok(!text(f.renderer.tree).includes('Old denial'));
        assert.ok(!text(f.renderer.tree).includes('KEEP UNSAVED NOTES'));
        checks++;
    }
    finally {
        f.stop();
    }
    f = new Fixture();
    try {
        await f.init();
        await f.click('Refresh');
        const old = f.requests.filter(r => r.url.includes('/invoices?')).at(-1);
        await f.change('Clinic', 'B');
        const before = globals.servicesTestInvalidations;
        old.deliver({ error: 'Old branch denied' }, 403);
        await f.settle();
        assert.equal(globals.servicesTestInvalidations, before);
        assert.ok(!text(f.renderer.tree).includes('Old branch denied'));
        checks++;
    }
    finally {
        f.stop();
    }
    f = new Fixture();
    try {
        await f.init();
        assert.ok(!find(f.renderer.tree, n => n.type === 'button' && text(n) === 'Clinic sales'));
        checks++;
    }
    finally {
        f.stop();
    }
    const paymentDetail = () => ({ id:'invoice-correction', number:55, patient_id:'p', patient_name:'Synthetic patient', branch_id:'A', branch_name:'Synthetic A', state:'posted', version:4, total_cents:10000, paid_cents:10000, outstanding_cents:0, created_at:'2035-02-01T10:00:00Z', items:[], events:[], notes:'Preserve invoice history', payments:[{ id:'payment-original', amount_cents:10000, tender_cents:12000, method:'cash', reference:'Original reference', actor:{name:'Synthetic collector'}, recorded_at:'2035-02-01T10:00:00Z' }] });
    const reversal = { id:'reversal-1', reason:'Wrong amount recorded', actor:{name:'Synthetic Admin'}, recorded_at:'2035-02-02T10:00:00Z' };
    const reversedDetail = () => { const detail = paymentDetail(); return {...detail, version:5, paid_cents:0, outstanding_cents:10000, payments:detail.payments.map(p=>({...p,reversal})), events:[{id:'event-reversal',kind:'payment-reversal',actor:reversal.actor,recorded_at:reversal.recorded_at,detail:{reason:reversal.reason}}]}; };
    const administrator = () => { const fixture = new Fixture(); fixture.profile={...fixture.profile,role:'admin'}; fixture.props={...fixture.props,userProfile:fixture.profile}; h.modules.PosDashboard.publishPermissionProfile(fixture.profile); return fixture; };
    // Financial corrections remain Admin-only and unavailable in embedded Patient Billing.
    for (const setup of ['staff','manager','admin-denied','embedded-admin']) {
        const fixture = setup.includes('admin') ? administrator() : new Fixture();
        try {
            if (setup==='manager') fixture.profile={...fixture.profile,role:'manager'};
            if (setup==='admin-denied') fixture.profile={...fixture.profile,permissionOverrides:{'pos.adjust':'deny'}};
            fixture.props={...fixture.props,userProfile:fixture.profile,...(setup==='embedded-admin'?{patientContext:{id:'p'},embedded:true}:{})}; h.modules.PosDashboard.publishPermissionProfile(fixture.profile);
            await fixture.invoice(paymentDetail());
            assert.ok(!find(fixture.renderer.tree,n=>n.type==='button' && text(n)==='Correct payment'),setup+' has no correction action');
            assert.equal(fixture.requests.filter(r=>r.init.method==='POST').length,0);
            checks++;
        } finally {fixture.stop();}
    }
    let correction = administrator();
    try {
        await correction.invoice(paymentDetail()); await correction.click('Correct payment');
        assert.ok(correction.button('Confirm reversal').props.disabled,'a reason is required');
        await correction.change('Correction reason','Draft correction reason');
        assert.ok(text(correction.renderer.tree).includes('It does not refund money'));
        await correction.click('Cancel correction');
        assert.ok(!find(correction.renderer.tree,n=>n.type==='form'&&n.props['aria-label']==='Payment correction'));
        assert.equal(correction.requests.filter(r=>r.init.method==='POST').length,0,'Cancel never writes');
        assert.ok(text(correction.renderer.tree).includes('Original reference'));
        checks++;
    } finally {correction.stop();}
    correction = administrator();
    try {
        await correction.invoice(paymentDetail()); await correction.click('Correct payment'); await correction.change('Correction reason',reversal.reason);
        const req=await correction.correct(); const body=JSON.parse(req.init.body);
        assert.equal(req.url,'/api/pos/invoices/invoice-correction/payments/payment-original/reversal');
        assert.equal(body.expectedVersion,4);assert.equal(body.reason,reversal.reason);assert.ok(body.commandId);
        assert.ok(correction.field('Correction reason').props.disabled,'in-flight reason is frozen');
        req.deliver(reversedDetail());await correction.settle();
        assert.ok(text(correction.renderer.tree).includes('Reversed'));
        assert.ok(text(correction.renderer.tree).includes(reversal.reason));assert.ok(text(correction.renderer.tree).includes('Synthetic Admin'));
        assert.ok(text(correction.renderer.tree).includes('Original reference'));assert.ok(text(correction.renderer.tree).match(/Acknowledgment\s+payment-original/));
        assert.ok(text(correction.renderer.tree).match(/Correction\s+reversal-1/));
        assert.ok(text(correction.renderer.tree).includes('payment-reversal'));
        assert.ok(!find(correction.renderer.tree,n=>n.type==='button' && text(n)==='Correct payment'),'entry cannot be reversed twice');
        assert.ok(!text(correction.renderer.tree).includes('Void unpaid invoice'),'reversed history does not turn an invoice into a voidable unpaid invoice');
        assert.ok(find(correction.renderer.tree,n=>n.type==='form' && text(n).includes('Record payment')),'correct amount can be re-recorded using existing collection');
        checks++;
    } finally {correction.stop();}
    correction = administrator();
    try {
        await correction.invoice(paymentDetail()); await correction.click('Correct payment'); await correction.change('Correction reason','KEEP CORRECTION DRAFT');
        const old=await correction.correct();old.deliver({error:'Invoice changed. Reload current invoice.'},409);await correction.settle();
        assert.equal(correction.field('Correction reason').props.value,'KEEP CORRECTION DRAFT');
        assert.ok(text(correction.renderer.tree).includes('Invoice changed. Reload current invoice.'));
        await correction.click('Reload invoice for correction');correction.requests.at(-1).deliver({...paymentDetail(),version:5});await correction.settle();
        assert.equal(correction.field('Correction reason').props.value,'KEEP CORRECTION DRAFT');
        const retried=await correction.correct();assert.equal(JSON.parse(retried.init.body).expectedVersion,5);
        assert.equal(JSON.parse(retried.init.body).reason,'KEEP CORRECTION DRAFT');
        assert.notEqual(JSON.parse(retried.init.body).commandId,JSON.parse(old.init.body).commandId,'known conflict starts a newly versioned command');
        checks++;
    } finally {correction.stop();}
    // Refreshing the version for a correction must not discard an independent
    // accounting-reference draft, including an explicitly cleared reference.
    for (const orDraft of ['UNSAVED-OR-DRAFT', '', undefined]) {
        const fixture = administrator();
        try {
            const saved = {...paymentDetail(),or_number:'SAVED-OR',paid_cents:5000,outstanding_cents:5000};
            await fixture.invoice(saved);
            assert.equal(fixture.field('Admin OR#').props.value,'SAVED-OR','initial Open hydrates the saved reference');
            if (orDraft !== undefined) await fixture.change('Admin OR#',orDraft);
            await fixture.change('Payment amount (PHP)','45.00');await fixture.change('Cash tendered (PHP)','50.00');
            await fixture.change('Reference','UNSAVED-PAYMENT-REF');
            await fixture.click('Correct payment');await fixture.change('Correction reason','KEEP CORRECTION REASON');
            const stale = await fixture.correct();stale.deliver({error:'Invoice changed. Reload current invoice.'},409);await fixture.settle();
            for (const version of [5,6]) {
                const writesBefore = fixture.requests.filter(r=>r.init.method!=='GET').length;
                await fixture.click('Reload invoice for correction');const reload=fixture.requests.at(-1);
                assert.equal(reload.init.method,'GET');assert.equal(reload.url,'/api/pos/invoices/invoice-correction');
                assert.ok(fixture.field('Admin OR#').props.disabled,'reference draft is frozen during reload');
                reload.deliver({...saved,version,or_number:`SERVER-OR-${version}`});await fixture.settle();
                assert.equal(fixture.field('Admin OR#').props.value,orDraft ?? `SERVER-OR-${version}`,'reload preserves edited/cleared reference and refreshes an untouched one');
                assert.equal(fixture.field('Correction reason').props.value,'KEEP CORRECTION REASON');
                assert.equal(fixture.field('Payment amount (PHP)').props.value,'45.00');assert.equal(fixture.field('Cash tendered (PHP)').props.value,'50.00');
                assert.equal(fixture.field('Reference').props.value,'UNSAVED-PAYMENT-REF');
                assert.equal(fixture.requests.filter(r=>r.init.method!=='GET').length,writesBefore,'reload makes no payment, reversal or reference write');
                assert.ok(text(fixture.renderer.tree).includes('Partially paid'),'reloading does not change the returned payment status');
            }
            const retried=await fixture.correct(),body=JSON.parse(retried.init.body);
            assert.equal(body.expectedVersion,6);assert.equal(body.reason,'KEEP CORRECTION REASON');
            assert.notEqual(body.commandId,JSON.parse(stale.init.body).commandId,'known conflict reattempt uses a new command with current version');
            assert.equal(fixture.requests.filter(r=>r.init.method==='PATCH').length,0,'OR draft is not silently saved');
            retried.deliver({error:'Review the current invoice again.'},409);await fixture.settle();
            await fixture.click('Cancel correction');await fixture.click('Back to invoices');await fixture.click('Refresh');
            fixture.requests.filter(r=>r.url.includes('/invoices?')).at(-1).deliver({invoices:[{...saved,id:'another-invoice',or_number:'ANOTHER-OR'}],total:1,page:1});await fixture.settle();
            await fixture.click('Open');fixture.requests.at(-1).deliver({...saved,id:'another-invoice',or_number:'ANOTHER-OR'});await fixture.settle();
            assert.equal(fixture.field('Admin OR#').props.value,'ANOTHER-OR','opening another invoice never carries over the previous OR draft');
            checks++;
        } finally {fixture.stop();}
    }
    correction = administrator();
    try {
        await correction.invoice({...paymentDetail(),or_number:'SAVED-OR'});await correction.change('Admin OR#','KEEP FAILED RELOAD DRAFT');
        await correction.click('Correct payment');await correction.change('Correction reason','KEEP FAILED RELOAD REASON');
        await correction.click('Reload invoice for correction');correction.requests.at(-1).deliver({error:'Synthetic reload failure'},503);await correction.settle();
        assert.equal(correction.field('Admin OR#').props.value,'KEEP FAILED RELOAD DRAFT');assert.equal(correction.field('Correction reason').props.value,'KEEP FAILED RELOAD REASON');
        await correction.click('Reload invoice for correction');correction.requests.at(-1).deliver({...paymentDetail(),version:7,or_number:'REMOTE-OR'});await correction.settle();
        assert.equal(correction.field('Admin OR#').props.value,'KEEP FAILED RELOAD DRAFT');
        assert.equal(correction.requests.filter(r=>r.init.method!=='GET').length,0,'failed/retried refresh never mutates financial history');
        checks++;
    } finally {correction.stop();}
    for (const status of [200,401,403]) for (const change of ['branch','permission']) {
        const fixture=administrator();
        try {
            await fixture.invoice({...paymentDetail(),or_number:'SAVED-OR'});await fixture.change('Admin OR#','OBSOLETE OR DRAFT');
            await fixture.click('Correct payment');await fixture.change('Correction reason','OBSOLETE RELOAD REASON');
            await fixture.click('Reload invoice for correction');const old=fixture.requests.at(-1);
            if(change==='branch') fixture.props={...fixture.props,activeBranchId:'B'};
            else {fixture.profile={...fixture.profile,accessRevision:2,permissionOverrides:{'pos.adjust':'deny'}};fixture.props={...fixture.props,userProfile:fixture.profile};h.modules.PosDashboard.publishPermissionProfile(fixture.profile);}
            fixture.renderer.render(fixture.props);await fixture.settle();const invalidations=globals.servicesTestInvalidations;
            old.deliver(status===200?{...paymentDetail(),version:9,or_number:'OLD SCOPE SERVER OR'}:{error:'Obsolete reload denial'},status);await fixture.settle();
            assert.equal(globals.servicesTestInvalidations,invalidations,'old reload cannot invalidate replacement protected scope');
            assert.ok(!text(fixture.renderer.tree).includes('Obsolete reload denial'));
            assert.ok(!text(fixture.renderer.tree).includes('OBSOLETE RELOAD REASON'));assert.ok(!text(fixture.renderer.tree).includes('OLD SCOPE SERVER OR'));
            assert.ok(!find(fixture.renderer.tree,n=>n.type==='form'&&n.props['aria-label']==='Payment correction'),'old correction editor cannot survive scope change');
            checks++;
        } finally {fixture.stop();}
    }
    correction = administrator();
    try {
        await correction.invoice(paymentDetail());await correction.click('Correct payment');await correction.change('Correction reason','Lost reply correction');
        const req=await correction.correct();req.fail();await correction.settle();
        assert.equal(correction.field('Correction reason').props.value,'Lost reply correction');
        assert.ok(correction.field('Correction reason').props.disabled,'uncertain command cannot be edited');
        await correction.click('Retry request');const retry=correction.requests.at(-1);
        assert.equal(retry.url,req.url);assert.equal(retry.init.body,req.init.body,'lost reply repeats identical command, version and reason');
        retry.deliver(reversedDetail());await correction.settle();assert.ok(text(correction.renderer.tree).match(/Correction\s+reversal-1/));
        checks++;
    } finally {correction.stop();}
    for (const status of [401,403]) for (const change of ['branch','permission']) {
        const fixture=administrator();
        try {
            await fixture.invoice(paymentDetail());await fixture.click('Correct payment');await fixture.change('Correction reason','OLD SCOPE CORRECTION');
            const req=await fixture.correct();
            if(change==='branch') fixture.props={...fixture.props,activeBranchId:'B'};
            else { fixture.profile={...fixture.profile,accessRevision:2,permissionOverrides:{'pos.adjust':'deny'}};fixture.props={...fixture.props,userProfile:fixture.profile};h.modules.PosDashboard.publishPermissionProfile(fixture.profile); }
            fixture.renderer.render(fixture.props);await fixture.settle();
            const before=globals.servicesTestInvalidations;
            req.deliver({error:'Obsolete correction denial'},status);await fixture.settle();
            assert.equal(globals.servicesTestInvalidations,before,'old correction denial cannot invalidate current scope');
            assert.ok(!text(fixture.renderer.tree).includes('Obsolete correction denial'));assert.ok(!text(fixture.renderer.tree).includes('OLD SCOPE CORRECTION'));
            checks++;
        } finally {fixture.stop();}
    }
    correction=administrator();
    try {
        const detail={...paymentDetail(),items:[{id:'package-line',kind:'package',name:'Used synthetic package',amount_cents:10000,snapshot:{input:{expectedVersion:1},packageTerms:{lines:[]}}}]};
        await correction.invoice(detail);await correction.click('Correct payment');await correction.change('Correction reason','Wrong collection on used package');
        const req=await correction.correct();req.deliver({error:'Package sessions have already been used; reversal is blocked.'},409);await correction.settle();
        assert.equal(correction.field('Correction reason').props.value,'Wrong collection on used package');
        assert.ok(text(correction.renderer.tree).includes('reversal is blocked'));assert.ok(!text(correction.renderer.tree).includes('Payment entry reversed'));
        assert.ok(text(correction.renderer.tree).includes('Package sessions are available in the Treatment Ledger.'));
        assert.ok(!find(correction.renderer.tree,n=>n.type==='form'&&text(n).includes('Payment amount (PHP)')),'failed correction preserves paid state');
        checks++;
    } finally {correction.stop();}
    const correctionHistory=new Fixture();
    try {
        correctionHistory.props={...correctionHistory.props,patientContext:{id:'p'},embedded:true};await correctionHistory.invoice(reversedDetail());
        assert.ok(text(correctionHistory.renderer.tree).includes('Payment entry reversed'));assert.ok(text(correctionHistory.renderer.tree).includes(reversal.reason));
        assert.ok(text(correctionHistory.renderer.tree).includes('Synthetic Admin'));assert.ok(text(correctionHistory.renderer.tree).match(/Acknowledgment\s+payment-original/));
        assert.ok(!find(correctionHistory.renderer.tree,n=>n.type==='button'&&text(n)==='Correct payment'),'Patient Billing shows history without correction authority');
        checks++;
    } finally {correctionHistory.stop();}
    const correctionSales=administrator();
    try {
        await correctionSales.init();await correctionSales.click('Clinic sales');correctionSales.requests.at(-1).deliver({branches:[{id:'A',name:'Synthetic A',sales:0,received:0,reversed:10000,collected:-10000,outstanding:10000}],totals:{sales:0,received:0,reversed:10000,collected:-10000,outstanding:10000}});await correctionSales.settle();
        assert.ok(text(correctionSales.renderer.tree).includes('Reversed entries'));assert.ok(text(correctionSales.renderer.tree).includes('Collected (net)'));
        assert.ok(text(correctionSales.renderer.tree).includes('may be negative'));assert.ok(text(correctionSales.renderer.tree).includes('-₱100.00'));
        checks++;
    } finally {correctionSales.stop();}
    console.log(`POS controlled UI: ${checks} scenarios passed (patient selection, draft prices, invoice lookup, patient collections, saved quotes, payment corrections, stale responses, retries and permissions)`);
}
finally {
    await h.cleanup();
}
