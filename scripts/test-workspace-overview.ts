import assert from 'node:assert/strict';
import { emptyOverviewState, overviewSources, subscribeOverviewData, workspaceAccessScope, type OverviewSource, type OverviewState } from '../src/utils/workspaceOverview';
let checks = 0;
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; };
const profile = { role: 'staff', active: true, assignedBranches: ['A', 'B'] };
const scope = workspaceAccessScope('test-user', profile);
check(scope === workspaceAccessScope('test-user', { ...profile, fullName: 'Changed display name' }), 'Descriptive changes retain access scope');
check(scope === workspaceAccessScope('test-user', { ...profile, assignedBranches: ['B', 'A', 'A'] }), 'Branch order is not a permission change');
for (const next of [{ ...profile, role: 'doctor' }, { ...profile, assignedBranches: ['A'] }, { ...profile, active: false }, { ...profile, isArchived: true }]) check(scope !== workspaceAccessScope('test-user', next), 'Material access change invalidates scope');
check(scope !== workspaceAccessScope('another-user', profile), 'Identity changes invalidate scope');
check(workspaceAccessScope(undefined, profile) === '' && workspaceAccessScope('test-user', null) === '', 'Unresolved identity/profile has no access scope');

function harness() {
  const callbacks = new Map<OverviewSource, { success: (rows: any[]) => void; fail: (error: any) => void }>();
  const states: OverviewState[] = [];
  let subscriptions = 0, cleanups = 0;
  const stop = subscribeOverviewData((source, success, fail) => {
    subscriptions++; callbacks.set(source, { success, fail }); return () => cleanups++;
  }, state => states.push(state));
  return { callbacks, states, stop, get state() { return states.at(-1)!; }, get subscriptions() { return subscriptions; }, get cleanups() { return cleanups; }, finish() { overviewSources.forEach(source => callbacks.get(source)!.success([{ id: source + '-A' }])); } };
}
const current = harness();
check(!current.state.ready, 'Initial overview stays loading');
current.callbacks.get('patients')!.success([]); current.callbacks.get('appointments')!.success([]);
check(!current.state.ready, 'All permitted sources must finish before ready');
current.callbacks.get('visits')!.success([]);
check(current.state.ready, 'Empty authorized collections become ready');
current.finish();
check(current.subscriptions === 3, 'Exactly three persistent sources');
for (let cycle = 0; cycle < 3; cycle++) { current.finish(); check(current.state.ready, 'Background refresh stays usable'); }
current.callbacks.get('patients')!.fail({ status: 503 });
check(current.state.ready && current.state.data.patients.length === 1 && !!current.state.errors.patients, 'Transient refresh preserves valid rows with a warning');
current.callbacks.get('patients')!.success([{ id: 'refreshed-patient' }]);
check(!current.state.errors.patients && current.state.data.patients[0].id === 'refreshed-patient', 'Successful polling clears warning and updates rows');
for (const failure of [{ status: 401 }, { status: 403 }, { code: 'permission-denied' }]) {
  current.callbacks.get('appointments')!.fail(failure);
  check(!current.state.ready && Object.values(current.state.data).every(rows => rows.length === 0), 'Authorization failures clear every protected source');
  current.callbacks.get('appointments')!.success([]);
  check(!current.state.ready, 'One recovered source cannot restore an invalidated workspace');
  current.finish(); check(current.state.ready, 'All sources must revalidate after a denial');
}
const oldStates = current.states.length; current.stop();
current.callbacks.get('patients')!.success([{ id: 'late-old-scope' }]);
current.callbacks.get('visits')!.fail({ status: 403 });
check(current.states.length === oldStates && current.cleanups === 3, 'Disposed generation cannot publish success or denial');
const next = harness();
check(!next.state.ready && JSON.stringify(next.state.data) === JSON.stringify(emptyOverviewState().data), 'Material scope change starts without old records');
next.finish(); next.stop();
console.log(`${checks} workspace overview state/security checks passed.`);
