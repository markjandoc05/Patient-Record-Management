import { assertCurrentMigrationChain } from './platform-test-support';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { app } from '../server';
import { appointmentPricingRevision } from '../src/utils/appointmentSpecialPrice';
import { db, pool } from '../backend/database';
import { migrateDatabase } from './migrate-database';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_appointment_services_test'
  || process.env.ALLOW_TEST_DATABASE !== 'yes' || !process.env.STORAGE_DIR) throw Error('Disposable loopback vine_appointment_services_test and temporary storage required');
const origin = new URL(process.env.APP_URL!).origin;
const credentials = new Map<string, { cookie: string; csrf: string }>();
let server: ReturnType<typeof app.listen>, checks = 0;
const check = (value: any, message: string) => { assert.ok(value, message); checks++; };
async function request(path: string, method = 'GET', body?: any, role = 'admin', headers: any = {}) {
  const c = credentials.get(role);
  const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}${path}`, { method,
    headers: { Origin: origin, ...(c ? { Cookie: c.cookie, Authorization: `Bearer ${c.csrf}` } : {}), 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const read = async (id: string) => (await db.collection('appointments').doc(id).get()).data()!;
// Existing happy-path edits start from a current server snapshot. Race tests below
// use request directly with the revision captured by each independent form.
async function patchPricing(id: string, body: any, role = 'admin', headers: any = {}) {
  const precondition = body.specialPrice === undefined ? {}
    : { expectedPricingRevision: appointmentPricingRevision(await read(id)) };
  return request('/api/records/appointments/' + id, 'PATCH', { ...body, ...precondition }, role, headers);
}
const snapshot = (record: any) => Object.fromEntries(['serviceId', 'serviceNameSnapshot', 'serviceDurationMinutesSnapshot', 'serviceCatalogueVersion'].map(field => [field, record[field]]));
let minute = 0;
const booking = (extra = {}, branchId = 'A') => {
  const slot = minute++;
  return { patientId: 'patient', doctorId: 'provider', branchId,
    appointmentDate: `${2029 + Math.floor(slot / 19)}-01-01T${String(10 + Math.floor((slot % 19) / 2)).padStart(2, '0')}:${slot % 19 % 2 ? '30' : '00'}`,
    visitType: 'Initial Consultation', status: 'Scheduled', mainConcern: '', notes: '', ...extra };
};
const selection = (service: any) => ({ serviceSelection: { serviceId: service.id, expectedVersion: service.version } });
async function createService(name: string, price: any = { mode: 'priced', amount: '100' }, settings = [{ branchId: 'A', available: true, price: { mode: 'inherit' } }, { branchId: 'B', available: true, price: { mode: 'priced', amount: '987.65' } }]) {
  const result = await request('/api/services', 'POST', { id: randomUUID(), name, defaultDurationMinutes: 45, standardPrice: price, branchSettings: settings });
  check(result.status === 201, 'create synthetic catalogue Service'); return result.body;
}
async function editService(service: any, changes: any) {
  const result = await request('/api/services/' + service.id, 'PATCH', { expectedVersion: service.version, ...changes });
  check(result.status === 200, 'edit synthetic catalogue Service'); return result.body;
}
try {
  // Production's known 002 -> local 004 release gap, retaining legacy JSONB.
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const name of ['001_platform.sql', '002_session_integrity.sql']) {
    const sql = await readFile('migrations/' + name, 'utf8'); await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, createHash('sha256').update(sql).digest('hex')]);
  }
  await db.collection('appointments').doc('legacy').set({ branchId: 'A', visitType: 'Follow-up', notes: '  retained historical text  ' });
  const before = JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path='appointments'")).rows);
  await migrateDatabase(); await migrateDatabase();
  check(before === JSON.stringify((await pool.query("SELECT * FROM app_records WHERE collection_path='appointments'")).rows), '002 -> 004 preserves legacy values and timestamps');
  check(await assertCurrentMigrationChain(), 'same current immutable migration chain');
  for (const role of ['admin', 'support_developer', 'manager', 'doctor', 'staff', 'inactive']) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await db.collection('users').doc(role).set({ role: role === 'inactive' ? 'staff' : role, active: role !== 'inactive', assignedBranches: ['A'], fullName: 'Synthetic ' + role });
    await pool.query('INSERT INTO auth_identities(google_subject,user_id,email) VALUES($1,$1,$2)', [role, role + '@example.invalid']);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), role, csrf]);
    credentials.set(role, { cookie: `${origin.startsWith('https') ? '__Host-' : ''}vine_session=${token}`, csrf });
  }
  for (const [id, status] of [['A', 'Active'], ['B', 'Active'], ['C', 'Inactive']]) await db.collection('branches').doc(id).set({ branchName: 'Synthetic ' + id, status });
  await db.collection('users').doc('provider').set({ role: 'doctor', active: true, assignedBranches: ['A', 'B', 'C'] });
  await db.collection('patients').doc('patient').set({ name: 'Synthetic patient', patientID: 'SYNTHETIC', isArchived: false });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  let service = await createService('Appointment reference');
  const payload = booking(selection(service));
  const created = await request('/api/records/appointments', 'POST', payload);
  check(created.status === 201, 'priced Service booking'); const id = created.body.id;
  check(JSON.stringify(snapshot(await read(id))) === JSON.stringify({ serviceId: service.id, serviceNameSnapshot: service.name, serviceDurationMinutesSnapshot: 45, serviceCatalogueVersion: 1 }), 'authoritative four fields');
  check(!(await read(id)).serviceSelection && !Object.hasOwn(await read(id), 'chargedPrice')
    && (await read(id)).bookingQuote.total === '100.00'
    && !JSON.stringify(await read(id)).includes('987.65'), 'authoritative booking quote stores selected branch price without a charge or command');
  check((await read(id)).visitType === payload.visitType && (await read(id)).doctorId === 'provider', 'visit type and provider unchanged');
  const original = JSON.stringify(snapshot(await read(id)));
  service = await editService(service, { name: 'Renamed current Service', defaultDurationMinutes: 90, active: false });
  check((await request('/api/records/appointments/' + id, 'PATCH', { ...payload, serviceSelection: undefined, notes: 'Edited notes' })).status === 200, 'unrelated edit retains inactive historical Service');
  check(JSON.stringify(snapshot(await read(id))) === original, 'name duration version are never silently refreshed');
  check((await request('/api/records/appointments', 'POST', booking(selection(service)))).status === 400, 'inactive new selection denied');
  const staleVersion = await request('/api/records/appointments', 'POST', booking({ serviceSelection: { serviceId: service.id, expectedVersion: 1 } }));
  check(staleVersion.status === 409, 'stale catalogue version denied');
  check(staleVersion.body.code === 'SERVICE_VERSION_CHANGED', 'Service version denial is distinguishable from appointment conflicts');
  check((await request('/api/records/appointments/' + id, 'PATCH', { ...payload, serviceSelection: undefined, branchId: 'B' })).status === 409, 'branch change cannot implicitly retain snapshot');
  check(JSON.stringify(snapshot(await read(id))) === original && (await read(id)).branchId === 'A', 'failed branch write atomic');
  service = await editService(service, { active: true });
  check((await request('/api/records/appointments/' + id, 'PATCH', { ...payload, ...selection(service), branchId: 'B' })).status === 200, 'explicit eligible branch re-selection');
  check((await read(id)).serviceCatalogueVersion === service.version && (await read(id)).serviceDurationMinutesSnapshot === 90, 'explicit re-selection replaces authoritative snapshot');
  service = await editService(service, { branchSettings: [{ branchId: 'B', available: false, price: { mode: 'inherit' } }] });
  const changedPayload = { ...payload, branchId: 'B', serviceSelection: undefined };
  check((await request('/api/records/appointments/' + id, 'PATCH', changedPayload)).status === 200, 'unavailable historical selection retained');
  check((await request('/api/records/appointments', 'POST', booking(selection(service), 'B'))).status === 400, 'unavailable new selection denied');
  check((await request('/api/records/appointments/' + id, 'PATCH', { ...changedPayload, branchId: 'A', serviceSelection: null })).status === 200, 'explicit clear allows branch change');
  check(Object.values(snapshot(await read(id))).every(value => value === null), 'explicit removal clears all four fields');
  const free = await createService('Free appointment Service', { mode: 'free' });
  check((await request('/api/records/appointments', 'POST', booking(selection(free)))).status === 201, 'explicit Free is eligible');
  const unpriced = await createService('Unconfigured appointment Service', { mode: 'unpriced' });
  check((await request('/api/records/appointments', 'POST', booking(selection(unpriced)))).status === 400, 'inherited unconfigured price denied');
  check((await request('/api/records/appointments', 'POST', booking(selection(unpriced), 'B'))).status === 201, 'branch configured price makes unpriced standard eligible');
  const overrideFree = await editService(unpriced, { branchSettings: [{ branchId: 'A', available: true, price: { mode: 'free' } }] });
  check((await request('/api/records/appointments', 'POST', booking(selection(overrideFree)))).status === 201, 'branch Free override eligible');
  for (const body of [{ serviceSelection: {} }, { serviceSelection: { serviceId: free.id } }, { serviceSelection: { serviceId: free.id, expectedVersion: '1' } }, { serviceSelection: { serviceId: 'invalid', expectedVersion: 1 } }, { serviceSelection: { serviceId: free.id, expectedVersion: 1, price: '1' } }]) check((await request('/api/records/appointments', 'POST', booking(body))).status === 400, 'invalid selection rejected');
  for (const field of ['serviceId', 'serviceNameSnapshot', 'serviceDurationMinutesSnapshot', 'serviceCatalogueVersion']) {
    check((await request('/api/records/appointments', 'POST', booking({ [field]: 'forged' }))).status === 400, 'create rejects forged ' + field);
    check((await request('/api/records/appointments/' + id, 'PATCH', { ...payload, serviceSelection: undefined, [field]: null })).status === 400, 'edit rejects forged ' + field);
  }
  check((await request('/api/records/appointments', 'POST', booking({ serviceSelection: { serviceId: randomUUID(), expectedVersion: 1 } }))).status === 400, 'missing Service denied');
  check((await request('/api/records/appointments', 'POST', booking(selection(free), 'C'))).status === 400, 'inactive branch denied');
  const legacyBooking = booking(); const legacyCreate = await request('/api/records/appointments', 'POST', legacyBooking);
  check(legacyCreate.status === 201 && !Object.hasOwn(await read(legacyCreate.body.id), 'serviceId'), 'legacy create has no snapshot fields');
  check(!Object.keys(await read(legacyCreate.body.id)).some(field => field.startsWith('specialPrice')), 'ordinary legacy booking gains no quote fields');
  check((await read(legacyCreate.body.id)).bookingQuote.source === 'unset' && (await read(legacyCreate.body.id)).bookingQuote.total === null, 'new unpriced optional-Service booking has an explicit unset summary');
  check((await request('/api/records/appointments/' + legacyCreate.body.id, 'PATCH', { ...legacyBooking, branchId: 'B' })).status === 200, 'legacy branch change unaffected');
  // Special Price is an advisory booking quote, never a catalogue write or payment.
  const quoteService = await createService('Special Price reference');
  const cataloguePrices = async () => JSON.stringify([
    (await pool.query('SELECT id,standard_price FROM services ORDER BY id')).rows,
    (await pool.query('SELECT service_id,branch_id,available,price_override FROM service_branch_settings ORDER BY service_id,branch_id')).rows,
  ]);
  const catalogueBeforeQuotes = await cataloguePrices();
  const quoteFields = (record: any) => Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith('specialPrice')));
  const quotePayload = booking({ ...selection(quoteService), specialPrice: ' 60.5 ' });
  const quoted = await request('/api/records/appointments', 'POST', quotePayload, 'staff');
  check(quoted.status === 201, 'authorized Staff can create a Special Price booking');
  const quoteId = quoted.body.id, quoteRecord = await read(quoteId);
  check(quoteRecord.specialPrice === '60.50', 'Special Price normalized to exact two-decimal string');
  check(quoteRecord.bookingQuote.servicePrice === '100.00' && quoteRecord.bookingQuote.specialPrice === '60.50'
    && quoteRecord.bookingQuote.total === '60.50' && quoteRecord.bookingQuote.source === 'special', 'Special Price replaces catalogue amount instead of adding to it');
  check(quoteRecord.specialPriceUpdatedByUid === 'staff' && quoteRecord.specialPriceUpdatedByName === 'Synthetic staff'
    && Number.isFinite(Date.parse(quoteRecord.specialPriceUpdatedAt)), 'quote attribution comes from authenticated server context');
  check(!['invoiceId', 'paymentId', 'chargedPrice'].some(field => Object.hasOwn(quoteRecord, field)), 'booking quote creates no billing fields');
  const originalQuote = JSON.stringify(quoteFields(quoteRecord));
  check((await patchPricing(quoteId, { ...quotePayload, specialPrice: undefined }, 'staff')).status === 200, 'omitted quote retains saved amount');
  check(JSON.stringify(quoteFields(await read(quoteId))) === originalQuote, 'omission preserves quote amount and attribution exactly');
  check((await patchPricing(quoteId, { ...quotePayload, specialPrice: '60.50' }, 'admin')).status === 200, 'same normalized quote remains editable');
  check(JSON.stringify(quoteFields(await read(quoteId))) === originalQuote, 'unchanged quote does not acquire new attribution');
  check((await patchPricing(quoteId, { ...quotePayload, specialPrice: '0' }, 'staff')).status === 200, 'zero is an explicit valid Special Price');
  check((await read(quoteId)).specialPrice === '0.00', 'zero stored as an exact amount, not missing');
  for (const value of ['-1', '1.001', '1e2', '1,000', '10000000000', 10, false, {}, []]) {
    check((await request('/api/records/appointments', 'POST', booking({ specialPrice: value }))).status === 400, 'invalid new quote rejected: ' + JSON.stringify(value));
    check((await patchPricing(quoteId, { ...quotePayload, specialPrice: value })).status === 400, 'invalid edit quote rejected: ' + JSON.stringify(value));
  }
  check((await read(quoteId)).specialPrice === '0.00', 'invalid quote edits preserve saved amount');
  const largest = await request('/api/records/appointments', 'POST', booking({ specialPrice: '9999999999.99' }));
  check(largest.status === 201 && (await read(largest.body.id)).specialPrice === '9999999999.99', 'existing Services money bounds supported without numeric rounding');
  check((await read(largest.body.id)).bookingQuote.total === '9999999999.99', 'maximum Special Price summary keeps exact decimal amount');
  const freeQuote = await request('/api/records/appointments', 'POST', booking({ specialPrice: '0' }), 'staff');
  check(freeQuote.status === 201 && (await read(freeQuote.body.id)).specialPrice === '0.00', 'explicit Free quote works during booking creation');
  check((await read(freeQuote.body.id)).bookingQuote.total === '0.00' && (await read(freeQuote.body.id)).bookingQuote.source === 'special', 'zero Special Price summary is Free rather than unset');
  for (const field of ['specialPriceUpdatedAt', 'specialPriceUpdatedByUid', 'specialPriceUpdatedByName']) {
    check((await request('/api/records/appointments', 'POST', booking({ specialPrice: '1', [field]: 'forged' }))).status === 400, 'create rejects forged quote attribution: ' + field);
    check((await patchPricing(quoteId, { ...quotePayload, [field]: null })).status === 400, 'edit rejects forged quote attribution: ' + field);
  }
  const branchReview = await patchPricing(quoteId, { ...quotePayload, specialPrice: undefined, branchId: 'B' });
  check(branchReview.status === 409 && branchReview.body.code === 'SPECIAL_PRICE_REVIEW_REQUIRED', 'branch change cannot silently carry even a zero quote');
  check((await read(quoteId)).branchId === 'A', 'failed quote review leaves branch unchanged');
  check((await patchPricing(quoteId, { ...quotePayload, specialPrice: '0', branchId: 'B' })).status === 200, 'explicit confirmation permits quote at new authorized branch');
  check((await read(quoteId)).specialPriceUpdatedByUid === 'admin', 'branch-context confirmation updates trusted quote attribution');
  check((await request('/api/data/query', 'POST', { path: 'appointments/' + quoteId, kind: 'document' }, 'staff')).status === 403, 'Special Price cannot be read outside authorized branch');
  check((await request('/api/records/appointments', 'POST', booking({ specialPrice: '1' }, 'B'), 'staff')).status === 403, 'new Special Price booking cannot bypass branch restrictions');
  const revisedQuoteService = await editService(quoteService, { name: 'Special Price revised reference' });
  const revisedQuotePayload = { ...quotePayload, ...selection(revisedQuoteService), branchId: 'B' };
  const versionReview = await patchPricing(quoteId, { ...revisedQuotePayload, specialPrice: undefined });
  check(versionReview.status === 409 && versionReview.body.code === 'SPECIAL_PRICE_REVIEW_REQUIRED', 'new catalogue version requires explicit quote review');
  check((await patchPricing(quoteId, { ...revisedQuotePayload, specialPrice: '5' })).status === 200, 'reviewed new version and quote save together');
  const replacedQuotePayload = { ...revisedQuotePayload, ...selection(free) };
  const replacementReview = await patchPricing(quoteId, { ...replacedQuotePayload, specialPrice: undefined });
  check(replacementReview.status === 409 && replacementReview.body.code === 'SPECIAL_PRICE_REVIEW_REQUIRED', 'different canonical Service requires explicit quote review');
  check((await patchPricing(quoteId, { ...replacedQuotePayload, specialPrice: '5' })).status === 200, 'explicit confirmation permits a different Service');
  const removalReview = await patchPricing(quoteId, { ...revisedQuotePayload, serviceSelection: null, specialPrice: undefined });
  check(removalReview.status === 409 && removalReview.body.code === 'SPECIAL_PRICE_REVIEW_REQUIRED', 'removing Service requires explicit quote review');
  check((await patchPricing(quoteId, { ...revisedQuotePayload, serviceSelection: null, specialPrice: null })).status === 200, 'explicit null clears quote alongside Service removal');
  check((await read(quoteId)).specialPrice === null && (await read(quoteId)).serviceId === null, 'clear is atomic and distinguishable from Free');
  const blankQuote = await request('/api/records/appointments', 'POST', booking({ specialPrice: null }));
  check(blankQuote.status === 201 && Object.keys(quoteFields(await read(blankQuote.body.id))).length === 0, 'explicit blank new booking adds no quote metadata');
  const blankTextQuote = await request('/api/records/appointments', 'POST', booking({ specialPrice: '  ' }));
  check(blankTextQuote.status === 201 && Object.keys(quoteFields(await read(blankTextQuote.body.id))).length === 0, 'blank input is not quoted and adds no metadata');
  const noServicePayload = booking({ specialPrice: '25' });
  const noServiceQuote = await request('/api/records/appointments', 'POST', noServicePayload, 'staff');
  check(noServiceQuote.status === 201 && !Object.hasOwn(await read(noServiceQuote.body.id), 'serviceId'), 'optional-Service booking may contain an advisory quote');
  const noServiceReview = await patchPricing(noServiceQuote.body.id, { ...noServicePayload, branchId: 'B', specialPrice: undefined });
  check(noServiceReview.status === 409 && noServiceReview.body.code === 'SPECIAL_PRICE_REVIEW_REQUIRED', 'no-Service quote also requires review on branch change');
  check((await patchPricing(noServiceQuote.body.id, { ...noServicePayload, branchId: 'B', specialPrice: '20' }, 'staff')).status === 403, 'quote confirmation never bypasses branch restrictions');
  await db.collection('users').doc('staff').update({ permissionOverrides: { 'clinical.view': 'deny' } });
  const redactedQuote = await request('/api/data/query', 'POST', { path: 'appointments/' + noServiceQuote.body.id, kind: 'document' }, 'staff');
  check(redactedQuote.status === 200 && redactedQuote.body.document.data.specialPrice === '25.00'
    && redactedQuote.body.document.data.specialPriceUpdatedByUid === 'staff', 'clinical-denied Staff can read authorized operational quote');
  check(redactedQuote.body.document.data.bookingQuote.total === '25.00'
    && redactedQuote.body.document.data.bookingQuote.quotedByUid === 'staff', 'clinical denial preserves the closed operational booking summary');
  check((await patchPricing(noServiceQuote.body.id, { ...noServicePayload, specialPrice: '24.99' }, 'staff')).status === 200, 'clinical-denied Staff retains permitted quote-edit workflow');
  await db.collection('users').doc('staff').update({ permissionOverrides: { 'appointments.create': 'deny', 'appointments.edit': 'deny' } });
  check((await request('/api/records/appointments', 'POST', booking({ specialPrice: '1' }), 'staff')).status === 403, 'read-only Staff cannot create quotes');
  check((await patchPricing(noServiceQuote.body.id, { ...noServicePayload, specialPrice: '1' }, 'staff')).status === 403, 'read-only Staff cannot mutate quotes');
  check((await read(noServiceQuote.body.id)).specialPrice === '24.99', 'permission denial preserves quote');
  await db.collection('users').doc('staff').update({ permissionOverrides: {} });
  const guardedQuoteBefore = JSON.stringify(quoteFields(await read(noServiceQuote.body.id)));
  check((await request('/api/records/appointments/' + noServiceQuote.body.id, 'DELETE', { reason: 'Synthetic quote archive check' })).status === 200, 'quote booking uses existing archive workflow');
  check((await patchPricing(noServiceQuote.body.id, { ...noServicePayload, specialPrice: '1' })).status === 409, 'archived quote edits remain blocked');
  check((await request('/api/records/appointments/' + noServiceQuote.body.id + '/restore', 'POST', {})).status === 200, 'quote booking uses existing restore workflow');
  await db.collection('appointments').doc(noServiceQuote.body.id).update({ visitHistoryCreated: true });
  check((await patchPricing(noServiceQuote.body.id, { ...noServicePayload, specialPrice: '1' })).status === 409, 'Visit-sealed quote edits remain blocked');
  check(JSON.stringify(quoteFields(await read(noServiceQuote.body.id))) === guardedQuoteBefore, 'archive, restore and denied edits retain quote history');
  check(await cataloguePrices() === catalogueBeforeQuotes, 'booking quote operations leave catalogue and branch prices unchanged');
  const quoteAudits = (await pool.query("SELECT data FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1", [quoteId])).rows.map(row => row.data);
  check(quoteAudits.some(log => log.changes?.some((change: any) => change.field === 'specialPrice')), 'trusted appointment audit records quote changes');
  check(quoteAudits.some(log => log.changes?.some((change: any) => change.field === 'bookingQuote')), 'trusted appointment audit records computed summary changes');

  // Booking computations work independently of POS and retain the original quote.
  let summaryService = await createService('Booking summary reference');
  const summaryPayload = booking(selection(summaryService));
  const summaryCreated = await request('/api/records/appointments', 'POST', summaryPayload, 'staff');
  check(summaryCreated.status === 201, 'ordinary Staff can compute a Service booking without POS');
  const summaryId = summaryCreated.body.id;
  const initialSummary = (await read(summaryId)).bookingQuote;
  check(isDeepStrictEqual(initialSummary, { version: 1, currency: 'PHP', branchId: 'A',
    serviceId: summaryService.id, serviceCatalogueVersion: summaryService.version,
    servicePrice: '100.00', specialPrice: null, total: '100.00', source: 'service',
    quotedAt: initialSummary.quotedAt, quotedByUid: 'staff', quotedByName: 'Synthetic staff' }), 'server freezes exact Service quote context and attribution');
  check(Number.isFinite(Date.parse(initialSummary.quotedAt)), 'quote timestamp is authoritative');
  const inheritedSummary = JSON.stringify(initialSummary);
  summaryService = await editService(summaryService, { name: 'Repriced booking summary reference', standardPrice: { mode: 'priced', amount: '250' } });
  check((await patchPricing(summaryId, { ...summaryPayload,
    serviceSelection: undefined, notes: 'Synthetic unrelated update' })).status === 200, 'unrelated edit remains valid after catalogue repricing');
  check(JSON.stringify((await read(summaryId)).bookingQuote) === inheritedSummary, 'catalogue repricing and unrelated edits preserve saved quote exactly');
  check((await patchPricing(summaryId, summaryPayload)).status === 409, 'stale Service version cannot refresh booking quote');
  check(JSON.stringify((await read(summaryId)).bookingQuote) === inheritedSummary, 'stale Service selection preserves quoted amount and attribution');
  const summaryEdit = { ...summaryPayload, serviceSelection: undefined, specialPrice: '80' };
  check((await patchPricing(summaryId, summaryEdit)).status === 200, 'Special Price-only edit needs no current Service reselection');
  let summary = (await read(summaryId)).bookingQuote;
  check(summary.servicePrice === '100.00' && summary.specialPrice === '80.00' && summary.total === '80.00'
    && summary.source === 'special', 'Special Price edit reuses frozen base instead of live repricing');
  check(summary.quotedByUid === 'admin' && summary.quotedByName === 'Synthetic admin', 'summary change acquires only trusted actor metadata');
  const specialSummary = JSON.stringify(summary);
  check((await patchPricing(summaryId, { ...summaryPayload,
    serviceSelection: undefined, notes: 'Synthetic stale form without quote commands' })).status === 200, 'stale unrelated save omits quote commands');
  check(JSON.stringify((await read(summaryId)).bookingQuote) === specialSummary, 'stale unrelated save cannot overwrite newer quote or attribution');
  check((await patchPricing(summaryId, { ...summaryEdit,
    notes: 'Synthetic stale form without quote commands', specialPrice: '80.00' }, 'staff')).status === 200, 'same Special Price command remains valid');
  check(JSON.stringify((await read(summaryId)).bookingQuote) === specialSummary, 'same normalized Special Price does not refresh summary attribution');
  check((await patchPricing(summaryId, { ...summaryEdit, specialPrice: null })).status === 200, 'clearing Special Price restores frozen catalogue quote');
  summary = (await read(summaryId)).bookingQuote;
  check(summary.servicePrice === '100.00' && summary.total === '100.00' && summary.specialPrice === null && summary.source === 'service', 'clearing uses quoted base price rather than changed live price');
  const currentSelection = { ...summaryPayload, ...selection(summaryService) };
  check((await patchPricing(summaryId, currentSelection)).status === 200, 'explicit current Service selection refreshes booking quote');
  summary = (await read(summaryId)).bookingQuote;
  check(summary.servicePrice === '250.00' && summary.total === '250.00'
    && summary.serviceCatalogueVersion === summaryService.version, 'explicit refreshed quote matches authoritative catalogue version');
  check((await patchPricing(summaryId, { ...currentSelection, branchId: 'B' })).status === 200, 'authorized branch reselection computes branch quote');
  summary = (await read(summaryId)).bookingQuote;
  check(summary.branchId === 'B' && summary.servicePrice === '987.65' && summary.total === '987.65', 'branch override replaces inherited standard price');
  check((await request('/api/data/query', 'POST', { path: 'appointments/' + summaryId, kind: 'document' }, 'staff')).status === 403, 'unauthorized branch cannot read historical quote override');
  check((await patchPricing(summaryId, { ...currentSelection, branchId: 'B', specialPrice: '1' }, 'staff')).status === 403, 'quote mutation never bypasses original branch restriction');
  check((await read(summaryId)).bookingQuote.total === '987.65', 'denied branch mutation retains quote');
  check((await patchPricing(summaryId, { ...summaryPayload, branchId: 'B', serviceSelection: null })).status === 200, 'explicit Service removal clears Service-based quote');
  check((await read(summaryId)).bookingQuote.total === null && (await read(summaryId)).bookingQuote.source === 'unset', 'removed Service with no Special Price is unset rather than Free');
  const summaryFree = await createService('Booking summary Free', { mode: 'free' });
  const freeSummaryPayload = booking(selection(summaryFree));
  const freeSummaryCreated = await request('/api/records/appointments', 'POST', freeSummaryPayload);
  check(freeSummaryCreated.status === 201 && (await read(freeSummaryCreated.body.id)).bookingQuote.servicePrice === '0.00'
    && (await read(freeSummaryCreated.body.id)).bookingQuote.total === '0.00'
    && (await read(freeSummaryCreated.body.id)).bookingQuote.source === 'service', 'catalogue Free computes an explicit zero Service quote');
  await editService(summaryFree, { active: false });
  check((await patchPricing(freeSummaryCreated.body.id, { ...freeSummaryPayload,
    serviceSelection: undefined, specialPrice: '21' })).status === 200, 'inactive historical Service permits an explicit Special Price-only edit');
  check((await read(freeSummaryCreated.body.id)).bookingQuote.servicePrice === '0.00'
    && (await read(freeSummaryCreated.body.id)).bookingQuote.total === '21.00', 'inactive historical quote keeps original Free base while Special Price overrides it');
  check((await patchPricing(freeSummaryCreated.body.id, { ...freeSummaryPayload,
    serviceSelection: undefined, specialPrice: null })).status === 200, 'inactive historical Service permits clearing only Special Price');
  check((await read(freeSummaryCreated.body.id)).bookingQuote.total === '0.00', 'clearing Special Price on inactive history restores quoted Free amount');
  const branchFreeSummary = await createService('Booking summary branch Free', { mode: 'priced', amount: '45' }, [
    { branchId: 'A', available: true, price: { mode: 'inherit' } }, { branchId: 'B', available: true, price: { mode: 'free' } },
  ]);
  const branchFreeCreated = await request('/api/records/appointments', 'POST', booking(selection(branchFreeSummary), 'B'));
  check(branchFreeCreated.status === 201 && (await read(branchFreeCreated.body.id)).bookingQuote.total === '0.00', 'branch Free overrides nonzero standard quote');
  const legacySummaryPayload = booking();
  await db.collection('appointments').doc('legacy-summary').set({ ...legacySummaryPayload, serviceId: summaryService.id,
    serviceNameSnapshot: 'Historical booking name', serviceDurationMinutesSnapshot: 20, serviceCatalogueVersion: 1 });
  check((await patchPricing('legacy-summary', { ...legacySummaryPayload, notes: 'Retained historical quote unknown' })).status === 200, 'historical Service booking without quote remains editable');
  check(!Object.hasOwn(await read('legacy-summary'), 'bookingQuote'), 'unrelated edits never backfill current catalogue price into history');
  check((await patchPricing('legacy-summary', { ...legacySummaryPayload, specialPrice: '77' })).status === 200, 'historical Service booking can receive an explicit new Special Price');
  summary = (await read('legacy-summary')).bookingQuote;
  check(summary.servicePrice === null && summary.specialPrice === '77.00' && summary.total === '77.00'
    && summary.serviceCatalogueVersion === 1, 'historical unknown Service base stays unknown while explicit special quote computes');
  check((await patchPricing('legacy-summary', { ...legacySummaryPayload, specialPrice: null })).status === 200, 'historical Special Price can be explicitly removed');
  check((await read('legacy-summary')).bookingQuote.total === null && (await read('legacy-summary')).serviceNameSnapshot === 'Historical booking name', 'historical quote removal neither invents current price nor rewrites Service snapshot');
  const legacySpecialPayload = booking();
  await db.collection('appointments').doc('legacy-special-summary').set({ ...legacySpecialPayload, specialPrice: '33.00', specialPriceUpdatedByUid: 'historical-staff' });
  check((await patchPricing('legacy-special-summary', { ...legacySpecialPayload, notes: 'Unrelated historical edit' })).status === 200, 'legacy Special Price booking remains editable');
  check(!Object.hasOwn(await read('legacy-special-summary'), 'bookingQuote')
    && (await read('legacy-special-summary')).specialPrice === '33.00', 'legacy Special Price remains untouched without synthetic quote backfill');
  summaryService = await editService(summaryService, { active: false });
  const inactiveSpecialPayload = { ...summaryPayload, serviceSelection: undefined, branchId: 'B', specialPrice: '9' };
  // The record has explicitly cleared Service; its quote remains independent.
  check((await patchPricing(summaryId, inactiveSpecialPayload)).status === 200, 'no-Service booking quote remains editable after old catalogue reference deactivation');
  check((await read(summaryId)).bookingQuote.servicePrice === null && (await read(summaryId)).bookingQuote.total === '9.00', 'Special Price alone computes without an active catalogue Service');
  const immutableBeforeTampering = JSON.stringify(await read(summaryId));
  for (const field of ['bookingQuote', 'bookingQuoteTotal', 'bookingQuoteCurrency', 'quotedAt', 'quotedByUid', 'quotedByName', 'servicePrice', 'bookingTotal', 'quoteTotal', 'quoteSource', 'quoteCurrency']) {
    check((await request('/api/records/appointments', 'POST', booking({ [field]: { total: '1' } }))).status === 400, 'create rejects client-computed quote field: ' + field);
    check((await patchPricing(summaryId, { ...inactiveSpecialPayload, [field]: null })).status === 400, 'update rejects client-computed quote field: ' + field);
  }
  check(JSON.stringify(await read(summaryId)) === immutableBeforeTampering, 'all forged quote writes leave existing booking unchanged');
  // Clinical projection is closed even when unknown keys exist in historical JSONB.
  await db.collection('appointments').doc('legacy-special-summary').update({ bookingQuote: {
    version: 1, currency: 'PHP', branchId: 'A', serviceId: null, serviceCatalogueVersion: null,
    servicePrice: null, specialPrice: '33.00', total: '33.00', source: 'special',
    quotedAt: new Date().toISOString(), quotedByUid: 'historical-staff', quotedByName: 'Historical staff',
    notes: 'Synthetic protected clinical note', nested: { diagnosis: 'Synthetic protected diagnosis' },
  } });
  await db.collection('users').doc('staff').update({ permissionOverrides: { 'clinical.view': 'deny' } });
  const closedSummary = await request('/api/data/query', 'POST', { path: 'appointments/legacy-special-summary', kind: 'document' }, 'staff');
  check(closedSummary.status === 200 && closedSummary.body.document.data.bookingQuote.total === '33.00'
    && !Object.hasOwn(closedSummary.body.document.data.bookingQuote, 'notes')
    && !Object.hasOwn(closedSummary.body.document.data.bookingQuote, 'nested'), 'operational summary includes only explicitly whitelisted scalar quote fields');
  check((await request('/api/data/query', 'POST', { kind: 'collection', path: 'appointments', constraints: [
    { type: 'where', field: 'bookingQuote', operator: '==', value: { notes: 'Synthetic protected clinical note' } },
  ] }, 'staff')).status === 403, 'clinical-denied query cannot infer unknown nested quote fields through an object predicate');
  await db.collection('users').doc('staff').update({ permissionOverrides: {} });
  // Two independent forms: a reviewed Service/quote changes after the old form
  // opens. Neither setting nor clearing a quote may act on that newer context.
  for (const change of ['replacement', 'version'] as const) for (const action of ['set', 'clear'] as const) {
    let racingPriceService = await createService(`Stale Special Price ${change} ${action}`);
    const racingPricePayload = booking({ ...selection(racingPriceService), specialPrice: '80' });
    const racingPriceCreated = await request('/api/records/appointments', 'POST', racingPricePayload);
    check(racingPriceCreated.status === 201, 'create separate two-form stale pricing fixture');
    const racingPriceId = racingPriceCreated.body.id;
    const oldForm = await read(racingPriceId);
    const oldRevision = appointmentPricingRevision(oldForm);
    check(oldRevision === 1, 'new quote begins at server-owned revision one');
    racingPriceService = change === 'replacement'
      ? await createService(`Replacement for ${action}`, { mode: 'priced', amount: '250' })
      : await editService(racingPriceService, { standardPrice: { mode: 'priced', amount: '250' } });
    const currentSave = await request('/api/records/appointments/' + racingPriceId, 'PATCH', {
      ...racingPricePayload, ...selection(racingPriceService), specialPrice: null,
      expectedPricingRevision: oldRevision,
    });
    check(currentSave.status === 200, 'second form saves reviewed Service change and clears prior quote');
    const currentRecord = await read(racingPriceId);
    check(currentRecord.bookingQuote.total === '250.00' && appointmentPricingRevision(currentRecord) === oldRevision + 1,
      'Service replacement/version change produces coherent quote and advances revision');
    const auditCount = async () => (await pool.query("SELECT count(*) FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1", [racingPriceId])).rows[0].count;
    const beforeDenial = JSON.stringify(currentRecord), auditsBeforeDenial = await auditCount();
    const oldSave = await request('/api/records/appointments/' + racingPriceId, 'PATCH', {
      ...racingPricePayload, serviceSelection: undefined, specialPrice: action === 'set' ? '55' : null,
      expectedPricingRevision: oldRevision, notes: 'Synthetic unsaved old-form notes',
    });
    check(oldSave.status === 409 && oldSave.body.code === 'SPECIAL_PRICE_CONTEXT_CHANGED', `${change} rejects stale ${action} rather than computing from another form's Service`);
    check(JSON.stringify(await read(racingPriceId)) === beforeDenial && await auditCount() === auditsBeforeDenial,
      'stale pricing denial leaves latest quote, attribution, notes and audit unchanged');
    check((await request('/api/records/appointments/' + racingPriceId, 'PATCH', {
      ...racingPricePayload, serviceSelection: undefined, specialPrice: undefined,
      notes: 'Synthetic unrelated old-form notes',
    })).status === 200, 'old form without a price command still saves unrelated fields');
    const afterUnrelated = await read(racingPriceId);
    check(isDeepStrictEqual(afterUnrelated.bookingQuote, currentRecord.bookingQuote)
      && appointmentPricingRevision(afterUnrelated) === appointmentPricingRevision(currentRecord), 'unrelated old-form save preserves current quote and revision');
  }

  const revisionService = await createService('Pricing revision controls');
  const revisionPayload = booking(selection(revisionService));
  const revisionCreated = await request('/api/records/appointments', 'POST', revisionPayload, 'staff');
  const revisionId = revisionCreated.body.id;
  check(revisionCreated.status === 201 && appointmentPricingRevision(await read(revisionId)) === 1, 'Service-only quote also gets a revision');
  for (const command of ['10', null]) {
    const missing = await request('/api/records/appointments/' + revisionId, 'PATCH', { ...revisionPayload, serviceSelection: undefined, specialPrice: command });
    check(missing.status === 409 && missing.body.code === 'SPECIAL_PRICE_CONTEXT_CHANGED', 'set/clear without reviewed pricing precondition fails closed');
  }
  for (const expectedPricingRevision of [null, -1, 1.5, '1', false, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    check((await request('/api/records/appointments/' + revisionId, 'PATCH', {
      ...revisionPayload, serviceSelection: undefined, specialPrice: '10', expectedPricingRevision,
    })).status === 400, 'invalid expected revision shape is rejected');
  }
  for (const method of ['POST', 'PATCH']) check((await request('/api/records/appointments' + (method === 'PATCH' ? '/' + revisionId : ''), method, {
    ...(method === 'PATCH' ? revisionPayload : booking()), serviceSelection: undefined, specialPrice: '10', bookingPricingRevision: 999,
  })).status === 400, 'direct server revision tampering is rejected on ' + method);
  const revisionPatch = { ...revisionPayload, serviceSelection: undefined, specialPrice: '10', expectedPricingRevision: 1 };
  check((await request('/api/records/appointments/' + revisionId, 'PATCH', revisionPatch, 'staff')).status === 200, 'current permitted Staff revision can set Special Price');
  check(appointmentPricingRevision(await read(revisionId)) === 2 && !Object.hasOwn(await read(revisionId), 'expectedPricingRevision'), 'actual quote write advances once without persisting precondition');
  const sameAmount = await request('/api/records/appointments/' + revisionId, 'PATCH', { ...revisionPatch, specialPrice: '10.00', expectedPricingRevision: 2 }, 'staff');
  check(sameAmount.status === 200 && appointmentPricingRevision(await read(revisionId)) === 2, 'same normalized amount without reselection is a no-op revision');
  check((await request('/api/records/appointments/' + revisionId, 'PATCH', { ...revisionPatch, specialPrice: null, expectedPricingRevision: 2 }, 'staff')).status === 200
    && appointmentPricingRevision(await read(revisionId)) === 3, 'clear advances pricing revision');
  const staleClear = await request('/api/records/appointments/' + revisionId, 'PATCH', { ...revisionPatch, specialPrice: null, expectedPricingRevision: 2 }, 'staff');
  check(staleClear.status === 409 && staleClear.body.code === 'SPECIAL_PRICE_CONTEXT_CHANGED', 'stale already-null clear still requires reviewed revision');
  check((await request('/api/records/appointments/' + revisionId, 'PATCH', { ...revisionPatch, expectedPricingRevision: 3 }, 'staff')).status === 200
    && appointmentPricingRevision(await read(revisionId)) === 4, 'A-to-B-to-A amount round trip never resets revision');
  check((await request('/api/records/appointments/' + revisionId, 'PATCH', revisionPatch, 'staff')).status === 409, 'old amount command stays stale after A-to-B-to-A round trip');
  check((await request('/api/records/appointments/' + revisionId, 'PATCH', { ...revisionPayload, specialPrice: '10', expectedPricingRevision: 4 }, 'staff')).status === 200
    && appointmentPricingRevision(await read(revisionId)) === 5, 'explicit same-Service reselection advances the pricing review revision');
  const revisionBeforeUnauthorized = JSON.stringify(await read(revisionId));
  check((await request('/api/records/appointments/' + revisionId, 'PATCH', { ...revisionPatch, branchId: 'B', expectedPricingRevision: 5 }, 'staff')).status === 403,
    'valid revision grants no unauthorized branch access');
  await db.collection('users').doc('staff').update({ permissionOverrides: { 'appointments.edit': 'deny' } });
  check((await request('/api/records/appointments/' + revisionId, 'PATCH', { ...revisionPatch, expectedPricingRevision: 5 }, 'staff')).status === 403,
    'valid revision grants no denied edit capability');
  check(JSON.stringify(await read(revisionId)) === revisionBeforeUnauthorized, 'permission denials preserve complete quote and revision');
  await db.collection('users').doc('staff').update({ permissionOverrides: { 'clinical.view': 'deny' } });
  const safeRevision = await request('/api/data/query', 'POST', { path: 'appointments/' + revisionId, kind: 'document' }, 'staff');
  check(safeRevision.status === 200 && safeRevision.body.document.data.bookingPricingRevision === 5, 'clinical-denied authorized Staff receives operational pricing revision');
  await db.collection('users').doc('staff').update({ permissionOverrides: {} });
  await db.collection('patients').doc('other-pricing-patient').set({ name: 'Synthetic other pricing patient', patientID: 'SYNTHETIC-OTHER', isArchived: false });
  const beforePatientChange = await read(revisionId);
  check((await request('/api/records/appointments/' + revisionId, 'PATCH', {
    ...revisionPayload, patientId: 'other-pricing-patient', serviceSelection: undefined,
  })).status === 200, 'existing authorized patient reassignment remains supported');
  const afterPatientChange = await read(revisionId);
  check(afterPatientChange.patientId === 'other-pricing-patient'
    && appointmentPricingRevision(afterPatientChange) === appointmentPricingRevision(beforePatientChange) + 1
    && afterPatientChange.bookingQuote.servicePrice === beforePatientChange.bookingQuote.servicePrice
    && afterPatientChange.bookingQuote.total === beforePatientChange.bookingQuote.total,
  'patient reassignment advances pricing revision while preserving the frozen amounts');
  const patientAuditCount = async () => (await pool.query("SELECT count(*) FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1", [revisionId])).rows[0].count;
  const beforePatientDenial = JSON.stringify(afterPatientChange), patientAuditsBeforeDenial = await patientAuditCount();
  for (const specialPrice of ['55', null]) {
    const stalePatientSave = await request('/api/records/appointments/' + revisionId, 'PATCH', {
      ...revisionPayload, serviceSelection: undefined, specialPrice,
      expectedPricingRevision: appointmentPricingRevision(beforePatientChange), notes: 'Synthetic unsaved notes from prior patient context',
    });
    check(stalePatientSave.status === 409 && stalePatientSave.body.code === 'SPECIAL_PRICE_CONTEXT_CHANGED', 'prior patient context cannot set or clear Special Price');
    check(JSON.stringify(await read(revisionId)) === beforePatientDenial && await patientAuditCount() === patientAuditsBeforeDenial,
      'stale patient-context quote save preserves latest patient, frozen quote, notes and audit');
  }
  const legacyRevisionPayload = booking();
  await db.collection('appointments').doc('legacy-pricing-revision').set({ ...legacyRevisionPayload, specialPrice: '30.00' });
  check(appointmentPricingRevision(await read('legacy-pricing-revision')) === 0, 'historical missing revision is revision zero');
  check((await request('/api/records/appointments/legacy-pricing-revision', 'PATCH', { ...legacyRevisionPayload, notes: 'Retained legacy quote' })).status === 200
    && !Object.hasOwn(await read('legacy-pricing-revision'), 'bookingPricingRevision'), 'unrelated legacy save neither backfills revision nor changes quote');
  check((await request('/api/records/appointments/legacy-pricing-revision', 'PATCH', { ...legacyRevisionPayload, specialPrice: '20', expectedPricingRevision: 0 })).status === 200
    && appointmentPricingRevision(await read('legacy-pricing-revision')) === 1, 'explicit historical price edit upgrades revision zero atomically');
  check((await request('/api/records/appointments/legacy-pricing-revision', 'PATCH', { ...legacyRevisionPayload, specialPrice: null, expectedPricingRevision: 0 })).status === 409,
    'stale historical revision zero cannot clear upgraded quote');
  for (const bookingPricingRevision of [Number.MAX_SAFE_INTEGER, -1, 'broken']) {
    const guardedId = 'guarded-pricing-' + String(bookingPricingRevision);
    await db.collection('appointments').doc(guardedId).set({ ...booking(), bookingPricingRevision });
    const guardedRecord = await read(guardedId);
    const guardedSave = await request('/api/records/appointments/' + guardedId, 'PATCH', {
      patientId: guardedRecord.patientId, doctorId: guardedRecord.doctorId, branchId: guardedRecord.branchId,
      appointmentDate: guardedRecord.appointmentDate, visitType: guardedRecord.visitType, status: guardedRecord.status,
      specialPrice: '1', expectedPricingRevision: typeof bookingPricingRevision === 'number' && bookingPricingRevision >= 0 ? bookingPricingRevision : 0,
    });
    check(guardedSave.status === 409 && guardedSave.body.code === 'SPECIAL_PRICE_CONTEXT_CHANGED'
      && isDeepStrictEqual(await read(guardedId), guardedRecord), 'overflow/malformed stored revisions fail closed without a write');
  }
  for (const role of ['admin', 'support_developer', 'manager', 'doctor', 'staff']) {
    check((await request('/api/records/appointments', 'POST', booking(selection(free)), role)).status === 201, role + ' existing booking permission preserved');
    const scoped = await request('/api/services?branchId=A&availableOnly=true', 'GET', undefined, role);
    check(scoped.status === 200 && scoped.body.services.every((s: any) => s.branches.every((b: any) => b.id === 'A')), role + ' branch-filtered options');
    check(!JSON.stringify(scoped.body).includes('987.65'), role + ' removed branch price not exposed');
    if (!['admin', 'support_developer'].includes(role)) {
      check((await request('/api/records/appointments', 'POST', booking(selection(free), 'B'), role)).status === 403, role + ' unauthorized booking branch denied');
      check((await request('/api/services?branchId=B', 'GET', undefined, role)).status === 403, role + ' unauthorized catalogue branch denied');
    }
  }
  for (const role of ['inactive', 'anonymous']) check([401, 403].includes((await request('/api/records/appointments', 'POST', booking(selection(free)), role)).status), role + ' denied');
  check([401, 403].includes((await request('/api/records/appointments', 'POST', booking(selection(free)), 'admin', { Authorization: 'Bearer invalid' })).status), 'CSRF retained');
  const clash = booking(selection(free)); const first = await request('/api/records/appointments', 'POST', clash);
  check(first.status === 201 && (await request('/api/records/appointments', 'POST', clash)).status === 409, 'existing exact-slot conflict retained');
  check((await request('/api/records/appointments/' + first.body.id, 'PATCH', clash)).status === 200, 'self excluded from slot conflict');
  const durationOverlap = { ...clash, appointmentDate: clash.appointmentDate.endsWith('00') ? clash.appointmentDate.slice(0, -2) + '30' : `${clash.appointmentDate.slice(0, 11)}${String(Number(clash.appointmentDate.slice(11, 13)) + 1).padStart(2, '0')}:00` };
  check((await request('/api/records/appointments', 'POST', durationOverlap)).status === 201, 'reference duration does not add advanced scheduling');
  const archive = await request('/api/records/appointments/' + first.body.id, 'DELETE', { reason: 'Synthetic archive test' });
  check(archive.status === 200, 'archive unchanged');
  const archivedSnapshot = JSON.stringify(snapshot(await read(first.body.id)));
  check((await request('/api/records/appointments/' + first.body.id, 'PATCH', clash)).status === 409, 'archived edit denied');
  check((await request('/api/records/appointments/' + first.body.id + '/restore', 'POST', {})).status === 200, 'restore unchanged');
  check(JSON.stringify(snapshot(await read(first.body.id))) === archivedSnapshot, 'archive and restore preserve snapshot');
  await db.collection('appointments').doc(first.body.id).update({ visitHistoryCreated: true });
  check((await request('/api/records/appointments/' + first.body.id, 'PATCH', { ...clash, serviceSelection: null })).status === 409, 'visit seal unchanged');
  // Race a catalogue revision against appointment selection: whichever wins the
  // shared transaction lock determines a coherent snapshot or stale-version denial.
  const racing = await createService('Racing Service');
  const racedPayload = booking(selection(racing));
  const race = await Promise.all([request('/api/records/appointments', 'POST', racedPayload), request('/api/services/' + racing.id, 'PATCH', { expectedVersion: 1, name: 'Racing Service updated', defaultDurationMinutes: 60 })]);
  check(race[1].status === 200 && [201, 409].includes(race[0].status), 'catalogue/booking race is serialized');
  if (race[0].status === 201) check((await read(race[0].body.id)).serviceNameSnapshot === racing.name && (await read(race[0].body.id)).serviceDurationMinutesSnapshot === 45, 'race has coherent original snapshot');
  // Access can narrow after initial HTTP authorization but before the lock.
  const originalTransaction = db.runTransaction;
  let narrowed = false;
  db.runTransaction = async callback => {
    if (!narrowed) { narrowed = true; await originalTransaction(async tx => { tx.update(db.collection('users').doc('staff'), { assignedBranches: [] }); }); }
    return originalTransaction(callback);
  };
  try { check((await request('/api/records/appointments', 'POST', booking(selection(free)), 'staff')).status === 403, 'current transactional branch scope enforced'); }
  finally { db.runTransaction = originalTransaction; }
  // Stored snapshots are readable even when their catalogue reference is gone.
  await db.collection('appointments').doc('orphan-history').set({ ...booking(), serviceId: randomUUID(), serviceNameSnapshot: 'Historical removed reference', serviceDurationMinutesSnapshot: 20, serviceCatalogueVersion: 7 });
  const orphan = await read('orphan-history');
  check((await request('/api/records/appointments/orphan-history', 'PATCH', { ...orphan, ...Object.fromEntries(Object.keys(snapshot(orphan)).map(k => [k, undefined])) })).status === 200, 'historical missing reference editable without catalogue lookup');
  const historicalRead = await request('/api/data/query', 'POST', { path: 'appointments/orphan-history', kind: 'document' }, 'doctor');
  check(historicalRead.status === 200 && historicalRead.body.document.data.serviceNameSnapshot === 'Historical removed reference', 'snapshot readable through authorized appointment API');
  const freeBooking = booking(selection(free)); const freeAppointment = await request('/api/records/appointments', 'POST', freeBooking);
  const freeBefore = JSON.stringify(snapshot(await read(freeAppointment.body.id)));
  await editService(free, { standardPrice: { mode: 'unpriced' } });
  check((await request('/api/records/appointments/' + freeAppointment.body.id, 'PATCH', { ...freeBooking, serviceSelection: undefined })).status === 200, 'historical newly unpriced Service remains editable');
  check(JSON.stringify(snapshot(await read(freeAppointment.body.id))) === freeBefore, 'unpriced historical snapshot unchanged');
  const atomicService = await createService('Atomic Service');
  const atomicBookingPayload = booking({ ...selection(atomicService), specialPrice: '18' });
  const atomicBooking = await request('/api/records/appointments', 'POST', atomicBookingPayload);
  check(atomicBooking.status === 201, 'synthetic booking for quote rollback check');
  const atomicQuoteBefore = JSON.stringify(await read(atomicBooking.body.id));
  const recordCount = (await pool.query("SELECT count(*) FROM app_records WHERE collection_path='appointments'")).rows[0].count;
  db.runTransaction = callback => originalTransaction(async tx => {
    const originalSet = tx.set.bind(tx);
    tx.set = ((ref: any, data: any, options: any) => { if (ref.collectionPath === 'audit_logs') throw Error('Synthetic appointment audit failure'); return originalSet(ref, data, options); }) as any;
    return callback(tx);
  });
  try {
    check((await request('/api/records/appointments', 'POST', booking({ ...selection(atomicService), specialPrice: '12.50' }))).status === 500, 'audit failure returned for quoted booking');
    check((await patchPricing(atomicBooking.body.id, { ...atomicBookingPayload,
      serviceSelection: undefined, specialPrice: '19' })).status === 500, 'audit failure returned for quote update');
  }
  finally { db.runTransaction = originalTransaction; }
  check((await pool.query("SELECT count(*) FROM app_records WHERE collection_path='appointments'")).rows[0].count === recordCount, 'audit failure rolls back snapshot and booking');
  check(JSON.stringify(await read(atomicBooking.body.id)) === atomicQuoteBefore, 'audit failure rolls back computed quote update and original amount atomically');
  await db.collection('users').doc('staff').update({ assignedBranches: ['A'] });
  let disabled = false;
  db.runTransaction = async callback => {
    if (!disabled) { disabled = true; await originalTransaction(async tx => { tx.update(db.collection('users').doc('staff'), { active: false }); }); }
    return originalTransaction(callback);
  };
  try { check((await request('/api/records/appointments', 'POST', booking(selection(atomicService)), 'staff')).status === 403, 'transactional access loss denied'); }
  finally { db.runTransaction = originalTransaction; }
  const audits = (await pool.query("SELECT data FROM app_records WHERE collection_path='audit_logs' AND data->>'resourceId'=$1", [id])).rows.map(row => row.data);
  check(audits.some(log => log.changes?.some((change: any) => change.field === 'serviceId')), 'explicit selection change appears in trusted appointment audit');
  console.log(`Appointment Services API: ${checks} checks passed (disposable synthetic database)`);
} finally {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
