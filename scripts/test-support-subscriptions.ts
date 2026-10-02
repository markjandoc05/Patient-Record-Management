import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
const originalInterval = globalThis.setInterval;
const timers: (() => void)[] = [];
const pending: { body: any; resolve: (response: Response) => void }[] = [];
const stops: (() => void)[] = [];
globalThis.setTimeout = ((callback: any) => { timers.push(callback); return 0; }) as any;
globalThis.setInterval = (() => 0) as any;
globalThis.fetch = (async (url: any, options: any) => {
  if (url === '/api/auth/session') return new Response(JSON.stringify({ user: null }), { status: 401 });
  return new Promise<Response>(resolve => pending.push({ body: JSON.parse(options.body), resolve }));
}) as any;
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const response = (id: string, branchId = 'demo-branch') => new Response(JSON.stringify({ documents: [{ id, data: { branchId } }] }));
let checks = 0;
try {
  const { onSnapshot, collection, db, invalidateProtectedData } = await import('../src/dataClient');
  const { subscribeToBranchScopedCollection } = await import('../src/utils/branchAccess');
  const rows: any[] = [], errors: any[] = [];
  const stop = onSnapshot(collection(db, 'appointments'), snapshot => rows.push(snapshot.docs.map((doc: any) => doc.data())), error => errors.push(error));
  stops.push(stop);
  await flush();
  const oldRequest = pending.shift()!;
  invalidateProtectedData();
  oldRequest.resolve(response('stale'));
  await flush();
  assert.deepEqual(rows, [[]]); assert.equal(errors.length, 0); checks++;
  timers.shift()!(); await flush(); pending.shift()!.resolve(response('current')); await flush();
  assert.equal(rows.length, 2); checks++;
  stop(); timers.length = 0;

  const allRows: Record<string, any[]> = {}, allErrors: string[] = [];
  for (const source of ['patients', 'appointments']) stops.push(onSnapshot(collection(db, source), snapshot => { allRows[source] = snapshot.docs; }, () => { allRows[source] = []; allErrors.push(source); }));
  await flush();
  for (const request of pending.splice(0)) request.resolve(response(request.body.path));
  await flush();
  assert.equal(allRows.patients.length, 1); assert.equal(allRows.appointments.length, 1);
  timers.shift()!(); timers.shift()!(); await flush();
  const inFlight = pending.splice(0);
  inFlight[0].resolve(new Response(JSON.stringify({ error: 'denied' }), { status: 403 })); await flush();
  inFlight[1].resolve(response('late-protected')); await flush();
  assert.deepEqual(allRows.patients, []); assert.deepEqual(allRows.appointments, []); assert.equal(allErrors.length, 1); checks++;
  for (const stop of stops) stop(); timers.length = 0;

  const merged: any[] = [], mergeErrors: any[] = [];
  const stopMerge = subscribeToBranchScopedCollection(db, 'appointments', 'branchId', { role: 'staff', assignedBranches: Array.from({ length: 31 }, (_, i) => `branch-${i}`) }, rows => merged.push(rows), error => mergeErrors.push(error), [], true);
  stops.push(stopMerge);
  await flush();
  pending.shift()!.resolve(response('chunk-a', 'branch-0'));
  pending.shift()!.resolve(response('chunk-b', 'branch-30'));
  await flush();
  assert.equal(merged.at(-1).length, 2);
  timers.shift()!(); await flush();
  pending.shift()!.resolve(new Response(JSON.stringify({ error: 'permission revoked' }), { status: 403 })); await flush();
  assert.deepEqual(merged.at(-1), []); assert.ok(mergeErrors.length); checks++;
  stopMerge(); timers.length = 0;

  const rapidRows: any[] = [];
  const obsolete: any[] = [];
  for (const branch of ['demo-branch', 'acceptance-branch-b', 'demo-branch']) {
    const stopBranch = subscribeToBranchScopedCollection(db, 'appointments', 'branchId', { role: 'staff', assignedBranches: [branch] }, rows => rapidRows.push(rows));
    stops.push(stopBranch); await flush();
    const request = pending.shift()!;
    if (obsolete.length < 2) { obsolete.push(request); stopBranch(); invalidateProtectedData(); }
    else { request.resolve(response('latest')); await flush(); }
  }
  obsolete.reverse().forEach(request => request.resolve(response('obsolete', 'acceptance-branch-b'))); await flush();
  assert.equal(rapidRows.length, 1); assert.equal(rapidRows[0][0].id, 'latest'); checks++;
  console.log(`${checks} protected-cache and rapid-scope scenarios passed (controlled HTTP responses).`);
} finally {
  for (const stop of stops) stop();
  globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; globalThis.setInterval = originalInterval;
}
