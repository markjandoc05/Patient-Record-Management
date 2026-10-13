import assert from 'node:assert/strict';

// Exercise the real chart adapter and protected cache with intentionally late
// transport and body replies. This is controlled evidence, not a browser login.
const saved = { fetch: globalThis.fetch, interval: globalThis.setInterval, timeout: globalThis.setTimeout };
globalThis.setInterval = (() => 0) as any;
globalThis.setTimeout = (() => 0) as any;
globalThis.fetch = (async () => new Response(JSON.stringify({ user: { uid: 'synthetic-chart-user' }, csrfToken: 'synthetic' }))) as any;
const { auth } = await import('../src/session');
await auth.ready;
const foundation = await import('../src/dataClient');
const api = await import('../src/utils/clinicalChartsApi');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
let checks = 0;
const verify = (run: () => void) => { run(); checks++; };
const user = () => ({ uid: 'synthetic-chart-user', getRequestToken: async () => 'synthetic' } as any);
const response = (status: number) => new Response(JSON.stringify(status === 200 ? { visitId: 'visit-1', chart: null } : { error: 'Synthetic denial', code: 'TEST_DENIAL' }), { status });
const stops: (() => void)[] = [];
try {
  for (const mutation of [false, true]) for (const status of [200, 401, 403, 409]) {
    auth.currentUser = user();
    let deliver!: (value: Response) => void, current = true;
    globalThis.fetch = (async () => new Promise<Response>(resolve => { deliver = resolve; })) as any;
    let invalidations = 0;
    const stop = foundation.subscribeProtectedDataInvalidation(() => invalidations++); stops.push(stop);
    const pending = mutation ? api.saveClinicalChartDraft('visit-1', { expectedVersion: 0, expectedContextKey: 'ctx', markers: [], notes: '' }, { isCurrent: () => current }) : api.getClinicalChart('visit-1', { isCurrent: () => current });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await flush(); current = false; deliver(response(status)); await rejected;
    verify(() => assert.equal(invalidations, 0, 'stale reply cannot invalidate current protected scope'));
    stop();
  }
  for (const status of [401, 403]) {
    auth.currentUser = user(); let rows: any[] = [];
    globalThis.fetch = (async (url: any) => url === '/api/data/query'
      ? new Response(JSON.stringify({ documents: [{ id: 'current', data: { marker: 'CURRENT_SCOPE' } }] })) : response(status)) as any;
    const stop = foundation.onSnapshot(foundation.collection(foundation.db, 'visits'), snapshot => { rows = snapshot.docs; }); stops.push(stop);
    await flush(); verify(() => assert.equal(rows[0]?.data().marker, 'CURRENT_SCOPE'));
    await assert.rejects(api.getClinicalChart('visit-1'), (error: any) => error.status === status);
    verify(() => assert.equal(rows.length, 0, 'current denial clears protected data'));
    stop();
  }
  for (const change of ['identity', 'invalidation', 'abort']) {
    auth.currentUser = user(); let deliver!: (value: Response) => void;
    globalThis.fetch = (async () => new Promise<Response>(resolve => { deliver = resolve; })) as any;
    const controller = new AbortController(); const pending = api.getClinicalChart('visit-1', { signal: controller.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' }); await flush();
    if (change === 'identity') auth.currentUser = { ...user(), uid: 'new-user' };
    if (change === 'invalidation') foundation.invalidateProtectedData();
    if (change === 'abort') controller.abort();
    deliver(response(200)); await rejected; checks++;
  }
  auth.currentUser = user(); let body!: (value: unknown) => void, current = true;
  globalThis.fetch = (async () => {
    const value = response(403); Object.defineProperty(value, 'json', { configurable: true, value: () => new Promise(resolve => { body = resolve; }) }); return value;
  }) as any;
  const pendingBody = api.signClinicalChart('visit-1', { expectedVersion: 1, expectedContextKey: 'ctx' }, { isCurrent: () => current });
  const rejectedBody = assert.rejects(pendingBody, { name: 'AbortError' }); await flush(); current = false; body({ error: 'OLD_DENIAL' }); await rejectedBody; checks++;
  let token!: (value: string) => void; auth.currentUser = { ...user(), getRequestToken: () => new Promise(resolve => { token = resolve; }) };
  let fetched = false; globalThis.fetch = (async () => { fetched = true; return response(200); }) as any;
  const pendingToken = api.getClinicalChart('visit-1'); const rejectedToken = assert.rejects(pendingToken, { name: 'AbortError' });
  auth.currentUser = { ...user(), uid: 'new-user' }; token('synthetic'); await rejectedToken; verify(() => assert.equal(fetched, false));
  auth.currentUser = user(); globalThis.fetch = (async () => new Response(JSON.stringify({ visitId: 'other-visit' }))) as any;
  await assert.rejects(api.getClinicalChart('visit-1'), (error: any) => error.status === 502); checks++;
  console.log(`${checks}/${checks} clinical chart transport checks passed.`);
} finally {
  stops.forEach(stop => stop()); Object.assign(globalThis, saved);
}
