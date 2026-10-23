import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
import { assertCurrentMigrationChain } from './platform-test-support';
const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const origin = new URL(process.env.APP_URL || 'https://invalid').origin;
const storage = path.resolve(process.env.STORAGE_DIR || '/');
if (database.hostname !== '127.0.0.1' || database.pathname !== '/vine_pos_test' || process.env.ALLOW_TEST_DATABASE !== 'yes'
    || process.env.NODE_ENV !== 'production' || !new URL(origin).hostname.endsWith('.invalid')
    || ![tmpdir(), '/private/tmp', '/tmp'].some(root => storage.startsWith(path.resolve(root) + path.sep))) {
    throw Error('Use empty disposable loopback vine_pos_test, production middleware, .invalid APP_URL and temporary STORAGE_DIR');
}
let server: ReturnType<typeof app.listen> | undefined, checks = 0, slot = 0;
const sessions = new Map<string, {
    cookie: string;
    csrf: string;
}>();
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; };
async function request(route: string, method = 'GET', body?: any, actor = 'admin', extra: Record<string, string> = {}) {
    const auth = sessions.get(actor);
    const r = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, { method,
        headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Cookie: auth.cookie, Authorization: `Bearer ${auth.csrf}` } : {}), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json().catch(() => null) };
}
function status(r: {
    status: number;
    body: any;
}, expected: number, label: string) {
    check(r.status === expected, `${label}: expected ${expected}, got ${r.status}: ${JSON.stringify(r.body)?.slice(0, 700)}`);
    return r.body;
}
const command = () => randomUUID();
const create = async (items: any[], actor = 'staffA', extra: any = {}) => status(await request('/api/pos/invoices', 'POST', { commandId: command(), expectedVersion: 0, patientId: 'patient', branchId: 'A', notes: 'Synthetic retained notes', items, ...extra }, actor), 200, 'draft');
const post = async (i: any, actor = 'staffA') => status(await request(`/api/pos/invoices/${i.id}/post`, 'POST', { commandId: command(), expectedVersion: i.version }, actor), 200, 'post');
const pay = async (i: any, amount: string, actor = 'staffA') => status(await request(`/api/pos/invoices/${i.id}/payments`, 'POST', { commandId: command(), expectedVersion: i.version, method: 'cash', amount, tender: amount }, actor), 200, 'pay');
try {
    check(Number((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count) === 0, 'requires empty disposable POS database');
    await migrateDatabase();
    await migrateDatabase();
    check(await assertCurrentMigrationChain(), 'current chain');
    for (const id of ['A', 'B'])
        await db.collection('branches').doc(id).set({ branchName: 'Synthetic ' + id, status: 'Active' });
    for (const [id, fields] of Object.entries({ admin: { role: 'admin' }, staffA: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'] }, staffB: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['B'] }, manager: { role: 'manager', assignedBranches: ['A'] }, doctor: { role: 'doctor', assignedBranches: ['A'] }, denied: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'pos.collect': 'deny' } }, noClinical: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'clinical.view': 'deny' } }, noVisits: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'visits.view': 'deny' } }, noAppointments: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'appointments.view': 'deny' } }, noPatients: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'patients.view': 'deny' } } })) {
        await db.collection('users').doc(id).set({ active: true, fullName: 'Synthetic ' + id, ...fields });
        const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
        await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
        await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id, csrf]);
        sessions.set(id, { cookie: `__Host-vine_session=${token}`, csrf });
    }
    await db.collection('patients').doc('patient').set({ name: 'Synthetic POS patient', isArchived: false });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    status(await request('/api/pos/branches', 'GET', undefined, 'anonymous'), 401, 'anonymous blocked');
    status(await request('/api/pos/branches', 'GET', undefined, 'doctor'), 403, 'Doctor has no automatic financial authority');
    const branchList = status(await request('/api/pos/branches', 'GET', undefined, 'staffA'), 200, 'scoped branches');
    check(branchList.branches.length === 1 && branchList.branches[0].id === 'A', 'only assigned branch visible');
    for (const endpoint of ['/options?branchId=B', '/invoices?branchId=B', '/sales?branchId=B&from=2020-01-01&to=2040-01-01'])
        status(await request('/api/pos' + endpoint, 'GET', undefined, 'manager'), 403, 'cross-branch read denied');
    const service = status(await request('/api/services', 'POST', { id: randomUUID(), name: 'Synthetic POS service', description: '', defaultDurationMinutes: 30, standardPrice: { mode: 'priced', amount: '100.10' }, branchSettings: [{ branchId: 'A', available: true, price: { mode: 'inherit' } }, { branchId: 'B', available: true, price: { mode: 'priced', amount: '200.20' } }] }), 201, 'service');
    const item = { kind: 'service', id: service.id, expectedVersion: service.version };
    const original = { commandId: command(), expectedVersion: 0, patientId: 'patient', branchId: 'A', notes: 'Original notes', items: [item] };
    status(await request('/api/pos/invoices', 'POST', original, 'staffA', { Origin: 'https://wrong.invalid' }), 403, 'origin enforced');
    status(await request('/api/pos/invoices', 'POST', original, 'staffA', { Authorization: 'Bearer wrong' }), 403, 'CSRF enforced');
    let i = status(await request('/api/pos/invoices', 'POST', original, 'staffA'), 200, 'create draft');
    check(i.total_cents === 10010 && i.state === 'draft', 'authoritative branch price in cents');
    const repeat = status(await request('/api/pos/invoices', 'POST', original, 'staffA'), 200, 'create replay');
    check(repeat.id === i.id, 'create retry creates one invoice');
    status(await request('/api/pos/invoices', 'POST', { ...original, notes: 'Changed' }, 'staffA'), 409, 'retry conflict');
    status(await request(`/api/pos/invoices/${i.id}`, 'GET', undefined, 'staffB'), 403, 'invoice details branch guarded');
    status(await request(`/api/pos/invoices/${i.id}/payments`, 'POST', { commandId: command(), expectedVersion: i.version, method: 'cash', amount: '1', tender: '1' }, 'staffA'), 409, 'no draft payment');
    status(await request('/api/pos/invoices', 'POST', { ...original, commandId: command(), items: [{ ...item, amount: '1', reason: 'Override' }] }, 'staffA'), 403, 'staff price override denied');
    let adjusted = await create([{ ...item, amount: '90', reason: 'Approved synthetic special' }], 'admin');
    check(adjusted.total_cents === 9000 && adjusted.items[0].snapshot.originalAmount === 10010, 'authorized price adjustment retains original');
    const postCommand = { commandId: command(), expectedVersion: i.version };
    i = status(await request(`/api/pos/invoices/${i.id}/post`, 'POST', postCommand, 'staffA'), 200, 'post');
    status(await request(`/api/pos/invoices/${i.id}/post`, 'POST', postCommand, 'staffA'), 200, 'post replay');
    status(await request(`/api/pos/invoices/${i.id}`, 'PATCH', { ...original, commandId: command(), expectedVersion: i.version }, 'staffA'), 409, 'posted immutable');
    const payment = { commandId: command(), expectedVersion: i.version, method: 'cash', amount: '40', tender: '50' };
    status(await request(`/api/pos/invoices/${i.id}/payments`, 'POST', payment, 'denied'), 403, 'collection denial enforced');
    i = status(await request(`/api/pos/invoices/${i.id}/payments`, 'POST', payment, 'staffA'), 200, 'partial cash');
    check(i.paid_cents === 4000 && i.outstanding_cents === 6010 && Number(i.payments[0].tender_cents) === 5000, 'partial and cash change');
    status(await request(`/api/pos/invoices/${i.id}/payments`, 'POST', payment, 'staffA'), 200, 'payment replay');
    check((await pool.query('SELECT count(*) FROM pos_payments WHERE invoice_id=$1', [i.id])).rows[0].count === '1', 'one payment after retry');
    status(await request(`/api/pos/invoices/${i.id}/payments`, 'POST', { ...payment, commandId: command() }, 'staffA'), 409, 'stale payment version');
    status(await request(`/api/pos/invoices/${i.id}/payments`, 'POST', { ...payment, commandId: command(), expectedVersion: i.version, amount: '100' }, 'staffA'), 400, 'insufficient tender invalid');
    status(await request(`/api/pos/invoices/${i.id}/payments`, 'POST', { ...payment, commandId: command(), expectedVersion: i.version, amount: '100', tender: '100' }, 'staffA'), 409, 'overpayment denied');
    const later = { commandId: command(), expectedVersion: i.version, method: 'gcash', amount: '60.10', reference: 'SYNTHETIC-REF' };
    i = status(await request(`/api/pos/invoices/${i.id}/payments`, 'POST', later, 'staffA'), 200, 'later noncash collection');
    check(i.outstanding_cents === 0 && i.payments.length === 2, 'fully paid');
    status(await request(`/api/pos/invoices/${i.id}/void`, 'POST', { commandId: command(), expectedVersion: i.version, reason: 'Synthetic correction' }, 'admin'), 409, 'paid invoice cannot be erased');
    status(await request(`/api/pos/invoices/${i.id}/reference`, 'PATCH', { commandId: command(), expectedVersion: i.version, orNumber: 'SYNTHETIC-OR' }, 'staffA'), 403, 'staff cannot edit OR');
    i = status(await request(`/api/pos/invoices/${i.id}/reference`, 'PATCH', { commandId: command(), expectedVersion: i.version, orNumber: 'SYNTHETIC-OR' }, 'admin'), 200, 'Admin OR');
    check(i.or_number === 'SYNTHETIC-OR', 'reference saved');
    // Source quotes are frozen and remain independent of later catalogue pricing.
    const quote = { version: 1, currency: 'PHP', branchId: 'A', serviceId: service.id, serviceCatalogueVersion: 1, servicePrice: '100.10', specialPrice: '70.00', total: '70.00', source: 'special', quotedAt: '2030-01-01', quotedByUid: 'staffA', quotedByName: 'Synthetic staff' };
    await db.collection('appointments').doc('booking').set({ patientId: 'patient', branchId: 'A', serviceId: service.id, serviceCatalogueVersion: 1, serviceNameSnapshot: 'Original Service', bookingQuote: quote, bookingPricingRevision: 1 });
    const booking = { kind: 'appointment', id: 'booking', expectedVersion: 1 };
    let quoted = await create([booking]);
    check(quoted.total_cents === 7000, 'Special Price used');
    await db.collection('appointments').doc('booking').update({ bookingPricingRevision: 2, bookingQuote: { ...quote, total: '60.00', specialPrice: '60.00' } });
    status(await request(`/api/pos/invoices/${quoted.id}/post`, 'POST', { commandId: command(), expectedVersion: quoted.version }, 'staffA'), 409, 'changed quote requires review');
    const visitData = { patientId: 'patient', branchId: 'A', appointmentId: 'booking', visitVersion: 1, serviceId: service.id, serviceCatalogueVersion: 1, serviceNameSnapshot: 'Original Service', visitQuote: { ...quote, bookingAppointmentId: 'booking', bookingPricingRevision: 1 }, visitDate: '2037-02-01T10:00', performedByUserId: 'staffA' };
    await db.collection('visits').doc('visit').set(visitData);
    let v = await create([{ kind: 'visit', id: 'visit', expectedVersion: 1 }]);
    v = await post(v);
    check(v.total_cents === 7000, 'Visit frozen quote');
    const duplicate = await create([{ kind: 'visit', id: 'visit', expectedVersion: 1 }]);
    status(await request(`/api/pos/invoices/${duplicate.id}/post`, 'POST', { commandId: command(), expectedVersion: duplicate.version }, 'staffA'), 409, 'duplicate Visit billing blocked');
    status(await request('/api/pos/invoices', 'POST', { ...original, commandId: command(), items: [{ kind: 'appointment', id: 'booking', expectedVersion: 2 }] }, 'staffA'), 409, 'booking with Visit must use Visit');
    check((await pool.query('SELECT count(*) FROM pos_source_claims WHERE invoice_id=$1', [v.id])).rows[0].count === '2', 'Visit and booking both claimed');
    // Package purchases and release are atomic; no duplicate purchases on retry.
    const pkg = status(await request('/api/packages', 'POST', { id: randomUUID(), commandId: command(), expectedVersion: 0, name: 'Synthetic POS package', description: '', active: true, lines: [{ serviceId: service.id, expectedServiceVersion: service.version, sessions: 3 }] }), 201, 'package');
    const packageItem = { kind: 'package', id: pkg.id, expectedVersion: pkg.version, amount: '300' };
    status(await request('/api/pos/invoices', 'POST', { ...original, commandId: command(), items: [packageItem] }, 'noClinical'), 403, 'ledger permissions preserved');
    let pack = await create([packageItem]);
    check((await pool.query('SELECT count(*) FROM treatment_ledger_purchases')).rows[0].count === '0', 'draft has no sessions');
    const packPost = { commandId: command(), expectedVersion: pack.version };
    pack = status(await request(`/api/pos/invoices/${pack.id}/post`, 'POST', packPost, 'staffA'), 200, 'post package');
    status(await request(`/api/pos/invoices/${pack.id}/post`, 'POST', packPost, 'staffA'), 200, 'repeat package post');
    check((await pool.query('SELECT count(*) FROM treatment_ledger_purchases')).rows[0].count === '1', 'exactly one linked purchase');
    let ledger = status(await request('/api/records/patients/patient/treatment-ledger', 'GET', undefined, 'staffA'), 200, 'ledger');
    let purchase = ledger.purchases[0];
    check(purchase.usable === false && purchase.lines[0].remainingSessions === 3, 'purchased sessions preserved but locked');
    const line = purchase.lines[0];
    status(await request(`/api/records/patients/patient/treatment-ledger/lines/${line.id}/adjustments`, 'POST', { commandId: command(), expectedLineVersion: line.version, delta: 1, reason: 'Synthetic' }, 'admin'), 409, 'unpaid adjustment blocked');
    const visitPayload = { clientVisitId: randomUUID(), patientId: 'patient', branchId: 'B', doctorId: null, performedByUserId: 'staffB', visitType: 'Treatment Session', visitDate: '2037-02-02T10:00', notes: 'Synthetic usage', serviceSelection: { serviceId: service.id, expectedVersion: service.version }, sessionUsage: { commandId: command(), lineId: line.id, sessions: 1, expectedLineVersion: line.version, expectedUsageVersion: 0 } };
    status(await request('/api/records/visits', 'POST', visitPayload, 'staffB'), 409, 'unpaid usage blocked at another authorized branch');
    pack = await pay(pack, '100');
    ledger = status(await request('/api/records/patients/patient/treatment-ledger', 'GET', undefined, 'staffB'), 200, 'cross-branch ledger');
    check(ledger.purchases[0].usable === false && ledger.purchases[0].notes === '', 'partial package still locked and private notes redacted');
    pack = await pay(pack, '200');
    ledger = status(await request('/api/records/patients/patient/treatment-ledger', 'GET', undefined, 'staffB'), 200, 'funded ledger');
    check(ledger.purchases[0].usable === true, 'full payment releases sessions');
    status(await request('/api/records/visits', 'POST', visitPayload, 'staffB'), 201, 'paid package usable at authorized branch B');
    ledger = status(await request('/api/records/patients/patient/treatment-ledger', 'GET', undefined, 'staffB'), 200, 'used ledger');
    check(ledger.purchases[0].lines[0].remainingSessions === 2, 'one session deducted');
    // Concurrent collectors cannot overpay, and payment rows cannot be edited.
    let race = await post(await create([item]));
    const attempts = await Promise.all([1, 2].map(() => request(`/api/pos/invoices/${race.id}/payments`, 'POST', { commandId: command(), expectedVersion: race.version, method: 'cash', amount: '100.10', tender: '100.10' }, 'staffA')));
    check(attempts.filter(r => r.status === 200).length === 1 && attempts.filter(r => r.status === 409).length === 1, 'concurrent collection serialized');
    await assert.rejects(pool.query('UPDATE pos_payments SET amount_cents=1'), /immutable/);
    checks++;
    await assert.rejects(pool.query('DELETE FROM pos_invoices WHERE id=$1', [race.id]), /deleted/);
    checks++;
    let voided = await post(await create([item]));
    voided = status(await request(`/api/pos/invoices/${voided.id}/void`, 'POST', { commandId: command(), expectedVersion: voided.version, reason: 'Synthetic cancellation' }, 'admin'), 200, 'void unpaid');
    check(voided.state === 'void' && voided.outstanding_cents === 0, 'void retained');
    await post(await create([item], 'admin', { branchId: 'B' }), 'admin');
    status(await request('/api/pos/sales?from=2020-01-01&to=2040-01-01', 'GET', undefined, 'staffA'), 403, 'staff cannot access totals');
    const manager = status(await request('/api/pos/sales?from=2020-01-01&to=2040-01-01', 'GET', undefined, 'manager'), 200, 'scoped sales');
    check(manager.branches.length === 1 && manager.branches[0].id === 'A', 'manager overall limited to authorized clinic');
    const admin = status(await request('/api/pos/sales?from=2020-01-01&to=2040-01-01', 'GET', undefined, 'admin'), 200, 'overall sales');
    check(admin.branches.length === 2 && admin.totals.sales === manager.totals.sales + 20020, 'overall includes both clinics with branch-specific price');
    check(admin.totals.collected === 50020, 'collections count payment allocations, not tender, quotes or redemptions');
    check((await pool.query('SELECT data FROM app_records WHERE collection_path=\'visits\' AND id=\'visit\'')).rows[0].data.visitQuote.total === '70.00', 'source quote unchanged');
    const serviceDraft = await create([item]);
    status(await request('/api/services/' + service.id, 'PATCH', { expectedVersion: service.version, standardPrice: { mode: 'priced', amount: '500.00' } }), 200, 'catalogue repriced');
    status(await request(`/api/pos/invoices/${serviceDraft.id}/post`, 'POST', { commandId: command(), expectedVersion: serviceDraft.version }, 'staffA'), 409, 'new direct catalogue sale requires current version');
    await db.collection('visits').doc('historical-quote').set({ ...visitData, appointmentId: null });
    const frozen = await post(await create([{ kind: 'visit', id: 'historical-quote', expectedVersion: 1 }]));
    check(frozen.total_cents === 7000 && frozen.items[0].snapshot.source.quote.servicePrice === '100.10', 'historical quote retained after catalogue repricing');
    const packageDraft = await create([{ ...packageItem, amount: '0' }]);
    const freePack = await post(packageDraft);
    const freeLink = (await pool.query('SELECT p.purchase_id FROM pos_package_purchases p JOIN pos_invoice_items i ON i.id=p.item_id WHERE i.invoice_id=$1', [freePack.id])).rows[0];
    check((await pool.query('SELECT pos_purchase_usable($1) AS usable', [freeLink.purchase_id])).rows[0].usable === true, 'explicit Free package activates without fake payment');
    const voidFree = status(await request(`/api/pos/invoices/${freePack.id}/void`, 'POST', { commandId: command(), expectedVersion: freePack.version, reason: 'Synthetic unused cancellation' }, 'admin'), 200, 'void unused free package');
    check((await pool.query('SELECT pos_purchase_usable($1) AS usable', [freeLink.purchase_id])).rows[0].usable === false, 'void locks linked sessions without deleting balances');
    const billedUsage = { ...visitPayload, clientVisitId: randomUUID(), branchId: 'A', performedByUserId: 'staffA', appointmentId: 'booking', expectedBookingContext: { pricingRevision: 2, serviceId: service.id, serviceCatalogueVersion: 1 }, visitDate: '2037-02-02T11:00', serviceSelection: { serviceId: service.id, expectedVersion: 2 }, sessionUsage: { ...visitPayload.sessionUsage, commandId: command(), expectedLineVersion: 2 } };
    // Exercise the shared ledger boundary directly with current authorization,
    // avoiding unrelated appointment-completion validation in this focused check.
    const { applyVisitSessionUsage } = await import('../backend/treatmentLedger');
    await assert.rejects(db.runTransaction(async (tx) => applyVisitSessionUsage(tx, { identity: { uid: 'staffA', email: 'staffA@example.invalid' } as any, profile: (await tx.get(db.collection('users').doc('staffA'))).data()! }, 'visit', { ...visitData, serviceCatalogueVersion: 2 }, billedUsage.sessionUsage)), (e: any) => e.code === 'VISIT_ALREADY_BILLED');
    checks++;
    await db.collection('visits').doc('legacy').set({ patientId: 'patient', branchId: 'A', visitType: 'Legacy treatment', notes: 'Keep old notes' });
    status(await request('/api/pos/invoices', 'POST', { ...original, commandId: command(), items: [{ kind: 'visit', id: 'legacy', expectedVersion: 0 }] }, 'staffA'), 400, 'unknown historical price is not silently zero');
    const legacy = await create([{ kind: 'visit', id: 'legacy', expectedVersion: 0, amount: '50', reason: 'Confirmed synthetic historical quote' }], 'admin');
    check(legacy.total_cents === 5000, 'Admin confirms legacy price explicitly');
    const noService = { ...quote, serviceId: null, serviceCatalogueVersion: null, servicePrice: null, specialPrice: '12.34', total: '12.34' };
    await db.collection('appointments').doc('special-only').set({ patientId: 'patient', branchId: 'A', bookingPricingRevision: 1, bookingQuote: noService });
    const specialOnly = await post(await create([{ kind: 'appointment', id: 'special-only', expectedVersion: 1 }]));
    check(specialOnly.total_cents === 1234, 'Special Price without a canonical Service remains billable');
    // Source discovery must cover the patient's complete history without changing
    // quotes, payment history or package funding/session balances.
    await db.collection('patients').doc('source-history').set({ name: 'Synthetic source history', isArchived: false });
    await db.collection('patients').doc('source-other').set({ name: 'Synthetic other patient', isArchived: false });
    await db.collection('patients').doc('source-archived').set({ name: 'Synthetic archived patient', isArchived: true });
    const historicalSource = { patientId: 'source-history', branchId: 'A', visitType: 'Synthetic follow-up treatment', serviceNameSnapshot: 'Ordinary historical quote',
        visitVersion: 7, bookingPricingRevision: 9, visitDate: '2037-03-15T09:30', appointmentDate: '2037-03-15T09:30',
        visitQuote: { ...noService, bookingAppointmentId: null, bookingPricingRevision: null }, bookingQuote: noService,
        notes: 'Private clinical text must not be returned by the POS picker' };
    for (const kind of ['visit', 'appointment'] as const) {
        const collection = kind === 'visit' ? 'visits' : 'appointments';
        for (let n = 0; n < 125; n++)
            await db.collection(collection).doc(`history-${kind}-${String(n).padStart(3, '0')}`).set({ ...historicalSource, ...(n === 124 ? { serviceNameSnapshot: 'Unique 100%_ quote' } : {}) });
        await db.collection(collection).doc(`history-${kind}-archived`).set({ ...historicalSource, isArchived: true });
        await db.collection(collection).doc(`history-${kind}-branch-b`).set({ ...historicalSource, branchId: 'B' });
        await db.collection(collection).doc(`history-${kind}-other-patient`).set({ ...historicalSource, patientId: 'source-other' });
        await db.collection(collection).doc(`history-${kind}-archived-patient`).set({ ...historicalSource, patientId: 'source-archived' });
    }
    const sourceRowsBefore = (await pool.query("SELECT collection_path,id,data FROM app_records WHERE collection_path IN ('visits','appointments') ORDER BY collection_path,id")).rows;
    const financialTables = ['pos_invoices', 'pos_invoice_items', 'pos_payments', 'pos_events', 'pos_source_claims', 'pos_package_purchases', 'treatment_ledger_purchases', 'treatment_ledger_lines', 'treatment_ledger_events', 'treatment_ledger_visit_usage'];
    const financialSnapshot = async () => Promise.all(financialTables.map(async table => (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const financialBefore = await financialSnapshot();
    const oldOptions = status(await request('/api/pos/options?branchId=A&patientId=source-history', 'GET', undefined, 'staffA'), 200, 'compatible original options');
    check(oldOptions.sources.length === 200 && !oldOptions.sources.some((s: any) => s.id.endsWith('-124')), 'regression setup exceeds both original 100-record windows');
    for (const kind of ['visit', 'appointment'] as const) {
        const base = `/api/pos/sources?branchId=A&patientId=source-history&kind=${kind}`;
        const pages = [];
        for (let page = 1; page <= 3; page++)
            pages.push(status(await request(base + `&page=${page}`, 'GET', undefined, 'staffA'), 200, `${kind} history page ${page}`));
        check(pages.every((p, index) => p.page === index + 1 && p.total === 125) && pages.map(p => p.sources.length).join(',') === '50,50,25', `${kind} bounded pages expose complete history`);
        const ids = pages.flatMap(p => p.sources.map((s: any) => s.id));
        check(new Set(ids).size === 125 && ids[0] === `history-${kind}-124` && ids.at(-1) === `history-${kind}-000`, `${kind} stable date/id ordering has no gaps or duplicates`);
        const repeatPage = status(await request(base + '&page=2', 'GET', undefined, 'staffA'), 200, `${kind} repeat page`);
        check(JSON.stringify(repeatPage.sources) === JSON.stringify(pages[1].sources), `${kind} pagination is deterministic`);
        const emptyPage = status(await request(base + '&page=4', 'GET', undefined, 'staffA'), 200, `${kind} empty trailing page`);
        check(emptyPage.total === 125 && emptyPage.sources.length === 0, `${kind} trailing page retains total`);
        for (const term of [`HISTORY-${kind.toUpperCase()}-124`, 'UNIQUE 100%_', '%_']) {
            const result = status(await request(base + '&q=' + encodeURIComponent(term), 'GET', undefined, 'staffA'), 200, `${kind} source search`);
            check(result.total === 1 && result.sources[0].id === `history-${kind}-124`, `${kind} literal case-insensitive search reaches records beyond 100`);
        }
        for (const term of ['follow-UP', '2037-03-15']) {
            const result = status(await request(base + '&q=' + encodeURIComponent(term), 'GET', undefined, 'staffA'), 200, `${kind} type/date search`);
            check(result.total === 125, `${kind} search covers Visit type and treatment date`);
        }
        const exactPath = `/api/pos/sources/${kind}/history-${kind}-124?branchId=A&patientId=source-history`;
        const exact = status(await request(exactPath, 'GET', undefined, 'staffA'), 200, `${kind} exact load beyond 100`);
        check(exact.source.id === `history-${kind}-124` && exact.source.price === '12.34' && exact.source.version === (kind === 'visit' ? 7 : 9), `${kind} exact source retains authoritative saved quote/version`);
        check(Object.keys(exact.source).sort().join(',') === 'date,id,kind,name,price,version', `${kind} source exposes only the operational quote summary`);
        const deniedActor = kind === 'visit' ? 'noVisits' : 'noAppointments';
        for (const endpoint of [base, exactPath]) {
            status(await request(endpoint, 'GET', undefined, 'anonymous'), 401, `${kind} anonymous source read denied`);
            status(await request(endpoint, 'GET', undefined, 'doctor'), 403, `${kind} no automatic POS authority`);
            status(await request(endpoint, 'GET', undefined, deniedActor), 403, `${kind} source-view denial enforced`);
            status(await request(endpoint, 'GET', undefined, 'noPatients'), 403, `${kind} patient-view denial enforced`);
            status(await request(endpoint, 'GET', undefined, 'staffB'), 403, `${kind} unauthorized branch denied`);
        }
        status(await request(exactPath.replace('patientId=source-history', 'patientId=source-other'), 'GET', undefined, 'staffA'), 403, `${kind} exact patient mismatch denied`);
        status(await request(exactPath.replace('-124?', '-branch-b?'), 'GET', undefined, 'staffA'), 403, `${kind} actual source branch rechecked`);
        status(await request(exactPath.replace('-124?', '-archived?'), 'GET', undefined, 'staffA'), 409, `${kind} archived source denied`);
        status(await request(base.replace('patientId=source-history', 'patientId=source-archived'), 'GET', undefined, 'staffA'), 409, `${kind} archived patient list denied`);
        status(await request(exactPath.replace('-124?', '-archived-patient?').replace('patientId=source-history', 'patientId=source-archived'), 'GET', undefined, 'staffA'), 409, `${kind} archived patient exact load denied`);
        status(await request(exactPath.replace('-124?', '-missing?'), 'GET', undefined, 'staffA'), 404, `${kind} missing exact source`);
    }
    status(await request('/api/pos/sources?branchId=A&patientId=source-history&kind=other', 'GET', undefined, 'staffA'), 400, 'invalid source kind rejected');
    status(await request('/api/pos/sources?branchId=A&kind=visit', 'GET', undefined, 'staffA'), 400, 'source patient context required');
    for (const page of ['0', '-1', '1.5', 'not-a-page', 'Infinity', '100001'])
        status(await request('/api/pos/sources?branchId=A&patientId=source-history&kind=visit&page=' + page, 'GET', undefined, 'staffA'), 400, 'invalid source page rejected');
    check(JSON.stringify((await pool.query("SELECT collection_path,id,data FROM app_records WHERE collection_path IN ('visits','appointments') ORDER BY collection_path,id")).rows) === JSON.stringify(sourceRowsBefore), 'source paging/search/direct reads preserve saved quotes and historical data');
    check(JSON.stringify(await financialSnapshot()) === JSON.stringify(financialBefore), 'source discovery preserves all invoices, payments, package purchases, balances and usage history');
    const originalTx = db.runTransaction.bind(db);
    const beforeInvoices = (await pool.query('SELECT count(*) FROM pos_invoices')).rows[0].count;
    db.runTransaction = callback => originalTx(async (tx) => { const create = tx.create.bind(tx); tx.create = ((ref: any, data: any) => { if (ref.collectionPath === 'audit_logs')
        throw Error('Synthetic POS audit failure'); return create(ref, data); }) as any; return callback(tx); });
    try {
        status(await request('/api/pos/invoices', 'POST', { ...original, commandId: command(), items: [{ ...item, expectedVersion: 2 }] }, 'staffA'), 503, 'audit failure surfaced');
    }
    finally {
        db.runTransaction = originalTx;
    }
    check((await pool.query('SELECT count(*) FROM pos_invoices')).rows[0].count === beforeInvoices, 'invoice and lines roll back with audit failure');
    console.log(`POS API: ${checks} checks passed`);
}
finally {
    if (server)
        await new Promise<void>(resolve => server!.close(() => resolve()));
    await pool.end();
}
