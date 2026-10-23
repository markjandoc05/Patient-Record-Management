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
    for (const [id, fields] of Object.entries({ admin: { role: 'admin' }, staffA: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'] }, staffB: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['B'] }, manager: { role: 'manager', assignedBranches: ['A'] }, doctor: { role: 'doctor', assignedBranches: ['A'] }, denied: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'pos.collect': 'deny' } }, noClinical: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'clinical.view': 'deny' } }, noVisits: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'visits.view': 'deny' } }, noAppointments: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'appointments.view': 'deny' } }, noPatients: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'patients.view': 'deny' } }, readOnly: { role: 'staff', assignedBranches: ['A'], permissionOverrides: { 'pos.manage': 'deny', 'pos.collect': 'deny' } }, noBranches: { role: 'staff', assignedBranches: [] } })) {
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
    // Keep a selected patient's identity independent of the bounded search list.
    for (let n = 0; n < 35; n++)
        await db.collection('patients').doc(`picker-${n}`).set({ name: `Picker ${String(n).padStart(2, '0')}`, patientID: `PICK-${n}`, isArchived: false });
    const selectedIdentity = { id: 'picker-selected', name: 'Zzz selected patient', patientID: 'ID-PICK-100%_' };
    await db.collection('patients').doc(selectedIdentity.id).set({ name: selectedIdentity.name, patientID: selectedIdentity.patientID, isArchived: false,
        dateOfBirth: '1990-01-01', phone: 'Synthetic private contact', medicalHistory: 'Synthetic private clinical history' });
    await db.collection('patients').doc('picker-decoy').set({ name: 'Zzz similar identifier', patientID: 'ID-PICK-100XY', isArchived: false });
    await db.collection('patients').doc('picker-archived').set({ name: 'Archived picker patient', patientID: 'ID-PICK-ARCHIVED', isArchived: true });
    const pickerPatientsBefore = (await pool.query("SELECT id,data FROM app_records WHERE collection_path='patients' ORDER BY id")).rows;
    const pickerBase = '/api/pos/options?branchId=A';
    for (const query of ['', '&q=', '&q=%20%20%20', '&q=p', '&q=%20p%20']) {
        const options = status(await request(pickerBase + query, 'GET', undefined, 'staffA'), 200, 'patient choices require two search characters');
        check(options.patients.length === 0 && options.selectedPatient === null, 'missing, blank, whitespace and one-character searches do not preload patients');
    }
    const pickerOptions = status(await request(pickerBase + '&q=pi', 'GET', undefined, 'staffA'), 200, 'patient picker options');
    check(pickerOptions.patients.length === 30 && !pickerOptions.patients.some((p: any) => p.id === selectedIdentity.id), 'selected patient setup falls outside the first thirty results');
    check(pickerOptions.selectedPatient === null && pickerOptions.patients.every((p: any) => Object.keys(p).sort().join(',') === 'id,name,patientID'), 'patient options expose only identity fields and no implicit selection');
    const trimmedName = status(await request(pickerBase + '&q=%20%20pIcKeR%2000%20%20', 'GET', undefined, 'staffA'), 200, 'trimmed name search');
    check(trimmedName.patients.length === 1 && trimmedName.patients[0].id === 'picker-0', 'two or more search characters match names case insensitively after trimming');
    const shortPatientId = status(await request(pickerBase + '&q=10', 'GET', undefined, 'staffA'), 200, 'two-character patientID search');
    check(shortPatientId.patients.some((p: any) => p.id === selectedIdentity.id), 'two-character patientID search returns matching identities');
    const emptySelection = status(await request(pickerBase + '&patientId=', 'GET', undefined, 'staffA'), 200, 'compatible empty patient selection');
    check(emptySelection.selectedPatient === null, 'empty patient selection remains supported');
    const selectedOptions = status(await request(pickerBase + '&patientId=' + selectedIdentity.id, 'GET', undefined, 'staffA'), 200, 'selected patient outside first thirty');
    check(selectedOptions.patients.length === 0 && JSON.stringify(selectedOptions.selectedPatient) === JSON.stringify(selectedIdentity), 'exact selected patient exposes only its saved identity without loading patients');
    for (const query of ['&q=', '&q=%20%20', '&q=%20p%20']) {
        const options = status(await request(pickerBase + '&patientId=' + selectedIdentity.id + query, 'GET', undefined, 'staffA'), 200, 'short search preserves selected patient');
        check(options.patients.length === 0 && JSON.stringify(options.selectedPatient) === JSON.stringify(selectedIdentity), 'blank and short searches retain the independent exact selected identity');
    }
    const searchedOptions = status(await request(pickerBase + '&patientId=' + selectedIdentity.id + '&q=Picker%2000&itemSearch=no-match', 'GET', undefined, 'staffA'), 200, 'search preserves selected patient');
    check(searchedOptions.patients.length === 1 && searchedOptions.patients[0].id === 'picker-0' && JSON.stringify(searchedOptions.selectedPatient) === JSON.stringify(selectedIdentity), 'patient and catalogue searches preserve an independent selected identity');
    const literalPatientId = status(await request(pickerBase + '&q=' + encodeURIComponent('id-pick-100%_'), 'GET', undefined, 'staffA'), 200, 'literal patientID search');
    check(literalPatientId.patients.length === 1 && literalPatientId.patients[0].id === selectedIdentity.id && literalPatientId.patients[0].patientID === selectedIdentity.patientID, 'patientID search is case insensitive and treats percent and underscore literally');
    const legacyIdentity = status(await request(pickerBase + '&patientId=patient', 'GET', undefined, 'staffA'), 200, 'legacy identity without patientID');
    check(JSON.stringify(legacyIdentity.selectedPatient) === JSON.stringify({ id: 'patient', name: 'Synthetic POS patient', patientID: null }), 'existing patients without patientID still load');
    const archivedIdentity = status(await request(pickerBase + '&patientId=picker-archived&q=ID-PICK-ARCHIVED', 'GET', undefined, 'staffA'), 200, 'archived patient identity excluded');
    check(archivedIdentity.selectedPatient === null && archivedIdentity.patients.length === 0, 'archived patient cannot appear in new draft identity choices');
    const missingIdentity = status(await request(pickerBase + '&patientId=picker-missing', 'GET', undefined, 'staffA'), 200, 'missing selected patient identity');
    check(missingIdentity.selectedPatient === null, 'missing selected identity is null');
    for (const actor of ['anonymous', 'doctor', 'noPatients', 'staffB', 'noBranches'])
        for (const query of ['', '&q=pi'])
            status(await request(pickerBase + '&patientId=' + selectedIdentity.id + query, 'GET', undefined, actor), actor === 'anonymous' ? 401 : 403, 'suppressed and matching searches retain patient, POS and branch guards');
    for (const patientQuery of ['patientId=invalid%2Fid', 'patientId=patient&patientId=picker-selected'])
        status(await request(pickerBase + '&' + patientQuery, 'GET', undefined, 'staffA'), 400, 'nonempty selected patient identifier validated');
    check(JSON.stringify((await pool.query("SELECT id,data FROM app_records WHERE collection_path='patients' ORDER BY id")).rows) === JSON.stringify(pickerPatientsBefore), 'options identity reads preserve patient records');
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
    // Invoice lookup and Patient Billing use existing immutable financial records.
    // These fixtures are created only inside this suite's guarded empty database.
    await db.collection('patients').doc('invoice-history').set({ name: 'Current renamed patient', patientID: 'ID-LOOKUP-100%_', isArchived: false });
    await db.collection('patients').doc('invoice-other').set({ name: 'Other synthetic patient', isArchived: false });
    const seededActor = JSON.stringify({ uid: 'admin', name: 'Synthetic admin', role: 'admin' });
    const seedInvoice = async ({ patientId = 'invoice-history', branchId = 'A', state = 'posted', cents = 10000, created = '2038-05-01T01:00:00Z', payments = [] }: { patientId?: string; branchId?: string; state?: 'draft' | 'posted' | 'void'; cents?: number; created?: string; payments?: { cents: number; reference: string }[] } = {}) => {
        const id = randomUUID();
        const row = (await pool.query("INSERT INTO pos_invoices(id,patient_id,branch_id,patient_name,branch_name,total_cents,created_at,actor) VALUES($1,$2,$3,'Synthetic Lookup Patient',$3,$4,$5,$6::jsonb) RETURNING *", [id, patientId, branchId, cents, created, seededActor])).rows[0];
        await pool.query("INSERT INTO pos_invoice_items(id,invoice_id,position,kind,name,amount_cents,snapshot) VALUES($1,$2,0,'service','Synthetic retained quote',$3,$4::jsonb)", [randomUUID(), id, cents, JSON.stringify({ source: { quote: { total: (cents / 100).toFixed(2), source: 'special' } } })]);
        if (state !== 'draft')
            await pool.query("UPDATE pos_invoices SET state='posted',version=2,posted_at='2038-06-15T00:00:00Z' WHERE id=$1", [id]);
        if (state === 'void')
            await pool.query("UPDATE pos_invoices SET state='void',version=3 WHERE id=$1", [id]);
        for (const p of payments)
            await pool.query("INSERT INTO pos_payments(id,invoice_id,amount_cents,tender_cents,method,reference,actor,recorded_at) VALUES($1,$2,$3,$3,'bank',$4,$5::jsonb,'2038-07-01T00:00:00Z')", [randomUUID(), id, p.cents, p.reference, seededActor]);
        return row;
    };
    const lookupRows = [];
    for (let n = 0; n < 35; n++)
        lookupRows.push(await seedInvoice({ created: n === 0 ? '2038-04-30T15:59:59Z' : n === 1 ? '2038-04-30T16:00:00Z' : '2038-05-01T01:00:00Z', payments: n === 0 ? [{ cents: 4000, reference: 'Trace 100%_ repeated' }, { cents: 6000, reference: 'Trace 100%_ repeated' }] : n === 1 ? [{ cents: 2500, reference: 'Partial reference' }] : [] }));
    const lookupDraft = await seedInvoice({ state: 'draft' }), lookupVoid = await seedInvoice({ state: 'void' }), lookupFree = await seedInvoice({ cents: 0 });
    const lookupB = await seedInvoice({ branchId: 'B', cents: 20000, payments: [{ cents: 5000, reference: 'PRIVATE-B-ONLY' }] });
    const lookupOther = await seedInvoice({ patientId: 'invoice-other', cents: 900000 });
    const lookupBase = '/api/pos/invoices?patientId=invoice-history';
    const lookupReadSnapshot = await financialSnapshot();
    const lookupSourcesSnapshot = (await pool.query("SELECT collection_path,id,data FROM app_records WHERE collection_path IN ('visits','appointments') ORDER BY collection_path,id")).rows;
    const page1 = status(await request(lookupBase + '&page=1', 'GET', undefined, 'staffA'), 200, 'patient invoice page1'), page2 = status(await request(lookupBase + '&page=2', 'GET', undefined, 'staffA'), 200, 'patient invoice page2');
    check(page1.invoices.length === 30 && page2.invoices.length === 8 && page1.total === 38 && page2.total === 38, 'invoice lookup pages beyond thirty with accurate totals');
    const pagedIds = [...page1.invoices, ...page2.invoices].map((r: any) => r.id);
    check(new Set(pagedIds).size === 38 && !pagedIds.includes(lookupB.id) && !pagedIds.includes(lookupOther.id), 'invoice paging has no duplicate, unauthorized branch or other-patient rows');
    check(JSON.stringify((await request(lookupBase + '&page=1', 'GET', undefined, 'staffA')).body.invoices) === JSON.stringify(page1.invoices), 'invoice date/id ordering is deterministic');
    check(page1.invoices.every((r: any) => typeof r.total_cents === 'number' && typeof r.paid_cents === 'number' && typeof r.outstanding_cents === 'number'), 'invoice list money values are numeric cents');
    const expectedA = { invoicedCents: 350000, paidCents: 12500, outstandingCents: 337500 };
    check(JSON.stringify(page1.summary) === JSON.stringify(expectedA), 'patient summary excludes drafts/voids and uses payment allocations');
    const allAdmin = status(await request(lookupBase + '&branchId=all', 'GET', undefined, 'admin'), 200, 'Admin all clinics patient history');
    check(allAdmin.total === 39 && JSON.stringify(allAdmin.summary) === JSON.stringify({ invoicedCents: 370000, paidCents: 17500, outstandingCents: 352500 }), 'Admin patient summary includes both authorized clinics only for this patient');
    check((await request(lookupBase + '&branchId=All', 'GET', undefined, 'staffA')).body.total === 38, 'all clinic sentinel is still branch scoped');
    check((await request(lookupBase + '&branchId=A', 'GET', undefined, 'admin')).body.total === 38, 'explicit branch filter restricts global Admin');
    const bOnly = status(await request(lookupBase, 'GET', undefined, 'staffB'), 200, 'branch B patient history');
    check(bOnly.total === 1 && bOnly.invoices[0].id === lookupB.id && bOnly.summary.outstandingCents === 15000, 'branch B summary never exposes branch A totals');
    const noBranches = status(await request(lookupBase, 'GET', undefined, 'noBranches'), 200, 'no assigned clinics');
    check(noBranches.total === 0 && noBranches.summary.invoicedCents === 0 && noBranches.summary.paidCents === 0 && noBranches.summary.outstandingCents === 0, 'no-branch scope reveals no balances');
    for (const term of ['SYNTHETIC LOOKUP', 'invoice-HISTORY', 'ID-LOOKUP-100%_']) {
        const found = status(await request(lookupBase + '&q=' + encodeURIComponent(term), 'GET', undefined, 'staffA'), 200, 'patient snapshot/id search');
        check(found.total === 38, 'case-insensitive literal patient search covers complete history');
    }
    for (const term of ['trace 100%_', '%_ repeated']) {
        const found = status(await request(lookupBase + '&q=' + encodeURIComponent(term), 'GET', undefined, 'staffA'), 200, 'payment reference search');
        check(found.total === 1 && found.invoices[0].id === lookupRows[0].id && found.invoices[0].paid_cents === 10000, 'multiple matching payments return one invoice with exact allocation');
    }
    const invoiceNumber = status(await request(lookupBase + '&q=' + lookupRows[34].number, 'GET', undefined, 'staffA'), 200, 'invoice number search');
    check(invoiceNumber.invoices.some((r: any) => r.id === lookupRows[34].id), 'invoice number is searchable beyond initial page');
    check((await request(lookupBase + '&q=PRIVATE-B-ONLY', 'GET', undefined, 'staffA')).body.total === 0, 'payment reference search cannot reveal unauthorized clinic');
    for (const [state, expected, ids] of [['draft', 1, [lookupDraft.id]], ['void', 1, [lookupVoid.id]], ['paid', 2, [lookupRows[0].id, lookupFree.id]], ['partial', 1, [lookupRows[1].id]], ['unpaid', 33, []], ['outstanding', 34, []]] as const) {
        const found = status(await request(lookupBase + '&status=' + state, 'GET', undefined, 'staffA'), 200, state + ' filter');
        check(found.total === expected && ids.every(id => found.invoices.some((r: any) => r.id === id)), 'derived payment status ' + state);
        check(JSON.stringify(found.summary) === JSON.stringify(expectedA), 'patient summary ignores ' + state + ' list filter');
    }
    const noMatch = status(await request(lookupBase + '&q=not-present&status=void&from=2039-01-01&to=2039-01-02&page=2', 'GET', undefined, 'staffA'), 200, 'combined empty list filters');
    check(noMatch.total === 0 && noMatch.invoices.length === 0 && JSON.stringify(noMatch.summary) === JSON.stringify(expectedA), 'summary remains complete when all list filters are empty');
    const manilaBefore = status(await request(lookupBase + '&from=2038-04-30&to=2038-04-30', 'GET', undefined, 'staffA'), 200, 'invoice date before Manila midnight');
    check(manilaBefore.total === 1 && manilaBefore.invoices[0].id === lookupRows[0].id, 'created date is inclusive and uses Asia/Manila');
    check((await request(lookupBase + '&from=2038-05-01&to=2038-05-01', 'GET', undefined, 'staffA')).body.total === 37, 'Manila midnight includes next-day invoice; posting date does not affect lookup');
    const general = status(await request('/api/pos/invoices?branchId=A', 'GET', undefined, 'staffA'), 200, 'general clinic invoice lookup');
    check(!Object.hasOwn(general, 'summary'), 'Staff general invoice lookup does not receive clinic sales summary');
    const readonly = status(await request(lookupBase, 'GET', undefined, 'readOnly'), 200, 'read-only invoice lookup');
    check(readonly.total === 38 && readonly.summary.outstandingCents === expectedA.outstandingCents, 'read-only POS user can view scoped patient balance');
    status(await request('/api/pos/invoices', 'POST', { ...original, commandId: command() }, 'readOnly'), 403, 'read-only POS cannot create');
    status(await request(`/api/pos/invoices/${lookupRows[2].id}/payments`, 'POST', { commandId: command(), expectedVersion: 2, method: 'cash', amount: '1', tender: '1' }, 'readOnly'), 403, 'read-only POS cannot collect');
    for (const actor of ['anonymous', 'doctor', 'noPatients'])
        status(await request(lookupBase, 'GET', undefined, actor), actor === 'anonymous' ? 401 : 403, 'invoice lookup capability required');
    status(await request(lookupBase + '&branchId=B', 'GET', undefined, 'staffA'), 403, 'patient billing explicit unauthorized clinic rejected');
    status(await request(`/api/pos/invoices/${lookupB.id}?patientId=invoice-history`, 'GET', undefined, 'staffA'), 403, 'patient detail retains branch enforcement');
    status(await request(`/api/pos/invoices/${lookupRows[2].id}?patientId=invoice-other`, 'GET', undefined, 'staffA'), 403, 'patient detail rejects mismatched patient');
    status(await request(`/api/pos/invoices/${lookupRows[2].id}?patientId=invoice-history`, 'GET', undefined, 'staffA'), 200, 'patient-bound invoice detail');
    status(await request('/api/pos/invoices?patientId=does-not-exist', 'GET', undefined, 'staffA'), 404, 'missing patient rejected');
    for (const query of ['q=' + 'x'.repeat(101), 'q=a&q=b', 'status=posted', 'status=paid&status=void', 'from=2038-02-30', 'from=', 'to=not-a-date', 'from=2038-05-02&to=2038-05-01', 'page=0', 'page=-1', 'page=1.5', 'page=1e1', 'page=100001', 'page=Infinity', 'page=1&page=2', 'patientId=bad.id', 'branchId=bad.id'])
        status(await request('/api/pos/invoices?' + query, 'GET', undefined, 'staffA'), 400, 'invalid invoice lookup parameter rejected');
    check(JSON.stringify(await financialSnapshot()) === JSON.stringify(lookupReadSnapshot), 'lookup/search/filter/detail reads never alter payments, package balances or financial history');
    check(JSON.stringify((await pool.query("SELECT collection_path,id,data FROM app_records WHERE collection_path IN ('visits','appointments') ORDER BY collection_path,id")).rows) === JSON.stringify(lookupSourcesSnapshot), 'invoice lookup preserves all historical quotes');
    // Archived patients retain history. Later collections use the unchanged payment path
    // and update current balance independently of invoice date/status filters.
    await db.collection('patients').doc('invoice-history').update({ isArchived: true });
    const archived = status(await request(lookupBase, 'GET', undefined, 'staffA'), 200, 'archived patient billing remains readable');
    check(archived.total === 38 && JSON.stringify(archived.summary) === JSON.stringify(expectedA), 'archive preserves patient billing balances');
    status(await request(`/api/pos/invoices/${lookupRows[2].id}?patientId=invoice-history`, 'GET', undefined, 'staffA'), 200, 'archived patient invoice detail');
    const collected = status(await request(`/api/pos/invoices/${lookupRows[2].id}/payments`, 'POST', { commandId: command(), expectedVersion: 2, method: 'cash', amount: '10', tender: '20' }, 'staffA'), 200, 'later collection on retained patient invoice');
    check(collected.paid_cents === 1000 && collected.outstanding_cents === 9000 && Number(collected.payments[0].tender_cents) === 2000, 'later payment preserves cash tender/change');
    const afterCollection = status(await request(lookupBase + '&status=draft&from=2039-01-01', 'GET', undefined, 'staffA'), 200, 'current patient balance after later payment');
    check(afterCollection.summary.invoicedCents === 350000 && afterCollection.summary.paidCents === 13500 && afterCollection.summary.outstandingCents === 336500, 'later collection updates complete patient summary without changing quoted sales');
    const ledgerAfterLookup = status(await request('/api/records/patients/patient/treatment-ledger', 'GET', undefined, 'staffA'), 200, 'existing patient ledger after invoice lookup');
    check(ledgerAfterLookup.purchases.some((p: any) => p.id === purchase.id && p.lines[0].remainingSessions === 2 && p.usable === true), 'lookup and patient collections preserve existing package funding/session balances');
    // Page-sized Visit billing is a read-only projection of frozen source bindings.
    // None of these synthetic records leave this guarded disposable database.
    const visitBillingBase = '/api/pos/visit-billing?visitIds=';
    const addBillingVisit = async (id: string, extra: any = {}) => db.collection('visits').doc(id).set({ ...visitData, appointmentId: null, ...extra });
    const visitBilling = async (ids: string[], actor = 'staffA') => status(await request(visitBillingBase + ids.map(encodeURIComponent).join(','), 'GET', undefined, actor), 200, 'Visit billing projection').visits;
    const seedLinkedInvoice = async (visitId: string, extra: { state?: 'draft' | 'posted' | 'void'; patientId?: string; branchId?: string; cents?: number; otherCents?: number; source?: any; claim?: { collection: string; id: string }; payments?: number[] } = {}) => {
        const id = randomUUID(), cents = extra.cents ?? 7000, total = cents + (extra.otherCents ?? 0);
        const row = (await pool.query("INSERT INTO pos_invoices(id,patient_id,branch_id,patient_name,branch_name,total_cents,actor) VALUES($1,$2,$3,'Synthetic billing patient',$3,$4,$5::jsonb) RETURNING *", [id, extra.patientId ?? 'patient', extra.branchId ?? 'A', total, seededActor])).rows[0];
        await pool.query("INSERT INTO pos_invoice_items(id,invoice_id,position,kind,name,amount_cents,snapshot) VALUES($1,$2,0,'visit','Frozen synthetic Visit',$3,$4::jsonb)", [randomUUID(), id, cents, JSON.stringify({ source: extra.source ?? { collection: 'visits', id: visitId, appointmentId: null, quote: { ...quote, total: (cents / 100).toFixed(2) } } })]);
        if (extra.otherCents)
            await pool.query("INSERT INTO pos_invoice_items(id,invoice_id,position,kind,name,amount_cents,snapshot) VALUES($1,$2,1,'service','Other synthetic treatment',$3,'{}'::jsonb)", [randomUUID(), id, extra.otherCents]);
        if (extra.state !== 'draft')
            await pool.query("UPDATE pos_invoices SET state='posted',version=2,posted_at=now() WHERE id=$1", [id]);
        if (extra.state === 'void')
            await pool.query("UPDATE pos_invoices SET state='void',version=3 WHERE id=$1", [id]);
        if (extra.claim)
            await pool.query('INSERT INTO pos_source_claims(collection_path,record_id,invoice_id) VALUES($1,$2,$3)', [extra.claim.collection, extra.claim.id, id]);
        for (const cents of extra.payments ?? [])
            await pool.query("INSERT INTO pos_payments(id,invoice_id,amount_cents,tender_cents,method,actor) VALUES($1,$2,$3,$3,'cash',$4::jsonb)", [randomUUID(), id, cents, seededActor]);
        return row;
    };
    for (const id of ['billing-open', 'billing-free', 'billing-missing', 'billing-drafts', 'billing-shared', 'billing-void', 'billing-reversed', 'billing-overflow', 'billing-incompatible', 'billing-claim', 'billing-archived'])
        await addBillingVisit(id, id === 'billing-free' ? { visitQuote: { ...visitData.visitQuote, specialPrice: '0.00', total: '0.00' } } : id === 'billing-missing' ? { visitQuote: null } : id === 'billing-archived' ? { isArchived: true } : {});
    const initialBilling = await visitBilling(['billing-open', 'billing-free', 'billing-missing', 'billing-archived']);
    check(initialBilling.length === 4 && initialBilling.every((r: any) => r.invoices.length === 0 && !r.billingUnavailable && !r.packageSessionUsed), 'new, Free, missing quote and archived Visits retain separate empty billing states');
    check(initialBilling.slice(0, 3).every((r: any) => r.canCreateInvoice) && !initialBilling[3].canCreateInvoice, 'eligible active Visits can start draft review, archived Visits cannot');
    check(!(await visitBilling(['billing-open'], 'readOnly'))[0].canCreateInvoice, 'read-only POS sees billing without create authority');
    const archivedBillingInvoice = await seedLinkedInvoice('billing-archived');
    const archivedVisitBilling = (await visitBilling(['billing-archived']))[0];
    check(archivedVisitBilling.invoices[0].id === archivedBillingInvoice.id && !archivedVisitBilling.canCreateInvoice, 'archived Visits keep historical invoice links readable');
    const draftOne = await seedLinkedInvoice('billing-drafts', { state: 'draft', cents: 7000 });
    const draftTwo = await seedLinkedInvoice('billing-drafts', { state: 'draft', cents: 6000 });
    let draftBilling = (await visitBilling(['billing-drafts']))[0];
    check(draftBilling.invoices.length === 2 && draftBilling.invoices.every((r: any) => r.state === 'draft' && r.paymentStatus === null) && !draftBilling.canCreateInvoice, 'all matching draft snapshots appear without creating an extra draft');
    check(draftBilling.invoices.some((r: any) => r.id === draftOne.id && r.visitLineCents === 7000) && draftBilling.invoices.some((r: any) => r.id === draftTwo.id && r.visitLineCents === 6000), 'each draft preserves its frozen quote separately');
    let shared = await seedLinkedInvoice('billing-shared', { otherCents: 3000, payments: [2500] });
    let sharedBilling = (await visitBilling(['billing-shared']))[0];
    check(sharedBilling.invoices[0].visitLineCents === 7000 && sharedBilling.invoices[0].totalCents === 10000 && sharedBilling.invoices[0].paidCents === 2500 && sharedBilling.invoices[0].outstandingCents === 7500 && sharedBilling.invoices[0].paymentStatus === 'partial', 'shared invoice totals remain distinct from the frozen Visit line');
    const sharedDetail = status(await request(`/api/pos/invoices/${shared.id}?patientId=patient&visitId=billing-shared`, 'GET', undefined, 'staffA'), 200, 'Visit-bound invoice detail');
    shared = await pay(sharedDetail, '75');
    sharedBilling = (await visitBilling(['billing-shared']))[0];
    check(sharedBilling.invoices[0].paymentStatus === 'paid' && sharedBilling.invoices[0].outstandingCents === 0 && !sharedBilling.canCreateInvoice, 'later collection immediately updates summary from payment records');
    const freeInvoice = await seedLinkedInvoice('billing-free', { cents: 0 });
    const freeBilling = (await visitBilling(['billing-free']))[0];
    check(freeBilling.invoices[0].id === freeInvoice.id && freeBilling.invoices[0].paymentStatus === 'paid' && freeBilling.invoices[0].totalCents === 0, 'explicit Free posted invoice is paid without invented payment');
    const voidInvoice = await seedLinkedInvoice('billing-void', { state: 'void' });
    const voidBilling = (await visitBilling(['billing-void']))[0];
    check(voidBilling.invoices[0].id === voidInvoice.id && voidBilling.invoices[0].paymentStatus === null && voidBilling.invoices[0].outstandingCents === 0 && voidBilling.canCreateInvoice, 'void history remains readable and does not block a replacement draft');
    const reversedInvoice = await seedLinkedInvoice('billing-reversed', { payments: [7000] });
    const reversedDetail = status(await request(`/api/pos/invoices/${reversedInvoice.id}`, 'GET', undefined, 'admin'), 200, 'reversal fixture detail');
    status(await request(`/api/pos/invoices/${reversedInvoice.id}/payments/${reversedDetail.payments[0].id}/reversal`, 'POST', { commandId: command(), expectedVersion: reversedDetail.version, reason: 'Synthetic duplicate payment' }, 'admin'), 200, 'correct linked Visit payment');
    const reversedBilling = (await visitBilling(['billing-reversed']))[0];
    check(reversedBilling.invoices[0].paidCents === 0 && reversedBilling.invoices[0].outstandingCents === 7000 && reversedBilling.invoices[0].paymentStatus === 'unpaid', 'billing status uses net payments after immutable correction');
    await db.collection('appointments').doc('billing-prepaid-booking').set({ patientId: 'patient', branchId: 'A' });
    const billedBeforeVisit = await seedLinkedInvoice('unused-source-id', { source: { collection: 'appointments', id: 'billing-prepaid-booking' }, claim: { collection: 'appointments', id: 'billing-prepaid-booking' } });
    await addBillingVisit('billing-after-booking', { appointmentId: 'billing-prepaid-booking' });
    const preBilled = (await visitBilling(['billing-after-booking']))[0];
    check(preBilled.invoices.length === 1 && preBilled.invoices[0].id === billedBeforeVisit.id && !preBilled.canCreateInvoice, 'appointment billed before Visit is linked once by claim and frozen source');
    status(await request(`/api/pos/invoices/${billedBeforeVisit.id}?visitId=billing-after-booking`, 'GET', undefined, 'staffA'), 200, 'pre-Visit appointment invoice opens from related Visit');
    const claimOnly = await seedLinkedInvoice('not-the-claim-source', { claim: { collection: 'visits', id: 'billing-claim' } });
    const claimBilling = (await visitBilling(['billing-claim']))[0];
    check(claimBilling.invoices.length === 1 && claimBilling.invoices[0].id === claimOnly.id && claimBilling.invoices[0].visitLineCents === 0 && !claimBilling.canCreateInvoice, 'retained claim still blocks duplicate billing when a legacy line has no source snapshot');
    const originalBinding = await seedLinkedInvoice('billing-sibling-source', { state: 'draft', source: { collection: 'visits', id: 'other-visit', appointmentId: 'billing-prepaid-booking' } });
    check((await visitBilling(['billing-after-booking']))[0].invoices.some((r: any) => r.id === originalBinding.id), 'frozen linked appointment reference discovers drafts from the same care');
    for (let n = 0; n < 22; n++)
        await seedLinkedInvoice('billing-overflow', { state: n === 0 ? 'posted' : n === 1 ? 'void' : 'draft', cents: n });
    const overflow = (await visitBilling(['billing-overflow']))[0];
    check(overflow.invoices.length === 20 && overflow.hasMoreInvoices && overflow.invoices[0].state === 'posted' && overflow.invoices.slice(1).every((r: any) => r.state === 'draft'), 'billing summary is capped at twenty with posted then draft then void priority');
    check(JSON.stringify((await visitBilling(['billing-overflow']))[0]) === JSON.stringify(overflow), 'bounded invoice ordering is deterministic');
    const overflowHidden = (await pool.query("SELECT id FROM pos_invoices WHERE state='void' AND id IN (SELECT invoice_id FROM pos_invoice_items WHERE snapshot->'source'->>'id'='billing-overflow')")).rows[0].id;
    status(await request(`/api/pos/invoices/${overflowHidden}?visitId=billing-overflow`, 'GET', undefined, 'staffA'), 200, 'direct relation guard does not depend on first twenty summary invoices');
    const incompatibleB = await seedLinkedInvoice('billing-incompatible', { branchId: 'B', cents: 999999 });
    const incompatiblePatient = await seedLinkedInvoice('billing-incompatible', { patientId: 'invoice-other', cents: 888888 });
    const blocked = (await visitBilling(['billing-incompatible']))[0];
    check(blocked.billingUnavailable && !blocked.canCreateInvoice && blocked.invoices.length === 0 && !JSON.stringify(blocked).includes(incompatibleB.id) && !JSON.stringify(blocked).includes(incompatiblePatient.id), 'incompatible historical source billing fails closed without amounts or invoice IDs');
    check((await visitBilling(['billing-incompatible'], 'admin'))[0].billingUnavailable, 'global branch access never makes a different patient or Visit clinic compatible');
    await addBillingVisit('billing-branch-B', { branchId: 'B' });
    for (const actor of ['anonymous', 'doctor', 'noPatients', 'noVisits', 'staffB', 'noBranches'])
        status(await request(visitBillingBase + 'billing-shared', 'GET', undefined, actor), actor === 'anonymous' ? 401 : 403, 'Visit billing requires POS, patient, Visit and branch authority');
    status(await request(visitBillingBase + 'billing-shared,billing-branch-B', 'GET', undefined, 'staffA'), 403, 'mixed authorized/unauthorized Visit page is entirely denied');
    status(await request(visitBillingBase + 'billing-shared,missing-visit', 'GET', undefined, 'staffA'), 404, 'mixed existing/missing Visit page is entirely denied');
    const beforeGuardedRead = db.runTransaction.bind(db);
    let unauthorizedFinancialReads = 0;
    db.runTransaction = callback => beforeGuardedRead(async (tx) => {
        const sql = tx.sql.bind(tx);
        tx.sql = ((query: string, args?: any[]) => { if (/pos_|treatment_ledger_/.test(query)) unauthorizedFinancialReads++; return sql(query, args); }) as any;
        return callback(tx);
    });
    try { status(await request(visitBillingBase + 'billing-shared,billing-branch-B', 'GET', undefined, 'staffA'), 403, 'authorize complete Visit page before financial lookup'); }
    finally { db.runTransaction = beforeGuardedRead; }
    check(unauthorizedFinancialReads === 0, 'mixed-scope rejection executes no financial reads');
    const usageFixture = (await pool.query('SELECT visit_id FROM treatment_ledger_visit_usage LIMIT 1')).rows[0];
    const usedBilling = (await visitBilling([usageFixture.visit_id], 'staffB'))[0];
    check(usedBilling.packageSessionUsed && !usedBilling.canCreateInvoice && !usedBilling.billingUnavailable && usedBilling.invoices.length === 0, 'package session usage is distinct from invoice paid or Free and cannot be billed again');
    const usageVisit = (await db.collection('visits').doc(usageFixture.visit_id).get()).data()!;
    await db.collection('visits').doc(usageFixture.visit_id).update({ branchId: 'A' });
    const inconsistentUsage = (await visitBilling([usageFixture.visit_id]))[0];
    check(inconsistentUsage.packageSessionUsed && inconsistentUsage.billingUnavailable && !inconsistentUsage.canCreateInvoice, 'incompatible retained package Visit binding fails closed');
    await db.collection('visits').doc(usageFixture.visit_id).update({ branchId: usageVisit.branchId });
    await db.collection('patients').doc('billing-archived-patient').set({ name: 'Synthetic retained patient', isArchived: true });
    await addBillingVisit('billing-patient-archived', { patientId: 'billing-archived-patient' });
    check(!(await visitBilling(['billing-patient-archived']))[0].canCreateInvoice, 'archived patients retain readable Visit billing without new billing');
    await db.collection('branches').doc('billing-inactive-branch').set({ branchName: 'Synthetic inactive branch', status: 'Inactive' });
    await addBillingVisit('billing-branch-inactive', { branchId: 'billing-inactive-branch' });
    check(!(await visitBilling(['billing-branch-inactive'], 'admin'))[0].canCreateInvoice, 'inactive clinic preserves history without new billing');
    for (const route of ['/api/pos/visit-billing', visitBillingBase, visitBillingBase + 'billing-open,billing-open', visitBillingBase + 'bad.id', visitBillingBase + 'bad%2Fid', visitBillingBase + 'billing-open,', visitBillingBase + 'billing-open&visitIds=billing-free', visitBillingBase + Array.from({ length: 51 }, (_, n) => 'page-' + n).join(',')])
        status(await request(route, 'GET', undefined, 'staffA'), 400, 'missing, malformed, duplicate and oversized Visit requests rejected');
    for (let n = 0; n < 50; n++) await addBillingVisit('billing-page-' + n);
    check((await visitBilling(Array.from({ length: 50 }, (_, n) => 'billing-page-' + n))).length === 50, 'maximum page of fifty Visits is supported');
    for (const [invoiceId, visitId, actor, expected] of [[shared.id, 'billing-open', 'staffA', 403], [incompatibleB.id, 'billing-incompatible', 'staffA', 403], [incompatiblePatient.id, 'billing-incompatible', 'admin', 403], [shared.id, 'billing-shared', 'staffB', 403], [shared.id, 'billing-shared', 'noVisits', 403], [shared.id, 'missing-visit', 'staffA', 404]] as const)
        status(await request(`/api/pos/invoices/${invoiceId}?visitId=${visitId}`, 'GET', undefined, actor), expected, 'Visit-bound detail rejects unrelated invoice, patient, branch and capability');
    status(await request(`/api/pos/invoices/${shared.id}?visitId=bad.id`, 'GET', undefined, 'staffA'), 400, 'Visit-bound detail validates identifier');
    status(await request(`/api/pos/invoices/${shared.id}?visitId=billing-shared&visitId=billing-open`, 'GET', undefined, 'staffA'), 400, 'Visit-bound detail rejects duplicate identifier parameters');
    const billingFinancialBefore = await financialSnapshot();
    const billingReversalsBefore = (await pool.query('SELECT to_jsonb(r) AS row FROM pos_payment_reversals r ORDER BY id')).rows;
    const billingSourceBefore = (await pool.query("SELECT collection_path,id,data FROM app_records WHERE collection_path IN ('visits','appointments','patients') ORDER BY collection_path,id")).rows;
    const preservedBilling = await visitBilling(['visit', 'historical-quote', 'billing-free', 'billing-missing', 'billing-shared', 'billing-archived']);
    check(preservedBilling[0].invoices.some((r: any) => r.id === v.id && r.visitLineCents === 7000) && preservedBilling[1].invoices.some((r: any) => r.id === frozen.id && r.visitLineCents === 7000), 'billing projection retains Special Price and frozen historical quote after catalogue repricing');
    check(JSON.stringify(await financialSnapshot()) === JSON.stringify(billingFinancialBefore) && JSON.stringify((await pool.query('SELECT to_jsonb(r) AS row FROM pos_payment_reversals r ORDER BY id')).rows) === JSON.stringify(billingReversalsBefore), 'Visit billing projection performs no invoice, payment, reversal, package, balance or history writes');
    check(JSON.stringify((await pool.query("SELECT collection_path,id,data FROM app_records WHERE collection_path IN ('visits','appointments','patients') ORDER BY collection_path,id")).rows) === JSON.stringify(billingSourceBefore), 'Visit billing reads preserve saved quotes, old records and patient data');
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
