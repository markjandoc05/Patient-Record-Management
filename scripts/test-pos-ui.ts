import assert from 'node:assert/strict';
import { buildControlledForms, Renderer, find, text, flush, globals } from './controlled-form-harness';
const h = await buildControlledForms(['PosDashboard'], process.cwd(), { exposePermissionState: true, useProductionInvalidation: true });
let checks = 0;
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
    button(label: string) { const b = find(this.renderer.tree, n => n.type === 'button' && text(n).trim() === label); assert.ok(b, 'button ' + label); return b; }
    async click(label: string) { this.button(label).props.onClick(); await this.settle(); }
    async change(label: string, value: string) { this.field(label).props.onChange({ target: { value } }); await this.settle(); }
    async options() { await new Promise(r => setTimeout(r, 170)); await this.settle(); const req = this.requests.filter(r => r.url.includes('/options?')).at(-1); req.deliver({ patients: [{ id: 'p', name: 'Synthetic patient' }], services: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic service', version: 1, price: '100.00' }], packages: [], sources: [] }); await this.settle(); }
    async sourceRequest() { await new Promise(r => setTimeout(r, 170)); await this.settle(); return this.requests.filter(r => r.url.includes('/sources?')).at(-1); }
    async sources(body: any, status = 200) { const req = await this.sourceRequest(); assert.ok(req, 'source request'); req.deliver(body, status); await this.settle(); return req; }
    async draft() { await this.init(); await this.click('New invoice'); await this.options(); await this.change('Patient', 'p'); await this.options(); await this.change('Item', '00000000-0000-4000-8000-000000000001'); await this.click('Add item'); await this.change('Invoice notes', 'KEEP UNSAVED NOTES'); }
    async submit() { find(this.renderer.tree, n => n.type === 'form').props.onSubmit({ preventDefault() { } }); await this.settle(); return this.requests.filter(r => r.init.method === 'POST').at(-1); }
    stop() { this.renderer.unmount(); }
}
try {
    // A launched Visit must load by exact ID, independently of the options window.
    const directSource = { id: 'history-124', kind: 'visit', name: 'Saved special quote', version: 4, price: '70.00' };
    let launched = new Fixture();
    try {
        launched.props.launch = { patientId: 'p', branchId: 'A', visitId: directSource.id };
        await launched.init(); await launched.options();
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
    console.log(`POS controlled UI: ${checks} scenarios passed (invoice lookup, patient collections, saved quotes, stale responses, retries and permissions)`);
}
finally {
    await h.cleanup();
}
