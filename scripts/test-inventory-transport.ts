import assert from 'node:assert/strict';

const saved = { fetch: globalThis.fetch, interval: globalThis.setInterval, timeout: globalThis.setTimeout };
globalThis.setInterval = (() => 0) as any;
globalThis.setTimeout = (() => 0) as any;
globalThis.fetch = (async () => new Response(JSON.stringify({ user: { uid: 'inventory-user' }, csrfToken: 'synthetic' }))) as any;
const { auth } = await import('../src/session'); await auth.ready;
const foundation = await import('../src/dataClient');
const permissions = await import('../src/permissionState');
const api = await import('../src/utils/inventoryApi');
const user = () => ({ uid: 'inventory-user', getRequestToken: async () => 'synthetic' } as any);
const profile = (revision = 1) => ({ role: 'admin', active: true, accessRevision: revision });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const response = (status: number) => new Response(JSON.stringify(status === 200 ? { id: 'synthetic-command' } : { error: 'Synthetic denial' }), { status });
let checks = 0;
try {
  for (const method of ['GET', 'POST']) for (const status of [200, 401, 403, 409]) {
    auth.currentUser = user(); permissions.publishPermissionProfile(profile());
    let deliver!: (value: Response) => void, current = true, invalidations = 0;
    globalThis.fetch = (async () => new Promise(resolve => { deliver = resolve; })) as any;
    const stop = foundation.subscribeProtectedDataInvalidation(() => invalidations++);
    const pending = api.inventoryRequest('/api/inventory', method, method === 'POST' ? { quantity: 1 } : undefined, undefined, () => current);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await flush(); current = false; deliver(response(status)); await rejected;
    assert.equal(invalidations, 0, 'an old response must not invalidate current protected data'); checks++; stop();
  }
  for (const status of [401, 403]) {
    auth.currentUser = user(); permissions.publishPermissionProfile(profile());
    let invalidations = 0;
    const stop = foundation.subscribeProtectedDataInvalidation(() => invalidations++);
    globalThis.fetch = (async () => response(status)) as any;
    await assert.rejects(api.inventoryRequest('/api/inventory?branchId=A'), (error: any) => error.status === status);
    assert.equal(invalidations, 1, 'a current denial still invalidates'); checks++; stop();
  }
  for (const change of ['account', 'invalidate', 'abort', 'permission']) for (const status of [200, 403]) {
    auth.currentUser = user(); permissions.publishPermissionProfile(profile());
    let deliver!: (value: Response) => void;
    globalThis.fetch = (async () => new Promise(resolve => { deliver = resolve; })) as any;
    const controller = new AbortController();
    const pending = api.inventoryRequest('/api/inventory/movements', 'POST', { quantity: 1 }, controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush();
    if (change === 'account') auth.currentUser = { ...user(), uid: 'replacement' };
    if (change === 'invalidate') foundation.invalidateProtectedData();
    if (change === 'abort') controller.abort();
    if (change === 'permission') permissions.publishPermissionProfile(profile(2));
    deliver(response(status)); await rejected; checks++;
  }
  auth.currentUser = user(); permissions.publishPermissionProfile(profile());
  let deliverBody!: (value: unknown) => void, current = true;
  globalThis.fetch = (async () => {
    const result = response(403);
    Object.defineProperty(result, 'json', { configurable: true, value: () => new Promise(resolve => { deliverBody = resolve; }) });
    return result;
  }) as any;
  const pending = api.inventoryRequest('/api/inventory/movements', 'POST', {}, undefined, () => current);
  const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush();
  current = false; deliverBody({ error: 'Obsolete denial' }); await rejected; checks++;

  let token!: (value: string) => void, fetched = false;
  permissions.publishPermissionProfile(profile());
  auth.currentUser = { ...user(), getRequestToken: () => new Promise(resolve => { token = resolve; }) };
  globalThis.fetch = (async () => { fetched = true; return response(200); }) as any;
  const old = api.inventoryRequest('/api/inventory'), oldRejected = assert.rejects(old, { name: 'AbortError' });
  auth.currentUser = { ...user(), uid: 'replacement' }; token('synthetic'); await oldRejected;
  assert.equal(fetched, false, 'obsolete authentication must never start a request'); checks++;

  auth.currentUser = user(); permissions.publishPermissionProfile(profile());
  let sent: any;
  globalThis.fetch = (async (url, init) => { sent = { url, init }; return response(200); }) as any;
  await api.transferRequest('complete', { id: 'synthetic-transfer' });
  assert.equal(sent.url, '/api/inventory/transfers/complete');
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.headers.Authorization, 'Bearer synthetic');
  assert.deepEqual(JSON.parse(sent.init.body), { id: 'synthetic-transfer' }); checks++;
  console.log(`${checks}/${checks} inventory transport checks passed.`);
} finally { Object.assign(globalThis, saved); }
