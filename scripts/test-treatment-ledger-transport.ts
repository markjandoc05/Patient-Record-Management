import assert from 'node:assert/strict';

const saved = { fetch: globalThis.fetch, interval: globalThis.setInterval, timeout: globalThis.setTimeout };
globalThis.setInterval = (() => 0) as any; globalThis.setTimeout = (() => 0) as any;
globalThis.fetch = (async () => new Response(JSON.stringify({ user: { uid: 'ledger-user' }, csrfToken: 'synthetic' }))) as any;
const { auth } = await import('../src/session'); await auth.ready;
const foundation = await import('../src/dataClient');
const api = await import('../src/utils/treatmentLedgerApi');
const permissions = await import('../src/permissionState');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const user = () => ({ uid: 'ledger-user', getRequestToken: async () => 'synthetic' } as any);
const payload = { commandId: '11111111-1111-4111-8111-111111111111', expectedVersion: 0 };
const body = { patientId: 'patient-1', purchases: [], events: [], activeVisitUsages: [], capabilities: {} };
const response = (status: number) => new Response(JSON.stringify(status === 200 ? body : { error: 'Synthetic denial' }), { status });
let checks = 0;
try {
  for (const mutation of [false, true]) for (const status of [200, 401, 403, 409]) {
    auth.currentUser = user(); let deliver!: (value: Response) => void, current = true, invalidations = 0;
    globalThis.fetch = (async () => new Promise(resolve => { deliver = resolve; })) as any;
    const stop = foundation.subscribeProtectedDataInvalidation(() => invalidations++);
    const pending = mutation ? api.createTreatmentPurchase('patient-1', payload, { isCurrent: () => current }) : api.getTreatmentLedger('patient-1', { isCurrent: () => current });
    const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush(); current = false; deliver(response(status)); await rejected;
    assert.equal(invalidations, 0); checks++; stop();
  }
  for (const status of [401, 403]) {
    auth.currentUser = user(); let invalidations = 0;
    const stop = foundation.subscribeProtectedDataInvalidation(() => invalidations++);
    globalThis.fetch = (async () => response(status)) as any;
    await assert.rejects(api.getTreatmentLedger('patient-1'), (error: any) => error.status === status); assert.equal(invalidations, 1); checks++; stop();
  }
  for (const change of ['account', 'invalidate', 'abort']) {
    auth.currentUser = user(); let deliver!: (value: Response) => void;
    globalThis.fetch = (async () => new Promise(resolve => { deliver = resolve; })) as any;
    const controller = new AbortController(), pending = api.getTreatmentLedger('patient-1', { signal: controller.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush();
    if (change === 'account') auth.currentUser = { ...user(), uid: 'new-account' };
    if (change === 'invalidate') foundation.invalidateProtectedData();
    if (change === 'abort') controller.abort();
    deliver(response(200)); await rejected; checks++;
  }
  auth.currentUser = user(); let deliverBody!: (value: unknown) => void, current = true;
  globalThis.fetch = (async () => { const result = response(403); Object.defineProperty(result, 'json', { configurable: true, value: () => new Promise(resolve => { deliverBody = resolve; }) }); return result; }) as any;
  const pending = api.adjustTreatmentSessions('patient-1', 'line', payload, { isCurrent: () => current });
  const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush(); current = false; deliverBody({ error: 'Old body' }); await rejected; checks++;
  let token!: (value: string) => void, fetched = false;
  auth.currentUser = { ...user(), getRequestToken: () => new Promise(resolve => { token = resolve; }) };
  globalThis.fetch = (async () => { fetched = true; return response(200); }) as any;
  const oldToken = api.getTreatmentLedger('patient-1'), oldRejected = assert.rejects(oldToken, { name: 'AbortError' });
  auth.currentUser = { ...user(), uid: 'replacement' }; token('synthetic'); await oldRejected; assert.equal(fetched, false); checks++;
  auth.currentUser = user(); globalThis.fetch = (async () => new Response(JSON.stringify({ ...body, patientId: 'other' }))) as any;
  await assert.rejects(api.getTreatmentLedger('patient-1'), (error: any) => error.status === 502); checks++;
  for (const status of [200, 401, 403, 409]) {
    auth.currentUser = user(); permissions.publishPermissionProfile({ role: 'admin', active: true, accessRevision: 1 });
    let deliver!: (value: Response) => void, invalidations = 0;
    const stop = foundation.subscribeProtectedDataInvalidation(() => invalidations++);
    globalThis.fetch = (async () => new Promise(resolve => { deliver = resolve; })) as any;
    const pending = api.getTreatmentLedger('patient-1'), rejected = assert.rejects(pending, { name: 'AbortError' }); await flush();
    permissions.publishPermissionProfile({ role: 'admin', active: true, accessRevision: 2, permissionOverrides: { 'treatment_ledger.view': 'deny' } });
    deliver(response(status)); await rejected; assert.equal(invalidations, 0); checks++; stop();
  }
  console.log(`${checks}/${checks} treatment ledger transport checks passed.`);
} finally { Object.assign(globalThis, saved); }
