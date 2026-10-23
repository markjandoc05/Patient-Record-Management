import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from '../server';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';
import { assertCurrentMigrationChain } from './platform-test-support';

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const origin = new URL(process.env.APP_URL || 'https://invalid').origin;
const storage = path.resolve(process.env.STORAGE_DIR || '/');
if (target.hostname !== '127.0.0.1' || target.pathname !== '/vine_pos_corrections_test'
    || process.env.ALLOW_TEST_DATABASE !== 'yes' || process.env.NODE_ENV !== 'production'
    || !new URL(origin).hostname.endsWith('.invalid')
    || ![tmpdir(), '/private/tmp', '/tmp'].some(root => storage.startsWith(path.resolve(root) + path.sep))) {
    throw Error('Use empty disposable loopback vine_pos_corrections_test, production middleware, .invalid APP_URL and temporary STORAGE_DIR');
}
let server: ReturnType<typeof app.listen> | undefined, checks = 0, visitSlot = 0;
const sessions = new Map<string, { cookie: string; csrf: string }>();
const command = () => randomUUID();
const check = (value: unknown, label: string) => { assert.ok(value, label); checks++; };
async function request(route: string, method = 'GET', body?: any, actor = 'admin', extra: Record<string, string> = {}) {
    const auth = sessions.get(actor);
    const response = await fetch(`http://127.0.0.1:${(server!.address() as any).port}${route}`, {
        method, headers: { Origin: origin, 'Content-Type': 'application/json',
            ...(auth ? { Cookie: auth.cookie, Authorization: `Bearer ${auth.csrf}` } : {}), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
}
function status(result: { status: number; body: any }, expected: number, label: string) {
    check(result.status === expected, `${label}: expected ${expected}, got ${result.status}: ${JSON.stringify(result.body)?.slice(0, 500)}`);
    return result.body;
}
const detail = async (id: string, actor = 'admin') => status(await request(`/api/pos/invoices/${id}`, 'GET', undefined, actor), 200, 'invoice detail');
const post = async (invoice: any) => status(await request(`/api/pos/invoices/${invoice.id}/post`, 'POST', { commandId: command(), expectedVersion: invoice.version }, 'staffA'), 200, 'post');
const pay = async (invoice: any, amount: string, method = 'cash', reference = '') => status(await request(`/api/pos/invoices/${invoice.id}/payments`, 'POST', {
    commandId: command(), expectedVersion: invoice.version, amount, tender: amount, method, reference,
}, 'staffA'), 200, 'payment');
const reversalPath = (invoice: any, paymentId = invoice.payments.at(-1).id) => `/api/pos/invoices/${invoice.id}/payments/${paymentId}/reversal`;
const reversalBody = (invoice: any, reason = 'Synthetic wrong payment entry') => ({ commandId: command(), expectedVersion: invoice.version, reason });
const reverse = async (invoice: any, paymentId?: string) => status(await request(reversalPath(invoice, paymentId), 'POST', reversalBody(invoice)), 200, 'reverse payment entry');
async function snapshot(table: string, where = '', values: any[] = []) {
    return JSON.stringify((await pool.query(`SELECT to_jsonb(r) AS row FROM ${table} r ${where} ORDER BY to_jsonb(r)::text`, values)).rows);
}
async function waitForLock(pid: number) {
    for (let n = 0; n < 100; n++) {
        const activity = (await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
        if (activity?.wait_event_type === 'Lock') { checks++; return; }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('competing transaction must wait on invoice serialization');
}
try {
    check((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count === '0', 'empty database guard');
    await migrateDatabase(); await migrateDatabase(); check(await assertCurrentMigrationChain(), 'complete migration checksums');
    for (const id of ['A', 'B']) await db.collection('branches').doc(id).set({ branchName: 'Synthetic ' + id, status: 'Active' });
    const actors: Record<string, any> = {
        admin: { role: 'admin' }, adminDenied: { role: 'admin', permissionOverrides: { 'pos.adjust': 'deny' } },
        staffA: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['A'] },
        staffB: { role: 'staff', staffDesignation: 'Nurse', assignedBranches: ['B'] },
        manager: { role: 'manager', assignedBranches: ['A'], permissionOverrides: { 'pos.adjust': 'allow' } },
        doctor: { role: 'doctor', assignedBranches: ['A'], permissionOverrides: { 'pos.view': 'allow', 'pos.adjust': 'allow' } },
    };
    for (const [id, fields] of Object.entries(actors)) {
        await db.collection('users').doc(id).set({ active: true, fullName: 'Synthetic ' + id, ...fields });
        const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
        await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [id, id + '@example.invalid']);
        await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id, csrf]);
        sessions.set(id, { cookie: `__Host-vine_session=${token}`, csrf });
    }
    await db.collection('patients').doc('patient').set({ name: 'Synthetic correction patient', patientID: 'QA-CORRECTION', oldHistory: 'Retain history' });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const service = status(await request('/api/services', 'POST', { id: randomUUID(), name: 'Synthetic correction Service', description: '', defaultDurationMinutes: 30,
        standardPrice: { mode: 'priced', amount: '100.00' }, branchSettings: ['A', 'B'].map(branchId => ({ branchId, available: true, price: { mode: 'inherit' } })) }), 201, 'service');
    const serviceItem = { kind: 'service', id: service.id, expectedVersion: service.version };
    const draft = async (items: any[] = [serviceItem]) => status(await request('/api/pos/invoices', 'POST', { commandId: command(), expectedVersion: 0, patientId: 'patient', branchId: 'A', notes: 'Keep frozen invoice notes', items }, 'staffA'), 200, 'draft');
    const sourceQuote = { version: 1, currency: 'PHP', branchId: 'A', serviceId: service.id, serviceCatalogueVersion: service.version, servicePrice: '100.00', specialPrice: '70.00', total: '70.00', source: 'special', quotedAt: '2030-01-01', quotedByUid: 'staffA', quotedByName: 'Synthetic staff' };
    await db.collection('appointments').doc('booking').set({ patientId: 'patient', branchId: 'A', serviceId: service.id, serviceCatalogueVersion: service.version,
        serviceNameSnapshot: service.name, bookingQuote: sourceQuote, bookingPricingRevision: 1, notes: 'Historical quote notes' });
    const quoteBefore = await snapshot('app_records', "WHERE collection_path IN ('patients','appointments','visits')");
    let invoice = await post(await draft([{ kind: 'appointment', id: 'booking', expectedVersion: 1 }]));
    invoice = await pay(invoice, '20'); invoice = await pay(invoice, '50', 'gcash', 'SYNTHETIC-ORIGINAL-REF');
    const originalPayments = await snapshot('pos_payments', 'WHERE invoice_id=$1', [invoice.id]);
    const originalTerms = await snapshot('pos_invoice_items', 'WHERE invoice_id=$1', [invoice.id]);
    const route = reversalPath(invoice), body = reversalBody(invoice);
    for (const actor of ['anonymous', 'staffA', 'staffB', 'manager', 'doctor', 'adminDenied'])
        status(await request(route, 'POST', body, actor), actor === 'anonymous' ? 401 : 403, 'current correction authority ' + actor);
    status(await request(route, 'POST', body, 'admin', { Origin: 'https://wrong.invalid' }), 403, 'correction origin guard');
    status(await request(route, 'POST', body, 'admin', { Authorization: 'Bearer wrong' }), 403, 'correction CSRF guard');
    for (const reason of ['', '   ', 'a'.repeat(1001)]) status(await request(route, 'POST', { ...body, reason }), 400, 'required bounded reason');
    status(await request(route, 'POST', { ...body, amount: '1.00' }), 400, 'cannot partially reverse or supply amount');
    const other = await pay(await post(await draft()), '100');
    status(await request(reversalPath(other, invoice.payments[1].id), 'POST', reversalBody(other)), 404, 'payment must belong to target invoice');
    const stale = { ...body, expectedVersion: invoice.version - 1 };
    status(await request(route, 'POST', stale), 409, 'stale correction denied');
    invoice = status(await request(route, 'POST', body), 200, 'partial original allocation reversed');
    check(invoice.paid_cents === 2000 && invoice.outstanding_cents === 5000 && invoice.total_cents === 7000, 'net balance reopens without changing quote');
    const correctedPayment = invoice.payments.find((p: any) => p.reversal);
    check(correctedPayment.amount_cents === '5000' && correctedPayment.reference === 'SYNTHETIC-ORIGINAL-REF'
        && correctedPayment.reversal.reason === body.reason && correctedPayment.reversal.actor.uid === 'admin'
        && Number.isFinite(Date.parse(correctedPayment.reversal.recorded_at)), 'original acknowledgment and attributed reversal retained');
    const replayed = status(await request(route, 'POST', body), 200, 'identical reversal retry');
    check(replayed.version === invoice.version && replayed.payments.filter((p: any) => p.reversal).length === 1, 'retry is one correction and one invoice revision');
    status(await request(route, 'POST', { ...body, reason: 'Changed content' }), 409, 'changed retry rejected');
    status(await request(route, 'POST', reversalBody(invoice)), 409, 'second reversal command rejected');
    await db.collection('users').doc('admin').update({ permissionOverrides: { 'pos.adjust': 'deny' } });
    status(await request(route, 'POST', body), 403, 'revoked authority checked before replay');
    await db.collection('users').doc('admin').update({ permissionOverrides: {} });
    check(await snapshot('pos_payments', 'WHERE invoice_id=$1', [invoice.id]) === originalPayments, 'original payment rows never edited');
    check(await snapshot('pos_invoice_items', 'WHERE invoice_id=$1', [invoice.id]) === originalTerms, 'frozen quoted items retained');
    check(await snapshot('app_records', "WHERE collection_path IN ('patients','appointments','visits')") === quoteBefore, 'correction preserves patient history and saved quotes byte-for-byte');
    const lookup = status(await request('/api/pos/invoices?patientId=patient&status=partial&q=SYNTHETIC-ORIGINAL-REF', 'GET', undefined, 'staffA'), 200, 'corrected lookup');
    check(lookup.total === 1 && lookup.invoices[0].id === invoice.id && lookup.invoices[0].paid_cents === 2000 && lookup.invoices[0].outstanding_cents === 5000, 'net statuses and original reference search');
    check(lookup.summary.paidCents === 12000 && lookup.summary.outstandingCents === 5000, 'patient totals use net payment history');
    status(await request(`/api/pos/invoices/${invoice.id}`, 'GET', undefined, 'staffB'), 403, 'corrected history retains branch boundary');
    const hidden = status(await request('/api/pos/invoices?patientId=patient', 'GET', undefined, 'staffB'), 200, 'other clinic patient billing');
    check(hidden.total === 0 && hidden.summary.paidCents === 0, 'other clinic sees no correction or balance');
    const replacementAttempts = await Promise.all([1, 2].map(() => request(`/api/pos/invoices/${invoice.id}/payments`, 'POST', {
        commandId: command(), expectedVersion: invoice.version, amount: '50', tender: '60', method: 'cash', reference: 'SYNTHETIC-REPLACEMENT',
    }, 'staffA')));
    check(replacementAttempts.filter(r => r.status === 200).length === 1 && replacementAttempts.filter(r => r.status === 409).length === 1, 'concurrent replacement does not overpay');
    invoice = await detail(invoice.id); check(invoice.paid_cents === 7000 && invoice.outstanding_cents === 0, 'replacement restores paid balance');
    // Every original allocation can be reversed once, with no destructive void of its history.
    for (const p of invoice.payments.filter((p: any) => !p.reversal)) invoice = await reverse(invoice, p.id);
    check(invoice.paid_cents === 0 && invoice.outstanding_cents === 7000, 'fully reversed invoice is unpaid');
    status(await request(`/api/pos/invoices/${invoice.id}/void`, 'POST', { commandId: command(), expectedVersion: invoice.version, reason: 'Keep payment history' }), 409, 'payment history still prevents void');
    const unpaid = status(await request('/api/pos/invoices?patientId=patient&status=unpaid', 'GET', undefined, 'staffA'), 200, 'unpaid filter');
    check(unpaid.invoices.some((r: any) => r.id === invoice.id), 'fully reversed invoice appears unpaid');
    const reversedId = correctedPayment.reversal.id;
    await assert.rejects(pool.query('UPDATE pos_payment_reversals SET reason=$2 WHERE id=$1', [reversedId, 'Rewrite']), /immutable/); checks++;
    await assert.rejects(pool.query('DELETE FROM pos_payment_reversals WHERE id=$1', [reversedId]), /immutable/); checks++;
    // Corrections are signed movements on correction date; old collection periods stay intact.
    let dated = await post(await draft());
    await pool.query("INSERT INTO pos_payments(id,invoice_id,amount_cents,tender_cents,method,reference,actor,recorded_at) VALUES($1,$2,10000,10000,'bank','SYNTHETIC-OLD-DATE',$3::jsonb,'2000-01-01T16:00:00Z')", [command(), dated.id, JSON.stringify({ uid: 'staffA', name: 'Synthetic staff' })]);
    dated = await detail(dated.id);
    const oldSalesPath = '/api/pos/sales?branchId=A&from=2000-01-02&to=2000-01-02';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const todayPath = `/api/pos/sales?branchId=A&from=${today}&to=${today}`;
    const oldSales = status(await request(oldSalesPath), 200, 'old collections'), salesBefore = status(await request(todayPath), 200, 'today before correction');
    dated = await reverse(dated);
    const oldAfter = status(await request(oldSalesPath), 200, 'old collections after correction'), salesAfter = status(await request(todayPath), 200, 'today after correction');
    check(oldAfter.totals.collected === oldSales.totals.collected && oldAfter.totals.collected === 10000, 'original collection period is not rewritten');
    check(salesAfter.totals.collected === salesBefore.totals.collected - 10000 && salesAfter.totals.reversed === salesBefore.totals.reversed + 10000
        && salesAfter.totals.received === salesBefore.totals.received && salesAfter.totals.sales === salesBefore.totals.sales, 'correction date reduces net collections, not invoiced sales');
    check(salesAfter.totals.outstanding === salesBefore.totals.outstanding + 10000, 'sales outstanding uses corrected allocations');
    const managerSales = status(await request(todayPath, 'GET', undefined, 'manager'), 200, 'Manager financial reads');
    check(managerSales.branches.length === 1 && managerSales.branches[0].id === 'A', 'sales correction totals stay branch scoped');
    status(await request('/api/pos/sales?branchId=B&from=2000-01-01&to=2040-01-01', 'GET', undefined, 'manager'), 403, 'sales other branch denied');
    status(await request(todayPath, 'GET', undefined, 'staffA'), 403, 'Staff cannot read clinic financial totals');
    // Package balances remain facts; only funding usability changes for unused packages.
    const pkg = status(await request('/api/packages', 'POST', { id: command(), commandId: command(), expectedVersion: 0, name: 'Synthetic correction package', description: '', active: true,
        lines: [{ serviceId: service.id, expectedServiceVersion: service.version, sessions: 3 }] }), 201, 'package');
    async function fundedPackage() {
        const paid = await pay(await post(await draft([{ kind: 'package', id: pkg.id, expectedVersion: pkg.version, amount: '100' }])), '100');
        const linked = (await pool.query('SELECT p.purchase_id,l.id AS line_id FROM pos_package_purchases p JOIN pos_invoice_items i ON i.id=p.item_id JOIN treatment_ledger_lines l ON l.purchase_id=p.purchase_id WHERE i.invoice_id=$1', [paid.id])).rows[0];
        return { invoice: paid, ...linked };
    }
    const usable = async (id: string) => (await pool.query('SELECT pos_purchase_usable($1) AS usable', [id])).rows[0].usable;
    const unused = await fundedPackage();
    const purchaseBefore = await snapshot('treatment_ledger_purchases', 'WHERE id=$1', [unused.purchase_id]);
    const linesBefore = await snapshot('treatment_ledger_lines', 'WHERE purchase_id=$1', [unused.purchase_id]);
    unused.invoice = await reverse(unused.invoice);
    check(await usable(unused.purchase_id) === false, 'correction relocks unused package');
    check(await snapshot('treatment_ledger_purchases', 'WHERE id=$1', [unused.purchase_id]) === purchaseBefore
        && await snapshot('treatment_ledger_lines', 'WHERE purchase_id=$1', [unused.purchase_id]) === linesBefore, 'correction preserves purchased sessions and package metadata');
    status(await request(`/api/records/patients/patient/treatment-ledger/lines/${unused.line_id}/adjustments`, 'POST', {
        commandId: command(), expectedLineVersion: 1, delta: 1, reason: 'Synthetic locked adjustment',
    }), 409, 'unfunded package adjustment denied');
    unused.invoice = await pay(unused.invoice, '100'); check(await usable(unused.purchase_id) === true, 'replacement reopens same package');
    const used = await fundedPackage();
    const visitPayload = { clientVisitId: command(), patientId: 'patient', branchId: 'B', doctorId: null, performedByUserId: 'staffB', visitType: 'Treatment Session',
        visitDate: '2037-02-02T10:00', notes: 'Synthetic used package', serviceSelection: { serviceId: service.id, expectedVersion: service.version },
        sessionUsage: { commandId: command(), lineId: used.line_id, sessions: 1, expectedLineVersion: 1, expectedUsageVersion: 0 } };
    status(await request('/api/records/visits', 'POST', visitPayload, 'staffB'), 201, 'funded package used at another authorized branch');
    const usedHistory = await snapshot('treatment_ledger_events', 'WHERE purchase_id=$1', [used.purchase_id]);
    status(await request(reversalPath(used.invoice), 'POST', reversalBody(used.invoice)), 409, 'used package protects funding');
    check(await usable(used.purchase_id) === true && await snapshot('treatment_ledger_events', 'WHERE purchase_id=$1', [used.purchase_id]) === usedHistory, 'denial preserves funded usage history');
    const adjusted = await fundedPackage();
    status(await request(`/api/records/patients/patient/treatment-ledger/lines/${adjusted.line_id}/adjustments`, 'POST', {
        commandId: command(), expectedLineVersion: 1, delta: 1, reason: 'Synthetic extra session',
    }), 200, 'funded package adjustment');
    status(await request(reversalPath(adjusted.invoice), 'POST', reversalBody(adjusted.invoice)), 409, 'adjusted package protects funding');
    // DB guards must serialize even outside the API's advisory transaction lock.
    const insertReversal = (client: any, pack: any) => client.query('INSERT INTO pos_payment_reversals(id,payment_id,command_id,reason,actor) VALUES($1,$2,$3,$4,$5::jsonb)', [command(), pack.invoice.payments[0].id, command(), 'Synthetic direct SQL correction', JSON.stringify({ uid: 'admin' })]);
    const insertUsage = async (client: any, pack: any, type: 'usage' | 'adjustment') => {
        const id = command(), visitId = 'sql-correction-' + (++visitSlot);
        if (type === 'usage') await client.query("INSERT INTO app_records(collection_path,id,data) VALUES('visits',$1,'{}')", [visitId]);
        return client.query(`INSERT INTO treatment_ledger_events(id,command_id,request_hash,type,purchase_id,line_id,visit_id,branch_id,sessions_delta,used_delta,treatment_date,actor,reason,visit_snapshot,balance_after)
            VALUES($1,$2,$3,$4,$5,$6,$7,'A',$8,$9,'2037-02-02T12:00','{"uid":"admin"}',$10,$11::jsonb,$12::jsonb)`,
            [id, command(), 'a'.repeat(64), type, pack.purchase_id, pack.line_id, type === 'usage' ? visitId : null,
                type === 'adjustment' ? 1 : 0, type === 'usage' ? 1 : 0, type === 'adjustment' ? 'Synthetic adjustment' : null,
                type === 'usage' ? '{}' : null, JSON.stringify({ purchasedSessions: 3, adjustmentSessions: type === 'adjustment' ? 1 : 0, usedSessions: type === 'usage' ? 1 : 0, remainingSessions: type === 'usage' ? 2 : 4 })]);
    };
    for (const type of ['usage', 'adjustment'] as const) for (const correctionFirst of [false, true]) {
        const pack = await fundedPackage(), a = await pool.connect(), b = await pool.connect();
        try {
            await a.query('BEGIN'); await b.query('BEGIN');
            await a.query("SET LOCAL statement_timeout='5s'"); await b.query("SET LOCAL statement_timeout='5s'");
            const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            if (correctionFirst) await insertReversal(a, pack); else await insertUsage(a, pack, type);
            const blocked = (correctionFirst ? insertUsage(b, pack, type) : insertReversal(b, pack)).then(() => ({ error: null }), error => ({ error }));
            await waitForLock(pid); await a.query('COMMIT');
            const result = await blocked;
            check(result.error?.code === '23514', `${type} vs correction ${correctionFirst ? 'correction' : 'session'} first rechecks after waiting`);
            await b.query('ROLLBACK');
            check(await usable(pack.purchase_id) === !correctionFirst, 'concurrent funding history remains consistent');
        } finally { await a.query('ROLLBACK'); await b.query('ROLLBACK'); a.release(); b.release(); }
    }
    // Audit rejection must roll back the correction, its event and the invoice revision together.
    const auditInvoice = await pay(await post(await draft()), '100');
    const auditBefore = await detail(auditInvoice.id), originalTx = db.runTransaction.bind(db);
    db.runTransaction = callback => originalTx(async tx => { const create = tx.create.bind(tx); tx.create = ((ref: any, data: any) => {
        if (ref.collectionPath === 'audit_logs') throw Error('Synthetic correction audit failure'); return create(ref, data);
    }) as any; return callback(tx); });
    try { status(await request(reversalPath(auditInvoice), 'POST', reversalBody(auditInvoice)), 503, 'audit failure surfaced'); }
    finally { db.runTransaction = originalTx; }
    check(JSON.stringify(await detail(auditInvoice.id)) === JSON.stringify(auditBefore), 'audit failure leaves financial history and version unchanged');
    // No canonical price, old note or saved quote is changed by correction operations.
    const bookingBefore = JSON.parse(quoteBefore).filter((r: any) => r.row.collection_path === 'appointments');
    const bookingAfter = JSON.parse(await snapshot('app_records', "WHERE collection_path='appointments'"));
    check(JSON.stringify(bookingAfter) === JSON.stringify(bookingBefore), 'saved Special Price quote preserved throughout package usage');
    check((await db.collection('patients').doc('patient').get()).data()?.oldHistory === 'Retain history', 'clinical history retained through ordinary Visit summary updates');
    check((await pool.query('SELECT version,standard_price::text FROM services WHERE id=$1', [service.id])).rows[0].standard_price === '100.00', 'Service price unchanged');
    console.log(`POS corrections API: ${checks} checks passed (net balances, immutable history, authorization, packages, correction dates and two-connection races)`);
} finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await pool.end();
}
