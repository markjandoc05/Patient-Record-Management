import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const target = process.argv[2] || process.cwd();
const saved = { fetch: globalThis.fetch, timeout: globalThis.setTimeout, interval: globalThis.setInterval, error: console.error };
let timers: (() => void)[] = [], pending: ((response: Response) => void)[] = [], stops: (() => void)[] = [];
let observedFailures = 0;
console.error = () => { observedFailures++; };
globalThis.setTimeout = ((callback: () => void) => { timers.push(callback); return 0; }) as any;
globalThis.setInterval = (() => 0) as any;
globalThis.fetch = (async (url: any) => {
  if (url === '/api/auth/session') return new Response(JSON.stringify({ user: { uid: 'synthetic-user' }, csrfToken: 'synthetic' }));
  if (url === '/api/auth/logout') return new Response('{}');
  return new Promise<Response>(resolve => pending.push(resolve));
}) as any;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const records = () => new Response(JSON.stringify({ documents: [{ id: 'synthetic', data: { branchId: 'branch-0' } }] }));
const populate = async () => { await flush(); pending.splice(0).forEach(resolve => resolve(records())); await flush(); };
const tick = async () => { timers.splice(0).forEach(callback => callback()); await flush(); };
const cleanup = () => { stops.splice(0).forEach(stop => stop()); timers = []; pending = []; };
const results: { name: string; passed: boolean; error?: string }[] = [];
const test = async (name: string, run: () => Promise<void>) => {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); }
  finally { cleanup(); }
};
try {
  const api = await import(pathToFileURL(path.join(target, 'src/dataClient.ts')).href);
  const session = await import(pathToFileURL(path.join(target, 'src/session.ts')).href);
  const branches = await import(pathToFileURL(path.join(target, 'src/utils/branchAccess.ts')).href);
  const { onSnapshot, collection, doc, db, invalidateProtectedData } = api;
  for (const failing of [[0], [1], [2], [0, 2]]) await test(`reset isolation: throwing ${failing.join(',')}`, async () => {
    const rows = [[], [], []] as any[][], calls = [0, 0, 0];
    for (let i = 0; i < 3; i++) stops.push(onSnapshot(collection(db, 'patients'), (snapshot: any) => {
      if (snapshot.empty) { calls[i]++; if (failing.includes(i)) throw new Error('synthetic callback failure'); }
      rows[i] = snapshot.docs;
    }, () => { if (failing.includes(i)) throw new Error('old contract callback failure'); }));
    await populate();
    const before = observedFailures;
    assert.doesNotThrow(() => invalidateProtectedData());
    assert.deepEqual(calls, [1, 1, 1]);
    for (let i = 0; i < 3; i++) if (!failing.includes(i)) assert.deepEqual(rows[i], []);
    assert.equal(observedFailures - before, failing.length);
  });
  for (const reason of ['explicit invalidation', 'profile/branch scope change']) await test(reason, async () => {
    let rows: any[] = [], errors = 0;
    stops.push(onSnapshot(collection(db, 'inventory_items'), (snapshot: any) => { rows = snapshot.docs; }));
    stops.push(onSnapshot(collection(db, 'appointments'), () => {}, () => { errors++; }));
    await populate(); assert.equal(rows.length, 1);
    invalidateProtectedData(reason); assert.deepEqual(rows, []); assert.equal(errors, 0);
  });
  await test('sign-out through session listener', async () => {
    let rows: any[] = [];
    // Same session listener contract used by App; exercise the real logout API.
    stops.push(session.onAuthStateChanged(session.auth, (user: any) => { if (!user) invalidateProtectedData(); }));
    stops.push(onSnapshot(collection(db, 'patients'), (snapshot: any) => { rows = snapshot.docs; }));
    await populate(); assert.equal(rows.length, 1);
    await session.signOut(session.auth); assert.deepEqual(rows, []);
  });
  for (const status of [401, 403]) await test(`authorization loss ${status}`, async () => {
    let rows: any[] = [], errors = 0;
    stops.push(onSnapshot(collection(db, 'patients'), (snapshot: any) => { rows = snapshot.docs; }));
    stops.push(onSnapshot(collection(db, 'users'), () => {}, () => { errors++; }));
    await populate(); await tick();
    pending.splice(0).forEach(resolve => resolve(new Response(JSON.stringify({ error: 'synthetic denial' }), { status })));
    await flush(); assert.deepEqual(rows, []);
    // A second poll delivers the other subscription's actual request error.
    await tick(); pending.splice(0).forEach(resolve => resolve(new Response('{}', { status })));
    await flush(); assert.equal(errors, 1);
    await tick(); pending.splice(0).forEach(resolve => resolve(records())); await flush();
    assert.equal(rows.length, 1);
  });
  await test('temporary 5xx and network loss retain data; recovery; later denial clears', async () => {
    let rows: any[] = [], errors = 0;
    stops.push(onSnapshot(collection(db, 'patients'), (snapshot: any) => { rows = snapshot.docs; }, () => { errors++; }));
    await populate(); await tick(); pending.shift()!(new Response('{}', { status: 503 })); await flush();
    assert.equal(rows.length, 1); assert.equal(errors, 1);
    const requestFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('synthetic network failure'); };
    await tick(); await flush(); assert.equal(rows.length, 1); assert.equal(errors, 1);
    globalThis.fetch = requestFetch;
    await tick(); pending.shift()!(records()); await flush(); assert.equal(rows.length, 1);
    await tick(); pending.shift()!(new Response('{}', { status: 403 })); await flush(); assert.deepEqual(rows, []); assert.equal(errors, 2);
  });
  await test('in-flight old generation cannot repopulate reset state', async () => {
    let rows: any[] = [{ id: 'cached' }];
    stops.push(onSnapshot(collection(db, 'patients'), (snapshot: any) => { rows = snapshot.docs; }));
    await flush(); const stale = pending.shift()!; invalidateProtectedData(); stale(records()); await flush(); assert.deepEqual(rows, []);
    await tick(); pending.shift()!(records()); await flush(); assert.equal(rows.length, 1);
  });
  await test('protected document receives null reset', async () => {
    let data: any;
    stops.push(onSnapshot(doc(db, 'patients', 'synthetic'), (snapshot: any) => { data = snapshot.data(); }));
    await flush(); pending.shift()!(new Response(JSON.stringify({ document: { id: 'synthetic', data: { attachments: ['synthetic'] } } }))); await flush();
    assert.ok(data.attachments); invalidateProtectedData(); assert.equal(data, null);
  });
  await test('multi-chunk reset is atomic and emitted once', async () => {
    const emissions: any[][] = [];
    stops.push(branches.subscribeToBranchScopedCollection(db, 'appointments', 'branchId', { role: 'staff', assignedBranches: Array.from({ length: 31 }, (_, i) => `branch-${i}`) }, (rows: any[]) => emissions.push(rows)));
    await populate(); const before = emissions.length; invalidateProtectedData();
    assert.deepEqual(emissions.slice(before), [[]]);
  });
  await test('public settings and own profile are exempt; unsubscribe prevents callbacks', async () => {
    session.auth.currentUser = { uid: 'synthetic-user', getRequestToken: async () => '' };
    let resets = 0;
    stops.push(onSnapshot(doc(db, 'settings', 'branding'), () => { resets++; }));
    stops.push(onSnapshot(doc(db, 'users', 'synthetic-user'), () => { resets++; }));
    const stop = onSnapshot(collection(db, 'patients'), () => { resets++; }); stop();
    invalidateProtectedData(); assert.equal(resets, 0);
  });
  console.log(JSON.stringify(results, null, 2));
  console.log(`${results.filter(result => result.passed).length}/${results.length} protected invalidation scenarios passed.`);
  if (results.some(result => !result.passed)) process.exitCode = 1;
} finally {
  cleanup(); globalThis.fetch = saved.fetch; globalThis.setTimeout = saved.timeout; globalThis.setInterval = saved.interval; console.error = saved.error;
}
